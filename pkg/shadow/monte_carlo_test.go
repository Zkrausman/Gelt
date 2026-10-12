package shadow

import (
	"testing"
)

func TestRunSimulationIsDeterministicForSameSnapshot(t *testing.T) {
	trades := []Trade{{ID: "one", PlanName: "plan", Symbol: "SPY", Status: "CLOSED", PnLUSD: 10}, {ID: "two", PlanName: "plan", Symbol: "SPY", Status: "CLOSED", PnLUSD: -5}}
	first := RunSimulation(trades, 1000, 100)
	second := RunSimulation(trades, 1000, 100)
	if first != second {
		t.Fatalf("same snapshot yielded different simulations: %+v != %+v", first, second)
	}
}

func TestRunSimulation(t *testing.T) {
	// Create mock array of winning and losing trades
	trades := []Trade{
		{PnLUSD: 100},
		{PnLUSD: 50},
		{PnLUSD: -20},
		{PnLUSD: -30},
		{PnLUSD: 200},
	}

	iterations := 1000
	result := RunSimulation(trades, iterations, 10000.0)

	// In 1000 iterations of sampling 5 trades with replacement,
	// the expected value per iteration should be around the sum of the population
	// since size of sample = size of population. (100 + 50 - 20 - 30 + 200) = 300.
	if result.ExpectedValue < 200 || result.ExpectedValue > 400 {
		t.Errorf("Expected Value out of reasonable bounds. Got %f", result.ExpectedValue)
	}

	// VaR (5th percentile worst drawdown) should be > 0 since we have losing trades
	if result.ValueAtRisk < 0 {
		t.Errorf("Expected ValueAtRisk to be >= 0, got %f", result.ValueAtRisk)
	}

	// Probability of Ruin should be calculated correctly.
	// With an initial balance of 10000 and the worst possible loss in one iteration being -150 (if all -30 trades are sampled),
	// Ruin should be 0 here.
	if result.ProbabilityOfRuin != 0 {
		t.Errorf("Expected ProbabilityOfRuin to be 0 for this mock data, got %f", result.ProbabilityOfRuin)
	}
}

func TestRunSimulation_Ruin(t *testing.T) {
	// Create mock array of mostly losing trades to force ruin
	trades := []Trade{
		{PnLUSD: -5000},
		{PnLUSD: -6000},
	}

	iterations := 100
	result := RunSimulation(trades, iterations, 10000.0)

	// In each iteration, 2 trades are sampled.
	// Worst case: -6000 + -6000 = -12000
	// Best case: -5000 + -5000 = -10000
	// Initial balance is 10000. So we always hit <= 0.
	if result.ProbabilityOfRuin != 1.0 {
		t.Errorf("Expected ProbabilityOfRuin to be 1.0, got %f", result.ProbabilityOfRuin)
	}
}

func TestRunSimulation_Empty(t *testing.T) {
	result := RunSimulation([]Trade{}, 100, 10000.0)
	if result.ExpectedValue != 0 || result.ValueAtRisk != 0 || result.ProbabilityOfRuin != 0 {
		t.Errorf("Expected zero values for empty trades slice")
	}
}
