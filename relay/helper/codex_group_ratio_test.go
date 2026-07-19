package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestHandleGroupRatio_CodexDynamicByUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Avoid CacheGetChannel hitting a nil DB: enable memory cache with empty map so miss is clean.
	origCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = origCache })

	// Seed group baseline ratios used when falling back to e-flow (1.10 × baseline).
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"1_vip_codex":0.20,"2_free_codex":0.50,"default":1}`,
	))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`)
	})

	cases := []struct {
		name      string
		group     string
		baseURL   string
		wantRatio float64
	}{
		// Classification falls back to base URL when channel cache miss (no DB in this package).
		{"vip_sub2api", "1_vip_codex", "http://sub2api:8080", ratio_setting.Sub2APICodexGroupRatio},
		{"vip_eflow", "1_vip_codex", "http://e-flowcode.cc", 0.20 * ratio_setting.EflowFallbackGroupRatioMultiplier},
		{"free_sub2api", "2_free_codex", "http://sub2api:8080", ratio_setting.Sub2APICodexGroupRatio},
		{"free_eflow", "2_free_codex", "http://e-flowcode.cc", 0.50 * ratio_setting.EflowFallbackGroupRatioMultiplier},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

			info := &relaycommon.RelayInfo{
				UserGroup:  tc.group,
				UsingGroup: tc.group,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelId:      999001, // force URL-based classification (cache miss)
					ChannelBaseUrl: tc.baseURL,
				},
			}
			got := HandleGroupRatio(c, info)
			require.InDelta(t, tc.wantRatio, got.GroupRatio, 1e-12)
		})
	}
}

// TestPriceDataGroupRatio_AfterInitChannelMeta mirrors the real relay billing order:
//   ModelPriceHelper (ChannelMeta nil) → InitChannelMeta (channel known) → PriceData used at settle.
// Without refreshing GroupRatioInfo after InitChannelMeta, codex dynamic ratio never bills.
func TestPriceDataGroupRatio_AfterInitChannelMeta(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ratio_setting.InitRatioSettings()

	origCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = origCache })

	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"1_vip_codex":0.20,"2_free_codex":0.50,"default":1}`,
	))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`)
	})

	cases := []struct {
		name      string
		group     string
		baseURL   string
		channelID int
		wantRatio float64
	}{
		{"vip_sub2api", "1_vip_codex", "http://sub2api:8080", 501, ratio_setting.Sub2APICodexGroupRatio},
		{"vip_eflow", "1_vip_codex", "http://e-flowcode.cc", 502, 0.20 * ratio_setting.EflowFallbackGroupRatioMultiplier},
		{"free_sub2api", "2_free_codex", "http://sub2api:8080", 503, ratio_setting.Sub2APICodexGroupRatio},
		{"free_eflow", "2_free_codex", "http://e-flowcode.cc", 504, 0.50 * ratio_setting.EflowFallbackGroupRatioMultiplier},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			// Distributor has not yet selected a channel into RelayInfo.ChannelMeta.
			// Context may already hold a provisional channel; leave it empty until after ModelPriceHelper.

			info := &relaycommon.RelayInfo{
				UserGroup:       tc.group,
				UsingGroup:      tc.group,
				OriginModelName: "gpt-5",
				// ChannelMeta intentionally nil — same as GenRelayInfo before handler InitChannelMeta.
			}

			// 1) Pre-consume pricing path (controller Relay before channel loop / handler).
			priceData, err := ModelPriceHelper(c, info, 100, &types.TokenCountMeta{})
			require.NoError(t, err)
			// Baseline group ratio only (no ChannelMeta → dynamic branch skipped).
			baseline := ratio_setting.GetGroupRatio(tc.group)
			require.InDelta(t, baseline, priceData.GroupRatioInfo.GroupRatio, 1e-12,
				"pre-channel ModelPriceHelper must store baseline, not dynamic ratio")
			require.InDelta(t, baseline, info.PriceData.GroupRatioInfo.GroupRatio, 1e-12)

			// 2) Selected channel is written into gin context (SetupContextForSelectedChannel).
			common.SetContextKey(c, constant.ContextKeyChannelId, tc.channelID)
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, tc.baseURL)
			common.SetContextKey(c, constant.ContextKeyOriginalModel, "gpt-5")
			common.SetContextKey(c, constant.ContextKeyChannelName, "upstream-"+tc.name)

			// 3) Handler entry: InitChannelMeta + refresh PriceData.GroupRatioInfo (shipped path).
			InitChannelMeta(c, info)
			require.NotNil(t, info.ChannelMeta)
			require.Equal(t, tc.baseURL, info.ChannelMeta.ChannelBaseUrl)
			require.InDelta(t, tc.wantRatio, info.PriceData.GroupRatioInfo.GroupRatio, 1e-12,
				"after InitChannelMeta, PriceData must carry dynamic ratio for settle/PostConsumeQuota")
		})
	}
}

// TestPriceDataGroupRatio_RetrySwitchesUpstream proves failover re-resolves ratio for the
// newly selected channel (not the previous ChannelMeta), matching getChannel retry order:
// SetupContextForSelectedChannel → helper.InitChannelMeta.
func TestPriceDataGroupRatio_RetrySwitchesUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ratio_setting.InitRatioSettings()

	origCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = origCache })

	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"1_vip_codex":0.20,"default":1}`,
	))
	t.Cleanup(func() {
		_ = ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`)
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		UserGroup:       "1_vip_codex",
		UsingGroup:      "1_vip_codex",
		OriginModelName: "gpt-5",
	}
	_, err := ModelPriceHelper(c, info, 100, &types.TokenCountMeta{})
	require.NoError(t, err)

	// First attempt: sub2api
	common.SetContextKey(c, constant.ContextKeyChannelId, 601)
	common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "http://sub2api:8080")
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "gpt-5")
	InitChannelMeta(c, info)
	require.InDelta(t, ratio_setting.Sub2APICodexGroupRatio, info.PriceData.GroupRatioInfo.GroupRatio, 1e-12)

	// Retry / failover: e-flow (context updated first, then InitChannelMeta)
	common.SetContextKey(c, constant.ContextKeyChannelId, 602)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "http://e-flowcode.cc")
	InitChannelMeta(c, info)
	wantEflow := 0.20 * ratio_setting.EflowFallbackGroupRatioMultiplier
	require.InDelta(t, wantEflow, info.PriceData.GroupRatioInfo.GroupRatio, 1e-12,
		"retry must bill e-flow 1.10× baseline, not keep prior sub2api 0.13")
	require.Equal(t, "http://e-flowcode.cc", info.ChannelMeta.ChannelBaseUrl)
}

func TestModelPrice_GptImage2FixedPerCall(t *testing.T) {
	// Runtime price map is populated by InitRatioSettings (main loads this at boot).
	ratio_setting.InitRatioSettings()

	// ModelPrice is the list price before group ratio. At sub2api codex ratio
	// 0.13 the effective per-call charge is ≈ $0.08 → list = 0.08/0.13.
	wantList := 0.08 / 0.13

	price, ok := ratio_setting.GetModelPrice("gpt-image-2", false)
	require.True(t, ok, "gpt-image-2 must be on ModelPrice / use-price path")
	require.InDelta(t, wantList, price, 1e-12, "price=%v want list %v (effective 0.08 @ 0.13)", price, wantList)

	// Default map must also list it (fresh process / reset).
	defaults := ratio_setting.GetDefaultModelPriceMap()
	require.InDelta(t, wantList, defaults["gpt-image-2"], 1e-12)

	// Plaza / settle: list * group_ratio ≈ 0.08 when preferred upstream is sub2api.
	require.InDelta(t, 0.08, wantList*ratio_setting.Sub2APICodexGroupRatio, 1e-12)
}
