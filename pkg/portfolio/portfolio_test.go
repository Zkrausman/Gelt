package portfolio

import (
	"strings"
	"testing"
	"time"

	"gelt/pkg/thesis"
)

func TestCheckTrailingStop(t *testing.T) {
	pos := Position{
		Symbol:          "SPY",
		Quantity:        1.0,
		AverageBuyPrice: 100.0,
		PeakPrice:       110.0,
		CurrentPrice:    106.0, // 3.6% drop from peak 110
	}

	sig := CheckTrailingStop(pos, 3.0)

	if !sig.ShouldExit {
		t.Errorf("Expected trailing stop trigger when price dropped from 110 to 106 with 3%% stop")
	}

	safePos := Position{
		Symbol:          "SPY",
		Quantity:        1.0,
		AverageBuyPrice: 100.0,
		PeakPrice:       110.0,
		CurrentPrice:    108.0,
	}

	safeSig := CheckTrailingStop(safePos, 3.0)
	if safeSig.ShouldExit {
		t.Errorf("Expected position to remain safe when drop is 1.8%% < 3%%")
	}
}

func TestCalculatePearsonCorrelation(t *testing.T) {
	returnsA := []float64{0.01, 0.02, -0.01, 0.03, -0.02}
	returnsB := []float64{0.01, 0.02, -0.01, 0.03, -0.02}

	corr, err := CalculatePearsonCorrelation(returnsA, returnsB)
	if err != nil {
		t.Fatalf("Correlation error: %v", err)
	}

	if corr < 0.99 {
		t.Errorf("Expected correlation ~1.0, got %.4f", corr)
	}
}

func TestGenerateTelemetry(t *testing.T) {
	positions := []Position{
		{Symbol: "DEMO", Quantity: 2, AverageBuyPrice: 10.00, CurrentPrice: 10.75},
	}
	theses := []thesis.TradeThesis{
		{ID: "order-test-001", Symbol: "DEMO", Side: "buy", AmountUSD: 1.0, Status: "FILLED", Timestamp: time.Now()},
	}

	telemetry := GenerateTelemetry(
		"SYNTHETIC-DEMO-ACCOUNT",
		100.0,
		101.5,
		80.0,
		80.0,
		positions,
		theses,
		5.0,
		3.0,
		112,
	)

	if telemetry.AccountValue != 50.0 {
		t.Errorf("Expected account value 50.0, got %.2f", telemetry.AccountValue)
	}

	dashboard := telemetry.FormatDashboard()
	if !strings.Contains(dashboard, "GELT SESSION TELEMETRY") {
		t.Errorf("Dashboard string missing header")
	}
	if !strings.Contains(dashboard, "112ms round-trip") {
		t.Errorf("Dashboard missing latency")
	}
}
