package macro

import (
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func TestReadRegimeMatrix_MissingFile(t *testing.T) {
	matrix, err := ReadRegimeMatrix("non_existent_file.json")
	if err != nil {
		t.Fatalf("Expected no error for missing file, got %v", err)
	}
	if matrix.Score != 50.0 {
		t.Errorf("Expected Score 50.0 for missing file, got %f", matrix.Score)
	}
	if matrix.MarketSentiment != 50.0 {
		t.Errorf("Expected MarketSentiment 50.0 for missing file, got %f", matrix.MarketSentiment)
	}
}

func TestReadRegimeMatrix_Concurrency(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "regime_matrix_*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	initialMatrix := RegimeMatrix{
		Score:           75.0,
		MarketSentiment: 80.0,
	}
	data, _ := json.Marshal(initialMatrix)
	tmpFile.Write(data)
	tmpFile.Close()

	var wg sync.WaitGroup
	readersCount := 10
	wg.Add(readersCount + 1) // 10 readers + 1 writer

	// Writer
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			MatrixMutex.Lock()
			newMatrix := RegimeMatrix{
				Score:           float64(i),
				MarketSentiment: float64(i),
			}
			newData, _ := json.Marshal(newMatrix)
			os.WriteFile(tmpFile.Name(), newData, 0644)
			MatrixMutex.Unlock()
		}
	}()

	// Readers
	for i := 0; i < readersCount; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_, err := ReadRegimeMatrix(tmpFile.Name())
				if err != nil {
					// We might occasionally catch it mid-write if OS locking isn't atomic
					// But ReadRegimeMatrix has RLock, while writer has Lock on MatrixMutex
					// So it should be safe.
					t.Errorf("Reader error: %v", err)
				}
			}
		}()
	}

	wg.Wait()
}
