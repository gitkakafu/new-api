package ratio_setting

// PreferredUpstreamKindForDisplay is a lightweight hint for UI (model plaza).
// Real billing still uses ResolveCodexGroupRatio with the channel that served the request.
type PreferredUpstreamKindForDisplay = UpstreamKind

// ResolveCodexDisplayGroupRatio picks the group ratio shown on the pricing page.
//
// When the preferred (highest-priority enabled) upstream for a codex group is sub2api,
// show the sub2api fixed ratio (0.04). When only e-flow remains, show baseline * 1.10.
// When preferred kind is unknown, keep baseline so operators still see the configured ratio.
func ResolveCodexDisplayGroupRatio(usingGroup string, baseline float64, preferredKind UpstreamKind) float64 {
	if !IsCodexDynamicRatioGroup(usingGroup) {
		return baseline
	}
	return ResolveCodexGroupRatio(usingGroup, baseline, preferredKind)
}
