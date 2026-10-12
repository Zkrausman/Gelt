package shadow

import (
	"encoding/binary"
	"hash/fnv"
	"math"
	"math/rand"
	"sort"
)

// Trade is an alias for ShadowTrade.
type Trade = ShadowTrade

// SimulationResult holds the metrics calculated from the Monte Carlo simulation.
type SimulationResult struct {
	ExpectedValue     float64
	ValueAtRisk       float64 // 5th percentile worst-case drawdown
	ProbabilityOfRuin float64
}

// RunSimulation runs a deterministic Monte Carlo simulation on the provided
// historical snapshot. Identical inputs always produce identical risk metrics.
func RunSimulation(trades []Trade, iterations int, initialBalance float64) SimulationResult {
	return RunSimulationSeeded(trades, iterations, initialBalance, simulationSeed(trades, iterations, initialBalance))
}

// RunSimulationSeeded permits explicit reproducible simulation runs.
func RunSimulationSeeded(trades []Trade, iterations int, initialBalance float64, seed int64) SimulationResult {
	if len(trades) == 0 || iterations <= 0 {
		return SimulationResult{}
	}

	r := rand.New(rand.NewSource(seed))

	var finalPnLs []float64
	var maxDrawdowns []float64
	ruinCount := 0

	// Use initialBalance to calculate probability of ruin (hitting 0 balance).

	for i := 0; i < iterations; i++ {
		var cumPnL float64
		var peakPnL float64
		var maxDD float64
		ruined := false

		for j := 0; j < len(trades); j++ {
			// Randomly sample a trade with replacement
			idx := r.Intn(len(trades))
			trade := trades[idx]

			cumPnL += trade.PnLUSD

			if cumPnL > peakPnL {
				peakPnL = cumPnL
			}

			dd := peakPnL - cumPnL
			if dd > maxDD {
				maxDD = dd
			}

			// Check if balance hits 0 or below
			if initialBalance+cumPnL <= 0 {
				ruined = true
			}
		}

		finalPnLs = append(finalPnLs, cumPnL)
		maxDrawdowns = append(maxDrawdowns, maxDD)
		if ruined {
			ruinCount++
		}
	}

	var expectedValue float64
	for _, pnl := range finalPnLs {
		expectedValue += pnl
	}
	expectedValue /= float64(iterations)

	// Value at Risk (5th percentile worst-case drawdown)
	// We sort max drawdowns in ascending order.
	// The 95th percentile of max drawdowns corresponds to the worst 5% case.
	sort.Float64s(maxDrawdowns)
	varIndex := int(0.95 * float64(iterations))
	if varIndex >= len(maxDrawdowns) {
		varIndex = len(maxDrawdowns) - 1
	}
	valueAtRisk := maxDrawdowns[varIndex]

	probabilityOfRuin := float64(ruinCount) / float64(iterations)

	return SimulationResult{
		ExpectedValue:     expectedValue,
		ValueAtRisk:       valueAtRisk,
		ProbabilityOfRuin: probabilityOfRuin,
	}
}

func simulationSeed(trades []Trade, iterations int, initialBalance float64) int64 {
	h := fnv.New64a()
	var value [8]byte
	writeString := func(s string) { _, _ = h.Write([]byte(s)); _, _ = h.Write([]byte{0}) }
	writeFloat := func(f float64) {
		binary.LittleEndian.PutUint64(value[:], math.Float64bits(f))
		_, _ = h.Write(value[:])
	}
	binary.LittleEndian.PutUint64(value[:], uint64(iterations))
	_, _ = h.Write(value[:])
	writeFloat(initialBalance)
	for _, t := range trades {
		writeString(t.ID)
		writeString(t.PlanName)
		writeString(t.Symbol)
		writeString(t.Status)
		writeFloat(t.PnLUSD)
		writeFloat(t.AmountUSD)
		writeFloat(t.EntryPrice)
		writeFloat(t.ExitPrice)
		binary.LittleEndian.PutUint64(value[:], uint64(t.EntryTime.UnixNano()))
		_, _ = h.Write(value[:])
		binary.LittleEndian.PutUint64(value[:], uint64(t.ExitTime.UnixNano()))
		_, _ = h.Write(value[:])
	}
	return int64(h.Sum64())
}
