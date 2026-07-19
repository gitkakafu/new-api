package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type captureDingTalk struct {
	title string
	text  string
}

func (c *captureDingTalk) SendMarkdown(_ context.Context, title, text string) error {
	c.title = title
	c.text = text
	return nil
}

func TestFormatRedemptionMarkdown(t *testing.T) {
	body := formatRedemptionMarkdown(RedemptionNotifyPayload{
		UserID:       7,
		Username:     "alice",
		Email:        "a@b.com",
		RedemptionID: 12,
		CodeName:     "vip-100",
		Key:          "ABCDEFGH12345678",
		Quota:        500000,
	})
	for _, want := range []string{"alice", "a@b.com", "vip-100", "12", "ABCD", "5678"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q:\n%s", want, body)
		}
	}
	// full key must not appear
	if strings.Contains(body, "ABCDEFGH12345678") {
		t.Fatal("full key must be masked")
	}
}

func TestMaskRedemptionKey(t *testing.T) {
	if got := maskRedemptionKey("1234567890"); got == "1234567890" {
		t.Fatalf("expected masked, got %s", got)
	}
}

func TestHTTPDingTalkRobotSignAndSend(t *testing.T) {
	var gotURL string
	var gotBody string
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		gotURL = req.URL.String()
		b, _ := io.ReadAll(req.Body)
		gotBody = string(b)
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"errcode":0,"errmsg":"ok"}`)),
			Header:     make(http.Header),
		}, nil
	})
	client := NewHTTPDingTalkRobot("https://oapi.dingtalk.com/robot/send?access_token=tok", "SECabc")
	client.HTTPClient = &http.Client{Transport: rt, Timeout: 5 * time.Second}
	client.Now = func() time.Time { return time.UnixMilli(1700000000000) }
	if err := client.SendMarkdown(context.Background(), "t", "hello"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotURL, "timestamp=") || !strings.Contains(gotURL, "sign=") {
		t.Fatalf("signed url missing params: %s", gotURL)
	}
	if !strings.Contains(gotBody, `"msgtype":"markdown"`) {
		t.Fatalf("body=%s", gotBody)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestNotifyRedemptionSuccessUsesSender(t *testing.T) {
	ResetOpsDingTalkSenderForTest()
	cap := &captureDingTalk{}
	// Mark once as done so OpsDingTalkSender keeps our injected sender.
	opsDingTalkOnce.Do(func() {})
	opsDingTalkSender = cap

	NotifyRedemptionSuccess(context.Background(), RedemptionNotifyPayload{
		UserID: 1, Username: "u", Quota: 100, Key: "abcdefghijklmnop", CodeName: "n", RedemptionID: 3,
	})
	if cap.title == "" || !strings.Contains(cap.text, "u") {
		t.Fatalf("sender not called: %+v", cap)
	}
}
