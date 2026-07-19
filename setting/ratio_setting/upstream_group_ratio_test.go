package ratio_setting

import (
	"math"
	"testing"
)

func TestIsCodexDynamicRatioGroup(t *testing.T) {
	if !IsCodexDynamicRatioGroup("1_vip_codex") || !IsCodexDynamicRatioGroup("2_free_codex") {
		t.Fatal("codex groups should be dynamic")
	}
	if IsCodexDynamicRatioGroup("1_vip_china") || IsCodexDynamicRatioGroup("") {
		t.Fatal("non-codex groups should not be dynamic")
	}
}

func TestClassifyUpstreamKind(t *testing.T) {
	cases := []struct {
		tag, name, base string
		want            UpstreamKind
	}{
		{"sub2api", "", "", UpstreamKindSub2API},
		{"eflow", "", "", UpstreamKindEflow},
		{"", "sub2api-codex", "http://127.0.0.1:8080", UpstreamKindSub2API},
		{"", "eflow-1_vip_codex", "http://e-flowcode.cc", UpstreamKindEflow},
		{"", "other", "https://api.openai.com", UpstreamKindUnknown},
	}
	for _, tc := range cases {
		got := ClassifyUpstreamKind(tc.tag, tc.name, tc.base)
		if got != tc.want {
			t.Fatalf("ClassifyUpstreamKind(%q,%q,%q)=%q want %q", tc.tag, tc.name, tc.base, got, tc.want)
		}
	}
}

func TestResolveCodexGroupRatio(t *testing.T) {
	baseline := 0.22
	got := ResolveCodexGroupRatio("1_vip_codex", baseline, UpstreamKindSub2API)
	if got != Sub2APICodexGroupRatio {
		t.Fatalf("sub2api ratio=%v want %v", got, Sub2APICodexGroupRatio)
	}
	got = ResolveCodexGroupRatio("2_free_codex", baseline, UpstreamKindEflow)
	wantEflow := baseline * EflowFallbackGroupRatioMultiplier
	if math.Abs(got-wantEflow) > 1e-12 {
		t.Fatalf("eflow ratio=%v want %v", got, wantEflow)
	}
	got = ResolveCodexGroupRatio("1_vip_china", baseline, UpstreamKindSub2API)
	if got != baseline {
		t.Fatalf("non-codex should keep baseline, got %v", got)
	}
	got = ResolveCodexGroupRatio("1_vip_codex", baseline, UpstreamKindUnknown)
	if got != baseline {
		t.Fatalf("unknown upstream should keep baseline, got %v", got)
	}
}

func TestResolveCodexDisplayGroupRatio(t *testing.T) {
	// Plaza should show 0.13 when preferred upstream is sub2api, even if static baseline is 0.33.
	got := ResolveCodexDisplayGroupRatio("1_vip_codex", 0.33, UpstreamKindSub2API)
	if got != Sub2APICodexGroupRatio {
		t.Fatalf("display sub2api=%v want %v", got, Sub2APICodexGroupRatio)
	}
	got = ResolveCodexDisplayGroupRatio("2_free_codex", 0.20, UpstreamKindEflow)
	want := 0.20 * EflowFallbackGroupRatioMultiplier
	if math.Abs(got-want) > 1e-12 {
		t.Fatalf("display eflow=%v want %v", got, want)
	}
}
