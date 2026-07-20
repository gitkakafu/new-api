package ratio_setting

import "strings"

// Codex groups that prefer sub2api with e-flow fallback and dynamic group ratio.
const (
	GroupVIPCodex  = "1_vip_codex"
	GroupFreeCodex = "2_free_codex"

	// Sub2APICodexGroupRatio is the effective group ratio when traffic is served by sub2api.
	Sub2APICodexGroupRatio = 0.07

	// EflowFallbackGroupRatioMultiplier is applied to the baseline (synced) group
	// ratio when traffic falls back to e-flowcode.cc for codex groups.
	EflowFallbackGroupRatioMultiplier = 1.10
)

// IsCodexDynamicRatioGroup reports whether the using-group uses channel-dependent ratio.
func IsCodexDynamicRatioGroup(group string) bool {
	switch strings.TrimSpace(group) {
	case GroupVIPCodex, GroupFreeCodex:
		return true
	default:
		return false
	}
}

// UpstreamKind identifies the upstream pool used for dynamic codex billing.
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

// ResolveCodexGroupRatio returns the effective group ratio for codex groups
// based on which upstream actually serves the request.
//
// - sub2api: fixed 0.07
// - e-flow fallback: baseline * 1.10 (baseline is the pre-existing GroupRatio sync value)
// - unknown: baseline unchanged
//
// Non-codex groups always return baseline.
func ResolveCodexGroupRatio(usingGroup string, baseline float64, kind UpstreamKind) float64 {
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
