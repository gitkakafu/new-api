package ratio_setting

// PreferredUpstreamKindForDisplay is a lightweight hint for UI (model plaza).
// Real billing still uses ResolveDynamicGroupRatio with the channel that served the request.
type PreferredUpstreamKindForDisplay = UpstreamKind

// ResolveCodexDisplayGroupRatio picks the group ratio shown on the pricing page.
// Kept name for compatibility; handles both Codex and Grok dynamic groups.
//
// When the preferred (highest-priority enabled) upstream is sub2api:
//   - Codex → 0.04
//   - Grok  → 0.01
// When only e-flow remains:
//   - Codex → baseline * 1.10
//   - Grok  → baseline (original billing)
// When preferred kind is unknown, keep baseline.
func ResolveCodexDisplayGroupRatio(usingGroup string, baseline float64, preferredKind UpstreamKind) float64 {
	if !IsDynamicUpstreamRatioGroup(usingGroup) {
		return baseline
	}
	return ResolveDynamicGroupRatio(usingGroup, baseline, preferredKind)
}
