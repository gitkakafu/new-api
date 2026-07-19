package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/require"
)

func TestApplyCodexDisplayGroupRatios_PrefersSub2API(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	insertCodexChannel(t, 1, "sub2api-primary", "sub2api", "http://sub2api:8080",
		"1_vip_codex,2_free_codex", "gpt-5.1", 100, common.ChannelStatusEnabled)
	insertCodexChannel(t, 2, "eflow-fallback", "eflow", "http://e-flowcode.cc",
		"1_vip_codex,2_free_codex", "gpt-5.1", 10, common.ChannelStatusEnabled)
	InitChannelCache()

	ratios := map[string]float64{
		"1_vip_codex":  0.33,
		"2_free_codex": 0.22,
		"1_vip_china":  0.22,
		"default":      1,
	}
	ApplyCodexDisplayGroupRatios(ratios)
	require.Equal(t, ratio_setting.Sub2APICodexGroupRatio, ratios["1_vip_codex"])
	require.Equal(t, ratio_setting.Sub2APICodexGroupRatio, ratios["2_free_codex"])
	require.Equal(t, 0.22, ratios["1_vip_china"])
	require.Equal(t, 1.0, ratios["default"])
}

func TestApplyCodexDisplayGroupRatios_EflowWhenSub2Disabled(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	insertCodexChannel(t, 1, "sub2api-primary", "sub2api", "http://sub2api:8080",
		"1_vip_codex", "gpt-5.1", 100, common.ChannelStatusManuallyDisabled)
	insertCodexChannel(t, 2, "eflow-fallback", "eflow", "http://e-flowcode.cc",
		"1_vip_codex", "gpt-5.1", 10, common.ChannelStatusEnabled)
	InitChannelCache()

	ratios := map[string]float64{"1_vip_codex": 0.30}
	ApplyCodexDisplayGroupRatios(ratios)
	require.InDelta(t, 0.30*ratio_setting.EflowFallbackGroupRatioMultiplier, ratios["1_vip_codex"], 1e-12)
}

func TestResolveCodexDisplayGroupRatio_SingleGroup(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	insertCodexChannel(t, 1, "sub2api-primary", "sub2api", "http://sub2api:8080",
		"1_vip_codex", "gpt-5.4", 100, common.ChannelStatusEnabled)
	InitChannelCache()

	got := ResolveCodexDisplayGroupRatio("1_vip_codex", 0.33)
	require.Equal(t, ratio_setting.Sub2APICodexGroupRatio, got)
	// non-codex group unchanged
	require.Equal(t, 0.22, ResolveCodexDisplayGroupRatio("1_vip_china", 0.22))
}
