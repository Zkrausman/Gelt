package signals

import (
	"math/rand"
)

// FetchTopScreenerSymbols returns the top N symbols from the provided universe
// ranked by Confluence Score. It simulates 60 bars of data to evaluate confluence.
func FetchTopScreenerSymbols(n int, minScore float64, universeList []string, priceMap map[string]float64) ([]string, error) {
	universe := make(map[string][]float64)

	for i, sym := range universeList {
		basePrice, ok := priceMap[sym]
		if !ok {
			basePrice = 100.0
		}
		universe[sym] = generateSampleCloses(60, basePrice, int64(100+i*7))
	}

	results, err := ScanWatchlist(universe, minScore)
	if err != nil {
		return nil, err
	}

	var topSymbols []string
	for i, res := range results {
		if i >= n {
			break
		}
		topSymbols = append(topSymbols, res.Symbol)
	}

	return topSymbols, nil
}

// generateSampleCloses produces deterministic pseudo-random close prices.
func generateSampleCloses(count int, startPrice float64, seed int64) []float64 {
	closes := make([]float64, count)
	current := startPrice
	r := rand.New(rand.NewSource(seed))
	for i := 0; i < count; i++ {
		change := (r.Float64() - 0.48) * 2.5
		current += change
		closes[i] = current
	}
	return closes
}
