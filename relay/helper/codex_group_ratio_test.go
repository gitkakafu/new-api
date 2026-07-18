package helper

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
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

func TestModelPrice_GptImage2FixedPerCall(t *testing.T) {
	// Runtime price map is populated by InitRatioSettings (main loads this at boot).
	ratio_setting.InitRatioSettings()

	price, ok := ratio_setting.GetModelPrice("gpt-image-2", false)
	require.True(t, ok, "gpt-image-2 must be on ModelPrice / use-price path")
	require.True(t, math.Abs(price-0.08) < 1e-12, "price=%v want 0.08", price)

	// Default map must also list it (fresh process / reset).
	defaults := ratio_setting.GetDefaultModelPriceMap()
	require.InDelta(t, 0.08, defaults["gpt-image-2"], 1e-12)
}
