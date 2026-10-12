package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestAppConfigLoadAndSave(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)

	// Verify load fails before init
	_, err := LoadAppConfig()
	if err == nil {
		t.Fatalf("expected error loading missing config, got nil")
	}

	// Init user config
	cfg, planPath, err := InitUserConfig()
	if err != nil {
		t.Fatalf("failed to init user config: %v", err)
	}

	if cfg.ScanIntervalMins != 15 {
		t.Errorf("expected 15 min interval, got %d", cfg.ScanIntervalMins)
	}

	if _, err := os.Stat(planPath); os.IsNotExist(err) {
		t.Errorf("expected plan file at %s, file not found", planPath)
	}

	// Load config back
	loaded, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("failed to load saved config: %v", err)
	}

	if loaded.ActivePlan != cfg.ActivePlan {
		t.Errorf("expected active plan %s, got %s", cfg.ActivePlan, loaded.ActivePlan)
	}

	// Test Save edit
	loaded.TotalCapitalUSD = 500.00
	if err := SaveAppConfig(loaded); err != nil {
		t.Fatalf("failed to save config edit: %v", err)
	}

	reloaded, _ := LoadAppConfig()
	if reloaded.TotalCapitalUSD != 500.00 {
		t.Errorf("expected 500.00 capital, got %.2f", reloaded.TotalCapitalUSD)
	}
}

func TestLoadAppConfig_LegacyDefaults(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	geltDir, _ := UserGeltDir()
	configPath := filepath.Join(geltDir, "config.json")

	// Write empty config (legacy)
	os.WriteFile(configPath, []byte(`{}`), 0644)

	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(cfg.ScreenerUniverse) != len(DefaultScreenerUniverse()) {
		t.Errorf("expected ScreenerUniverse to fallback to default, got %v", cfg.ScreenerUniverse)
	}

	if len(cfg.SyntheticPriceMap) != len(DefaultSyntheticPriceMap()) {
		t.Errorf("expected SyntheticPriceMap to fallback to default, got length %v", len(cfg.SyntheticPriceMap))
	}
}

func TestLoadAppConfig_EmptyMapFallback(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	geltDir, _ := UserGeltDir()
	configPath := filepath.Join(geltDir, "config.json")

	// Write config with explicit empty map
	os.WriteFile(configPath, []byte(`{"synthetic_price_map": {}}`), 0644)

	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(cfg.SyntheticPriceMap) != len(DefaultSyntheticPriceMap()) {
		t.Errorf("expected SyntheticPriceMap to fallback to default when empty JSON {}, got length %v", len(cfg.SyntheticPriceMap))
	}
}

func TestAppConfig_AIFailurePolicyValidation(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)
	_, _, err := InitUserConfig()
	if err != nil {
		t.Fatalf("Failed to init config: %v", err)
	}

	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("Expected load to succeed, got %v", err)
	}

	// Test valid
	cfg.AIFailurePolicy = "alert_and_hold"
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("Failed to save: %v", err)
	}
	_, err = LoadAppConfig()
	if err != nil {
		t.Errorf("Expected valid policy alert_and_hold to pass, got error: %v", err)
	}

	// Test invalid policy
	cfg.AIFailurePolicy = "invalid_policy"
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("Failed to save: %v", err)
	}
	_, err = LoadAppConfig()
	if err == nil {
		t.Errorf("Expected invalid policy to fail, but it passed")
	}

	// Test invalid retries
	cfg.AIFailurePolicy = "disable_strategy"
	cfg.AIMaxRetries = -1
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("Failed to save: %v", err)
	}
	_, err = LoadAppConfig()
	if err == nil {
		t.Errorf("Expected negative retries to fail, but it passed")
	}
}

func TestLoadAppConfig_InvalidThresholdRanges(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	_, defaultPlanPath, err := InitUserConfig()
	if err != nil {
		t.Fatalf("InitUserConfig failed: %v", err)
	}

	cfg, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("LoadAppConfig failed: %v", err)
	}

	cfg.BuyThreshold = 105.0
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("SaveAppConfig failed: %v", err)
	}
	if _, err := LoadAppConfig(); err == nil {
		t.Fatal("expected error for BuyThreshold > 100")
	}

	cfg.BuyThreshold = 75.0
	cfg.SellThreshold = -5.0
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("SaveAppConfig failed: %v", err)
	}
	if _, err := LoadAppConfig(); err == nil {
		t.Fatal("expected error for SellThreshold < 0")
	}

	cfg.BuyThreshold = 50.0
	cfg.SellThreshold = 60.0
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("SaveAppConfig failed: %v", err)
	}
	if _, err := LoadAppConfig(); err == nil {
		t.Fatal("expected error for SellThreshold >= BuyThreshold")
	}

	if err := os.Remove(defaultPlanPath); err != nil {
		t.Fatalf("remove default plan: %v", err)
	}
}

func TestSaveAppConfigPermissions(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)

	cfg := &AppConfig{
		DiscordBotToken: "secret-token",
	}

	err := SaveAppConfig(cfg)
	if err != nil {
		t.Fatalf("SaveAppConfig failed: %v", err)
	}

	path, err := DefaultConfigPath()
	if err != nil {
		t.Fatalf("DefaultConfigPath failed: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("os.Stat failed: %v", err)
	}

	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Errorf("Config file permissions = %v, want 0600", info.Mode().Perm())
	}

	loadedCfg, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("LoadAppConfig failed: %v", err)
	}

	if loadedCfg.DiscordBotToken != "secret-token" {
		t.Errorf("Loaded token = %q, want %q", loadedCfg.DiscordBotToken, "secret-token")
	}
}

func TestLoadAppConfig_MCPTimeout(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)

	// 1. Unconfigured / default LoadAppConfig() sets MCPTimeoutMins == 15.
	cfg, _, err := InitUserConfig()
	if err != nil {
		t.Fatalf("failed to init user config: %v", err)
	}

	if cfg.MCPTimeoutMins != 15 {
		t.Errorf("expected default MCPTimeoutMins to be 15, got %d", cfg.MCPTimeoutMins)
	}

	// Save modified config where MCPTimeoutMins = 0 (should default to 15 on load)
	cfg.MCPTimeoutMins = 0
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	loadedCfg, err := LoadAppConfig()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	if loadedCfg.MCPTimeoutMins != 15 {
		t.Errorf("expected <=0 MCPTimeoutMins to default to 15, got %d", loadedCfg.MCPTimeoutMins)
	}

	// Save modified config where MCPTimeoutMins = -5 (should fail on load)
	cfg.MCPTimeoutMins = -5
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	_, err = LoadAppConfig()
	if err == nil {
		t.Fatalf("expected negative MCPTimeoutMins to return an error, got nil")
	}

	// 2. Custom JSON unmarshaling overrides MCPTimeoutMins correctly (e.g. 30).
	cfg.MCPTimeoutMins = 30
	if err := SaveAppConfig(cfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	loadedCfg, err = LoadAppConfig()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}

	if loadedCfg.MCPTimeoutMins != 30 {
		t.Errorf("expected MCPTimeoutMins override to be 30, got %d", loadedCfg.MCPTimeoutMins)
	}
}
