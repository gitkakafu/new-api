package ratio_setting

import "strings"

// Groups that prefer sub2api with e-flow fallback and dynamic group ratio.
const (
	GroupVIPCodex  = "1_vip_codex"
	GroupFreeCodex = "2_free_codex"
	GroupVIPGrok   = "1_vip_grok"

	// Sub2APICodexGroupRatio is the effective group ratio when Codex traffic is served by sub2api.
	Sub2APICodexGroupRatio = 0.04

	// Sub2APIGrokGroupRatio is the effective group ratio when Grok traffic is served by sub2api.
	Sub2APIGrokGroupRatio = 0.01

	// EflowFallbackGroupRatioMultiplier is applied to the baseline (synced) group
	// ratio when Codex traffic falls back to e-flowcode.cc.
	// Grok e-flow keeps the stored baseline as-is ("original billing").
	EflowFallbackGroupRatioMultiplier = 1.10
)

// IsCodexDynamicRatioGroup reports whether the using-group is a Codex dynamic-ratio group.
func IsCodexDynamicRatioGroup(group string) bool {
	switch strings.TrimSpace(group) {
	case GroupVIPCodex, GroupFreeCodex:
		return true
	default:
		return false
	}
}

// IsGrokDynamicRatioGroup reports whether the using-group is a Grok dynamic-ratio group.
func IsGrokDynamicRatioGroup(group string) bool {
	return strings.TrimSpace(group) == GroupVIPGrok
}

// IsDynamicUpstreamRatioGroup reports whether billing/display depends on which
// upstream (sub2api vs e-flow) actually serves the request.
func IsDynamicUpstreamRatioGroup(group string) bool {
	return IsCodexDynamicRatioGroup(group) || IsGrokDynamicRatioGroup(group)
}

// UpstreamKind identifies the upstream pool used for dynamic billing.
type UpstreamKind string

const (
	UpstreamKindUnknown UpstreamKind = ""
	UpstreamKindSub2API UpstreamKind = "sub2api"
	UpstreamKindEflow   UpstreamKind = "eflow"
)

// ClassifyUpstreamKind classifies a channel by tag, name, and base URL.
// Prefer explicit tag "sub2api" / "eflow"; otherwise match host/name hints.
func ClassifyUpstreamKind(tag, name, baseURL string) UpstreamKind {
	tag = strings.ToLower(strings.TrimSpace(tag))
	switch tag {
	case string(UpstreamKindSub2API):
		return UpstreamKindSub2API
	case string(UpstreamKindEflow), "e-flow", "eflowcode":
		return UpstreamKindEflow
	}

	haystack := strings.ToLower(strings.TrimSpace(name) + " " + strings.TrimSpace(baseURL))
	if strings.Contains(haystack, "sub2api") {
		return UpstreamKindSub2API
	}
	if strings.Contains(haystack, "e-flowcode") ||
		strings.Contains(haystack, "eflowcode") ||
		strings.Contains(haystack, "e-flow") {
		return UpstreamKindEflow
	}
	return UpstreamKindUnknown
}

// ResolveCodexGroupRatio is kept for callers/tests; Codex + Grok both go through
// ResolveDynamicGroupRatio.
func ResolveCodexGroupRatio(usingGroup string, baseline float64, kind UpstreamKind) float64 {
	return ResolveDynamicGroupRatio(usingGroup, baseline, kind)
}

// ResolveDynamicGroupRatio returns the effective group ratio based on which
// upstream actually serves the request.
//
// Codex (1_vip_codex / 2_free_codex):
//   - sub2api: fixed 0.04
//   - e-flow fallback: baseline * 1.10
//   - unknown: baseline
//
// Grok (1_vip_grok):
//   - sub2api: fixed 0.01
//   - e-flow / unknown: baseline unchanged (original synced billing)
//
// Other groups always return baseline.
func ResolveDynamicGroupRatio(usingGroup string, baseline float64, kind UpstreamKind) float64 {
	if IsGrokDynamicRatioGroup(usingGroup) {
		switch kind {
		case UpstreamKindSub2API:
			return Sub2APIGrokGroupRatio
		default:
			// e-flow and unknown: keep original group ratio from options sync.
			return baseline
		}
	}
	if !IsCodexDynamicRatioGroup(usingGroup) {
		return baseline
	}
	switch kind {
	case UpstreamKindSub2API:
		return Sub2APICodexGroupRatio
	case UpstreamKindEflow:
		return baseline * EflowFallbackGroupRatioMultiplier
	default:
		return baseline
	}
}
