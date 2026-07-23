package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestIsImageGenerationOrEditRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("openai image format", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
		require.True(t, isImageGenerationOrEditRequest(c, types.RelayFormatOpenAIImage, nil))
	})

	t.Run("images generations path", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
		info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations}
		require.True(t, isImageGenerationOrEditRequest(c, types.RelayFormatOpenAI, info))
	})

	t.Run("images edits path", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
		info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesEdits}
		require.True(t, isImageGenerationOrEditRequest(c, types.RelayFormatOpenAI, info))
	})

	t.Run("playground images generations", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/pg/images/generations", nil)
		require.True(t, isImageGenerationOrEditRequest(c, types.RelayFormatOpenAIImage, nil))
	})

	t.Run("playground images edits", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/pg/images/edits", nil)
		require.True(t, isImageGenerationOrEditRequest(c, types.RelayFormatOpenAIImage, nil))
	})

	t.Run("chat completions not image", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		info := &relaycommon.RelayInfo{
			RelayMode:       relayconstant.RelayModeChatCompletions,
			OriginModelName: "gpt-5.4",
		}
		require.False(t, isImageGenerationOrEditRequest(c, types.RelayFormatOpenAI, info))
	})
}
