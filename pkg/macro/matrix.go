package macro

import (
	"sync"
	"time"
)

// MacroMatrix holds the most recent values for the key macroeconomic indicators.
type MacroMatrix struct {
	mu   sync.RWMutex
	data map[string]*MacroData
}

// SeriesEFFR is the Effective Federal Funds Rate
const SeriesEFFR = "EFFR"

// SeriesCPI is the Consumer Price Index
const SeriesCPI = "CPIAUCSL"

// Series10Y is the 10-Year Treasury Constant Maturity Rate
const Series10Y = "DGS10"

// SeriesNFP is the All Employees, Total Nonfarm
const SeriesNFP = "PAYEMS"

// NewMacroMatrix initializes a new MacroMatrix.
func NewMacroMatrix() *MacroMatrix {
	return &MacroMatrix{
		data: make(map[string]*MacroData),
	}
}

// Get returns the most recent data for a given series.
func (m *MacroMatrix) Get(seriesID string) *MacroData {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.data[seriesID]
}

// Set updates the matrix with new data.
func (m *MacroMatrix) Set(seriesID string, data *MacroData) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[seriesID] = data
}

// StartMatrixIngestion launches a background goroutine to poll the given indicators at a set interval.
func StartMatrixIngestion(client *Client, m *MacroMatrix, interval time.Duration) {
	seriesIDs := []string{SeriesEFFR, SeriesCPI, Series10Y, SeriesNFP}

	// Initial fetch
	for _, id := range seriesIDs {
		data, err := client.FetchSeries(id)
		if err == nil {
			m.Set(id, data)
		}
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			for _, id := range seriesIDs {
				data, err := client.FetchSeries(id)
				if err == nil {
					m.Set(id, data)
				}
			}
		}
	}()
}
