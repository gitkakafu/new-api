package common

// Lottery guest (public demo) account — intentionally published credentials.
// Used only to experience lottery probability; locked down to wallet + lottery.
const (
	LotteryGuestUsername    = "lottery_guest"
	LotteryGuestPassword    = "LotteryDemo1"
	LotteryGuestDisplayName = "抽奖游客"
	// LotteryGuestQuotaDisplay is the fixed display balance (wallet units).
	LotteryGuestQuotaDisplay = 10000
	// LotteryGuestRemainingDraws is a large sentinel for "unlimited" draws.
	LotteryGuestRemainingDraws = 999999
)

// IsLotteryGuestUsername reports whether the username is the public lottery demo account.
func IsLotteryGuestUsername(username string) bool {
	return username == LotteryGuestUsername
}
