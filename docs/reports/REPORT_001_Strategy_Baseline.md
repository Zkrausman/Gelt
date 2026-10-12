# REPORT_001: Strategy Baseline Assessment

## Executive Summary
This report establishes the baseline evaluation of Gelt's active strategy catalog and signal confidence scoring framework per `TASK_001_Strategy_Baseline_Review.md`. It captures the terminal execution output of `.\gelt.exe strategies` and provides code extraction for the confidence scoring logic (0.0 to 100.0) powering Gelt's active trading plans.

---

## 1. Strategy Catalog Execution Output

**Command Executed:** `.\gelt.exe strategies`

```text
Gelt Quantitative Strategy Catalog (4 Registered Strategies):
Strategy Name        | Description
---------------------------------------------------------------------------------------------------
BreakoutVol          | Captures volatility expansion breakouts confirmed by >1.5x ATR range expansion and volume surge.
MeanReversion        | Identifies oversold bounce opportunities using Bollinger Bands (Lower Band touch) and RSI < 35.
TrendConfluence      | Multi-indicator momentum strategy combining 20/50 EMA trend alignment, MACD momentum, and RSI levels.
VWAPRebound          | Evaluates intraday pullback rebounds against institutional VWAP support and resistance levels.
```

---

## 2. Active Trading Plan Confidence Score Logic

The primary active trading plan configured by default is **`IntradayAlphaPlan`**, defined in [`builtin.go`](../../pkg/plans/builtin.go). This plan is a composite ensemble combining two atomic catalog strategies:
- **`TrendConfluence`** (60% weight)
- **`VWAPRebound`** (40% weight)

### 2.1 Multi-Strategy Ensemble Score Weighted Calculation
Located in [`plan.go`](../../pkg/plans/plan.go#L68-L126), the `BasePlan.Evaluate` function aggregates scores from all constituent strategies using their defined weights:

```go
// Evaluate runs all weighted strategies, computes composite score & dynamic ATR stops, and returns PlanEvaluation.
func (p *BasePlan) Evaluate(symbol string, closes []float64, volumes []float64) (PlanEvaluation, error) {
	if len(p.strategies) == 0 {
		return PlanEvaluation{}, fmt.Errorf("trading plan %q contains no strategies", p.planName)
	}

	var signals []strategies.StrategySignal
	var totalWeight float64
	var weightedScore float64
	var totalStop float64
	var totalTarget float64

	var rationales []string

	for _, ws := range p.strategies {
		sig, err := ws.Strategy.Evaluate(symbol, closes, volumes)
		if err != nil {
			continue
		}
		signals = append(signals, sig)
		totalWeight += ws.Weight
		weightedScore += sig.Score * ws.Weight
		totalStop += sig.StopLossPct * ws.Weight
		totalTarget += sig.TargetPct * ws.Weight

		rationales = append(rationales, fmt.Sprintf("[%s (w=%.1f): %s Score=%.1f]", ws.Strategy.Name(), ws.Weight, sig.Signal, sig.Score))
	}

	if totalWeight == 0 {
		totalWeight = 1.0
	}

	finalScore := weightedScore / totalWeight
	avgStop := totalStop / totalWeight
	avgTarget := totalTarget / totalWeight

	consensus := strategies.SignalHold
	if finalScore >= 75.0 {
		consensus = strategies.SignalBuy
	} else if finalScore <= 35.0 {
		consensus = strategies.SignalSell
	}

	return PlanEvaluation{
		PlanName:        p.planName,
		Symbol:          symbol,
		ConsensusSignal: consensus,
		WeightedScore:   finalScore,
		StopLossPct:     avgStop,
		TargetPct:       avgTarget,
		StrategySignals: signals,
		Rationale:       strings.Join(rationales, " | "),
		Timestamp:       time.Now(),
	}, nil
}
```

---

### 2.2 Active Trading Plan Registration
Located in [`builtin.go`](../../pkg/plans/builtin.go#L16-L24):

```go
// 1. IntradayAlphaPlan (Default): TrendConfluence (60%) + VWAPRebound (40%)
alphaPlan := NewBasePlan(
	"IntradayAlphaPlan",
	"Default multi-strategy ensemble combining TrendConfluence (60%) and VWAPRebound (40%) for liquid US equities.",
	[]WeightedStrategy{
		{Strategy: trend, Weight: 0.60},
		{Strategy: vwap, Weight: 0.40},
	},
)
```

---

### 2.3 TrendConfluence Scoring Logic (0.0 - 100.0)
`TrendConfluence` invokes `EvaluateConfluence` in [`indicators.go`](../../pkg/signals/indicators.go#L310-L367), which computes a composite score starting from a neutral baseline of 50.0:

```go
score := 50.0 // Start neutral
var signals []string

// Trend checks
if latestPrice > latestEMA20 {
	score += 10.0
	signals = append(signals, "Price > 20 EMA (Short-term Uptrend)")
} else {
	score -= 10.0
	signals = append(signals, "Price < 20 EMA (Short-term Downtrend)")
}

if latestEMA20 > latestEMA50 {
	score += 15.0
	signals = append(signals, "20 EMA > 50 EMA (Bullish Trend Alignment)")
} else {
	score -= 15.0
	signals = append(signals, "20 EMA < 50 EMA (Bearish Trend Alignment)")
}

// RSI checks
if latestRSI < 30.0 {
	score += 20.0
	signals = append(signals, fmt.Sprintf("RSI Oversold (%.1f)", latestRSI))
} else if latestRSI > 70.0 {
	score -= 20.0
	signals = append(signals, fmt.Sprintf("RSI Overbought (%.1f)", latestRSI))
} else if latestRSI >= 50.0 {
	score += 5.0
	signals = append(signals, fmt.Sprintf("RSI Positive Momentum (%.1f)", latestRSI))
}

// MACD checks
if latestHist > 0 {
	score += 10.0
	signals = append(signals, "MACD Histogram Positive")
} else {
	score -= 10.0
	signals = append(signals, "MACD Histogram Negative")
}

// Bollinger Band checks
if latestPrice <= latestLower {
	score += 15.0
	signals = append(signals, "Price at/below Lower Bollinger Band (Potential Mean Reversion)")
} else if latestPrice >= latestUpper {
	score -= 15.0
	signals = append(signals, "Price at/above Upper Bollinger Band (Extended)")
}

// Clamp score between 0 and 100
if score > 100.0 {
	score = 100.0
}
if score < 0.0 {
	score = 0.0
}
```

---

### 2.4 VWAPRebound Scoring Logic
Located in [`vwap_rebound.go`](../../pkg/strategies/vwap_rebound.go#L42-L54):

```go
diffPct := ((lastClose - lastVWAP) / lastVWAP) * 100.0

score := 50.0
sig := SignalHold
rationale := fmt.Sprintf("Close: $%.2f | VWAP: $%.2f (Diff: %.2f%%)", lastClose, lastVWAP, diffPct)

if diffPct >= -0.2 && diffPct <= 0.3 {
	score = 88.0
	sig = SignalBuy
	rationale += " | Bullish VWAP Support Rebound (BUY)"
}
```

---

## 3. Conclusions & Baseline Summary

1. **Active Plan Composition**: The active default plan `IntradayAlphaPlan` blends `TrendConfluence` (60%) and `VWAPRebound` (40%).
2. **Consensus Decision Boundaries**:
   - `WeightedScore >= 75.0`: `SignalBuy`
   - `WeightedScore <= 35.0`: `SignalSell`
   - `35.0 < WeightedScore < 75.0`: `SignalHold`
3. **Status**: Baseline assessment completed. Strategy catalog and quantitative scoring mechanisms are documented and ready for Phase 1 optimization.
