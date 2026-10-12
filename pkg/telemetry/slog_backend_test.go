package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"testing"
	"time"
)

func TestSlogBackend_Log(t *testing.T) {
	var buf bytes.Buffer
	logger := NewSlogBackend(&buf, slog.LevelInfo)

	logger.Log(context.Background(), SeverityInfo, "test message", Field{Key: "foo", Value: "bar"})

	var result map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &result)
	if err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if result["msg"] != "test message" {
		t.Errorf("expected msg 'test message', got %v", result["msg"])
	}
	if result["foo"] != "bar" {
		t.Errorf("expected foo 'bar', got %v", result["foo"])
	}
	if result["level"] != "INFO" {
		t.Errorf("expected level 'INFO', got %v", result["level"])
	}
}

func TestSlogBackend_LogTrade(t *testing.T) {
	var buf bytes.Buffer
	logger := NewSlogBackend(&buf, slog.LevelInfo)

	ts := time.Date(2023, 1, 1, 12, 0, 0, 0, time.UTC)
	event := TradeTelemetryEvent{
		Symbol:    "AAPL",
		Action:    "BUY",
		Quantity:  10.5,
		Price:     150.25,
		Strategy:  "MACD",
		Timestamp: ts,
	}

	logger.LogTrade(context.Background(), event)

	var result map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &result)
	if err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if result["msg"] != "Trade Executed" {
		t.Errorf("expected msg 'Trade Executed', got %v", result["msg"])
	}
	if result["symbol"] != "AAPL" {
		t.Errorf("expected symbol 'AAPL', got %v", result["symbol"])
	}
	if result["action"] != "BUY" {
		t.Errorf("expected action 'BUY', got %v", result["action"])
	}
	if result["quantity"] != 10.5 {
		t.Errorf("expected quantity 10.5, got %v", result["quantity"])
	}
	if result["price"] != 150.25 {
		t.Errorf("expected price 150.25, got %v", result["price"])
	}
	if result["strategy"] != "MACD" {
		t.Errorf("expected strategy 'MACD', got %v", result["strategy"])
	}

	parsedTime, err := time.Parse(time.RFC3339Nano, result["timestamp"].(string))
	if err != nil {
		t.Fatalf("failed to parse timestamp: %v", err)
	}
	if !parsedTime.Equal(ts) {
		t.Errorf("expected timestamp %v, got %v", ts, parsedTime)
	}
}

func TestConcurrency_SetGetLogger(t *testing.T) {
	var wg sync.WaitGroup
	var buf bytes.Buffer
	newLogger := NewSlogBackend(&buf, slog.LevelInfo)

	// Start readers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_ = GetLogger()
			}
		}()
	}

	// Start writers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				SetLogger(newLogger)
			}
		}()
	}

	wg.Wait()
}

func TestSlogBackend_LogLevelsAndFlush(t *testing.T) {
	var buf bytes.Buffer
	logger := NewSlogBackend(&buf, slog.LevelDebug)

	// Test Debug
	logger.Log(context.Background(), SeverityDebug, "debug message")
	// Test Warn
	logger.Log(context.Background(), SeverityWarn, "warn message")
	// Test Error
	logger.Log(context.Background(), SeverityError, "error message")
	// Test Default
	logger.Log(context.Background(), Severity("UNKNOWN"), "unknown message")

	// Test Flush
	err := logger.Flush(context.Background())
	if err != nil {
		t.Errorf("expected no error on flush, got %v", err)
	}
}

func TestSlogBackend_DisabledLevel(t *testing.T) {
	var buf bytes.Buffer
	logger := NewSlogBackend(&buf, slog.LevelError)

	// Info should be ignored
	logger.Log(context.Background(), SeverityInfo, "info message")

	if buf.Len() > 0 {
		t.Errorf("expected no output for disabled level, got %s", buf.String())
	}
}
