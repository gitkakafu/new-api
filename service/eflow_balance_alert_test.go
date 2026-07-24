package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestFormatEflowBalanceAlert(t *testing.T) {
	title, body, sig := formatEflowBalanceAlert([]EflowChannelBalance{
		{ChannelID: 3, ChannelName: "eflow-1_vip_china", Balance: 4.2, HardLimit: 100, UsedUSD: 95.8},
		{ChannelID: 4, ChannelName: "eflow-1_vip_grok", Balance: 3.1, HardLimit: 100, UsedUSD: 96.9},
	}, 5.0)
	if title == "" || !strings.Contains(body, "eflow-1_vip_china") {
		t.Fatalf("bad format title=%q body=%s", title, body)
	}
	if !strings.Contains(body, "4.2000") || !strings.Contains(body, "阈值") {
		t.Fatalf("body missing balance/threshold:\n%s", body)
	}
	if !strings.Contains(sig, "3:") || !strings.Contains(sig, "4:") {
		t.Fatalf("sig=%s", sig)
	}
}

func TestEflowBalanceAlertDebounce(t *testing.T) {
	ResetEflowBalanceAlertStateForTest()
	now := time.Now()
	if !shouldSendEflowBalanceAlert("a", now) {
		t.Fatal("first send should be allowed")
	}
	markEflowBalanceAlertSent("a", now)
	if shouldSendEflowBalanceAlert("a", now.Add(time.Minute)) {
		t.Fatal("same sig within cooldown must debounce")
	}
	if !shouldSendEflowBalanceAlert("b", now.Add(time.Minute)) {
		t.Fatal("different sig should send")
	}
}

func TestQueryOpenAICompatibleBalance(t *testing.T) {
	var paths []string
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		paths = append(paths, req.URL.Path)
		if !strings.HasPrefix(req.Header.Get("Authorization"), "Bearer sk-") {
			t.Fatalf("auth=%s", req.Header.Get("Authorization"))
		}
		var body string
		if strings.Contains(req.URL.Path, "subscription") {
			body = `{"hard_limit_usd":100.5,"soft_limit_usd":100.5}`
		} else {
			// total_usage is 0.01 dollar units → 2500 = $25
			body = `{"total_usage":2500}`
		}
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	})
	client := &http.Client{Transport: rt, Timeout: 5 * time.Second}
	bal, hard, used, err := queryOpenAICompatibleBalance(
		context.Background(), client, "https://e-flowcode.cc", "sk-test",
	)
	if err != nil {
		t.Fatal(err)
	}
	if hard != 100.5 || used != 25 || bal != 75.5 {
		t.Fatalf("hard=%v used=%v bal=%v", hard, used, bal)
	}
	if len(paths) != 2 {
		t.Fatalf("paths=%v", paths)
	}
}

func TestEflowBalanceAlertThresholdDefault(t *testing.T) {
	t.Setenv("EFLOW_BALANCE_ALERT_THRESHOLD", "")
	if got := eflowBalanceAlertThreshold(); got != 5.0 {
		t.Fatalf("got %v", got)
	}
	t.Setenv("EFLOW_BALANCE_ALERT_THRESHOLD", "3.5")
	if got := eflowBalanceAlertThreshold(); got != 3.5 {
		t.Fatalf("got %v", got)
	}
}
