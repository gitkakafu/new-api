package model

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LotteryOrder 每次 draw 一单
type LotteryOrder struct {
	Id               int64   `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId           int     `json:"user_id" gorm:"not null;index:idx_lottery_user_date"`
	Mode             string  `json:"mode" gorm:"type:varchar(16);not null"` // single | multi
	CostQuota        int64   `json:"cost_quota" gorm:"not null"`
	DrawCount        int     `json:"draw_count" gorm:"not null"`
	PrizesJSON       string  `json:"prizes_json" gorm:"type:text;not null"`
	TotalPrizeQuota  int64   `json:"total_prize_quota" gorm:"not null"`
	TotalPrizeDisplay float64 `json:"total_prize_display" gorm:"type:decimal(12,4);not null"`
	DrawDate         string  `json:"draw_date" gorm:"type:varchar(10);not null;index:idx_lottery_user_date"`
	CreatedAt        int64   `json:"created_at" gorm:"bigint;index"`
}

func (LotteryOrder) TableName() string { return "lottery_orders" }

// LotteryPublicWin 高光播报（prize ≥ public_win_min）
type LotteryPublicWin struct {
	Id            int64   `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId        int     `json:"user_id" gorm:"not null;index"`
	DisplayName   string  `json:"display_name" gorm:"type:varchar(32);not null"`
	PrizeDisplay  float64 `json:"prize_display" gorm:"type:decimal(12,4);not null"`
	PrizeQuota    int64   `json:"prize_quota" gorm:"not null"`
	DrawDate      string  `json:"draw_date" gorm:"type:varchar(10);not null"`
	CreatedAt     int64   `json:"created_at" gorm:"bigint;index:idx_lottery_public_created"`
	OrderId       *int64  `json:"order_id" gorm:"index"`
	PrizeIndex    *int    `json:"prize_index"`
}

func (LotteryPublicWin) TableName() string { return "lottery_public_wins" }

// LotteryDrawResult 开奖结果（API 层）
type LotteryDrawResult struct {
	Mode               string    `json:"mode"`
	CostDisplay        float64   `json:"cost_display"`
	Prizes             []float64 `json:"prizes"`
	TotalPrizeDisplay  float64   `json:"total_prize_display"`
	SlotIndexes        []int     `json:"slot_indexes"`
	BigWins            []float64 `json:"big_wins"`
	RemainingDraws     int       `json:"remaining_draws"`
	Quota              int       `json:"quota"`
	DrawDate           string    `json:"draw_date"`
}

// LotteryPublicWinItem API 安全字段（无 user_id / 完整名）
type LotteryPublicWinItem struct {
	Date     string  `json:"date"`
	Username string  `json:"username"`
	Prize    float64 `json:"prize"`
}

// DisplayAmountToQuota 显示额度 → 内部 quota（四舍五入到整）
func DisplayAmountToQuota(display float64) int {
	return int(math.Round(display * common.QuotaPerUnit))
}

// LotteryToday 业务日 YYYY-MM-DD（配置时区）
func LotteryToday(setting *operation_setting.LotterySetting) string {
	loc := time.Local
	if setting != nil && setting.Timezone != "" {
		if l, err := time.LoadLocation(setting.Timezone); err == nil {
			loc = l
		}
	}
	return time.Now().In(loc).Format("2006-01-02")
}

// MaskLotteryUsername 用户名脱敏（设计 §3.2）
func MaskLotteryUsername(username string) string {
	username = strings.TrimSpace(username)
	if username == "" {
		return "*"
	}
	// 邮箱：本地段脱敏 + 保留域名结构
	if at := strings.LastIndex(username, "@"); at > 0 && at < len(username)-1 {
		local := username[:at]
		domain := username[at+1:]
		return maskRunes(local) + "@" + maskDomain(domain)
	}
	return maskRunes(username)
}

func maskDomain(domain string) string {
	parts := strings.Split(domain, ".")
	if len(parts) == 0 {
		return "*"
	}
	// 仅弱化主域名首部，保留 TLD 可读
	parts[0] = maskRunes(parts[0])
	return strings.Join(parts, ".")
}

func maskRunes(s string) string {
	n := utf8.RuneCountInString(s)
	if n <= 0 {
		return "*"
	}
	runes := []rune(s)
	switch {
	case n == 1:
		return "*"
	case n == 2:
		return string(runes[0]) + "*"
	case n <= 4:
		mid := strings.Repeat("*", n-2)
		return string(runes[0]) + mid + string(runes[n-1])
	default:
		return string(runes[0]) + "***" + string(runes[n-1])
	}
}

// SampleWeightedPrize 按权重表采样一档金额；随机源 crypto/rand
func SampleWeightedPrize(weights []operation_setting.LotteryPrizeWeight) (float64, int, error) {
	if len(weights) == 0 {
		return 0, -1, errors.New("empty lottery weights")
	}
	sumW := 0
	for _, w := range weights {
		if w.Weight < 0 {
			return 0, -1, errors.New("negative lottery weight")
		}
		sumW += w.Weight
	}
	if sumW <= 0 {
		return 0, -1, errors.New("zero lottery weight sum")
	}
	// roll ∈ [0, sumW)
	n, err := rand.Int(rand.Reader, big.NewInt(int64(sumW)))
	if err != nil {
		return 0, -1, err
	}
	roll := int(n.Int64())
	acc := 0
	for i, w := range weights {
		acc += w.Weight
		if roll < acc {
			return w.Amount, i, nil
		}
	}
	// 理论上不可达
	last := weights[len(weights)-1]
	return last.Amount, len(weights) - 1, nil
}

// PrizeIndexInOrder 金额 → PRIZE_ORDER 下标（前端卷轴）
func PrizeIndexInOrder(amount float64) int {
	order := operation_setting.PrizeOrder()
	for i, a := range order {
		if math.Abs(a-amount) < 1e-9 {
			return i
		}
	}
	// 回退：最近档
	best, bestDiff := 0, math.MaxFloat64
	for i, a := range order {
		d := math.Abs(a - amount)
		if d < bestDiff {
			bestDiff = d
			best = i
		}
	}
	return best
}

// GetUserLotteryDrawsToday 今日已用抽数
func GetUserLotteryDrawsToday(userId int, drawDate string) (int, error) {
	var sum int64
	err := DB.Model(&LotteryOrder{}).
		Select("COALESCE(SUM(draw_count), 0)").
		Where("user_id = ? AND draw_date = ?", userId, drawDate).
		Scan(&sum).Error
	if err != nil {
		return 0, err
	}
	return int(sum), nil
}

// ExpectedValue 权重表期望返还（显示额度）
func ExpectedValue(weights []operation_setting.LotteryPrizeWeight) float64 {
	sumW := 0
	var ev float64
	for _, w := range weights {
		sumW += w.Weight
		ev += float64(w.Weight) * w.Amount
	}
	if sumW == 0 {
		return 0
	}
	return ev / float64(sumW)
}

// WeightsToPublicTable 公示概率表
func WeightsToPublicTable(weights []operation_setting.LotteryPrizeWeight) []map[string]interface{} {
	sumW := 0
	for _, w := range weights {
		sumW += w.Weight
	}
	out := make([]map[string]interface{}, 0, len(weights))
	for _, w := range weights {
		p := 0.0
		if sumW > 0 {
			p = float64(w.Weight) / float64(sumW)
		}
		out = append(out, map[string]interface{}{
			"amount":  w.Amount,
			"weight":  w.Weight,
			"prob":    p,
			"contrib": p * w.Amount,
		})
	}
	return out
}

// UserLotteryDraw 服务端权威开奖（事务：日限 + 扣费 + 开奖 + 入账 + 写单 + 播报）
func UserLotteryDraw(userId int, mode string) (*LotteryDrawResult, error) {
	setting := operation_setting.GetLotterySetting()
	if setting == nil || !setting.Enabled {
		return nil, errors.New("抽奖功能未启用")
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
		return nil, errors.New("无效的抽奖模式")
	}

	dailyLimit := setting.DailyDrawLimit
	if dailyLimit <= 0 {
		dailyLimit = 10
	}
	drawDate := LotteryToday(setting)
	costQuota := DisplayAmountToQuota(costDisplay)
	if costQuota <= 0 {
		return nil, errors.New("抽奖成本配置无效")
	}

	// 开奖采样可在事务外（纯随机），但为与账本同事务失败可重试，放事务内也无妨；
	// 这里放事务内保证与扣费原子。
	var result *LotteryDrawResult
	var newQuota int

	run := func(tx *gorm.DB) error {
		// 锁用户行，防止双 tab 超扣
		var user User
		q := tx.Where("id = ?", userId)
		if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			q = q.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := q.First(&user).Error; err != nil {
			return errors.New("用户不存在")
		}
		if user.Quota < costQuota {
			return errors.New("余额不足")
		}

		var used int64
		if err := tx.Model(&LotteryOrder{}).
			Select("COALESCE(SUM(draw_count), 0)").
			Where("user_id = ? AND draw_date = ?", userId, drawDate).
			Scan(&used).Error; err != nil {
			return errors.New("查询今日抽奖次数失败")
		}
		if int(used)+need > dailyLimit {
			return fmt.Errorf("今日抽奖次数不足（已用 %d / %d）", used, dailyLimit)
		}
		// 十连：仅 used==0 时可抽（设计：仅剩余≥10 可十连；dailyLimit=10 时等价 used=0）
		if mode == "multi" && used > 0 {
			return errors.New("今日已抽过，无法使用十连（十连需剩余次数 ≥10）")
		}

		// 扣费（WHERE quota >= 防止并发超扣）
		deduct := tx.Model(&User{}).Where("id = ? AND quota >= ?", userId, costQuota).
			Update("quota", gorm.Expr("quota - ?", costQuota))
		if deduct.Error != nil {
			return errors.New("扣费失败")
		}
		if deduct.RowsAffected == 0 {
			return errors.New("余额不足")
		}

		prizes := make([]float64, 0, need)
		indexes := make([]int, 0, need)
		var totalDisplay float64
		for i := 0; i < need; i++ {
			amt, _, err := SampleWeightedPrize(weights)
			if err != nil {
				return err
			}
			prizes = append(prizes, amt)
			indexes = append(indexes, PrizeIndexInOrder(amt))
			totalDisplay += amt
		}
		creditQuota := DisplayAmountToQuota(totalDisplay)

		if creditQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota + ?", creditQuota)).Error; err != nil {
				return errors.New("入账失败")
			}
		}

		prizesBytes, err := json.Marshal(prizes)
		if err != nil {
			return err
		}
		order := &LotteryOrder{
			UserId:            userId,
			Mode:              mode,
			CostQuota:         int64(costQuota),
			DrawCount:         need,
			PrizesJSON:        string(prizesBytes),
			TotalPrizeQuota:   int64(creditQuota),
			TotalPrizeDisplay: totalDisplay,
			DrawDate:          drawDate,
			CreatedAt:         time.Now().Unix(),
		}
		if err := tx.Create(order).Error; err != nil {
			return errors.New("写入抽奖订单失败")
		}

		publicMin := setting.PublicWinMin
		if publicMin <= 0 {
			publicMin = 2
		}
		username, _ := GetUsernameById(userId, true)
		masked := MaskLotteryUsername(username)
		now := time.Now().Unix()
		for i, p := range prizes {
			if p+1e-9 < publicMin {
				continue
			}
			idx := i
			oid := order.Id
			win := &LotteryPublicWin{
				UserId:       userId,
				DisplayName:  masked,
				PrizeDisplay: p,
				PrizeQuota:   int64(DisplayAmountToQuota(p)),
				DrawDate:     drawDate,
				CreatedAt:    now,
				OrderId:      &oid,
				PrizeIndex:   &idx,
			}
			if err := tx.Create(win).Error; err != nil {
				return errors.New("写入公开播报失败")
			}
		}

		var finalUser User
		if err := tx.Select("quota").Where("id = ?", userId).First(&finalUser).Error; err != nil {
			return err
		}
		newQuota = finalUser.Quota

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
		remaining := dailyLimit - int(used) - need
		if remaining < 0 {
			remaining = 0
		}
		result = &LotteryDrawResult{
			Mode:              mode,
			CostDisplay:       costDisplay,
			Prizes:            prizes,
			TotalPrizeDisplay: totalDisplay,
			SlotIndexes:       indexes,
			BigWins:           bigWins,
			RemainingDraws:    remaining,
			Quota:             newQuota,
			DrawDate:          drawDate,
		}
		return nil
	}

	var err error
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		// SQLite：单连接串行；用 Transaction 仍可
		err = DB.Transaction(run)
	} else {
		err = DB.Transaction(run)
	}
	if err != nil {
		return nil, err
	}

	// 缓存：净变化 = 入账 - 扣费
	netDelta := DisplayAmountToQuota(result.TotalPrizeDisplay) - costQuota
	go func() {
		if netDelta > 0 {
			_ = cacheIncrUserQuota(userId, int64(netDelta))
		} else if netDelta < 0 {
			_ = cacheDecrUserQuota(userId, int64(-netDelta))
		}
	}()

	// 日志
	RecordLog(userId, LogTypeSystem, fmt.Sprintf(
		"抽奖消耗 %s（%s），获得 %s",
		logger.LogQuota(costQuota),
		mode,
		logger.LogQuota(DisplayAmountToQuota(result.TotalPrizeDisplay)),
	))

	return result, nil
}

// GetLotteryPublicWins 最近 N 条高光（无敏感字段）
func GetLotteryPublicWins(limit int) ([]LotteryPublicWinItem, int64, error) {
	if limit <= 0 {
		limit = 100
	}
	var rows []LotteryPublicWin
	err := DB.Model(&LotteryPublicWin{}).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	items := make([]LotteryPublicWinItem, 0, len(rows))
	var updatedAt int64
	for _, r := range rows {
		if r.CreatedAt > updatedAt {
			updatedAt = r.CreatedAt
		}
		items = append(items, LotteryPublicWinItem{
			Date:     r.DrawDate,
			Username: r.DisplayName,
			Prize:    r.PrizeDisplay,
		})
	}
	return items, updatedAt, nil
}

// GetUserLotteryHistory 自己的完整订单历史
func GetUserLotteryHistory(userId int, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var orders []LotteryOrder
	err := DB.Where("user_id = ?", userId).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&orders).Error
	if err != nil {
		return nil, err
	}
	out := make([]map[string]interface{}, 0, len(orders))
	for _, o := range orders {
		var prizes []float64
		_ = json.Unmarshal([]byte(o.PrizesJSON), &prizes)
		out = append(out, map[string]interface{}{
			"id":                  o.Id,
			"mode":                o.Mode,
			"cost_quota":          o.CostQuota,
			"draw_count":          o.DrawCount,
			"prizes":              prizes,
			"total_prize_display": o.TotalPrizeDisplay,
			"total_prize_quota":   o.TotalPrizeQuota,
			"draw_date":           o.DrawDate,
			"created_at":          o.CreatedAt,
		})
	}
	return out, nil
}

// GetLotteryStatusBundle status API 数据
func GetLotteryStatusBundle(userId int) (map[string]interface{}, error) {
	setting := operation_setting.GetLotterySetting()
	singleW := setting.EffectiveSingleWeights()
	multiW := setting.EffectiveMultiWeights()
	drawDate := LotteryToday(setting)
	used, err := GetUserLotteryDrawsToday(userId, drawDate)
	if err != nil {
		return nil, err
	}
	limit := setting.DailyDrawLimit
	if limit <= 0 {
		limit = 10
	}
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}
	user, err := GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	canSingle := remaining >= 1 && user.Quota >= DisplayAmountToQuota(setting.SingleCost)
	canMulti := used == 0 && remaining >= setting.MultiDraws && user.Quota >= DisplayAmountToQuota(setting.MultiCost)

	return map[string]interface{}{
		"enabled":              setting.Enabled,
		"single_cost":          setting.SingleCost,
		"multi_cost":           setting.MultiCost,
		"multi_draws":          setting.MultiDraws,
		"daily_draw_limit":     limit,
		"draws_used_today":     used,
		"remaining_draws":      remaining,
		"can_single":           canSingle,
		"can_multi":            canMulti,
		"quota":                user.Quota,
		"public_win_min":       setting.PublicWinMin,
		"public_win_limit":     setting.PublicWinLimit,
		"big_win_threshold":    setting.BigWinThreshold,
		"prize_order":          operation_setting.PrizeOrder(),
		"single_weights":       WeightsToPublicTable(singleW),
		"multi_weights":        WeightsToPublicTable(multiW),
		"single_ev":            ExpectedValue(singleW),
		"multi_ev_per_draw":    ExpectedValue(multiW),
		"multi_ev_total":       ExpectedValue(multiW) * float64(setting.MultiDraws),
		"multi_subsidy":        ExpectedValue(multiW)*float64(setting.MultiDraws) - setting.MultiCost,
		"draw_date":            drawDate,
		"timezone":             setting.Timezone,
	}, nil
}
