package server_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUIDegradedStateAndDashboardIDs(t *testing.T) {
	// 1. Verify app.js handles CONFIG_INVALID without restoring SPY
	appJSPath := filepath.Join("web", "static", "app.js")
	appJSContent, err := os.ReadFile(appJSPath)
	if err != nil {
		t.Fatalf("failed to read app.js: %v", err)
	}

	appJSStr := string(appJSContent)
	if !strings.Contains(appJSStr, "CONFIG_INVALID") {
		t.Error("app.js missing CONFIG_INVALID handling")
	}
	if strings.Contains(appJSStr, "Equity.SPY") {
		t.Error("app.js still contains hardcoded Equity.SPY fallback")
	}

	// 2. Verify all themes contain degraded banner text and required IDs
	themes := []string{"blueprint", "cyberpunk", "glass", "retro"}
	requiredIDs := []string{
		"broker-status", "buying-power", "latency", "vix-level",
		"regime-status", "daily-cap", "shadow-pnl", "shadow-winrate",
	}
	degradedText := "CONFIGURATION INVALID - DEGRADED MODE"

	for _, theme := range themes {
		t.Run(theme, func(t *testing.T) {
			themePath := filepath.Join("web", "theme_"+theme+".html")
			content, err := os.ReadFile(themePath)
			if err != nil {
				t.Fatalf("failed to read theme %s: %v", theme, err)
			}

			strContent := string(content)

			if !strings.Contains(strContent, degradedText) {
				t.Errorf("Theme %s missing degraded banner text: %s", theme, degradedText)
			}

			for _, id := range requiredIDs {
				if !strings.Contains(strContent, `id="`+id+`"`) {
					t.Errorf("Theme %s missing required dashboard ID: %s", theme, id)
				}
			}
		})
	}
}
