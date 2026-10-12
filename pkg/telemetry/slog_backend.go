package telemetry

import (
	"context"
	"io"
	"log/slog"
)

type SlogBackend struct {
	logger *slog.Logger
}

func NewSlogBackend(w io.Writer, level slog.Level) TelemetryLogger {
	opts := &slog.HandlerOptions{
		Level: level,
	}
	handler := slog.NewJSONHandler(w, opts)
	return &SlogBackend{
		logger: slog.New(handler),
	}
}

func mapSeverity(level Severity) slog.Level {
	switch level {
	case SeverityDebug:
		return slog.LevelDebug
	case SeverityInfo:
		return slog.LevelInfo
	case SeverityWarn:
		return slog.LevelWarn
	case SeverityError:
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func (s *SlogBackend) Log(ctx context.Context, level Severity, msg string, fields ...Field) {
	attrs := make([]slog.Attr, len(fields))
	for i, f := range fields {
		attrs[i] = slog.Any(f.Key, f.Value)
	}

	slogLevel := mapSeverity(level)

	// Check if level is enabled to avoid unnecessary allocation
	if !s.logger.Enabled(ctx, slogLevel) {
		return
	}

	// Convert slice to any
	args := make([]any, len(attrs))
	for i, a := range attrs {
		args[i] = a
	}

	s.logger.Log(ctx, slogLevel, msg, args...)
}

func (s *SlogBackend) LogTrade(ctx context.Context, tradeEvent TradeTelemetryEvent) {
	s.logger.InfoContext(ctx, "Trade Executed",
		slog.String("symbol", tradeEvent.Symbol),
		slog.String("action", tradeEvent.Action),
		slog.Float64("quantity", tradeEvent.Quantity),
		slog.Float64("price", tradeEvent.Price),
		slog.String("strategy", tradeEvent.Strategy),
		slog.Time("timestamp", tradeEvent.Timestamp),
	)
}

func (s *SlogBackend) Flush(ctx context.Context) error {
	// Standard slog does not have a flush method on handlers.
	// We implement the interface as a no-op.
	return nil
}
