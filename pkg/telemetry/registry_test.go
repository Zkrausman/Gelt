package telemetry

import (
	"os"
	"testing"
)

func TestRegistry_InitFromEnv(t *testing.T) {
	// Test Default (Slog)
	os.Setenv("GELT_TELEMETRY_BACKEND", "")
	os.Setenv("GELT_TELEMETRY_THNEED", "")
	InitFromEnv()
	logger := GetLogger()

	if _, ok := logger.(*SlogBackend); !ok {
		t.Errorf("Expected GetLogger to return SlogBackend when env vars are empty, got %T", logger)
	}

	// Test Thneed Backend via GELT_TELEMETRY_BACKEND
	os.Setenv("GELT_TELEMETRY_BACKEND", "thneed")
	os.Setenv("GELT_THNEED_BRAIN_PATH", "/tmp/dummy_brain")

	InitFromEnv()
	logger = GetLogger()

	tb, ok := logger.(*ThneedBackend)
	if !ok {
		t.Errorf("Expected GetLogger to return ThneedBackend when GELT_TELEMETRY_BACKEND=thneed, got %T", logger)
	}

	if tb != nil && tb.brainPath != "/tmp/dummy_brain" {
		t.Errorf("Expected brainPath to be /tmp/dummy_brain, got %s", tb.brainPath)
	}

	// Test Thneed Backend via GELT_TELEMETRY_THNEED
	os.Setenv("GELT_TELEMETRY_BACKEND", "")
	os.Setenv("GELT_TELEMETRY_THNEED", "true")
	os.Setenv("GELT_THNEED_BRAIN_PATH", "/tmp/dummy_brain_2")

	InitFromEnv()
	logger = GetLogger()

	tb, ok = logger.(*ThneedBackend)
	if !ok {
		t.Errorf("Expected GetLogger to return ThneedBackend when GELT_TELEMETRY_THNEED=true, got %T", logger)
	}

	if tb != nil && tb.brainPath != "/tmp/dummy_brain_2" {
		t.Errorf("Expected brainPath to be /tmp/dummy_brain_2, got %s", tb.brainPath)
	}

	// Clean up
	os.Setenv("GELT_TELEMETRY_BACKEND", "")
	os.Setenv("GELT_TELEMETRY_THNEED", "")
	os.Setenv("GELT_THNEED_BRAIN_PATH", "")
	InitFromEnv()
}
