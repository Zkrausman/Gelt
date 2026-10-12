// Package signals provides high-performance technical indicator calculations and market confluence evaluation for Gelt.
package signals

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// Bar represents a single price candle.
type Bar struct {
	Timestamp time.Time
	Open      float64
	High      float64
	Low       float64
	Close     float64
	Volume    float64
}

// ConfluenceSummary holds technical signal evaluation results and a overall bullishness score (0-100).
type ConfluenceSummary struct {
	Symbol           string   `json:"symbol"`
	LatestPrice      float64  `json:"latest_price"`
	Score            float64  `json:"score"`              // 0.0 (Extremely Bearish) to 100.0 (Extremely Bullish)
	Bias             string   `json:"bias"`               // "BULLISH", "NEUTRAL", "BEARISH"
	RSI14            float64  `json:"rsi_14"`             // Latest RSI value
	EMA20            float64  `json:"ema_20"`             // Latest 20-period EMA
	EMA50            float64  `json:"ema_50"`             // Latest 50-period EMA
	MACDValue        float64  `json:"macd_value"`         // Latest MACD line
	MACDSignal       float64  `json:"macd_signal"`        // Latest MACD signal line
	MACDHist         float64  `json:"macd_hist"`          // Latest MACD histogram
	BollingerUpper   float64  `json:"bollinger_upper"`    // Upper Bollinger Band
	BollingerLower   float64  `json:"bollinger_lower"`    // Lower Bollinger Band
	ATR14            float64  `json:"atr_14"`             // 14-period Average True Range
	DynamicStopPct   float64  `json:"dynamic_stop_pct"`   // Dynamically calculated ATR stop-loss %
	DynamicTargetPct float64  `json:"dynamic_target_pct"` // Dynamically calculated ATR target profit %
	SignalsTriggered []string `json:"signals_triggered"`  // List of active technical signals
}

// SMA calculates the Simple Moving Average for a price series.
func SMA(prices []float64, period int) ([]float64, error) {
	if period <= 0 {
		return nil, fmt.Errorf("period must be > 0, got %d", period)
	}
	if len(prices) < period {
		return nil, fmt.Errorf("insufficient data points (%d) for period %d", len(prices), period)
	}

	result := make([]float64, len(prices))
	var sum float64

	for i := 0; i < len(prices); i++ {
		sum += prices[i]
		if i >= period {
			sum -= prices[i-period]
		}
		if i >= period-1 {
			result[i] = sum / float64(period)
		} else {
			result[i] = math.NaN()
		}
	}
	return result, nil
}

// EMA calculates the Exponential Moving Average for a price series.
func EMA(prices []float64, period int) ([]float64, error) {
	if period <= 0 {
		return nil, fmt.Errorf("period must be > 0, got %d", period)
	}
	if len(prices) < period {
		return nil, fmt.Errorf("insufficient data points (%d) for period %d", len(prices), period)
	}

	result := make([]float64, len(prices))
	multiplier := 2.0 / float64(period+1)

	// Seed with initial SMA
	var sum float64
	for i := 0; i < period; i++ {
		sum += prices[i]
		result[i] = math.NaN()
	}
	initialSMA := sum / float64(period)
	result[period-1] = initialSMA

	// Calculate EMA recursively
	for i := period; i < len(prices); i++ {
		result[i] = (prices[i]-result[i-1])*multiplier + result[i-1]
	}
	return result, nil
}

// RSI calculates the Relative Strength Index (Wilder's RSI) for a price series.
func RSI(closes []float64, period int) ([]float64, error) {
	if period <= 0 {
		return nil, fmt.Errorf("period must be > 0, got %d", period)
	}
	if len(closes) <= period {
		return nil, fmt.Errorf("insufficient data points (%d) for RSI period %d", len(closes), period)
	}

	rsi := make([]float64, len(closes))
	for i := 0; i <= period; i++ {
		rsi[i] = math.NaN()
	}

	var gainSum, lossSum float64
	for i := 1; i <= period; i++ {
		change := closes[i] - closes[i-1]
		if change > 0 {
			gainSum += change
		} else {
			lossSum -= change
		}
	}

	avgGain := gainSum / float64(period)
	avgLoss := lossSum / float64(period)

	if avgLoss == 0 {
		rsi[period] = 100.0
	} else {
		rs := avgGain / avgLoss
		rsi[period] = 100.0 - (100.0 / (1.0 + rs))
	}

	// Smooth using Wilder's technique
	for i := period + 1; i < len(closes); i++ {
		change := closes[i] - closes[i-1]
		var gain, loss float64
		if change > 0 {
			gain = change
		} else {
			loss = -change
		}

		avgGain = (avgGain*float64(period-1) + gain) / float64(period)
		avgLoss = (avgLoss*float64(period-1) + loss) / float64(period)

		if avgLoss == 0 {
			rsi[i] = 100.0
		} else {
			rs := avgGain / avgLoss
			rsi[i] = 100.0 - (100.0 / (1.0 + rs))
		}
	}

	return rsi, nil
}

// MACD calculates the Moving Average Convergence Divergence indicators.
func MACD(closes []float64, fastPeriod, slowPeriod, signalPeriod int) (macdLine, signalLine, histogram []float64, err error) {
	if fastPeriod >= slowPeriod {
		return nil, nil, nil, fmt.Errorf("fastPeriod (%d) must be < slowPeriod (%d)", fastPeriod, slowPeriod)
	}

	fastEMA, err := EMA(closes, fastPeriod)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("fast EMA calculation failed: %w", err)
	}

	slowEMA, err := EMA(closes, slowPeriod)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("slow EMA calculation failed: %w", err)
	}

	macdLine = make([]float64, len(closes))
	for i := 0; i < len(closes); i++ {
		if math.IsNaN(fastEMA[i]) || math.IsNaN(slowEMA[i]) {
			macdLine[i] = math.NaN()
		} else {
			macdLine[i] = fastEMA[i] - slowEMA[i]
		}
	}

	// Filter valid MACD values to compute signal line
	var validMACD []float64
	firstValidIndex := -1
	for i, val := range macdLine {
		if !math.IsNaN(val) {
			if firstValidIndex == -1 {
				firstValidIndex = i
			}
			validMACD = append(validMACD, val)
		}
	}

	if len(validMACD) < signalPeriod {
		return nil, nil, nil, fmt.Errorf("insufficient valid MACD points (%d) for signal period %d", len(validMACD), signalPeriod)
	}

	validSignal, err := EMA(validMACD, signalPeriod)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("signal line EMA calculation failed: %w", err)
	}

	signalLine = make([]float64, len(closes))
	histogram = make([]float64, len(closes))

	for i := 0; i < len(closes); i++ {
		if i < firstValidIndex {
			signalLine[i] = math.NaN()
			histogram[i] = math.NaN()
		} else {
			idx := i - firstValidIndex
			signalLine[i] = validSignal[idx]
			if math.IsNaN(signalLine[i]) || math.IsNaN(macdLine[i]) {
				histogram[i] = math.NaN()
			} else {
				histogram[i] = macdLine[i] - signalLine[i]
			}
		}
	}

	return macdLine, signalLine, histogram, nil
}

// BollingerBands computes upper, middle, and lower bands for a price series.
func BollingerBands(closes []float64, period int, numStdDev float64) (upper, middle, lower []float64, err error) {
	sma, err := SMA(closes, period)
	if err != nil {
		return nil, nil, nil, err
	}

	upper = make([]float64, len(closes))
	middle = sma
	lower = make([]float64, len(closes))

	for i := 0; i < len(closes); i++ {
		if i < period-1 {
			upper[i] = math.NaN()
			lower[i] = math.NaN()
			continue
		}

		var variance float64
		mean := sma[i]
		for j := i - period + 1; j <= i; j++ {
			diff := closes[j] - mean
			variance += diff * diff
		}
		stdDev := math.Sqrt(variance / float64(period))

		upper[i] = mean + (numStdDev * stdDev)
		lower[i] = mean - (numStdDev * stdDev)
	}

	return upper, middle, lower, nil
}

// EvaluateConfluence scores the technical confluence of a price series (0.0 to 100.0).
func EvaluateConfluence(symbol string, closes []float64) (*ConfluenceSummary, error) {
	if len(closes) < 50 {
		return nil, fmt.Errorf("evaluate confluence requires at least 50 data points, got %d", len(closes))
	}

	latestPrice := closes[len(closes)-1]

	rsiSlice, err := RSI(closes, 14)
	if err != nil {
		return nil, err
	}
	latestRSI := rsiSlice[len(rsiSlice)-1]

	ema20Slice, err := EMA(closes, 20)
	if err != nil {
		return nil, err
	}
	latestEMA20 := ema20Slice[len(ema20Slice)-1]

	ema50Slice, err := EMA(closes, 50)
	if err != nil {
		return nil, err
	}
	latestEMA50 := ema50Slice[len(ema50Slice)-1]

	macdLine, signalLine, histLine, err := MACD(closes, 12, 26, 9)
	if err != nil {
		return nil, err
	}
	latestMACD := macdLine[len(macdLine)-1]
	latestSignal := signalLine[len(signalLine)-1]
	latestHist := histLine[len(histLine)-1]

	upper, _, lower, err := BollingerBands(closes, 20, 2.0)
	if err != nil {
		return nil, err
	}
	latestUpper := upper[len(upper)-1]
	latestLower := lower[len(lower)-1]

	atr14, _ := CalculateATRFromCloses(closes, 14)
	if atr14 <= 0 {
		atr14 = latestPrice * 0.01
	}

	// Calculate data-driven ATR stop loss % (0.5x ATR) and target profit % (1.25x ATR)
	dynStopPct := math.Round(((atr14*0.5)/latestPrice)*100.0*100) / 100
	dynTargetPct := math.Round(((atr14*1.25)/latestPrice)*100.0*100) / 100

	if dynStopPct < 0.10 {
		dynStopPct = 0.10
	}
	if dynTargetPct < 0.25 {
		dynTargetPct = 0.25
	}

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

	bias := "NEUTRAL"
	if score >= 65.0 {
		bias = "BULLISH"
	} else if score <= 35.0 {
		bias = "BEARISH"
	}

	return &ConfluenceSummary{
		Symbol:           symbol,
		LatestPrice:      latestPrice,
		Score:            score,
		Bias:             bias,
		RSI14:            latestRSI,
		EMA20:            latestEMA20,
		EMA50:            latestEMA50,
		MACDValue:        latestMACD,
		MACDSignal:       latestSignal,
		MACDHist:         latestHist,
		BollingerUpper:   latestUpper,
		BollingerLower:   latestLower,
		ATR14:            atr14,
		DynamicStopPct:   dynStopPct,
		DynamicTargetPct: dynTargetPct,
		SignalsTriggered: signals,
	}, nil
}

// CalculateATRFromCloses estimates the Average True Range (ATR) from a close price series.
func CalculateATRFromCloses(closes []float64, period int) (float64, error) {
	if len(closes) <= period {
		return 0.0, fmt.Errorf("insufficient price data (%d) for ATR period %d", len(closes), period)
	}

	var sumTR float64
	for i := len(closes) - period; i < len(closes); i++ {
		diff := math.Abs(closes[i] - closes[i-1])
		sumTR += diff
	}

	avgTrueRange := (sumTR / float64(period)) * 1.5 // 1.5x multiplier estimates high-low ATR from close diffs
	return avgTrueRange, nil
}

// ScanWatchlist evaluates technical confluence across a universe of price series and sorts by Confluence Score descending.
func ScanWatchlist(universe map[string][]float64, minScore float64) ([]*ConfluenceSummary, error) {
	var results []*ConfluenceSummary

	for symbol, closes := range universe {
		summary, err := EvaluateConfluence(symbol, closes)
		if err != nil {
			continue
		}
		if summary.Score >= minScore {
			results = append(results, summary)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results, nil
}

// CalculateVWAP computes Volume-Weighted Average Price from price and volume series.
func CalculateVWAP(closes []float64, volumes []float64) ([]float64, error) {
	if len(closes) == 0 || len(closes) != len(volumes) {
		return nil, fmt.Errorf("invalid closes/volumes length")
	}

	vwap := make([]float64, len(closes))
	var cumPV, cumV float64

	for i := 0; i < len(closes); i++ {
		cumPV += closes[i] * volumes[i]
		cumV += volumes[i]
		if cumV > 0 {
			vwap[i] = cumPV / cumV
		} else {
			vwap[i] = closes[i]
		}
	}

	return vwap, nil
}
