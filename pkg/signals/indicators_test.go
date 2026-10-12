package signals

import (
	"math"
	"testing"
)

func TestSMA(t *testing.T) {
	prices := []float64{10, 11, 12, 13, 14, 15}
	sma, err := SMA(prices, 3)
	if err != nil {
		t.Fatalf("SMA error: %v", err)
	}

	if !math.IsNaN(sma[0]) || !math.IsNaN(sma[1]) {
		t.Errorf("Expected NaN for first 2 SMA elements")
	}

	expectedIdx2 := 11.0 // (10+11+12)/3
	if sma[2] != expectedIdx2 {
		t.Errorf("Expected SMA at index 2 to be %.2f, got %.2f", expectedIdx2, sma[2])
	}

	expectedIdx3 := 12.0 // (11+12+13)/3
	if sma[3] != expectedIdx3 {
		t.Errorf("Expected SMA at index 3 to be %.2f, got %.2f", expectedIdx3, sma[3])
	}
}

func TestEMA(t *testing.T) {
	prices := make([]float64, 20)
	for i := range prices {
		prices[i] = float64(10 + i)
	}

	ema, err := EMA(prices, 10)
	if err != nil {
		t.Fatalf("EMA error: %v", err)
	}

	if math.IsNaN(ema[19]) {
		t.Errorf("Expected valid EMA at last index")
	}
}

func TestRSI(t *testing.T) {
	closes := make([]float64, 60)
	for i := range closes {
		closes[i] = 100.0 + float64(i%5)
	}

	rsi, err := RSI(closes, 14)
	if err != nil {
		t.Fatalf("RSI error: %v", err)
	}

	lastRSI := rsi[len(rsi)-1]
	if lastRSI < 0 || lastRSI > 100 {
		t.Errorf("RSI out of bounds: %.2f", lastRSI)
	}
}

func TestMACD(t *testing.T) {
	closes := make([]float64, 60)
	for i := range closes {
		closes[i] = 50.0 + float64(i)
	}

	macdLine, signalLine, hist, err := MACD(closes, 12, 26, 9)
	if err != nil {
		t.Fatalf("MACD error: %v", err)
	}

	if len(macdLine) != 60 || len(signalLine) != 60 || len(hist) != 60 {
		t.Errorf("MACD output lengths mismatch")
	}
}

func TestEvaluateConfluence(t *testing.T) {
	closes := make([]float64, 60)
	for i := range closes {
		closes[i] = 100.0 + float64(i)*0.5
	}

	summary, err := EvaluateConfluence("SPY", closes)
	if err != nil {
		t.Fatalf("EvaluateConfluence error: %v", err)
	}

	if summary.Symbol != "SPY" {
		t.Errorf("Expected symbol SPY, got %s", summary.Symbol)
	}

	if summary.Score < 0 || summary.Score > 100 {
		t.Errorf("Invalid score: %.2f", summary.Score)
	}

	if summary.ATR14 <= 0 || summary.DynamicStopPct <= 0 || summary.DynamicTargetPct <= 0 {
		t.Errorf("Invalid ATR dynamic metrics: ATR=%.2f, Stop=%.2f%%, Target=%.2f%%", summary.ATR14, summary.DynamicStopPct, summary.DynamicTargetPct)
	}
}

func TestCalculateATRFromCloses(t *testing.T) {
	closes := makeCloses(60, 100.0, 1.0)
	atr, err := CalculateATRFromCloses(closes, 14)
	if err != nil {
		t.Fatalf("CalculateATRFromCloses error: %v", err)
	}
	if atr <= 0 {
		t.Errorf("Expected positive ATR, got %.2f", atr)
	}
}

func TestScanWatchlist(t *testing.T) {
	universe := map[string][]float64{
		"SPY":  makeCloses(60, 500.0, 0.5),
		"QQQ":  makeCloses(60, 400.0, -0.3),
		"AAPL": makeCloses(60, 220.0, 0.8),
	}

	results, err := ScanWatchlist(universe, 0.0)
	if err != nil {
		t.Fatalf("ScanWatchlist failed: %v", err)
	}

	if len(results) != 3 {
		t.Errorf("Expected 3 results, got %d", len(results))
	}

	// Verify descending order
	if results[0].Score < results[1].Score || results[1].Score < results[2].Score {
		t.Errorf("Results not sorted in descending order of score")
	}
}

func makeCloses(count int, start float64, step float64) []float64 {
	closes := make([]float64, count)
	curr := start
	for i := 0; i < count; i++ {
		curr += step
		closes[i] = curr
	}
	return closes
}
