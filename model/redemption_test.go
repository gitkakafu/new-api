package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSearchRedemptionsFiltersAndPaginates(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	now := common.GetTimestamp()
	redemptions := []Redemption{
		{Id: 1, Name: "alpha-active", Key: "00000000000000000000000000000001", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: 0},
		{Id: 2, Name: "alpha-future", Key: "00000000000000000000000000000002", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now + 3600},
		{Id: 3, Name: "alpha-expired", Key: "00000000000000000000000000000003", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now - 10},
		{Id: 4, Name: "beta-disabled", Key: "00000000000000000000000000000004", Status: common.RedemptionCodeStatusDisabled, ExpiredTime: 0},
		{Id: 5, Name: "beta-used", Key: "00000000000000000000000000000005", Status: common.RedemptionCodeStatusUsed, ExpiredTime: 0},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	tests := []struct {
		name      string
		keyword   string
		status    string
		startIdx  int
		num       int
		wantTotal int64
		wantIds   []int
	}{
		{
			name:      "no filters returns all rows",
			num:       10,
			wantTotal: 5,
			wantIds:   []int{5, 4, 3, 2, 1},
		},
		{
			name:      "keyword filters by name prefix",
			keyword:   "alpha",
			num:       10,
			wantTotal: 3,
			wantIds:   []int{3, 2, 1},
		},
		{
			name:      "enabled status excludes expired rows",
			status:    "1",
			num:       10,
			wantTotal: 2,
			wantIds:   []int{2, 1},
		},
		{
			name:      "expired status returns enabled expired rows",
			status:    "expired",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{3},
		},
		{
			name:      "disabled status",
			status:    "2",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{4},
		},
		{
			name:      "used status",
			status:    "3",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{5},
		},
		{
			name:      "pagination keeps unpaged total",
			startIdx:  1,
			num:       2,
			wantTotal: 5,
			wantIds:   []int{4, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, total, err := SearchRedemptions(tt.keyword, tt.status, tt.startIdx, tt.num)
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, total)
			gotIds := make([]int, 0, len(rows))
			for _, row := range rows {
				gotIds = append(gotIds, row.Id)
			}
			assert.Equal(t, tt.wantIds, gotIds)
		})
	}
}

func setupRedeemFixture(t *testing.T, quota int) (userId int, key string) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	user := &User{Username: "redeem-user", Password: "password", Status: common.UserStatusEnabled, AffCode: "rdm1", Quota: 0}
	require.NoError(t, DB.Create(user).Error)

	key = "10000000000000000000000000000001"
	redemption := &Redemption{
		Name:        "redeem-test",
		Key:         key,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       quota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(redemption).Error)
	return user.Id, key
}

func TestRedeemCreditsQuotaExactlyOnce(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "name = ?", "redeem-test").Error)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, userId, redemption.UsedUserId)

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(key, userId); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, ok := range successes {
		if ok {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount, "exactly one concurrent redeem should succeed")

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 300, user.Quota, "quota must be credited exactly once")
}


func confirmPaymentComplianceForModelTest(t *testing.T) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
}

func TestAffiliateRebateRateForRedeemQuota(t *testing.T) {
	// 500000 units = $1
	unit := int(common.QuotaPerUnit)
	assert.Equal(t, 0.10, affiliateRebateRateForRedeemQuota(unit*20))   // $20 → 10%
	assert.Equal(t, 0.10, affiliateRebateRateForRedeemQuota(unit*10))   // $10 → 10%
	assert.Equal(t, 0.05, affiliateRebateRateForRedeemQuota(unit*20+1)) // >$20 → 5%
	assert.Equal(t, 0.05, affiliateRebateRateForRedeemQuota(unit*50))
	assert.Equal(t, 0.0, affiliateRebateRateForRedeemQuota(0))
	assert.Equal(t, unit*2, affiliateRebateQuotaForRedeem(unit*20)) // 10% of $20 = $2
	assert.Equal(t, int(float64(unit*50)*0.05), affiliateRebateQuotaForRedeem(unit*50))
}

func TestRedeemFirstCodeRewardsInviterTenPercent(t *testing.T) {
	confirmPaymentComplianceForModelTest(t)
	require.NoError(t, DB.AutoMigrate(&User{}, &Redemption{}, &Log{}))
	DB.Exec("DELETE FROM redemptions")
	DB.Exec("DELETE FROM users")
	DB.Exec("DELETE FROM logs")
	t.Cleanup(func() {
		DB.Exec("DELETE FROM redemptions")
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	inviter := &User{Username: "aff-inviter", Password: "password", Status: common.UserStatusEnabled, AffCode: "aff1", AffQuota: 0, AffHistoryQuota: 0}
	require.NoError(t, DB.Create(inviter).Error)
	invitee := &User{Username: "aff-invitee", Password: "password", Status: common.UserStatusEnabled, AffCode: "aff2", InviterId: inviter.Id, Quota: 0}
	require.NoError(t, DB.Create(invitee).Error)

	// $10 face value → 10% rebate
	quota := int(common.QuotaPerUnit * 10)
	key := "20000000000000000000000000000001"
	require.NoError(t, DB.Create(&Redemption{
		Name: "aff-first", Key: key, Status: common.RedemptionCodeStatusEnabled,
		Quota: quota, CreatedTime: common.GetTimestamp(),
	}).Error)

	got, err := Redeem(key, invitee.Id)
	require.NoError(t, err)
	assert.Equal(t, quota, got)

	var inviterAfter User
	require.NoError(t, DB.First(&inviterAfter, "id = ?", inviter.Id).Error)
	wantReward := int(float64(quota) * 0.10)
	assert.Equal(t, wantReward, inviterAfter.AffQuota)
	assert.Equal(t, wantReward, inviterAfter.AffHistoryQuota)

	var inviteeAfter User
	require.NoError(t, DB.First(&inviteeAfter, "id = ?", invitee.Id).Error)
	assert.Equal(t, quota, inviteeAfter.Quota)
}

func TestRedeemFirstCodeRewardsInviterFivePercentAbove20(t *testing.T) {
	confirmPaymentComplianceForModelTest(t)
	require.NoError(t, DB.AutoMigrate(&User{}, &Redemption{}))
	DB.Exec("DELETE FROM redemptions")
	DB.Exec("DELETE FROM users")
	t.Cleanup(func() {
		DB.Exec("DELETE FROM redemptions")
		DB.Exec("DELETE FROM users")
	})

	inviter := &User{Username: "aff-inviter2", Password: "password", Status: common.UserStatusEnabled, AffCode: "af21"}
	require.NoError(t, DB.Create(inviter).Error)
	invitee := &User{Username: "aff-invitee2", Password: "password", Status: common.UserStatusEnabled, AffCode: "af22", InviterId: inviter.Id}
	require.NoError(t, DB.Create(invitee).Error)

	// $50 face value → 5% rebate
	quota := int(common.QuotaPerUnit * 50)
	key := "20000000000000000000000000000002"
	require.NoError(t, DB.Create(&Redemption{
		Name: "aff-first-big", Key: key, Status: common.RedemptionCodeStatusEnabled,
		Quota: quota, CreatedTime: common.GetTimestamp(),
	}).Error)

	_, err := Redeem(key, invitee.Id)
	require.NoError(t, err)

	var inviterAfter User
	require.NoError(t, DB.First(&inviterAfter, "id = ?", inviter.Id).Error)
	wantReward := int(float64(quota) * 0.05)
	assert.Equal(t, wantReward, inviterAfter.AffQuota)
	assert.Equal(t, wantReward, inviterAfter.AffHistoryQuota)
}

func TestRedeemSecondCodeDoesNotRewardInviter(t *testing.T) {
	confirmPaymentComplianceForModelTest(t)
	require.NoError(t, DB.AutoMigrate(&User{}, &Redemption{}))
	DB.Exec("DELETE FROM redemptions")
	DB.Exec("DELETE FROM users")
	t.Cleanup(func() {
		DB.Exec("DELETE FROM redemptions")
		DB.Exec("DELETE FROM users")
	})

	inviter := &User{Username: "aff-inviter3", Password: "password", Status: common.UserStatusEnabled, AffCode: "af31"}
	require.NoError(t, DB.Create(inviter).Error)
	invitee := &User{Username: "aff-invitee3", Password: "password", Status: common.UserStatusEnabled, AffCode: "af32", InviterId: inviter.Id}
	require.NoError(t, DB.Create(invitee).Error)

	q1 := int(common.QuotaPerUnit * 10)
	k1 := "20000000000000000000000000000003"
	require.NoError(t, DB.Create(&Redemption{
		Name: "aff-1", Key: k1, Status: common.RedemptionCodeStatusEnabled,
		Quota: q1, CreatedTime: common.GetTimestamp(),
	}).Error)
	_, err := Redeem(k1, invitee.Id)
	require.NoError(t, err)

	var inviterAfterFirst User
	require.NoError(t, DB.First(&inviterAfterFirst, "id = ?", inviter.Id).Error)
	firstReward := inviterAfterFirst.AffQuota
	require.Greater(t, firstReward, 0)

	q2 := int(common.QuotaPerUnit * 10)
	k2 := "20000000000000000000000000000004"
	require.NoError(t, DB.Create(&Redemption{
		Name: "aff-2", Key: k2, Status: common.RedemptionCodeStatusEnabled,
		Quota: q2, CreatedTime: common.GetTimestamp(),
	}).Error)
	_, err = Redeem(k2, invitee.Id)
	require.NoError(t, err)

	var inviterAfterSecond User
	require.NoError(t, DB.First(&inviterAfterSecond, "id = ?", inviter.Id).Error)
	assert.Equal(t, firstReward, inviterAfterSecond.AffQuota, "second redeem must not add inviter reward")
	assert.Equal(t, firstReward, inviterAfterSecond.AffHistoryQuota)
}

func TestRedeemWithoutInviterNoAffiliate(t *testing.T) {
	confirmPaymentComplianceForModelTest(t)
	userId, key := setupRedeemFixture(t, int(common.QuotaPerUnit*10))
	// ensure no inviter
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("inviter_id", 0).Error)

	// create a dummy inviter that must not change
	inviter := &User{Username: "aff-unrelated", Password: "password", Status: common.UserStatusEnabled, AffCode: "af99", AffQuota: 7}
	require.NoError(t, DB.Create(inviter).Error)

	_, err := Redeem(key, userId)
	require.NoError(t, err)

	var inviterAfter User
	require.NoError(t, DB.First(&inviterAfter, "id = ?", inviter.Id).Error)
	assert.Equal(t, 7, inviterAfter.AffQuota)
}
