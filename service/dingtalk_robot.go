package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DingTalkRobotSender posts markdown messages to a DingTalk custom robot webhook.
type DingTalkRobotSender interface {
	SendMarkdown(ctx context.Context, title, text string) error
}

// HTTPDingTalkRobot implements DingTalkRobotSender against oapi.dingtalk.com/robot/send.
type HTTPDingTalkRobot struct {
	WebhookURL string
	Secret     string
	HTTPClient *http.Client
	Now        func() time.Time
}

func NewHTTPDingTalkRobot(webhookURL, secret string) *HTTPDingTalkRobot {
	return &HTTPDingTalkRobot{
		WebhookURL: strings.TrimSpace(webhookURL),
		Secret:     strings.TrimSpace(secret),
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
		Now:        time.Now,
	}
}

// SignDingTalkRobot returns timestamp (ms) and sign for a SEC… secret.
func SignDingTalkRobot(secret string, tsMillis int64) (string, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", fmt.Errorf("dingtalk robot secret is empty")
	}
	stringToSign := fmt.Sprintf("%d\n%s", tsMillis, secret)
	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write([]byte(stringToSign)); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (c *HTTPDingTalkRobot) signedURL() (string, error) {
	base := strings.TrimSpace(c.WebhookURL)
	if base == "" {
		return "", fmt.Errorf("dingtalk robot webhook url is empty")
	}
	if strings.TrimSpace(c.Secret) == "" {
		return base, nil
	}
	nowFn := c.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	ts := nowFn().UnixMilli()
	sign, err := SignDingTalkRobot(c.Secret, ts)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("timestamp", strconv.FormatInt(ts, 10))
	q.Set("sign", sign)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (c *HTTPDingTalkRobot) SendMarkdown(ctx context.Context, title, text string) error {
	if c == nil {
		return fmt.Errorf("dingtalk robot client is nil")
	}
	endpoint, err := c.signedURL()
	if err != nil {
		return err
	}
	body := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": title,
			"text":  text,
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dingtalk robot http %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(raw, &parsed); err == nil && parsed.ErrCode != 0 {
		return fmt.Errorf("dingtalk robot errcode=%d errmsg=%s", parsed.ErrCode, parsed.ErrMsg)
	}
	return nil
}

var (
	opsDingTalkOnce   sync.Once
	opsDingTalkSender DingTalkRobotSender
)

// OpsDingTalkSender returns a shared robot client for ops alerts (redeem, capacity, etc).
// Env (first non-empty wins for webhook/secret pairs conceptually):
//   - DINGTALK_ROBOT_WEBHOOK_URL / DINGTALK_ROBOT_SECRET
//   - REDEEM_DINGTALK_WEBHOOK_URL / REDEEM_DINGTALK_SECRET
//   - ACCOUNT_CAPACITY_ALERT_DINGTALK_WEBHOOK_URL / ACCOUNT_CAPACITY_ALERT_DINGTALK_SECRET
func OpsDingTalkSender() DingTalkRobotSender {
	opsDingTalkOnce.Do(func() {
		webhook := firstNonEmptyEnv(
			"DINGTALK_ROBOT_WEBHOOK_URL",
			"REDEEM_DINGTALK_WEBHOOK_URL",
			"ACCOUNT_CAPACITY_ALERT_DINGTALK_WEBHOOK_URL",
		)
		secret := firstNonEmptyEnv(
			"DINGTALK_ROBOT_SECRET",
			"REDEEM_DINGTALK_SECRET",
			"ACCOUNT_CAPACITY_ALERT_DINGTALK_SECRET",
		)
		if webhook == "" {
			return
		}
		opsDingTalkSender = NewHTTPDingTalkRobot(webhook, secret)
	})
	return opsDingTalkSender
}

// ResetOpsDingTalkSenderForTest clears the shared sender (tests only).
func ResetOpsDingTalkSenderForTest() {
	opsDingTalkOnce = sync.Once{}
	opsDingTalkSender = nil
}

func firstNonEmptyEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}
