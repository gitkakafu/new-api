package model

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func TestExpectedValueSingleAndMulti(t *testing.T) {
	s := operation_setting.GetLotterySetting()
	singleEV := ExpectedValue(s.EffectiveSingleWeights())
	multiEV := ExpectedValue(s.EffectiveMultiWeights())
	if math.Abs(singleEV-1.0) > 1e-9 {
		t.Fatalf("single EV want 1.0 got %.10f", singleEV)
	}
	if math.Abs(multiEV-0.888) > 1e-9 {
		t.Fatalf("multi EV/draw want 0.888 got %.10f", multiEV)
	}
	ten := multiEV * 10
	if math.Abs(ten-8.88) > 1e-9 {
		t.Fatalf("multi total EV want 8.88 got %.10f", ten)
	}
	subsidy := ten - 8
	if math.Abs(subsidy-0.88) > 1e-9 {
		t.Fatalf("subsidy want 0.88 got %.10f", subsidy)
	}
}

func TestDisplayAmountToQuotaHalf(t *testing.T) {
	// 默认 QuotaPerUnit=500000 → 0.5 → 250000
	q := DisplayAmountToQuota(0.5)
	if q != 250000 {
		t.Fatalf("0.5 display → quota want 250000 got %d", q)
	}
	if DisplayAmountToQuota(1) != 500000 {
		t.Fatalf("1 display → 500000")
	}
	if DisplayAmountToQuota(10) != 5000000 {
		t.Fatalf("10 display → 5000000")
	}
}

func TestMaskLotteryUsername(t *testing.T) {
	cases := map[string]string{
		"a":        "*",
		"ab":       "a*",
		"abc":      "a*c",
		"abcd":     "a**d",
		"alice":    "a***e",
		"zhangsan": "z***n",
	}
	for in, want := range cases {
		got := MaskLotteryUsername(in)
		if got != want {
			t.Fatalf("mask(%q)=%q want %q", in, got, want)
		}
	}
	// email: local masked + domain primary label masked
	got := MaskLotteryUsername("alice@example.com")
	if got != "a***e@e***e.com" {
		t.Fatalf("email mask got %q", got)
	}
}

func TestPrizeIndexInOrder(t *testing.T) {
	order := operation_setting.PrizeOrder()
	for i, a := range order {
		if PrizeIndexInOrder(a) != i {
			t.Fatalf("amount %v index want %d", a, i)
		}
	}
}

// TestMonteCarloSingleEV 验收 §8.1：≥10 万次样本均值 ∈ [0.99, 1.01]
func TestMonteCarloSingleEV(t *testing.T) {
	weights := operation_setting.GetLotterySetting().EffectiveSingleWeights()
	const n = 100_000
	var sum float64
	counts := map[float64]int{}
	for i := 0; i < n; i++ {
		amt, _, err := SampleWeightedPrize(weights)
		if err != nil {
			t.Fatal(err)
		}
		sum += amt
		counts[amt]++
	}
	mean := sum / float64(n)
	if mean < 0.99 || mean > 1.01 {
		t.Fatalf("single Monte Carlo mean=%.6f outside [0.99,1.01] (n=%d)", mean, n)
	}
	t.Logf("single Monte Carlo mean=%.6f (n=%d)", mean, n)
	// 粗检各档概率不过分偏离
	for _, w := range weights {
		p := float64(counts[w.Amount]) / float64(n)
		expect := float64(w.Weight) / 3000.0
		// 宽松：绝对偏差 < 1.5pp 或相对 < 15%（小概率档）
		if math.Abs(p-expect) > 0.015 && math.Abs(p-expect)/expect > 0.15 {
			t.Fatalf("amount %.1f empirical p=%.4f expect=%.4f", w.Amount, p, expect)
		}
	}
}

// TestMonteCarloMultiEV 验收 §8.2：每抽均值 ∈ [0.88, 0.90]；十连总 ∈ [8.80, 8.96]
func TestMonteCarloMultiEV(t *testing.T) {
	weights := operation_setting.GetLotterySetting().EffectiveMultiWeights()
	const draws = 100_000
	var sum float64
	for i := 0; i < draws; i++ {
		amt, _, err := SampleWeightedPrize(weights)
		if err != nil {
			t.Fatal(err)
		}
		sum += amt
	}
	mean := sum / float64(draws)
	if mean < 0.88 || mean > 0.90 {
		t.Fatalf("multi per-draw mean=%.6f outside [0.88,0.90]", mean)
	}
	// 十连总：用 20_000 次完整十连
	const tens = 20_000
	var tenSum float64
	for i := 0; i < tens; i++ {
		var one float64
		for j := 0; j < 10; j++ {
			amt, _, err := SampleWeightedPrize(weights)
			if err != nil {
				t.Fatal(err)
			}
			one += amt
		}
		tenSum += one
	}
	tenMean := tenSum / float64(tens)
	if tenMean < 8.80 || tenMean > 8.96 {
		t.Fatalf("multi ten-draw mean=%.6f outside [8.80,8.96]", tenMean)
	}
	t.Logf("multi per-draw mean=%.6f ten-mean=%.6f", mean, tenMean)
}

func TestSampleOnlyKnownTiers(t *testing.T) {
	weights := operation_setting.GetLotterySetting().EffectiveSingleWeights()
	allowed := map[float64]bool{}
	for _, w := range weights {
		allowed[w.Amount] = true
	}
	for i := 0; i < 5000; i++ {
		amt, idx, err := SampleWeightedPrize(weights)
		if err != nil {
			t.Fatal(err)
		}
		if !allowed[amt] {
			t.Fatalf("unexpected amount %v", amt)
		}
		if idx < 0 || idx >= len(weights) {
			t.Fatalf("bad index %d", idx)
		}
	}
}
