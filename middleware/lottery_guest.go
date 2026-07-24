package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// lotteryGuestAllowedExact are FullPath patterns (method + path) the demo account may call.
// FullPath uses Gin route templates (e.g. /api/user/sessions/:sid).
func lotteryGuestAllowed(method, fullPath, rawPath string) bool {
	method = strings.ToUpper(method)
	// Prefer FullPath when available; fall back to raw URL path.
	p := fullPath
	if p == "" {
		p = rawPath
	}
	// Normalize trailing slash
	p = strings.TrimSuffix(p, "/")

	// Auth lifecycle (not always under selfRoute, but listed for completeness)
	if method == "POST" && (p == "/api/user/auth/refresh" || p == "/api/user/auth/logout") {
		return true
	}

	// Self profile (read-only)
	if method == "GET" && (p == "/api/user/self" || p == "/api/user/self/groups") {
		return true
	}

	// Sessions: allow list / revoke so user can log out devices; block nothing critical
	if method == "GET" && p == "/api/user/sessions" {
		return true
	}
	if method == "DELETE" && strings.HasPrefix(p, "/api/user/sessions/") {
		return true
	}
	if method == "POST" && p == "/api/user/sessions/revoke-others" {
		return true
	}

	// Lottery
	if strings.HasPrefix(p, "/api/user/lottery") {
		if method == "GET" || method == "POST" {
			// only status / draw / history / public-wins
			return true
		}
	}

	// Wallet read: topup info for balance page chrome (payment POSTs blocked elsewhere)
	if method == "GET" && (p == "/api/user/topup/info" || p == "/api/user/topup/self") {
		return true
	}

	// Public status is usually unauthenticated; if somehow gated, allow
	if method == "GET" && (p == "/api/status" || p == "/api/notice" || p == "/api/home_page_content") {
		return true
	}

	return false
}

// RestrictLotteryGuest blocks the public lottery demo account from all non-allowlisted
// authenticated dashboard APIs. Mount after UserAuth (or any middleware that sets id/username).
func RestrictLotteryGuest() gin.HandlerFunc {
	return func(c *gin.Context) {
		username := c.GetString("username")
		userId := c.GetInt("id")
		isGuest := common.IsLotteryGuestUsername(username) || model.IsLotteryGuestUserId(userId)
		if !isGuest {
			c.Next()
			return
		}
		if lotteryGuestAllowed(c.Request.Method, c.FullPath(), c.Request.URL.Path) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "抽奖体验号仅可使用钱包与抽奖功能",
			"code":    "LOTTERY_GUEST_RESTRICTED",
		})
	}
}

// LotteryGuestDrawRateLimit enforces 1 draw/second for the lottery guest account only.
// Other users are unaffected (daily_draw_limit + quota already bound them).
func LotteryGuestDrawRateLimit() gin.HandlerFunc {
	const (
		mark     = "LGD" // lottery guest draw
		maxReq   = 1
		duration = int64(1) // seconds
	)
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)

	return func(c *gin.Context) {
		username := c.GetString("username")
		userId := c.GetInt("id")
		isGuest := common.IsLotteryGuestUsername(username) || model.IsLotteryGuestUserId(userId)
		if !isGuest {
			c.Next()
			return
		}

		if common.RedisEnabled {
			key := redisUserRateLimitKey(mark, userId)
			allowed, _, ttlSeconds, err := redisFixedWindowTake(c.Request.Context(), key, maxReq, duration)
			if err != nil {
				// fall back to memory
				memKey := fmt.Sprintf("%s:user:%d", mark, userId)
				if !inMemoryRateLimiter.Request(memKey, maxReq, duration) {
					writeRateLimitedJSON(c, duration, "抽奖体验号每秒仅可抽奖一次，请稍后再试")
					return
				}
				c.Next()
				return
			}
			if !allowed {
				writeRateLimitedJSON(c, ttlSeconds, "抽奖体验号每秒仅可抽奖一次，请稍后再试")
				return
			}
			c.Next()
			return
		}

		memKey := fmt.Sprintf("%s:user:%d", mark, userId)
		if !inMemoryRateLimiter.Request(memKey, maxReq, duration) {
			writeRateLimitedJSON(c, duration, "抽奖体验号每秒仅可抽奖一次，请稍后再试")
			return
		}
		c.Next()
	}
}

func writeRateLimitedJSON(c *gin.Context, retryAfterSeconds int64, message string) {
	if retryAfterSeconds > 0 {
		c.Header("Retry-After", fmt.Sprintf("%d", retryAfterSeconds))
	}
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": message,
		"code":    "LOTTERY_GUEST_RATE_LIMIT",
	})
}

// AbortIfLotteryGuest rejects TokenAuth / relay when the token belongs to the demo guest.
func AbortIfLotteryGuest(c *gin.Context, userId int) bool {
	if !model.IsLotteryGuestUserId(userId) {
		return false
	}
	abortWithOpenAiMessage(c, http.StatusForbidden, "抽奖体验号不可调用 API")
	return true
}
