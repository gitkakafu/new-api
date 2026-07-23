package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// LotteryPrizeWeight 单档金额 + 权重
type LotteryPrizeWeight struct {
	Amount float64 `json:"amount"`
	Weight int     `json:"weight"`
}

// LotterySetting 余额抽奖配置（operation_setting）
type LotterySetting struct {
	Enabled         bool                 `json:"enabled"`
	SingleCost      float64              `json:"single_cost"`       // 显示额度成本
	MultiCost       float64              `json:"multi_cost"`        // 十连显示额度成本
	MultiDraws      int                  `json:"multi_draws"`       // 十连抽数
	DailyDrawLimit  int                  `json:"daily_draw_limit"`  // 每日抽数上限
	SingleWeights   []LotteryPrizeWeight `json:"single_weights"`    // 单抽权重表
	MultiWeights    []LotteryPrizeWeight `json:"multi_weights"`     // 十连权重表
	PublicWinMin    float64              `json:"public_win_min"`    // 播报阈值（含）
	PublicWinLimit  int                  `json:"public_win_limit"`  // 播报条数
	Timezone        string               `json:"timezone"`          // 日切时区
	BigWinThreshold float64              `json:"big_win_threshold"` // 大奖特效阈值（含）
}

// 默认单抽表：Σw=3000，EV=1.000（见 docs/lottery-balance-draw.md §2.3）
func defaultSingleWeights() []LotteryPrizeWeight {
	return []LotteryPrizeWeight{
		{Amount: 0.5, Weight: 1820},
		{Amount: 1.0, Weight: 600},
		{Amount: 1.5, Weight: 240},
		{Amount: 2.0, Weight: 160},
		{Amount: 3.0, Weight: 100},
		{Amount: 5.0, Weight: 50},
		{Amount: 8.0, Weight: 20},
		{Amount: 10.0, Weight: 10},
	}
}

// 默认十连表：Σw=10000，每抽 EV=0.888，十连总 EV=8.88（§2.4）
func defaultMultiWeights() []LotteryPrizeWeight {
	return []LotteryPrizeWeight{
		{Amount: 0.5, Weight: 5960},
		{Amount: 1.0, Weight: 2880},
		{Amount: 1.5, Weight: 500},
		{Amount: 2.0, Weight: 250},
		{Amount: 3.0, Weight: 250},
		{Amount: 5.0, Weight: 100},
		{Amount: 8.0, Weight: 40},
		{Amount: 10.0, Weight: 20},
	}
}

var lotterySetting = LotterySetting{
	Enabled:         true,
	SingleCost:      1,
	MultiCost:       8,
	MultiDraws:      10,
	DailyDrawLimit:  10,
	SingleWeights:   defaultSingleWeights(),
	MultiWeights:    defaultMultiWeights(),
	PublicWinMin:    2,
	PublicWinLimit:  100,
	Timezone:        "Asia/Shanghai",
	BigWinThreshold: 5,
}

func init() {
	config.GlobalConfig.Register("lottery_setting", &lotterySetting)
}

// GetLotterySetting 获取抽奖配置（指针，可被全局配置热更新）
func GetLotterySetting() *LotterySetting {
	return &lotterySetting
}

// IsLotteryEnabled 是否启用抽奖
func IsLotteryEnabled() bool {
	return lotterySetting.Enabled
}

// PrizeOrder 与前端 PRIZE_ORDER / 角色图标 index 一致
func PrizeOrder() []float64 {
	return []float64{0.5, 1, 1.5, 2, 3, 5, 8, 10}
}

// EffectiveSingleWeights 空配置时回退默认
func (s *LotterySetting) EffectiveSingleWeights() []LotteryPrizeWeight {
	if len(s.SingleWeights) == 0 {
		return defaultSingleWeights()
	}
	return s.SingleWeights
}

// EffectiveMultiWeights 空配置时回退默认
func (s *LotterySetting) EffectiveMultiWeights() []LotteryPrizeWeight {
	if len(s.MultiWeights) == 0 {
		return defaultMultiWeights()
	}
	return s.MultiWeights
}
