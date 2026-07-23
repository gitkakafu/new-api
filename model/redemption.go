package model

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
)

type Redemption struct {
	Id           int            `json:"id"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(keyword string, status string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})

	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
		} else {
			query = query.Where("name LIKE ?", keyword+"%")
		}
	}

	if status != "" {
		now := common.GetTimestamp()
		switch status {
		case "expired":
			query = query.Where(
				"status = ? AND expired_time != 0 AND expired_time < ?",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusEnabled):
			query = query.Where(
				"status = ? AND (expired_time = 0 OR expired_time >= ?)",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusDisabled):
			query = query.Where("status = ?", common.RedemptionCodeStatusDisabled)
		case strconv.Itoa(common.RedemptionCodeStatusUsed):
			query = query.Where("status = ?", common.RedemptionCodeStatusUsed)
		}
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

// GetRedemptionByKey loads a redemption row by its secret key (for post-redeem notify).
func GetRedemptionByKey(key string) (*Redemption, error) {
	if key == "" {
		return nil, errors.New("key 为空")
	}
	keyCol := "`key`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		keyCol = `"key"`
	}
	redemption := &Redemption{}
	err := DB.Where(keyCol+" = ?", key).First(redemption).Error
	return redemption, err
}

// affiliateRedeemAmountThresholdUSD is the display-dollar threshold for invitee
// first-redeem inviter rebate: amount <= threshold → 10%, amount > threshold → 5%.
const affiliateRedeemAmountThresholdUSD = 20.0

// affiliateRebateRateForRedeemQuota returns the inviter rebate rate (0–1) for a
// first-time redemption whose face value is redeemQuota (internal quota units).
func affiliateRebateRateForRedeemQuota(redeemQuota int) float64 {
	if redeemQuota <= 0 || common.QuotaPerUnit <= 0 {
		return 0
	}
	amountUSD := float64(redeemQuota) / common.QuotaPerUnit
	if amountUSD <= affiliateRedeemAmountThresholdUSD {
		return 0.10
	}
	return 0.05
}

// affiliateRebateQuotaForRedeem returns inviter aff_quota credit for a first redeem.
func affiliateRebateQuotaForRedeem(redeemQuota int) int {
	rate := affiliateRebateRateForRedeemQuota(redeemQuota)
	if rate <= 0 {
		return 0
	}
	// Integer percent of face value (10% / 5%).
	return int(float64(redeemQuota) * rate)
}

// firstRedeemAffiliateReward is filled inside the redeem TX when the inviter is paid.
type firstRedeemAffiliateReward struct {
	InviterId    int
	InviteeName  string
	RewardQuota  int
	RatePercent  int
	RedeemQuota  int
}

// tryAccrueFirstRedeemAffiliateReward credits the inviter only when this is the
// invitee's first successful redemption code use. Must run inside the redeem TX
// after the code is marked used, with the invitee row locked when possible.
func tryAccrueFirstRedeemAffiliateReward(tx *gorm.DB, inviteeId int, redeemQuota int, redemptionId int) (*firstRedeemAffiliateReward, error) {
	if inviteeId == 0 || redeemQuota <= 0 || redemptionId == 0 {
		return nil, nil
	}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		return nil, nil
	}

	invitee := &User{}
	if err := lockForUpdate(tx).Select("id", "inviter_id", "username").First(invitee, "id = ?", inviteeId).Error; err != nil {
		return nil, err
	}
	if invitee.InviterId == 0 {
		return nil, nil
	}

	// Concurrent first-redeems serialize on the invitee lock above; count other
	// used codes so only the true first redeem pays the inviter.
	var priorCount int64
	if err := tx.Model(&Redemption{}).
		Where("used_user_id = ? AND status = ? AND id <> ?", inviteeId, common.RedemptionCodeStatusUsed, redemptionId).
		Count(&priorCount).Error; err != nil {
		return nil, err
	}
	if priorCount > 0 {
		return nil, nil
	}

	reward := affiliateRebateQuotaForRedeem(redeemQuota)
	if reward <= 0 {
		return nil, nil
	}

	result := tx.Model(&User{}).Where("id = ?", invitee.InviterId).Updates(map[string]interface{}{
		"aff_quota":   gorm.Expr("aff_quota + ?", reward),
		"aff_history": gorm.Expr("aff_history + ?", reward),
	})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		// Inviter missing: skip quietly (invitee still gets redeem credit).
		return nil, nil
	}

	return &firstRedeemAffiliateReward{
		InviterId:   invitee.InviterId,
		InviteeName: invitee.Username,
		RewardQuota: reward,
		RatePercent: int(affiliateRebateRateForRedeemQuota(redeemQuota) * 100),
		RedeemQuota: redeemQuota,
	}, nil
}

func Redeem(key string, userId int) (quota int, err error) {
	if key == "" {
		return 0, errors.New("未提供兑换码")
	}
	if userId == 0 {
		return 0, errors.New("无效的 user id")
	}
	redemption := &Redemption{}
	var affReward *firstRedeemAffiliateReward

	keyCol := "`key`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		keyCol = `"key"`
	}
	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(keyCol+" = ?", key).First(redemption).Error
		if err != nil {
			return errors.New("无效的兑换码")
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return errors.New("该兑换码已被使用")
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return errors.New("该兑换码已过期")
		}
		// Compare-and-swap on status: only the transaction that flips
		// enabled -> used may credit quota, so a concurrent redeem of the
		// same code loses here even without a row lock (e.g. on SQLite).
		result := tx.Model(&Redemption{}).
			Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
			Updates(map[string]interface{}{
				"redeemed_time": common.GetTimestamp(),
				"status":        common.RedemptionCodeStatusUsed,
				"used_user_id":  userId,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("该兑换码已被使用")
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", redemption.Quota)).Error; err != nil {
			return err
		}
		// Inviter rebate: only on invitee's first successful redemption.
		reward, err := tryAccrueFirstRedeemAffiliateReward(tx, userId, redemption.Quota, redemption.Id)
		if err != nil {
			return err
		}
		affReward = reward
		return nil
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		return 0, ErrRedeemFailed
	}
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("通过兑换码充值 %s，兑换码ID %d", logger.LogQuota(redemption.Quota), redemption.Id))
	if affReward != nil && affReward.RewardQuota > 0 {
		RecordLog(affReward.InviterId, LogTypeSystem, fmt.Sprintf(
			"邀请用户 %s 首次兑换码充值 %s，奖励邀请人 %s（%d%%）",
			affReward.InviteeName, logger.LogQuota(affReward.RedeemQuota), logger.LogQuota(affReward.RewardQuota), affReward.RatePercent,
		))
	}
	return redemption.Quota, nil
}

func (redemption *Redemption) Insert() error {
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) SelectUpdate() error {
	// This can update zero values
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	var err error
	err = DB.Model(redemption).Select("name", "status", "quota", "redeemed_time", "expired_time").Updates(redemption).Error
	return err
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
