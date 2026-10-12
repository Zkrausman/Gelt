// Package config provides application configuration loading and persistence for Gelt.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// ErrConfigNotFound is returned when the app configuration file cannot be found.
var ErrConfigNotFound = errors.New("configuration file not found")

// SlippageConfig holds per-asset-class simulated fill slippage percentages.
type SlippageConfig struct {
	CryptoPct  float64 `json:"crypto_pct"`
	EquityPct  float64 `json:"equity_pct"`
	OptionsPct float64 `json:"options_pct"`
}

// DispatcherConfig holds thresholds for the Heavy Agent Dispatcher.
type DispatcherConfig struct {
	MaxMonthlyCalls        int     `json:"max_monthly_calls"`        // default: 100
	ATRSpikeThreshold      float64 `json:"atr_spike_threshold"`      // default: 2.5
	DecisionScoreThreshold float64 `json:"decision_score_threshold"` // default: 85.0
}

// PromotionGate represents the thresholds for promoting or demoting shadow trading plans.
type PromotionGate struct {
	MinTrades           int     `json:"min_trades"`
	PromoteWinRate      float64 `json:"promote_win_rate"`
	PromoteProfitFactor float64 `json:"promote_profit_factor"`
	PromoteMaxVaR       float64 `json:"promote_max_var"`
	DemoteProfitFactor  float64 `json:"demote_profit_factor"`
	DemoteMaxDrawdown   float64 `json:"demote_max_drawdown"`
}

type RiskConfig struct {
	MaxPositionPct     float64            `json:"max_position_pct"`
	DefaultStopLossPct float64            `json:"default_stop_loss_pct"`
	PerSymbolStopLoss  map[string]float64 `json:"per_symbol_stop_loss"`
}

// DefaultScreenerUniverse returns a predefined list of high-volume equities.
func DefaultScreenerUniverse() []string {
	return []string{
		"SPY", "QQQ", "IWM", "AAPL", "NVDA",
		"MSFT", "AMZN", "GOOGL", "TSLA", "AMD",
	}
}

// DefaultSyntheticPriceMap returns default base prices for the synthetic generation.
func DefaultSyntheticPriceMap() map[string]float64 {
	return map[string]float64{
		"SPY": 505.83, "QQQ": 449.86, "NVDA": 875.50, "TSLA": 253.82, "GOOGL": 165.23,
		"IWM": 200.0, "AAPL": 220.0, "MSFT": 450.0, "AMZN": 180.0, "AMD": 150.0,
	}
}

// AppConfig represents user-level settings stored in ~/.gelt/config.json.
type AppConfig struct {
	ActivePlan            string                        `json:"active_plan"`
	BuyThreshold          float64                       `json:"buy_threshold,omitempty"`
	SellThreshold         float64                       `json:"sell_threshold,omitempty"`
	FallbackStrategies    []string                      `json:"fallback_strategies,omitempty"`
	ScanIntervalMins      int                           `json:"scan_interval_mins"`
	MCPTimeoutMins        int                           `json:"mcp_timeout_mins,omitempty"`
	TotalCapitalUSD       float64                       `json:"total_capital_usd"`
	DurationMode          string                        `json:"duration_mode"`
	WatchSymbols          []string                      `json:"watch_symbols"`
	ScreenerUniverse      []string                      `json:"screener_universe,omitempty"`
	SyntheticPriceMap     map[string]float64            `json:"synthetic_price_map,omitempty"`
	GeminiAPIKey          string                        `json:"gemini_api_key,omitempty"`
	GeminiModels          []string                      `json:"gemini_models,omitempty"`
	DiscordWebhookURL     string                        `json:"discord_webhook_url,omitempty"`
	DiscordBotToken       string                        `json:"discord_bot_token,omitempty"`
	EnableWebhooks        bool                          `json:"enable_webhooks"`
	Gate                  PromotionGate                 `json:"gate"`
	Risk                  RiskConfig                    `json:"risk"`
	StrategyConfig        map[string]map[string]float64 `json:"strategy_config,omitempty"`
	VerboseLog            bool                          `json:"verbose_log"`
	Dispatcher            DispatcherConfig              `json:"dispatcher,omitempty"`
	Slippage              SlippageConfig                `json:"slippage"`
	AIFailurePolicy       string                        `json:"ai_failure_policy,omitempty"`
	AIMaxRetries          int                           `json:"ai_max_retries,omitempty"`
	AutoSpawnOrchestrator bool                          `json:"auto_spawn_orchestrator,omitempty"`
}

// UserGeltDir returns the absolute path to the user's ~/.gelt directory.
func UserGeltDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to locate user home directory: %w", err)
	}
	dir := filepath.Join(home, ".gelt")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	return dir, nil
}

// UserPlansDir returns the absolute path to ~/.gelt/plans.
func UserPlansDir() (string, error) {
	geltDir, err := UserGeltDir()
	if err != nil {
		return "", err
	}
	plansDir := filepath.Join(geltDir, "plans")
	if err := os.MkdirAll(plansDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory %s: %w", plansDir, err)
	}
	return plansDir, nil
}

// UserJournalsDir returns the absolute path to ~/.gelt/journals.
func UserJournalsDir() (string, error) {
	geltDir, err := UserGeltDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(geltDir, "journals")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	return dir, nil
}

// UserDaemonDir returns the absolute path to ~/.gelt/daemon.
func UserDaemonDir() (string, error) {
	geltDir, err := UserGeltDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(geltDir, "daemon")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	return dir, nil
}

// UserTelemetryDir returns the absolute path to ~/.gelt/telemetry.
func UserTelemetryDir() (string, error) {
	geltDir, err := UserGeltDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(geltDir, "telemetry")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	return dir, nil
}

// MigrateLegacyFiles seamlessly moves legacy files from ~/.gelt/ root to subfolders.
func MigrateLegacyFiles() {
	geltDir, err := UserGeltDir()
	if err != nil {
		return
	}
	journalsDir, _ := UserJournalsDir()
	daemonDir, _ := UserDaemonDir()

	migrations := map[string]string{
		filepath.Join(geltDir, "gelt_shadow_journal.json"): filepath.Join(journalsDir, "shadow_journal.json"),
		filepath.Join(geltDir, "gelt_ai_theses.json"):      filepath.Join(journalsDir, "ai_theses.json"),
		filepath.Join(geltDir, "gelt_journal.json"):        filepath.Join(journalsDir, "live_journal.json"),
		filepath.Join(geltDir, "gelt_daemon_status.json"):  filepath.Join(daemonDir, "status.json"),
		filepath.Join(geltDir, "gelt_mcp.json"):            filepath.Join(geltDir, "mcp.json"),
	}

	for oldPath, newPath := range migrations {
		if _, err := os.Stat(oldPath); err == nil {
			if _, err := os.Stat(newPath); os.IsNotExist(err) {
				_ = os.Rename(oldPath, newPath)
			}
		}
	}
}

// DefaultConfigPath returns the path to ~/.gelt/config.json.
func DefaultConfigPath() (string, error) {
	geltDir, err := UserGeltDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(geltDir, "config.json"), nil
}

// LoadAppConfig loads the user's AppConfig from ~/.gelt/config.json.
func LoadAppConfig() (*AppConfig, error) {
	MigrateLegacyFiles()
	path, err := DefaultConfigPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w at %s. Please run 'gelt config init' or specify --plan=<path>", ErrConfigNotFound, path)
		}
		return nil, fmt.Errorf("failed to read config file %s: %w", path, err)
	}

	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config JSON at %s: %w", path, err)
	}

	if cfg.AIFailurePolicy == "" {
		cfg.AIFailurePolicy = "disable_strategy"
	}
	if cfg.AIFailurePolicy != "disable_strategy" && cfg.AIFailurePolicy != "alert_and_hold" && cfg.AIFailurePolicy != "exit" && cfg.AIFailurePolicy != "halt_daemon" {
		return nil, fmt.Errorf("invalid ai_failure_policy: %s", cfg.AIFailurePolicy)
	}
	if cfg.AIMaxRetries < 0 {
		return nil, fmt.Errorf("invalid ai_max_retries: must be >= 0, got %d", cfg.AIMaxRetries)
	}

	if cfg.MCPTimeoutMins < 0 {
		return nil, fmt.Errorf("mcp_timeout_mins must be greater than or equal to 0")
	}
	if cfg.MCPTimeoutMins == 0 {
		cfg.MCPTimeoutMins = 15
	}
	if len(cfg.ScreenerUniverse) == 0 {
		cfg.ScreenerUniverse = DefaultScreenerUniverse()
	}
	if len(cfg.SyntheticPriceMap) == 0 {
		cfg.SyntheticPriceMap = DefaultSyntheticPriceMap()
	}
	if cfg.BuyThreshold == 0 {
		cfg.BuyThreshold = 75.0
	}
	if cfg.SellThreshold == 0 {
		cfg.SellThreshold = 35.0
	}
	if cfg.Slippage.CryptoPct == 0 {
		cfg.Slippage.CryptoPct = 0.0015
	}
	if cfg.Slippage.EquityPct == 0 {
		cfg.Slippage.EquityPct = 0.0003
	}
	if cfg.Slippage.OptionsPct == 0 {
		cfg.Slippage.OptionsPct = 0.025
	}
	for _, pct := range []float64{cfg.Slippage.CryptoPct, cfg.Slippage.EquityPct, cfg.Slippage.OptionsPct} {
		if math.IsNaN(pct) || math.IsInf(pct, 0) || pct < 0 || pct >= 1 {
			return nil, fmt.Errorf("slippage percentages must be finite and in [0,1)")
		}
	}

	if cfg.BuyThreshold < 0 || cfg.BuyThreshold > 100 || cfg.SellThreshold < 0 || cfg.SellThreshold > 100 {
		return nil, fmt.Errorf("thresholds must be between 0 and 100")
	}
	if cfg.SellThreshold >= cfg.BuyThreshold {
		return nil, fmt.Errorf("sell threshold must be strictly less than buy threshold")
	}

	return &cfg, nil
}

// SaveAppConfig writes the AppConfig to ~/.gelt/config.json.
func SaveAppConfig(cfg *AppConfig) error {
	path, err := DefaultConfigPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	err = os.WriteFile(path, data, 0600)
	if err != nil {
		return err
	}
	// Enforce secure file permissions (owner read/write only).
	// Note: os.Chmod is a no-op on Windows. For a complete Windows security solution,
	// explicit ACLs via the golang.org/x/sys/windows API would be required.
	if runtime.GOOS != "windows" {
		if chmodErr := os.Chmod(path, 0600); chmodErr != nil {
			return fmt.Errorf("failed to enforce secure file permissions: %w", chmodErr)
		}
	}
	return nil
}

// InitUserConfig creates ~/.gelt/config.json and scaffolds a user plan in ~/.gelt/plans/crypto_ab_test.yaml if not present.
func InitUserConfig() (*AppConfig, string, error) {
	plansDir, err := UserPlansDir()
	if err != nil {
		return nil, "", err
	}

	defaultPlanPath := filepath.Join(plansDir, "crypto_ab_test.yaml")
	if _, err := os.Stat(defaultPlanPath); os.IsNotExist(err) {
		samplePlanYaml := `plan_name: User_Crypto_AB_Test
description: User 4-way A/B shadow test trading plan for 24/7 cryptocurrency markets.
asset_class: CRYPTO
auto_liquidate_at_close: false
intraday_only: false
strategies:
  - name: MACD_Crypto
    weight: 0.25
  - name: VWAP_Crypto
    weight: 0.25
  - name: AI_Choice_Crypto
    weight: 0.25
    signal: AGENT_REVIEW
    agent_prompt: "It's up to you to decide what to buy and sell, just no more than two positions at a time"
  - name: Random_Crypto
    weight: 0.25
`
		if err := os.WriteFile(defaultPlanPath, []byte(strings.TrimSpace(samplePlanYaml)), 0644); err != nil {
			return nil, "", fmt.Errorf("failed to write user plan file %s: %w", defaultPlanPath, err)
		}
	}

	cfg := &AppConfig{
		ActivePlan:            defaultPlanPath,
		BuyThreshold:          75.0,
		SellThreshold:         35.0,
		FallbackStrategies:    []string{"MACD_Crypto", "VWAP_Crypto", "AI_Choice_Crypto", "Random_Crypto"},
		ScanIntervalMins:      15,
		MCPTimeoutMins:        15,
		TotalCapitalUSD:       200.00,
		DurationMode:          "24h",
		WatchSymbols:          []string{"BTC", "ETH", "SOL", "AVAX"},
		ScreenerUniverse:      DefaultScreenerUniverse(),
		SyntheticPriceMap:     DefaultSyntheticPriceMap(),
		GeminiModels:          []string{"gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-2.5-pro", "gemini-2.5-flash-lite"},
		EnableWebhooks:        false,
		AutoSpawnOrchestrator: false,
		Gate: PromotionGate{
			MinTrades:           3,
			PromoteWinRate:      65.0,
			PromoteProfitFactor: 1.5,
			PromoteMaxVaR:       5.0,
			DemoteProfitFactor:  1.1,
			DemoteMaxDrawdown:   5.0,
		},
		Risk: RiskConfig{
			MaxPositionPct:     20.0,
			DefaultStopLossPct: 3.0,
			PerSymbolStopLoss: map[string]float64{
				"SPY":  0.35,
				"QQQ":  0.50,
				"AAPL": 1.00,
				"NVDA": 1.50,
			},
		},
		StrategyConfig: make(map[string]map[string]float64),
		VerboseLog:     true,
		Dispatcher: DispatcherConfig{
			MaxMonthlyCalls:        100,
			ATRSpikeThreshold:      2.5,
			DecisionScoreThreshold: 85.0,
		},
		Slippage: SlippageConfig{
			CryptoPct:  0.0015,
			EquityPct:  0.0003,
			OptionsPct: 0.025,
		},
		AIFailurePolicy: "disable_strategy",
		AIMaxRetries:    3,
	}

	if err := SaveAppConfig(cfg); err != nil {
		return nil, "", err
	}

	return cfg, defaultPlanPath, nil
}
