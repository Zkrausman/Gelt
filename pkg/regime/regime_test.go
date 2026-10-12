package regime

import (
	"testing"
)

func generateCloses(n int, start, step float64) []float64 {
	closes := make([]float64, n)
	for i := 0; i < n; i++ {
		closes[i] = start + float64(i)*step
	}
	return closes
}

func TestEvaluateRegimeNormal(t *testing.T) {
	// Positive slope data (step = +0.5)
	closes := generateCloses(30, 100.0, 0.5)
	vix := 18.5

	status, err := EvaluateRegime(vix, closes)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if status.AlertTriggered {
		t.Errorf("expected no alert, but alert was triggered")
	}

	if status.DetectedRegime != RegimeTrendingNormal {
		t.Errorf("expected TRENDING_NORMAL, got %s", status.DetectedRegime)
	}

	if status.EMA20Slope <= 0 {
		t.Errorf("expected positive slope, got %.4f", status.EMA20Slope)
	}
}

func TestEvaluateRegimeHighVIX(t *testing.T) {
	// Positive slope, but VIX = 28.5 (> 25.0)
	closes := generateCloses(30, 100.0, 0.5)
	vix := 28.5

	status, err := EvaluateRegime(vix, closes)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !status.AlertTriggered {
		t.Errorf("expected alert triggered for VIX > 25.0, got false")
	}

	if status.DetectedRegime != RegimeHighVolatility {
		t.Errorf("expected HIGH_VOLATILITY_CHOP, got %s", status.DetectedRegime)
	}

	expectedMsg := "[REGIME ALERT] High Volatility Detected (VIX > 25 / EMA Negative). Recommended Action: Switch to RangeBoundDefensivePlan."
	if status.AlertMessage != expectedMsg {
		t.Errorf("expected alert message %q, got %q", expectedMsg, status.AlertMessage)
	}
}

func TestEvaluateRegimeNegativeEMASlope(t *testing.T) {
	// VIX = 18.0 (low), but negative slope (step = -0.5)
	closes := generateCloses(30, 100.0, -0.5)
	vix := 18.0

	status, err := EvaluateRegime(vix, closes)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !status.AlertTriggered {
		t.Errorf("expected alert triggered for negative slope, got false")
	}

	if status.DetectedRegime != RegimeHighVolatility {
		t.Errorf("expected HIGH_VOLATILITY_CHOP, got %s", status.DetectedRegime)
	}

	if status.EMA20Slope > 0 {
		t.Errorf("expected negative slope, got %.4f", status.EMA20Slope)
	}
}

func TestEvaluateRegimeInsufficientData(t *testing.T) {
	closes := generateCloses(10, 100.0, 0.5)
	_, err := EvaluateRegime(18.0, closes)
	if err == nil {
		t.Fatalf("expected error for insufficient data, got nil")
	}
}
