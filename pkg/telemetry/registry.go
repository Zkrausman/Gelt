package telemetry

import (
	"log/slog"
	"os"
	"sync"
)

var (
	globalLogger TelemetryLogger
	mu           sync.RWMutex
)

func init() {
	InitFromEnv()
}

func InitFromEnv() {
	slogBackend := NewSlogBackend(os.Stdout, slog.LevelInfo)

	useThneed := os.Getenv("GELT_TELEMETRY_BACKEND") == "thneed" || os.Getenv("GELT_TELEMETRY_THNEED") == "true"

	if useThneed {
		brainPath := os.Getenv("GELT_THNEED_BRAIN_PATH")
		SetLogger(NewThneedBackend(brainPath, true, slogBackend))
	} else {
		SetLogger(slogBackend)
	}
}

func SetLogger(l TelemetryLogger) {
	mu.Lock()
	defer mu.Unlock()
	globalLogger = l
}

func GetLogger() TelemetryLogger {
	mu.RLock()
	defer mu.RUnlock()
	return globalLogger
}
