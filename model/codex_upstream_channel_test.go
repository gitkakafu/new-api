package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/require"
)

func resetCodexUpstreamTestTables(t *testing.T) {
	t.Helper()
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	require.NoError(t, DB.AutoMigrate(&Channel{}, &Ability{}))
	for _, table := range []string{"abilities", "channels"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
	InitChannelCache()
	t.Cleanup(func() {
		for _, table := range []string{"abilities", "channels"} {
			_ = DB.Exec("DELETE FROM " + table).Error
		}
		InitChannelCache()
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})
}

func ptrString(s string) *string { return &s }
func ptrInt64(v int64) *int64    { return &v }

func insertCodexChannel(t *testing.T, id int, name, tag, baseURL, group, models string, priority int64, status int) {
	t.Helper()
	weight := uint(100)
	ch := &Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      fmt.Sprintf("key-%d", id),
		Status:   status,
		Name:     name,
		BaseURL:  ptrString(baseURL),
		Tag:      ptrString(tag),
		Group:    group,
		Models:   models,
		Priority: ptrInt64(priority),
		Weight:   &weight,
	}
	require.NoError(t, DB.Create(ch).Error)
	// Abilities are normally added via channel.AddAbilities; create them directly for isolation.
	for _, g := range splitCSV(group) {
		for _, m := range splitCSV(models) {
			require.NoError(t, DB.Create(&Ability{
				Group:     g,
				Model:     m,
				ChannelId: id,
				Enabled:   status == common.ChannelStatusEnabled,
				Priority:  ptrInt64(priority),
				Weight:    100,
				Tag:       ptrString(tag),
			}).Error)
		}
	}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func TestCodexGroupsPreferLocalSub2APIThenFailoverToWish(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	const (
		groupVIP  = "1_vip_codex"
		modelName = "gpt-5.4"
	)

	// Higher priority local sub2api, lower priority external wishtoapp backup.
	// Both classified as sub2api for billing (0.04); failover is priority-based.
	insertCodexChannel(t, 1, "sub2api-primary", "sub2api", "http://sub2api:8080",
		groupVIP, modelName, 100, common.ChannelStatusEnabled)
	insertCodexChannel(t, 2, "sub2api-wish-backup", "sub2api", "https://sub2api.wishtoapp.com",
		groupVIP, modelName, 50, common.ChannelStatusEnabled)

	InitChannelCache()

	ch, err := GetRandomSatisfiedChannel(groupVIP, modelName, 0, "")
	require.NoError(t, err)
	require.NotNil(t, ch)
	require.Equal(t, 1, ch.Id, "retry=0 should prefer local sub2api")
	require.Equal(t, "sub2api", *ch.Tag)

	ch2, err := GetRandomSatisfiedChannel(groupVIP, modelName, 1, "")
	require.NoError(t, err)
	require.NotNil(t, ch2)
	require.Equal(t, 2, ch2.Id, "retry=1 should fall back to wishtoapp")
	require.Equal(t, "sub2api", *ch2.Tag)
	require.Equal(t, "https://sub2api.wishtoapp.com", ch2.GetBaseURL())
}

func TestCodexGroupsFailoverWhenLocalSub2APIDisabled(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	const (
		groupVIP  = "1_vip_codex"
		modelName = "gpt-5.4"
	)

	insertCodexChannel(t, 11, "sub2api-primary", "sub2api", "http://sub2api:8080",
		groupVIP, modelName, 100, common.ChannelStatusManuallyDisabled)
	insertCodexChannel(t, 12, "sub2api-wish-backup", "sub2api", "https://sub2api.wishtoapp.com",
		groupVIP, modelName, 50, common.ChannelStatusEnabled)

	InitChannelCache()

	ch, err := GetRandomSatisfiedChannel(groupVIP, modelName, 0, "")
	require.NoError(t, err)
	require.NotNil(t, ch)
	require.Equal(t, 12, ch.Id, "disabled local sub2api must not be selected; wish is the only enabled channel")
	require.Equal(t, "sub2api", *ch.Tag)
}

func TestGptImage2OnBothSub2APIBackends(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	const (
		groupVIP   = "1_vip_codex"
		imageModel = "gpt-image-2"
		chatModel  = "gpt-5.4"
	)

	// Both local and wish serve chat + image (no e-flow for openai).
	insertCodexChannel(t, 21, "sub2api-primary", "sub2api", "http://sub2api:8080",
		groupVIP, chatModel+","+imageModel, 100, common.ChannelStatusEnabled)
	insertCodexChannel(t, 22, "sub2api-wish-backup", "sub2api", "https://sub2api.wishtoapp.com",
		groupVIP, chatModel+","+imageModel, 50, common.ChannelStatusEnabled)

	InitChannelCache()

	ch, err := GetRandomSatisfiedChannel(groupVIP, imageModel, 0, "")
	require.NoError(t, err)
	require.NotNil(t, ch)
	require.Equal(t, 21, ch.Id, "gpt-image-2 retry=0 should hit local sub2api")

	chRetry, err := GetRandomSatisfiedChannel(groupVIP, imageModel, 1, "")
	require.NoError(t, err)
	require.NotNil(t, chRetry)
	require.Equal(t, 22, chRetry.Id, "gpt-image-2 retry=1 should hit wishtoapp")
}
