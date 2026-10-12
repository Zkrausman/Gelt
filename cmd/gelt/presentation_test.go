package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"gelt/pkg/robinhood"
)

func TestDegradedTelemetryPresentation(t *testing.T) {
	// Build the CLI binary temporarily for testing
	binName := "gelt-cli-test"
	if runtime.GOOS == "windows" {
		binName += ".exe"
	}
	tmpBin := filepath.Join(t.TempDir(), binName)
	buildCmd := exec.Command("go", "build", "-o", tmpBin, "./")
	if err := buildCmd.Run(); err != nil {
		t.Fatalf("Failed to build CLI for testing: %v", err)
	}

	// Create a temporary HOME directory to simulate missing/invalid config
	tmpHomeMissing := t.TempDir()

	// Create a temporary HOME with a valid mcp config but pointing to an HTTP 500 endpoint
	tmpHome500 := t.TempDir()
	server500 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server500.Close()

	mcpCfg := robinhood.MCPConfig{
		ServerURL: server500.URL,
		AuthToken: "mock-token",
	}
	geltDir := filepath.Join(tmpHome500, ".gelt")
	os.MkdirAll(geltDir, 0755)
	cfgBytes, _ := json.Marshal(mcpCfg)
	os.WriteFile(filepath.Join(geltDir, "mcp.json"), cfgBytes, 0644)

	tests := []struct {
		name    string
		command string
		homeDir string
	}{
		{"status command missing config", "status", tmpHomeMissing},
		{"status command HTTP 500 config", "status", tmpHome500},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cmd := exec.Command(tmpBin, tt.command)
			cmd.Env = append(os.Environ(), "HOME="+tt.homeDir, "USERPROFILE="+tt.homeDir)
			var stdout bytes.Buffer
			cmd.Stdout = &stdout
			cmd.Stderr = &stdout

			err := cmd.Run()
			if err != nil {
				t.Fatalf("command %s exited with error: %v, output: %s", tt.command, err, stdout.String())
			}

			output := stdout.String()

			// Verify the explicit degraded warning is present
			expectedWarning := "[WARNING] STATUS: DEGRADED. Dashboard reflects SYNTHETIC FALLBACK, not live market conditions."
			if !strings.Contains(output, expectedWarning) && !strings.Contains(output, "SYNTHETIC FALLBACK - DEGRADED MODE") {
				t.Errorf("Expected degraded telemetry warning, got output:\n%s", output)
			}

			// Verify it is NOT presented as LIVE VS SHADOW
			if strings.Contains(output, "LIVE VS SHADOW FORWARD-TEST") {
				t.Errorf("Command %s output should not contain 'LIVE VS SHADOW FORWARD-TEST' when degraded", tt.command)
			}
		})
	}
}
