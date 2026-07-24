package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

var (
	lotteryGuestIDMu sync.RWMutex
	lotteryGuestID   int
)

// IsLotteryGuestUserId reports whether the user id is the seeded lottery guest.
func IsLotteryGuestUserId(userId int) bool {
	if userId <= 0 {
		return false
	}
	lotteryGuestIDMu.RLock()
	cached := lotteryGuestID
	lotteryGuestIDMu.RUnlock()
	if cached > 0 {
		return userId == cached
	}
	username, err := GetUsernameById(userId, false)
	if err != nil {
		return false
	}
	return common.IsLotteryGuestUsername(username)
}

// IsLotteryGuestUsername is a thin wrapper for callers outside common.
func IsLotteryGuestUsername(username string) bool {
	return common.IsLotteryGuestUsername(username)
}

// LotteryGuestSidebarModulesJSON restricts the guest UI to wallet + lottery.
func LotteryGuestSidebarModulesJSON() string {
	cfg := map[string]interface{}{
		"chat": map[string]interface{}{
			"enabled":    false,
			"playground": false,
			"chat":       false,
		},
		"drawing": map[string]interface{}{
			"enabled": false,
			"draw":    false,
		},
		"console": map[string]interface{}{
			"enabled":    false,
			"detail":     false,
			"token":      false,
			"log":        false,
			"midjourney": false,
			"task":       false,
		},
		"personal": map[string]interface{}{
			"enabled":  true,
			"topup":    true, // wallet
			"lottery":  true,
			"personal": false,
		},
		"admin": map[string]interface{}{
			"enabled":      false,
			"channel":      false,
			"models":       false,
			"redemption":   false,
			"user":         false,
			"setting":      false,
			"subscription": false,
		},
	}
	b, err := common.Marshal(cfg)
	if err != nil {
		return ""
	}
	return string(b)
}

// EnsureLotteryGuestUser creates or repairs the public lottery demo account.
// Idempotent; safe to call on every master-node startup.
func EnsureLotteryGuestUser() error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	targetQuota := DisplayAmountToQuota(common.LotteryGuestQuotaDisplay)
	if targetQuota <= 0 {
		return fmt.Errorf("invalid lottery guest quota")
	}
	sidebar := LotteryGuestSidebarModulesJSON()

	var user User
	err := DB.Where("username = ?", common.LotteryGuestUsername).First(&user).Error
	if err != nil {
		hashed, hashErr := common.Password2Hash(common.LotteryGuestPassword)
		if hashErr != nil {
			return hashErr
		}
		user = User{
			Username:    common.LotteryGuestUsername,
			Password:    hashed,
			DisplayName: common.LotteryGuestDisplayName,
			Role:        common.RoleCommonUser,
			Status:      common.UserStatusEnabled,
			Quota:       targetQuota,
			Remark:      "lottery_guest_public_demo",
			AffCode:     common.GetRandomString(4),
		}
		setting := dto.UserSetting{SidebarModules: sidebar}
		user.SetSetting(setting)
		if createErr := DB.Create(&user).Error; createErr != nil {
			if findErr := DB.Where("username = ?", common.LotteryGuestUsername).First(&user).Error; findErr != nil {
				return createErr
			}
		} else {
			common.SysLog(fmt.Sprintf("created lottery guest user id=%d username=%s", user.Id, user.Username))
		}
	}

	// Repair fields every boot so the published password / quota stay correct.
	// Reload with password for hash check.
	_ = DB.Select("id", "password", "setting", "access_token").First(&user, user.Id).Error
	setting := user.GetSetting()
	setting.SidebarModules = sidebar
	user.SetSetting(setting)

	updates := map[string]interface{}{
		"display_name": common.LotteryGuestDisplayName,
		"role":         common.RoleCommonUser,
		"status":       common.UserStatusEnabled,
		"quota":        targetQuota,
		"used_quota":   0,
		"remark":       "lottery_guest_public_demo",
		"setting":      user.Setting,
	}
	if user.Password == "" || !common.ValidatePasswordAndHash(common.LotteryGuestPassword, user.Password) {
		hashed, hashErr := common.Password2Hash(common.LotteryGuestPassword)
		if hashErr != nil {
			return hashErr
		}
		updates["password"] = hashed
	}

	if err := DB.Model(&User{}).Where("id = ?", user.Id).Updates(updates).Error; err != nil {
		return err
	}
	// Clear access token so guest cannot use management PAT / relay.
	_ = DB.Model(&User{}).Where("id = ?", user.Id).Update("access_token", nil).Error

	// Refresh local struct for cache.
	_ = DB.First(&user, user.Id).Error

	lotteryGuestIDMu.Lock()
	lotteryGuestID = user.Id
	lotteryGuestIDMu.Unlock()

	if err := updateUserCache(user); err != nil {
		common.SysLog("lottery guest cache update: " + err.Error())
	}
	// Drop any tokens that may have been created historically.
	if err := DB.Where("user_id = ?", user.Id).Delete(&Token{}).Error; err != nil {
		common.SysLog("lottery guest token cleanup: " + err.Error())
	}
	common.SysLog(fmt.Sprintf("lottery guest ready id=%d quota_display=%d", user.Id, common.LotteryGuestQuotaDisplay))
	return nil
}

// EnsureLotteryGuestAnnouncement inserts a public announcement with demo credentials
// if one is not already present (matched by username marker).
func EnsureLotteryGuestAnnouncement() error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	key := "console_setting.announcements"
	var opt Option
	err := DB.Where(&Option{Key: key}).First(&opt).Error
	if err != nil {
		content := lotteryGuestAnnouncementContent()
		list := []map[string]interface{}{content}
		raw, mErr := json.Marshal(list)
		if mErr != nil {
			return mErr
		}
		if vErr := console_setting.ValidateConsoleSettings(string(raw), "Announcements"); vErr != nil {
			return vErr
		}
		if uErr := UpdateOption(key, string(raw)); uErr != nil {
			return uErr
		}
		_ = UpdateOption("console_setting.announcements_enabled", "true")
		return nil
	}

	raw := strings.TrimSpace(opt.Value)
	var list []map[string]interface{}
	if raw != "" && raw != "[]" {
		if uErr := json.Unmarshal([]byte(raw), &list); uErr != nil {
			list = nil
		}
	}
	for _, item := range list {
		if c, ok := item["content"].(string); ok && strings.Contains(c, common.LotteryGuestUsername) {
			_ = UpdateOption("console_setting.announcements_enabled", "true")
			return nil
		}
	}
	list = append([]map[string]interface{}{lotteryGuestAnnouncementContent()}, list...)
	if len(list) > 100 {
		list = list[:100]
	}
	out, err := json.Marshal(list)
	if err != nil {
		return err
	}
	if err := console_setting.ValidateConsoleSettings(string(out), "Announcements"); err != nil {
		return err
	}
	if err := UpdateOption(key, string(out)); err != nil {
		return err
	}
	_ = UpdateOption("console_setting.announcements_enabled", "true")
	common.SysLog("lottery guest announcement seeded")
	return nil
}

func lotteryGuestAnnouncementContent() map[string]interface{} {
	text := fmt.Sprintf(
		"【抽奖体验游客号】公开验概率、无作假：账号 %s / 密码 %s。仅可访问钱包与抽奖；抽奖不扣余额、不写使用日志/高光、次数无限；密码不可修改。欢迎自行体验。",
		common.LotteryGuestUsername,
		common.LotteryGuestPassword,
	)
	if len(text) > 500 {
		text = text[:500]
	}
	return map[string]interface{}{
		"id":          time.Now().Unix()%1000000 + 700000,
		"content":     text,
		"publishDate": time.Now().UTC().Format(time.RFC3339),
		"type":        "success",
		"extra":       "lottery_guest_demo",
	}
}

// UserLotteryDrawGuest dry-runs a draw: same RNG as production, no balance change,
// no order / public-win / usage-log writes. Unlimited remaining draws.
func UserLotteryDrawGuest(userId int, mode string) (*LotteryDrawResult, error) {
	setting := operation_setting.GetLotterySetting()
	if setting == nil || !setting.Enabled {
		return nil, fmt.Errorf("抽奖功能未启用")
	}
	mode = strings.ToLower(strings.TrimSpace(mode))
	var need int
	var costDisplay float64
	var weights []operation_setting.LotteryPrizeWeight
	switch mode {
	case "single":
		need = 1
		costDisplay = setting.SingleCost
		if costDisplay <= 0 {
			costDisplay = 1
		}
		weights = setting.EffectiveSingleWeights()
	case "multi":
		need = setting.MultiDraws
		if need <= 0 {
			need = 10
		}
		costDisplay = setting.MultiCost
		if costDisplay <= 0 {
			costDisplay = 8
		}
		weights = setting.EffectiveMultiWeights()
	default:
		return nil, fmt.Errorf("无效的抽奖模式")
	}
	if len(weights) == 0 {
		return nil, fmt.Errorf("奖池未配置")
	}

	// Keep fixed display balance (no prize/cost effect).
	targetQuota := DisplayAmountToQuota(common.LotteryGuestQuotaDisplay)
	if targetQuota > 0 {
		_ = DB.Model(&User{}).Where("id = ?", userId).Update("quota", targetQuota).Error
	}

	prizes := make([]float64, 0, need)
	indexes := make([]int, 0, need)
	var totalDisplay float64
	for i := 0; i < need; i++ {
		amt, _, err := SampleWeightedPrize(weights)
		if err != nil {
			return nil, err
		}
		prizes = append(prizes, amt)
		indexes = append(indexes, PrizeIndexInOrder(amt))
		totalDisplay += amt
	}

	bigWins := make([]float64, 0)
	thresh := setting.BigWinThreshold
	if thresh <= 0 {
		thresh = 5
	}
	for _, p := range prizes {
		if p+1e-9 >= thresh {
			bigWins = append(bigWins, p)
		}
	}

	var finalUser User
	if err := DB.Select("quota").Where("id = ?", userId).First(&finalUser).Error; err != nil {
		finalUser.Quota = targetQuota
	}

	return &LotteryDrawResult{
		Mode:              mode,
		CostDisplay:       costDisplay,
		Prizes:            prizes,
		TotalPrizeDisplay: totalDisplay,
		SlotIndexes:       indexes,
		BigWins:           bigWins,
		RemainingDraws:    common.LotteryGuestRemainingDraws,
		Quota:             finalUser.Quota,
		DrawDate:          LotteryToday(setting),
	}, nil
}
