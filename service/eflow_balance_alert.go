package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	defaultEflowBalanceAlertThreshold = 5.0
	defaultEflowBalanceAlertInterval  = 5 * time.Minute
	defaultEflowBalanceAlertCooldown  = 30 * time.Minute
)

var (
	eflowBalanceAlertOnce    sync.Once
	eflowBalanceAlertRunning atomic.Bool
)

// eflowBalanceAlertState is process-local debounce for DingTalk low-balance alerts.
type eflowBalanceAlertState struct {
	mu           sync.Mutex
	lastAlertAt  time.Time
	lastAlertSig string
}

var eflowBalanceAlertDebounce eflowBalanceAlertState

// StartEflowBalanceAlertTask periodically checks e-flow (e-flowcode) channel balances
// via OpenAI-compatible billing endpoints and pushes DingTalk when remaining USD
// drops below the configured threshold (default 5). Uses the same ops robot as
// redeem / capacity alerts (DINGTALK_ROBOT_* / ACCOUNT_CAPACITY_ALERT_DINGTALK_*).
func StartEflowBalanceAlertTask() {
	eflowBalanceAlertOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		if !eflowBalanceAlertEnabled() {
			common.SysLog("eflow balance DingTalk alert disabled (EFLOW_BALANCE_ALERT_ENABLED=false)")
			return
		}
		interval := eflowBalanceAlertInterval()
		threshold := eflowBalanceAlertThreshold()
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf(
				"eflow balance alert task started: interval=%s threshold=%.2f",
				interval, threshold,
			))
			// First check after a short delay so channel cache / network is ready.
			time.Sleep(45 * time.Second)
			runEflowBalanceAlertOnce()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for range ticker.C {
				runEflowBalanceAlertOnce()
			}
		})
	})
}

func eflowBalanceAlertEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("EFLOW_BALANCE_ALERT_ENABLED")))
	if v == "" {
		return true
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func eflowBalanceAlertThreshold() float64 {
	raw := strings.TrimSpace(os.Getenv("EFLOW_BALANCE_ALERT_THRESHOLD"))
	if raw == "" {
		return defaultEflowBalanceAlertThreshold
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil || f <= 0 {
		return defaultEflowBalanceAlertThreshold
	}
	return f
}

func eflowBalanceAlertInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("EFLOW_BALANCE_ALERT_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultEflowBalanceAlertInterval
	}
	sec, err := strconv.Atoi(raw)
	if err != nil || sec < 60 {
		return defaultEflowBalanceAlertInterval
	}
	return time.Duration(sec) * time.Second
}

func eflowBalanceAlertCooldown() time.Duration {
	raw := strings.TrimSpace(os.Getenv("EFLOW_BALANCE_ALERT_COOLDOWN_MINUTES"))
	if raw == "" {
		return defaultEflowBalanceAlertCooldown
	}
	min, err := strconv.Atoi(raw)
	if err != nil || min < 1 {
		return defaultEflowBalanceAlertCooldown
	}
	return time.Duration(min) * time.Minute
}

// EflowChannelBalance is one e-flow channel's remaining balance snapshot.
type EflowChannelBalance struct {
	ChannelID   int
	ChannelName string
	BaseURL     string
	Balance     float64
	HardLimit   float64
	UsedUSD     float64
	Error       string
}

func runEflowBalanceAlertOnce() {
	if !eflowBalanceAlertRunning.CompareAndSwap(false, true) {
		return
	}
	defer eflowBalanceAlertRunning.Store(false)

	ctx := context.Background()
	threshold := eflowBalanceAlertThreshold()
	rows, err := QueryEflowChannelBalances(ctx)
	if err != nil {
		common.SysError(fmt.Sprintf("eflow balance alert: list channels: %v", err))
		return
	}
	if len(rows) == 0 {
		return
	}

	// Persist balances on channels when query succeeded (best-effort).
	var low []EflowChannelBalance
	for _, r := range rows {
		if r.Error != "" {
			common.SysError(fmt.Sprintf(
				"eflow balance alert: channel id=%d name=%s: %s",
				r.ChannelID, r.ChannelName, r.Error,
			))
			continue
		}
		if ch, err := model.GetChannelById(r.ChannelID, true); err == nil && ch != nil {
			ch.UpdateBalance(r.Balance)
		}
		if r.Balance < threshold {
			low = append(low, r)
		}
	}
	if len(low) == 0 {
		return
	}

	title, body, sig := formatEflowBalanceAlert(low, threshold)
	if !shouldSendEflowBalanceAlert(sig, time.Now()) {
		return
	}
	sender := OpsDingTalkSender()
	if sender == nil {
		common.SysError("eflow balance alert: no DingTalk sender configured")
		return
	}
	nctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := sender.SendMarkdown(nctx, title, body); err != nil {
		common.SysError(fmt.Sprintf("eflow balance alert dingtalk failed: %v", err))
		return
	}
	markEflowBalanceAlertSent(sig, time.Now())
	logger.LogInfo(ctx, fmt.Sprintf("eflow balance alert sent: %d channel(s) below %.2f", len(low), threshold))
}

func shouldSendEflowBalanceAlert(sig string, now time.Time) bool {
	eflowBalanceAlertDebounce.mu.Lock()
	defer eflowBalanceAlertDebounce.mu.Unlock()
	if eflowBalanceAlertDebounce.lastAlertSig == sig &&
		now.Sub(eflowBalanceAlertDebounce.lastAlertAt) < eflowBalanceAlertCooldown() {
		return false
	}
	return true
}

func markEflowBalanceAlertSent(sig string, now time.Time) {
	eflowBalanceAlertDebounce.mu.Lock()
	defer eflowBalanceAlertDebounce.mu.Unlock()
	eflowBalanceAlertDebounce.lastAlertSig = sig
	eflowBalanceAlertDebounce.lastAlertAt = now
}

// ResetEflowBalanceAlertStateForTest clears debounce (tests only).
func ResetEflowBalanceAlertStateForTest() {
	eflowBalanceAlertDebounce.mu.Lock()
	defer eflowBalanceAlertDebounce.mu.Unlock()
	eflowBalanceAlertDebounce.lastAlertAt = time.Time{}
	eflowBalanceAlertDebounce.lastAlertSig = ""
}

func formatEflowBalanceAlert(low []EflowChannelBalance, threshold float64) (title, body, sig string) {
	title = "e-flow 余额不足提醒"
	var b strings.Builder
	b.WriteString("### e-flow 平台余额低于阈值\n\n")
	b.WriteString(fmt.Sprintf("- 时间: %s\n", time.Now().In(time.Local).Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("- 阈值: **%.2f** 元/USD\n", threshold))
	b.WriteString("- 请尽快在 e-flowcode 充值，避免渠道不可用。\n\n")
	var sigParts []string
	for _, r := range low {
		b.WriteString(fmt.Sprintf(
			"- **%s** (id=%d): 余额 **%.4f** (额度 %.4f / 已用 %.4f)\n",
			escapeDingMarkdown(r.ChannelName),
			r.ChannelID,
			r.Balance,
			r.HardLimit,
			r.UsedUSD,
		))
		sigParts = append(sigParts, fmt.Sprintf("%d:%.2f", r.ChannelID, r.Balance))
	}
	sig = strings.Join(sigParts, "|")
	return title, b.String(), sig
}

// QueryEflowChannelBalances lists enabled e-flow channels and queries remaining balance.
func QueryEflowChannelBalances(ctx context.Context) ([]EflowChannelBalance, error) {
	channels, err := model.GetAllChannels(0, 0, true, false)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 20 * time.Second}
	var out []EflowChannelBalance
	for _, ch := range channels {
		if ch == nil || ch.Status != common.ChannelStatusEnabled {
			continue
		}
		if ch.ChannelInfo.IsMultiKey {
			continue
		}
		tag := ""
		if ch.Tag != nil {
			tag = *ch.Tag
		}
		base := ""
		if ch.BaseURL != nil {
			base = *ch.BaseURL
		}
		kind := ratio_setting.ClassifyUpstreamKind(tag, ch.Name, base)
		if kind != ratio_setting.UpstreamKindEflow {
			continue
		}
		row := EflowChannelBalance{
			ChannelID:   ch.Id,
			ChannelName: ch.Name,
			BaseURL:     strings.TrimRight(base, "/"),
		}
		if row.BaseURL == "" {
			row.Error = "empty base_url"
			out = append(out, row)
			continue
		}
		bal, hard, used, qerr := queryOpenAICompatibleBalance(ctx, client, row.BaseURL, ch.Key)
		if qerr != nil {
			row.Error = qerr.Error()
			out = append(out, row)
			continue
		}
		row.Balance = bal
		row.HardLimit = hard
		row.UsedUSD = used
		out = append(out, row)
	}
	return out, nil
}

type openAISubscriptionResp struct {
	HardLimitUSD float64 `json:"hard_limit_usd"`
	SoftLimitUSD float64 `json:"soft_limit_usd"`
}

type openAIUsageResp struct {
	TotalUsage float64 `json:"total_usage"` // unit: 0.01 dollar
}

func queryOpenAICompatibleBalance(
	ctx context.Context,
	client *http.Client,
	baseURL, apiKey string,
) (balance, hardLimit, usedUSD float64, err error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" || apiKey == "" {
		return 0, 0, 0, fmt.Errorf("missing base_url or key")
	}
	subURL := baseURL + "/v1/dashboard/billing/subscription"
	subBody, err := httpGetWithBearer(ctx, client, subURL, apiKey)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("subscription: %w", err)
	}
	var sub openAISubscriptionResp
	if err := json.Unmarshal(subBody, &sub); err != nil {
		return 0, 0, 0, fmt.Errorf("subscription json: %w", err)
	}
	hardLimit = sub.HardLimitUSD
	if hardLimit <= 0 {
		hardLimit = sub.SoftLimitUSD
	}
	now := time.Now()
	startDate := fmt.Sprintf("%s-01", now.Format("2006-01"))
	endDate := now.Format("2006-01-02")
	usageURL := fmt.Sprintf(
		"%s/v1/dashboard/billing/usage?start_date=%s&end_date=%s",
		baseURL, startDate, endDate,
	)
	usageBody, err := httpGetWithBearer(ctx, client, usageURL, apiKey)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("usage: %w", err)
	}
	var usage openAIUsageResp
	if err := json.Unmarshal(usageBody, &usage); err != nil {
		return 0, 0, 0, fmt.Errorf("usage json: %w", err)
	}
	usedUSD = usage.TotalUsage / 100
	balance = hardLimit - usedUSD
	return balance, hardLimit, usedUSD, nil
}

func httpGetWithBearer(ctx context.Context, client *http.Client, url, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "new-api-eflow-balance-alert/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(raw[:min(200, len(raw))])))
	}
	return raw, nil
}
