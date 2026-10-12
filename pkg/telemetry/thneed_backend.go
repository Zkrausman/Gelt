package telemetry

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gelt/pkg/thesis"
)
// ThneedBackend implements the TelemetryLogger interface by writing trade telemetry to a local directory.

type ThneedBackend struct {
	brainPath string
	enabled   bool
	fallback  TelemetryLogger
	eventCh   chan thesis.TradeThesis
	wg        sync.WaitGroup
	mu        sync.Mutex
	closed    bool
}
// NewThneedBackend initializes a ThneedBackend instance. If enabled is false, it only logs to the fallback.

func NewThneedBackend(brainPath string, enabled bool, fallback TelemetryLogger) TelemetryLogger {
	if brainPath == "" {
		brainPath = strings.TrimSpace(os.Getenv("GELT_BEADS_BRAIN_PATH"))
	}
	if brainPath == "" {
		enabled = false
	}

	tb := &ThneedBackend{
		brainPath: brainPath,
		enabled:   enabled,
		fallback:  fallback,
		eventCh:   make(chan thesis.TradeThesis, 1000), // Buffered channel for non-blocking writes
	}

	if tb.enabled {
		tb.wg.Add(1)
		go tb.worker()
	}

	return tb
}

func (t *ThneedBackend) worker() {
	defer t.wg.Done()
	for event := range t.eventCh {
		t.writeToBrain(event)
	}
}

func (t *ThneedBackend) writeToBrain(event thesis.TradeThesis) {
	err := os.MkdirAll(t.brainPath, 0755)
	if err != nil {
		if t.fallback != nil {
			// Note: We'd normally use the logger context, but worker runs asynchronously.
		}
		return
	}

	rationale, evidence := event.FormatSelfDoc()

	// Replace "self-doc" with "telemetry"
	rationale = strings.ReplaceAll(rationale, "self-doc", "telemetry")
	evidence = strings.ReplaceAll(evidence, "self-doc", "telemetry")

	content := fmt.Sprintf("# Trade Telemetry: %s\n\n%s\n\n%s\n", event.Symbol, rationale, evidence)
	fileName := fmt.Sprintf("trade_telemetry_%s_%d.md", strings.ToLower(event.Symbol), event.Timestamp.UnixNano())
	filePath := filepath.Join(t.brainPath, fileName)

	_ = os.WriteFile(filePath, []byte(content), 0644)
}

func (t *ThneedBackend) Log(ctx context.Context, level Severity, msg string, fields ...Field) {
	if t.fallback != nil {
		t.fallback.Log(ctx, level, msg, fields...)
	}
}

func (t *ThneedBackend) LogTrade(ctx context.Context, tradeEvent TradeTelemetryEvent) {
	// First fallback log to keep normal stdout
	if t.fallback != nil {
		t.fallback.LogTrade(ctx, tradeEvent)
	}

	if !t.enabled {
		return
	}

	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.mu.Unlock()

	// Map to TradeThesis to use its self-doc formatting
	thesisEvent := thesis.TradeThesis{
		Symbol:    tradeEvent.Symbol,
		Side:      tradeEvent.Action,
		Quantity:  tradeEvent.Quantity,
		FillPrice: tradeEvent.Price,
		Timestamp: tradeEvent.Timestamp,
		Status:    "EXECUTED",
		AmountUSD: tradeEvent.Quantity * tradeEvent.Price,
		Signals:   []string{tradeEvent.Strategy},
	}

	select {
	case t.eventCh <- thesisEvent:
		// Sent successfully
	default:
		// Queue full, drop event to prevent blocking or log to fallback
		if t.fallback != nil {
			t.fallback.Log(ctx, SeverityWarn, "ThneedBackend queue full, dropped trade telemetry event", Field{Key: "symbol", Value: tradeEvent.Symbol})
		}
	}
}

func (t *ThneedBackend) Flush(ctx context.Context) error {
	if t.enabled {
		t.mu.Lock()
		if !t.closed {
			t.closed = true
			close(t.eventCh)
		}
		t.mu.Unlock()
		t.wg.Wait()
	}
	if t.fallback != nil {
		return t.fallback.Flush(ctx)
	}
	return nil
}
