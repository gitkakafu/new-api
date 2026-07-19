package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
)

// RedemptionNotifyPayload is sent to DingTalk after a successful redeem.
type RedemptionNotifyPayload struct {
	UserID       int
	Username     string
	Email        string
	DisplayName  string
	RedemptionID int
	CodeName     string
	// Key is the full code; only a masked form is included in the message.
	Key   string
	Quota int
}

// NotifyRedemptionSuccess pushes a DingTalk markdown alert. Failures are logged only.
func NotifyRedemptionSuccess(ctx context.Context, p RedemptionNotifyPayload) {
	sender := OpsDingTalkSender()
	if sender == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	title := "兑换码使用通知"
	body := formatRedemptionMarkdown(p)
	// Bound network wait so redeem HTTP path is not delayed when called sync.
	nctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := sender.SendMarkdown(nctx, title, body); err != nil {
		common.SysError(fmt.Sprintf("dingtalk redeem notify failed: %v", err))
	}
}

// NotifyRedemptionSuccessAsync runs NotifyRedemptionSuccess in a background goroutine.
func NotifyRedemptionSuccessAsync(p RedemptionNotifyPayload) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				common.SysError(fmt.Sprintf("dingtalk redeem notify panic: %v", r))
			}
		}()
		NotifyRedemptionSuccess(context.Background(), p)
	}()
}

func formatRedemptionMarkdown(p RedemptionNotifyPayload) string {
	who := strings.TrimSpace(p.Username)
	if who == "" {
		who = strings.TrimSpace(p.DisplayName)
	}
	if who == "" {
		who = fmt.Sprintf("user#%d", p.UserID)
	}
	email := strings.TrimSpace(p.Email)
	if email == "" {
		email = "-"
	}
	codeName := strings.TrimSpace(p.CodeName)
	if codeName == "" {
		codeName = "-"
	}
	quotaText := logger.LogQuota(p.Quota)
	var b strings.Builder
	b.WriteString("### new-api 兑换码使用\n\n")
	b.WriteString(fmt.Sprintf("- 时间: %s\n", time.Now().In(time.Local).Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("- 用户: **%s** (id=%d)\n", escapeDingMarkdown(who), p.UserID))
	b.WriteString(fmt.Sprintf("- 邮箱: %s\n", escapeDingMarkdown(email)))
	b.WriteString(fmt.Sprintf("- 兑换码名称: **%s**\n", escapeDingMarkdown(codeName)))
	b.WriteString(fmt.Sprintf("- 兑换码ID: %d\n", p.RedemptionID))
	b.WriteString(fmt.Sprintf("- 码片段: `%s`\n", escapeDingMarkdown(maskRedemptionKey(p.Key))))
	b.WriteString(fmt.Sprintf("- 到账额度: **%s**\n", escapeDingMarkdown(quotaText)))
	return b.String()
}

func maskRedemptionKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return "-"
	}
	if len(key) <= 8 {
		return key[:1] + "***"
	}
	return key[:4] + "…" + key[len(key)-4:]
}

func escapeDingMarkdown(s string) string {
	// Minimal escaping so user-controlled names cannot break markdown structure badly.
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	return s
}
