package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetLotteryStatus 抽奖状态 + 概率公示
func GetLotteryStatus(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	if setting == nil || !setting.Enabled {
		common.ApiErrorMsg(c, "抽奖功能未启用")
		return
	}
	userId := c.GetInt("id")
	data, err := model.GetLotteryStatusBundle(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, data)
}

// DoLotteryDraw 单抽 / 十连
func DoLotteryDraw(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	if setting == nil || !setting.Enabled {
		common.ApiErrorMsg(c, "抽奖功能未启用")
		return
	}
	var req struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Mode == "" {
		common.ApiErrorMsg(c, "参数错误：需要 mode=single|multi")
		return
	}
	userId := c.GetInt("id")
	result, err := model.UserLotteryDraw(userId, req.Mode)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, result)
}

// GetLotteryHistory 自己的抽奖历史
func GetLotteryHistory(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	if setting == nil || !setting.Enabled {
		common.ApiErrorMsg(c, "抽奖功能未启用")
		return
	}
	userId := c.GetInt("id")
	items, err := model.GetUserLotteryHistory(userId, 50)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

// GetLotteryPublicWins 高光时刻（登录可见）
func GetLotteryPublicWins(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	if setting == nil || !setting.Enabled {
		common.ApiErrorMsg(c, "抽奖功能未启用")
		return
	}
	limit := setting.PublicWinLimit
	if limit <= 0 {
		limit = 100
	}
	items, updatedAt, err := model.GetLotteryPublicWins(limit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":      items,
		"updated_at": updatedAt,
	})
}
