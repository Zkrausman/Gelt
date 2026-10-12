package macro

import (
	"encoding/json"
	"io"
	"os"
	"sync"
)

var (
	// MatrixMutex is exported so that external writers can acquire a write lock (Lock())
	// when updating the JSON file. This guarantees thread safety between concurrent readers
	// and writers, ensuring readers do not read a partially updated file.
	MatrixMutex sync.RWMutex
)

// ReadRegimeMatrix reads the RegimeMatrix from the specified path with thread-safe read-locking.
func ReadRegimeMatrix(path string) (*RegimeMatrix, error) {
	MatrixMutex.RLock()
	defer MatrixMutex.RUnlock()

	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			// Gracefully handle missing file scenarios by returning default neutral regime flags.
			return &RegimeMatrix{
				Score:           50.0,
				VolatilityFlags: make(map[string]bool),
				MarketSentiment: 50.0,
				AssetBiases:     make(map[string]float64),
			}, nil
		}
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}

	var matrix RegimeMatrix
	if err := json.Unmarshal(data, &matrix); err != nil {
		return nil, err
	}

	return &matrix, nil
}
