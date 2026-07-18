package model

import (
	"fmt"
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
		Weight:   func() *uint { v := uint(100); return &v }(),
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
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			part := s[start:i]
			if part != "" {
				out = append(out, part)
			}
			start = i + 1
		}
	}
	return out
}

func TestCodexGroupsPreferSub2APIThenFailoverToEflow(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	const (
		groupVIP  = "1_vip_codex"
		groupFree = "2_free_codex"
		modelName = "gpt-5.1"
	)

	// Higher priority sub2api, lower priority e-flow â€?both groups, same model.
	insertCodexChannel(t, 1, "sub2api-primary", "sub2api", "http://sub2api:8080",
		groupVIP+","+groupFree, modelName, 100, common.ChannelStatusEnabled)
	insertCodexChannel(t, 2, "eflow-fallback", "eflow", "http://e-flowcode.cc",
		groupVIP+","+groupFree, modelName, 10, common.ChannelStatusEnabled)

	InitChannelCache()

	for _, group := range []string{groupVIP, groupFree} {
		ch, err := GetRandomSatisfiedChannel(group, modelName, 0, "")
		require.NoError(t, err)
		require.NotNil(t, ch)
		require.Equal(t, 1, ch.Id, "retry=0 should prefer sub2api for %s", group)
		require.Equal(t, "sub2api", *ch.Tag)

		ch2, err := GetRandomSatisfiedChannel(group, modelName, 1, "")
		require.NoError(t, err)
		require.NotNil(t, ch2)
		require.Equal(t, 2, ch2.Id, "retry=1 should fall back to e-flow for %s", group)
		require.Equal(t, "eflow", *ch2.Tag)
	}
}

func TestCodexGroupsFailoverWhenSub2APIDisabled(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	const (
		groupVIP  = "1_vip_codex"
		modelName = "gpt-5.1"
	)

	insertCodexChannel(t, 11, "sub2api-primary", "sub2api", "http://sub2api:8080",
		groupVIP, modelName, 100, common.ChannelStatusManuallyDisabled)
	insertCodexChannel(t, 12, "eflow-fallback", "eflow", "http://e-flowcode.cc",
		groupVIP, modelName, 10, common.ChannelStatusEnabled)

	InitChannelCache()

	ch, err := GetRandomSatisfiedChannel(groupVIP, modelName, 0, "")
	require.NoError(t, err)
	require.NotNil(t, ch)
	require.Equal(t, 12, ch.Id, "disabled sub2api must not be selected; e-flow is the only enabled channel")
	require.Equal(t, "eflow", *ch.Tag)
}

func TestGptImage2OnlyOnSub2API(t *testing.T) {
	resetCodexUpstreamTestTables(t)

	const (
		groupVIP  = "1_vip_codex"
		groupFree = "2_free_codex"
		imageModel = "gpt-image-2"
		chatModel  = "gpt-5.1"
	)

	// sub2api serves both chat + image; e-flow only chat (no gpt-image-2 ability).
	insertCodexChannel(t, 21, "sub2api-primary", "sub2api", "http://sub2api:8080",
		groupVIP+","+groupFree, chatModel+","+imageModel, 100, common.ChannelStatusEnabled)
	insertCodexChannel(t, 22, "eflow-fallback", "eflow", "http://e-flowcode.cc",
		groupVIP+","+groupFree, chatModel, 10, common.ChannelStatusEnabled)

	InitChannelCache()

	for _, group := range []string{groupVIP, groupFree} {
		ch, err := GetRandomSatisfiedChannel(group, imageModel, 0, "")
		require.NoError(t, err)
		require.NotNil(t, ch)
		require.Equal(t, 21, ch.Id, "gpt-image-2 must only hit sub2api for %s", group)

		// retry beyond available priorities should still stay on the only image channel
		chRetry, err := GetRandomSatisfiedChannel(group, imageModel, 5, "")
		require.NoError(t, err)
		require.NotNil(t, chRetry)
		require.Equal(t, 21, chRetry.Id)
	}

	// Ensure e-flow has no ability row for gpt-image-2
	var eflowImageAbility int64
	require.NoError(t, DB.Model(&Ability{}).
		Where("channel_id = ? AND model = ? AND enabled = ?", 22, imageModel, true).
		Count(&eflowImageAbility).Error)
	require.Equal(t, int64(0), eflowImageAbility)
}
