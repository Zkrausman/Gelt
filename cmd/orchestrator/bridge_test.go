package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAntigravityAgentBridge_EvaluateThesis(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("USERPROFILE", tempHome)
	t.Setenv("GEMINI_API_KEY", "")
	tmpDir, err := os.MkdirTemp("", "bridge-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	b := &AntigravityAgentBridge{
		BrainPath:   filepath.Join(tmpDir, "brain"),
		JournalPath: filepath.Join(tmpDir, "gelt_ai_theses.json"),
	}

	score, thesis, err := b.EvaluateThesis(context.Background(), "DEMO", "synthetic test prompt", 75.0, 35.0)
	if err != nil {
		t.Fatalf("unexpected error evaluating thesis: %v", err)
	}

	if thesis == nil {
		t.Fatalf("expected non-nil TradeThesis")
	}

	if thesis.Symbol != "DEMO" {
		t.Errorf("expected symbol DEMO, got %s", thesis.Symbol)
	}

	if score < 0.0 || score > 100.0 {
		t.Errorf("expected score in range [0, 100], got %.2f", score)
	}

	if thesis.Status != "AI_ORCHESTRATED" {
		t.Errorf("expected status AI_ORCHESTRATED, got %s", thesis.Status)
	}

	// Verify local journal file was created
	if _, err := os.Stat(b.JournalPath); os.IsNotExist(err) {
		t.Errorf("expected journal file at %s to exist", b.JournalPath)
	}
}

func TestNewAntigravityAgentBridgeUsesConfiguredBrainPath(t *testing.T) {
	targetDir := t.TempDir()
	t.Setenv("GELT_BEADS_BRAIN_PATH", targetDir)
	bridge := NewAntigravityAgentBridge()
	if bridge.BrainPath != targetDir {
		t.Fatal("bridge did not use the configured local destination")
	}
}

func TestNewAntigravityAgentBridgeHasNoDefaultBrainPath(t *testing.T) {
	t.Setenv("GELT_BEADS_BRAIN_PATH", "")
	bridge := NewAntigravityAgentBridge()
	if bridge.BrainPath != "" {
		t.Fatal("bridge supplied an unconfigured default destination")
	}
}
