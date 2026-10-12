package telemetry

import (
	"context"
	"time"
)

type Severity string

const (
	SeverityDebug Severity = "DEBUG"
	SeverityInfo  Severity = "INFO"
	SeverityWarn  Severity = "WARN"
	SeverityError Severity = "ERROR"
)

type Field struct {
	Key   string
	Value interface{}
}

type TelemetryLogger interface {
	Log(ctx context.Context, level Severity, msg string, fields ...Field)
	LogTrade(ctx context.Context, tradeEvent TradeTelemetryEvent)
	Flush(ctx context.Context) error
}

type TradeTelemetryEvent struct {
	Symbol    string    `json:"symbol"`
	Action    string    `json:"action"`    // "BUY", "SELL", "HOLD"
	Quantity  float64   `json:"quantity"`
	Price     float64   `json:"price"`
	Strategy  string    `json:"strategy"`
	Timestamp time.Time `json:"timestamp"`
}
