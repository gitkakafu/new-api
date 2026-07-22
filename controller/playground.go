package controller

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Playground is the legacy chat entry (OpenAI chat completions format).
func Playground(c *gin.Context) {
	PlaygroundRelay(c, types.RelayFormatOpenAI)
}

// PlaygroundRelay runs a session-authenticated relay with a virtual token so
// console UIs (chat / drawing) can bill the logged-in user without an API key.
//
// Do not call GenRelayInfo(format, nil) here for formats that require a typed
// body (e.g. OpenAIResponses) — that fails with "request is not a …Request".
// Group for the virtual token comes from context (set by UserAuth + Distribute).
func PlaygroundRelay(c *gin.Context, relayFormat types.RelayFormat) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	// UsingGroup may already include body.group from Distribute for /pg/* paths.
	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "" {
		usingGroup = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	}
	if usingGroup == "" {
		usingGroup = "default"
	}

	tokenName := "playground"
	if relayFormat == types.RelayFormatOpenAIImage {
		// Distinguish generate vs edit in logs only (token name, not a group).
		if strings.Contains(c.Request.URL.Path, "/images/edits") {
			tokenName = "drawing-edits"
		} else {
			tokenName = "drawing-images"
		}
	}

	// Name is display-only in logs (e.g. drawing-images-1_vip_codex) — not a real group.
	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("%s-%s", tokenName, usingGroup),
		Group:  usingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, relayFormat)
}
