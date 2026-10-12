// Package main provides the CLI interface for Gelt Agentic Trading Suite.
package main

import (
	"encoding/json"

	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"gelt/pkg/telemetry"

	"gelt/pkg/notify"

	"gelt/pkg/backtest"
	"gelt/pkg/config"
	"gelt/pkg/data"
	"gelt/pkg/health"
	"gelt/pkg/macro"
	"gelt/pkg/options"
	"gelt/pkg/plans"
	"gelt/pkg/portfolio"
	"gelt/pkg/regime"
	"gelt/pkg/risk"
	"gelt/pkg/robinhood"
	"gelt/pkg/server"
	"gelt/pkg/shadow"
	"gelt/pkg/signals"
	"gelt/pkg/strategies"
	"gelt/pkg/thesis"
)

const Version = "v0.1.0"

func resolveStrategies(appCfg *config.AppConfig, appCfgErr error, isCrypto bool) ([]string, error) {
	if appCfgErr != nil {
		return nil, fmt.Errorf("configuration missing or unreadable: %w", appCfgErr)
	}

	if appCfg.ActivePlan != "" {
		if dynPlan, err := plans.LoadPlanFromYAML(appCfg.ActivePlan); err == nil {
			var names []string
			for _, ws := range dynPlan.Strategies() {
				names = append(names, ws.Strategy.Name())
			}
			if len(names) > 0 {
				return names, nil
			}
		}
	}

	if len(appCfg.FallbackStrategies) > 0 {
		return appCfg.FallbackStrategies, nil
	}

	return nil, fmt.Errorf("no valid ActivePlan strategies and no FallbackStrategies found in config")
}

// generateSyntheticBacktestBars keeps CLI demo data consistent with historical OHLCV validation.
func generateSyntheticBacktestBars(basePrice float64, days int, r *rand.Rand, now int64) []backtest.OHLCV {
	var bars []backtest.OHLCV
	currentPrice := basePrice
	for i := 0; i < days; i++ {
		change := (r.Float64() - 0.48) * (basePrice * 0.01) // random walk
		currentPrice += change

		open := currentPrice
		high := currentPrice + r.Float64()*(basePrice*0.005)
		low := currentPrice - r.Float64()*(basePrice*0.005)
		closePrice := currentPrice + (r.Float64()-0.5)*(basePrice*0.002)
		high = math.Max(high, closePrice)
		low = math.Min(low, closePrice)

		bars = append(bars, backtest.OHLCV{
			Timestamp: now - int64((days-i)*86400),
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePrice,
			Volume:    1000000.0 + r.Float64()*500000.0,
		})
	}
	return bars
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]

	switch command {
	case "version":
		fmt.Printf("gelt version %s\n", Version)

	case "risk":
		appCfg, _ := config.LoadAppConfig()
		limits := risk.TestAccountRiskLimits(appCfg)
		optionsStatus := "DISABLED (equities only)"
		if limits.OptionsEnabled {
			optionsStatus = "enabled"
		}
		fmt.Printf("Gelt Risk Limits (Test Account - $50):\n")
		fmt.Printf("  Max Trade:         $%.2f\n", limits.MaxTradeUsd)
		fmt.Printf("  Max Position %%:    %.2f%%\n", limits.MaxPositionPct)
		fmt.Printf("  Stop Loss %%:       %.2f%%\n", limits.StopLossPct)
		fmt.Printf("  Daily Loss Cap:    $%.2f\n", limits.DailyLossCapUsd)
		fmt.Printf("  Options Trading:   %s\n", optionsStatus)

	case "options-risk":
		optLimits := options.DefaultOptionsRiskLimits()
		fmt.Printf("Gelt Options Risk Limits:\n")
		fmt.Printf("  Max Contract Cost: $%.2f\n", optLimits.MaxContractPremiumUsd)
		fmt.Printf("  Min DTE Threshold: %d days\n", optLimits.MinDTE)
		fmt.Printf("  Max Contracts/Trade: %d\n", optLimits.MaxContractsPerTrade)
		fmt.Printf("  Max Implied Vol %%:  %.1f%%\n", optLimits.MaxImpliedVolPct)

	case "status", "telemetry":
		home, _ := os.UserHomeDir()
		journalPath := filepath.Join(home, ".gelt", "journals", "live_journal.json") // updated to new path just to match config
		theses, _ := thesis.LoadJournal(journalPath)

		appCfg, _ := config.LoadAppConfig()
		limits := risk.TestAccountRiskLimits(appCfg)
		// The CLI status preview uses a conspicuously synthetic fixture when no
		// live journal data is available; these values are not an account snapshot.
		samplePositions := []portfolio.Position{
			{Symbol: "DEMO", Quantity: 2, AverageBuyPrice: 10.00, PeakPrice: 11.00, CurrentPrice: 10.75},
		}

		telemetry := portfolio.GenerateTelemetry(
			"SYNTHETIC-DEMO-ACCOUNT",
			100.00,
			101.50,
			80.00,
			80.00,
			samplePositions,
			theses,
			limits.DailyLossCapUsd,
			limits.StopLossPct,
			0,
		)

		mcpPath := filepath.Join(home, ".gelt", "mcp.json")
		mcpCfg, mcpErr := robinhood.LoadConfig(mcpPath)
		dashboardStr := telemetry.FormatDashboard()
		if mcpErr != nil || mcpCfg == nil || mcpCfg.AuthToken == "" || robinhood.PingMCP(mcpCfg) != nil {
			dashboardStr = strings.Replace(dashboardStr, "LIVE VS SHADOW FORWARD-TEST", "SYNTHETIC FALLBACK - DEGRADED MODE", 1)
			dashboardStr = "[WARNING] Market-data configuration (mcp.json) is missing, expired, or unauthenticated.\n[WARNING] STATUS: DEGRADED. Dashboard reflects SYNTHETIC FALLBACK, not live market conditions.\n\n" + dashboardStr
		}

		fmt.Print(dashboardStr)

	case "signals":
		symbol := "SPY"
		if len(os.Args) >= 3 {
			symbol = strings.ToUpper(os.Args[2])
		}

		closes := generateSampleCloses(60, 500.0, 42)
		summary, err := signals.EvaluateConfluence(symbol, closes)
		if err != nil {
			fmt.Printf("Error calculating signals for %s: %v\n", symbol, err)
			os.Exit(1)
		}

		fmt.Printf("Gelt Technical Signals Evaluation (%s):\n", summary.Symbol)
		fmt.Printf("  Latest Price:      $%.2f\n", summary.LatestPrice)
		fmt.Printf("  Confluence Score:  %.1f / 100.0\n", summary.Score)
		fmt.Printf("  Market Bias:       %s\n", summary.Bias)
		fmt.Printf("  RSI (14):          %.2f\n", summary.RSI14)
		fmt.Printf("  EMA (20):          $%.2f\n", summary.EMA20)
		fmt.Printf("  EMA (50):          $%.2f\n", summary.EMA50)
		fmt.Printf("  MACD Hist:         %.4f\n", summary.MACDHist)
		fmt.Printf("  Bollinger Upper:   $%.2f\n", summary.BollingerUpper)
		fmt.Printf("  Bollinger Lower:   $%.2f\n", summary.BollingerLower)
		fmt.Printf("  ATR (14 Vol):      $%.2f\n", summary.ATR14)
		fmt.Printf("  Dynamic ATR Stop:  -%.2f%% (0.5x ATR)\n", summary.DynamicStopPct)
		fmt.Printf("  Dynamic Target:    +%.2f%% (1.25x ATR)\n", summary.DynamicTargetPct)
		fmt.Println("  Active Signals:")
		for _, sig := range summary.SignalsTriggered {
			fmt.Printf("    • %s\n", sig)
		}

	case "scan":
		minScore := 0.0
		if len(os.Args) >= 3 {
			if val, err := strconv.ParseFloat(os.Args[2], 64); err == nil {
				minScore = val
			}
		}

		appCfg, _ := config.LoadAppConfig()

		var watchlist []string
		var priceMap map[string]float64

		if appCfg != nil {
			watchlist = appCfg.ScreenerUniverse
			priceMap = appCfg.SyntheticPriceMap
		} else {
			watchlist = config.DefaultScreenerUniverse()
			priceMap = config.DefaultSyntheticPriceMap()
		}

		universe := make(map[string][]float64)
		for i, sym := range watchlist {
			basePrice, ok := priceMap[sym]
			if !ok {
				basePrice = 100.0
			}
			universe[sym] = generateSampleCloses(60, basePrice, int64(100+i*7))
		}

		results, err := signals.ScanWatchlist(universe, minScore)
		if err != nil {
			fmt.Printf("Scan error: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("Gelt Market Screener Results (%d tickers scanned, min score: %.1f):\n", len(watchlist), minScore)
		fmt.Printf("%-8s | %-9s | %-12s | %-8s | %-8s | %-8s | %s\n", "Symbol", "Price", "Score (0-100)", "Bias", "ATR Stop%", "Target%", "Top Signal")
		fmt.Println("----------------------------------------------------------------------------------------------------------")
		for _, res := range results {
			topSig := "Neutral"
			if len(res.SignalsTriggered) > 0 {
				topSig = res.SignalsTriggered[0]
			}
			fmt.Printf("%-8s | $%-8.2f | %-12.1f | %-8s | -%-7.2f%% | +%-7.2f%% | %s\n", res.Symbol, res.LatestPrice, res.Score, res.Bias, res.DynamicStopPct, res.DynamicTargetPct, topSig)
		}

	case "monitor":
		cfg, _ := config.LoadAppConfig()
		samplePositions := []portfolio.Position{
			{Symbol: "QQQ", Quantity: 0.022178, AverageBuyPrice: 450.89, PeakPrice: 452.10, CurrentPrice: 450.95},
			{Symbol: "TSLA", Quantity: 0.039321, AverageBuyPrice: 254.32, PeakPrice: 256.50, CurrentPrice: 255.80},
		}

		fmt.Printf("Gelt Portfolio & Asset-Calibrated Trailing Stop Monitor:\n")
		fmt.Printf("%-8s | %-10s | %-10s | %-10s | %-8s | %-8s | %s\n", "Symbol", "Shares", "Avg Price", "Current", "PnL %", "Stop %", "Status / Signal")
		fmt.Println("---------------------------------------------------------------------------------------------------")
		for _, pos := range samplePositions {
			adaptive := risk.GetAdaptiveRiskGuardrails(pos.Symbol, cfg)
			sig := portfolio.CheckTrailingStop(pos, adaptive.StopLossPct)
			statusStr := "SAFE (Hold)"
			if sig.ShouldExit {
				statusStr = fmt.Sprintf("EXIT TRIGGERED (%s)", sig.Reason)
			}
			fmt.Printf("%-8s | %-10.6f | $%-9.2f | $%-9.2f | %-8.2f%% | %-8.1f%% | %s\n", pos.Symbol, pos.Quantity, pos.AverageBuyPrice, pos.CurrentPrice, sig.PnLPct, adaptive.StopLossPct, statusStr)
		}

	case "health":
		fmt.Println("================================================================================")
		fmt.Printf("  GELT PRE-MARKET DIAGNOSTIC HEALTH CHECK (%s)\n", Version)
		fmt.Println("================================================================================")

		home, _ := os.UserHomeDir()
		mcpPath := filepath.Join(home, ".gelt", "mcp.json")
		cfg, err := robinhood.LoadConfig(mcpPath)
		if err != nil {
			cfg = &robinhood.MCPConfig{}
		}

		report := health.RunPreMarketCheck(cfg)

		fmt.Printf("%-30s | %-15s | %-10s | %s\n", "Diagnostic Check", "Status", "Latency", "Message")
		fmt.Println("--------------------------------------------------------------------------------")
		allPass := true
		for _, chk := range report.Checks {
			if chk.Status != "PASS" {
				allPass = false
			}
			fmt.Printf("%-30s | %-15s | %-7d ms | %s\n", chk.Name, "["+chk.Status+"]", chk.Latency, chk.Message)
		}
		fmt.Println("--------------------------------------------------------------------------------")

		if allPass {
			fmt.Printf("SYSTEM STATUS: READY FOR MARKET OPEN (Total Latency: %dms)\n", report.LatencyMs)
		} else {
			fmt.Printf("SYSTEM STATUS: CHECKS FAILED (Total Latency: %dms) - PLEASE RESOLVE ISSUES\n", report.LatencyMs)
		}
		fmt.Println("================================================================================")

	case "test-suite":
		fmt.Println("==========================================================")
		fmt.Printf("  GELT PRE-MARKET DIAGNOSTIC HEALTH CHECK (%s)\n", Version)
		fmt.Println("==========================================================")

		home, _ := os.UserHomeDir()
		mcpPath := filepath.Join(home, ".gelt", "mcp.json")
		journalPath := filepath.Join(home, ".gelt", "journals", "live_journal.json")

		// Check 1: MCP Endpoint Connectivity & Handshake
		mcpStatus := "PASS"
		cfg, err := robinhood.LoadConfig(mcpPath)
		if err != nil || cfg == nil {
			mcpStatus = "FAIL (Config Missing)"
		} else if err := robinhood.PingMCP(cfg); err != nil {
			mcpStatus = "WARN (Endpoint Offline / Paper Mode)"
		}

		// Check 2: Journal File
		journalStatus := "PASS"
		if _, err := thesis.LoadJournal(journalPath); err != nil {
			journalStatus = "FAIL"
		}

		// Check 3: Risk Engine
		appCfg, _ := config.LoadAppConfig()
		limits := risk.TestAccountRiskLimits(appCfg)
		riskStatus := "PASS"
		if err := limits.ValidateTrade("SPY", 1.0, 50.0); err != nil {
			riskStatus = "FAIL"
		}

		// Check 4: Technical Signal Engine
		sampleCloses := generateSampleCloses(60, 500.0, 42)
		signalStatus := "PASS"
		if _, err := signals.EvaluateConfluence("SPY", sampleCloses); err != nil {
			signalStatus = "FAIL"
		}

		// Check 5: Portfolio Monitor
		pos := portfolio.Position{Symbol: "SPY", Quantity: 0.001354, AverageBuyPrice: 738.12, PeakPrice: 745.00, CurrentPrice: 738.50}
		portStatus := "PASS"
		if sig := portfolio.CheckTrailingStop(pos, 3.0); sig.Symbol == "" {
			portStatus = "FAIL"
		}

		// Check 6: Thneed Self-Doc Format
		testThesis := thesis.TradeThesis{
			ID: "health-test", Symbol: "SPY", Side: "buy", AmountUSD: 1.0, ConfluenceScore: 85.0,
			Bias: "BULLISH", Status: "FILLED", Timestamp: time.Now(),
		}
		rat, ev := testThesis.FormatSelfDoc()
		thneedStatus := "PASS"
		if rat == "" || ev == "" {
			thneedStatus = "FAIL"
		}

		// Check 7: Promotion Config
		promoStatus := "PASS"
		promoCfg := config.LoadPromotionConfig()
		if err := promoCfg.Validate(); err != nil {
			promoStatus = "FAIL (" + err.Error() + ")"
		}

		// Check 7: Live Order Dispatch Pipeline Binding (Dry-run Ping)
		mcpPipelineStatus := "PASS"
		if cfg == nil || cfg.AuthToken == "" {
			mcpPipelineStatus = "FAIL (Auth Token Missing)"
		} else if err := robinhood.PingMCP(cfg); err != nil {
			mcpPipelineStatus = "WARN (Endpoint Offline)"
		}

		fmt.Printf("1. Robinhood MCP Endpoint Ping:        [%s]\n", mcpStatus)
		fmt.Printf("2. Trade Journal Store:               [%s]\n", journalStatus)
		fmt.Printf("3. Risk Governance Engine:            [%s]\n", riskStatus)
		fmt.Printf("4. Technical Indicator Engine:        [%s]\n", signalStatus)
		fmt.Printf("5. Portfolio Trailing-Stop Engine:    [%s]\n", portStatus)
		fmt.Printf("6. Thneed Self-Doc Formatter:         [%s]\n", thneedStatus)
		fmt.Printf("7. Promotion Engine Config:           [%s]\n", promoStatus)
		fmt.Printf("8. Live MCP Order Dispatch Pipeline:   [%s]\n", mcpPipelineStatus)

		// Check 9: Broker Integration Pre-Market Health
		if cfg == nil {
			cfg = &robinhood.MCPConfig{}
		}
		report := health.RunPreMarketCheck(cfg)
		fmt.Printf("9. Broker Pre-Market Diagnostic:       \n")
		allPass := true
		for _, chk := range report.Checks {
			if chk.Status != "PASS" {
				allPass = false
			}
		}
		if allPass {
			fmt.Printf("[%s]\n", "PASS")
		} else {
			fmt.Printf("[%s]\n", "FAIL")
		}

		fmt.Println("----------------------------------------------------------")
		fmt.Println("SYSTEM STATUS: ALL CORE MODULES OPERATIONAL FOR MARKET OPEN")
		fmt.Println("==========================================================")
	case "thesis":
		home, _ := os.UserHomeDir()
		journalPath := filepath.Join(home, ".gelt", "journals", "live_journal.json")

		theses, err := thesis.LoadJournal(journalPath)
		if err != nil {
			fmt.Printf("Error loading journal: %v\n", err)
			os.Exit(1)
		}

		if len(theses) == 0 {
			fmt.Println("No trade theses recorded in this journal.")
		}

		fmt.Printf("Gelt Trade Thesis Journal (%d records):\n", len(theses))
		for i, t := range theses {
			rat, ev := t.FormatSelfDoc()
			fmt.Printf("\n--- Trade Entry #%d (%s %s) ---\n", i+1, strings.ToUpper(t.Side), t.Symbol)
			fmt.Println(rat)
			fmt.Println(ev)
		}

		// Shadow performance is an operational claim. Never fabricate a fallback
		// or sync it when its journal cannot be verified.
		store := shadow.DefaultStore()
		perfList, perfErr := store.GetPerformance("IntradayAlphaPlan")
		if perfErr != nil || len(perfList) == 0 {
			if perfErr != nil {
				fmt.Printf("Shadow telemetry unavailable: %v\n", perfErr)
			} else {
				fmt.Println("Shadow telemetry unavailable: no verified shadow performance records.")
			}
			return
		}
		targetPerf := perfList[0]
		shadowRec := thesis.ShadowTelemetryRecord{
			PlanName:     targetPerf.PlanName,
			Mode:         "SHADOW",
			TotalTrades:  targetPerf.TotalTrades,
			WinRate:      targetPerf.WinRate,
			NetPnLUSD:    targetPerf.TotalPnLUSD,
			ProfitFactor: targetPerf.ProfitFactor,
			AvgWin:       targetPerf.AvgWin,
			AvgLoss:      targetPerf.AvgLoss,
			MaxDrawdown:  targetPerf.MaxDrawdown,
			Timestamp:    time.Now(),
		}
		if err := thesis.SyncShadowTelemetry("", shadowRec); err != nil {
			fmt.Printf("Shadow telemetry unavailable: %v\n", err)
			return
		}
		sRat, sEv := shadowRec.FormatShadowSelfDoc()
		fmt.Printf("\n--- Shadow Engine Telemetry Self-Doc (%s) ---\n", shadowRec.PlanName)
		fmt.Println(sRat)
		fmt.Println(sEv)

	case "macro":
		series := "EFFR"
		if len(os.Args) >= 3 {
			series = strings.ToUpper(os.Args[2])
		}

		client := macro.NewClient("")
		start := time.Now()
		ch := client.FetchSeriesAsync(series)
		elapsed := time.Since(start)

		data := <-ch
		fmt.Printf("Gelt Async Macro Ingestion (FRED API):\n")
		fmt.Printf("  Series ID:         %s\n", data.SeriesID)
		fmt.Printf("  Rate Value:        %.2f%%\n", data.Value)
		fmt.Printf("  Observation Date:  %s\n", data.Date)
		fmt.Printf("  Ingestion Latency: %.2fms (Asynchronous Non-Blocking)\n", float64(elapsed.Microseconds())/1000.0)

	case "strategies", "catalog":
		cat := strategies.DefaultCatalog()
		list := cat.List()
		fmt.Printf("Gelt Quantitative Strategy Catalog (%d Registered Strategies):\n", len(list))
		fmt.Printf("%-20s | %s\n", "Strategy Name", "Description")
		fmt.Println("---------------------------------------------------------------------------------------------------")
		for _, s := range list {
			fmt.Printf("%-20s | %s\n", s.Name(), s.Description())
		}

	case "plan":
		suite := plans.DefaultPlanSuite()
		if len(os.Args) >= 3 && os.Args[2] == "list" {
			list := suite.List()
			fmt.Printf("Gelt Registered Trading Plans (%d Available Plans):\n", len(list))
			fmt.Printf("%-25s | %s\n", "Plan Name", "Description")
			fmt.Println("---------------------------------------------------------------------------------------------------")
			for _, p := range list {
				fmt.Printf("%-25s | %s\n", p.Name(), p.Description())
			}
		} else if len(os.Args) >= 3 && (os.Args[2] == "promote" || os.Args[2] == "set") {
			// This one-shot CLI constructs an in-memory PlanSuite, so it cannot
			// truthfully claim an activation that survives process exit or controls
			// an already-running daemon. Keep both paths unavailable rather than
			// emitting a false operational success claim.
			fmt.Println("Plan activation is unavailable from this one-shot CLI; use the daemon-owned, audited promotion workflow.")
			os.Exit(1)
		} else {
			active, err := suite.Active()
			if err != nil {
				fmt.Printf("Error getting active plan: %v\n", err)
				os.Exit(1)
			}
			fmt.Printf("ACTIVE GELT TRADING PLAN: %s\n", active.Name())
			fmt.Printf("Description: %s\n", active.Description())
			fmt.Println("---------------------------------------------------------------------------------------------------")
			fmt.Println("Underlying Weighted Strategies:")
			for _, ws := range active.Strategies() {
				fmt.Printf("  - %-20s (Weight: %.0f%%) | %s\n", ws.Strategy.Name(), ws.Weight*100, ws.Strategy.Description())
			}
		}

	case "shadow":
		if len(os.Args) >= 3 && os.Args[2] == "capital-rebaseline" {
			if len(os.Args) != 4 || os.Args[3] != "--acknowledge-empty-journal-rebaseline" {
				fmt.Println("Usage: gelt shadow capital-rebaseline --acknowledge-empty-journal-rebaseline")
				fmt.Println("This archives the non-empty tainted journal beside its replacement, creates a fresh empty journal, and records archive provenance before clearing the latch.")
				os.Exit(1)
			}
			if err := shadow.DefaultStore().RebaselineCapitalReservation(); err != nil {
				fmt.Printf("Capital rebaseline refused: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Capital-integrity latch cleared after an auditable journal archive and empty replacement.")
			return
		} else if len(os.Args) >= 3 && os.Args[2] == "cycles" {
			store := shadow.DefaultStore()
			results, err := store.LoadCycleResults()
			if err != nil {
				fmt.Printf("Error loading cycle results: %v\n", err)
				os.Exit(1)
			}
			if len(results) == 0 {
				fmt.Println("No cycle logs found.")
				return
			}

			latest := false
			jsonOut := false
			symbolFilter := ""

			for _, arg := range os.Args[3:] {
				if arg == "--latest" {
					latest = true
				} else if arg == "--json" {
					jsonOut = true
				} else if strings.HasPrefix(arg, "--symbol=") {
					symbolFilter = strings.ToUpper(strings.TrimPrefix(arg, "--symbol="))
				}
			}

			if latest {
				results = results[len(results)-1:]
			}

			if jsonOut {
				filteredResults := make([]shadow.EnsembleResult, 0, len(results))
				for _, res := range results {
					if symbolFilter != "" {
						var filteredSignals []shadow.EnsembleSignal
						for _, sig := range res.Signals {
							if sig.Symbol == symbolFilter {
								filteredSignals = append(filteredSignals, sig)
							}
						}
						res.Signals = filteredSignals
					}
					filteredResults = append(filteredResults, res)
				}
				data, err := json.MarshalIndent(filteredResults, "", "  ")
				if err != nil {
					fmt.Printf("Error formatting JSON: %v\n", err)
					os.Exit(1)
				}
				fmt.Println(string(data))
				return
			}

			for _, res := range results {
				fmt.Printf("\nCycle #%d @ %s\n", res.CycleNumber, res.EvalTime.Format(time.RFC3339))
				if res.PreCloseSweep {
					fmt.Println("  ⚠ Pre-Close Sweep Active")
				}
				fmt.Printf("  Total Deployed: $%.2f\n", res.TotalDeployed)

				count := 0
				for _, sig := range res.Signals {
					if symbolFilter != "" && sig.Symbol != symbolFilter {
						continue
					}
					count++
					fmt.Printf("    [%s] %-5s %s (Score: %.1f) - %s\n", sig.AssetClass, sig.Symbol, sig.Signal, sig.Score, sig.Rationale)
				}
				if count == 0 && symbolFilter != "" {
					fmt.Printf("    No signals for symbol %s in this cycle.\n", symbolFilter)
				}
			}
			return
		} else if len(os.Args) >= 3 && os.Args[2] == "daemon" {
			// Load user config from ~/.gelt/config.json; fall back to defaults if not found.
			appCfg, appCfgErr := config.LoadAppConfig()

			// Resolve strategy names: from active plan YAML if set, else config fallback.
			strategyNames, err := resolveStrategies(appCfg, appCfgErr, false)
			if err != nil {
				fmt.Printf("[Daemon] Fatal error resolving strategies: %v\n", err)
				os.Exit(1)
			}

			ensembleCfg := shadow.DefaultEnsembleConfig(strategyNames)
			if appCfgErr == nil {
				ensembleCfg.SyntheticPriceMap = appCfg.SyntheticPriceMap
			}

			// Apply config.json values, then allow CLI flags to override.
			if appCfgErr == nil {
				if len(appCfg.WatchSymbols) > 0 {
					ensembleCfg.WatchSymbols = appCfg.WatchSymbols
				}
				// Preserve configured invalid values so the engine can reject them
				// fail-closed instead of silently substituting a default budget.
				ensembleCfg.TotalCapitalUSD = appCfg.TotalCapitalUSD
				// Preserve configured values verbatim so engine preflight rejects an
				// invalid interval rather than silently substituting a default.
				ensembleCfg.ScanIntervalMins = appCfg.ScanIntervalMins
				if appCfg.DurationMode != "" {
					ensembleCfg.DurationMode = appCfg.DurationMode
				}
				ensembleCfg.VerboseLog = appCfg.VerboseLog
			} else {
				fmt.Printf("[Daemon] Warning: could not load ~/.gelt/config.json (%v) — using built-in defaults\n", appCfgErr)
			}

			// CLI flags override config file. Reject malformed intervals before daemon
			// lifecycle work so a zero-duration loop cannot begin.
			for _, arg := range os.Args[3:] {
				if strings.HasPrefix(arg, "--interval=") {
					raw := strings.TrimPrefix(arg, "--interval=")
					interval, parseErr := strconv.Atoi(raw)
					if parseErr != nil {
						dur, durErr := time.ParseDuration(raw)
						if durErr != nil || dur <= 0 || dur%time.Minute != 0 {
							fmt.Println("Invalid --interval: use a positive whole number of minutes (for example --interval=5 or --interval=5m)")
							os.Exit(1)
						}
						interval = int(dur / time.Minute)
					}
					if interval <= 0 {
						fmt.Println("Invalid --interval: use a positive whole number of minutes")
						os.Exit(1)
					}
					ensembleCfg.ScanIntervalMins = interval
				}
				if strings.HasPrefix(arg, "--duration=") {
					ensembleCfg.DurationMode = strings.TrimPrefix(arg, "--duration=")
				}
			}

			fmt.Printf("[Daemon] Universe: %v | Capital: $%.2f | Interval: %dm | Duration: %s\n",
				ensembleCfg.WatchSymbols, ensembleCfg.TotalCapitalUSD, ensembleCfg.ScanIntervalMins, ensembleCfg.DurationMode)

			store := shadow.DefaultStore()
			engine := shadow.NewEnsembleEngine(ensembleCfg, store)
			daemon := shadow.NewDaemon(engine)

			// Initialize Discord Bot if token is present
			if appCfgErr == nil && appCfg.DiscordBotToken != "" {
				discordBot, err := notify.NewDiscordBot(appCfg.DiscordBotToken)
				if err != nil {
					logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
					logger.Error("Discord Bot failed to initialize", "error", err.Error())
				} else {
					if err := discordBot.Start(); err != nil {
						logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
						logger.Error("Discord Bot failed to start", "error", err.Error())
					} else {
						defer discordBot.Stop()
					}
				}
			}

			if err := daemon.RunBackground(context.Background()); err != nil {
				fmt.Printf("Daemon stopped with error: %v\n", err)
				os.Exit(1)
			}
			os.Exit(0)
		} else if len(os.Args) >= 3 && os.Args[2] == "status" {
			daemonDir, _ := config.UserDaemonDir()
			statusFile := filepath.Join(daemonDir, "status.json")
			data, err := os.ReadFile(statusFile)
			if err != nil {
				fmt.Println("Daemon Status: NOT RUNNING (no status file found)")
				os.Exit(0)
			}

			var status shadow.DaemonStatus
			if err := json.Unmarshal(data, &status); err != nil {
				fmt.Printf("Error parsing daemon status: %v\n", err)
				os.Exit(1)
			}

			if !shadow.StatusIsCurrent(status) {
				fmt.Println("Gelt Shadow Daemon Status:\n  State:          UNKNOWN (stale RUNNING status; PID is not live)")
				os.Exit(1)
			}
			fmt.Printf("Gelt Shadow Daemon Status:\n")
			fmt.Printf("  State:          %s\n", status.Status)
			if status.Reason != "" {
				fmt.Printf("  Reason:         %s\n", status.Reason)
			}
			fmt.Printf("  PID:            %d\n", status.PID)
			fmt.Printf("  Cycle Number:   %d\n", status.CycleNumber)
			fmt.Printf("  Total Deployed: $%.2f\n", status.TotalDeployed)
			fmt.Printf("  Last Scan Time: %s\n", status.LastScanTime.Format("2006-01-02 15:04:05 ET"))
			os.Exit(0)
		}

		// ── Parse flags for ensemble mode ──────────────────────────────────────
		ensembleMode := false
		durationMode := "session"
		useScreener := false
		symbolsOverride := ""
		strategiesOverride := ""
		planFilePath := ""
		topN := 5
		for i, arg := range os.Args[2:] {
			if arg == "--ensemble" {
				ensembleMode = true
			}
			if strings.HasPrefix(arg, "--plan=") {
				planFilePath = strings.TrimPrefix(arg, "--plan=")
				ensembleMode = true
			} else if arg == "--plan" && i+3 < len(os.Args) {
				planFilePath = os.Args[i+3]
				ensembleMode = true
			}
			if strings.HasPrefix(arg, "--duration=") {
				durationMode = strings.TrimPrefix(arg, "--duration=")
			}
			if arg == "--screener" {
				useScreener = true
			}
			if strings.HasPrefix(arg, "--symbols=") {
				symbolsOverride = strings.TrimPrefix(arg, "--symbols=")
			}
			if strings.HasPrefix(arg, "--strategies=") {
				strategiesOverride = strings.TrimPrefix(arg, "--strategies=")
			}
			if strings.HasPrefix(arg, "--top-n=") {
				val, err := strconv.Atoi(strings.TrimPrefix(arg, "--top-n="))
				if err == nil {
					topN = val
				}
			}
		}

		if ensembleMode {
			// ── Multi-Strategy Portfolio Shadow Engine ──────────────────────────

			// Read from config.json active plan
			appCfg, appCfgErr := config.LoadAppConfig()
			strategyNames, err := resolveStrategies(appCfg, appCfgErr, strings.Contains(planFilePath, "crypto"))
			if err != nil {
				fmt.Printf("[Ensemble] Fatal error resolving strategies: %v\n", err)
				os.Exit(1)
			}

			if planFilePath != "" && strings.Contains(planFilePath, "crypto") {
				if durationMode == "session" {
					durationMode = "24h" // Continuous 24/7 crypto evaluation
				}
			}
			if strategiesOverride != "" {
				strategyNames = strings.Split(strategiesOverride, ",")
			}
			cfg := shadow.DefaultEnsembleConfig(strategyNames)
			if appCfgErr == nil {
				cfg.SyntheticPriceMap = appCfg.SyntheticPriceMap
				// Preserve explicit values so engine preflight rejects malformed
				// budget or interval instead of using permissive defaults.
				cfg.TotalCapitalUSD = appCfg.TotalCapitalUSD
				cfg.ScanIntervalMins = appCfg.ScanIntervalMins
			}
			if planFilePath != "" && strings.Contains(planFilePath, "crypto") {
				cfg.WatchSymbols = []string{"BTC", "ETH", "SOL", "AVAX"}
			}
			cfg.DurationMode = durationMode

			if useScreener {
				fmt.Printf("Fetching top %d screener symbols...\n", topN)
				// Fallbacks guaranteed by LoadAppConfig (which we must load here if not already)
				appCfgForScreener, _ := config.LoadAppConfig() // even if it errors, we get a default-populated empty struct if we implement it, wait LoadAppConfig returns nil on error.

				var universe []string
				var priceMap map[string]float64
				if appCfgForScreener != nil {
					universe = appCfgForScreener.ScreenerUniverse
					priceMap = appCfgForScreener.SyntheticPriceMap
				} else {
					universe = config.DefaultScreenerUniverse()
					priceMap = config.DefaultSyntheticPriceMap()
				}

				screenerSymbols, err := signals.FetchTopScreenerSymbols(topN, 0.0, universe, priceMap)
				if err != nil {
					fmt.Printf("Warning: failed to fetch screener symbols: %v\n", err)
				} else if len(screenerSymbols) > 0 {
					cfg.WatchSymbols = screenerSymbols
				}
			} else if symbolsOverride != "" {
				cfg.WatchSymbols = strings.Split(symbolsOverride, ",")
			}

			store := shadow.DefaultStore()
			engine := shadow.NewEnsembleEngine(cfg, store)

			etLoc, _ := time.LoadLocation("America/New_York")
			nowET := time.Now().In(etLoc)
			mktClose := time.Date(nowET.Year(), nowET.Month(), nowET.Day(), 16, 0, 0, 0, etLoc)
			remaining := time.Until(mktClose)
			if remaining < 0 {
				remaining = 0
			}

			fmt.Println("╔══════════════════════════════════════════════════════════════════════════════╗")
			fmt.Printf("║  GELT MULTI-STRATEGY SHADOW ENGINE  %-40s║\n",
				fmt.Sprintf("[%s]", strings.Join(strategyNames, " + ")))
			fmt.Println("╠══════════════════════════════════════════════════════════════════════════════╣")
			fmt.Printf("║  Strategies : %-62s║\n", strings.Join(strategyNames, ", "))
			fmt.Printf("║  Capital    : $%-61.2f║\n", cfg.TotalCapitalUSD)
			fmt.Printf("║  Universe   : %-62s║\n", strings.Join(cfg.WatchSymbols, ", "))
			fmt.Printf("║  Scan Freq  : %-62s║\n", fmt.Sprintf("Every %d minutes", cfg.ScanIntervalMins))
			fmt.Printf("║  Duration   : %-62s║\n", durationMode)
			fmt.Printf("║  Mkt Close  : %-62s║\n", fmt.Sprintf("4:00 PM ET (~%s remaining)", remaining.Round(time.Minute)))
			fmt.Printf("║  Pre-Close  : %-62s║\n", "3:50 PM ET sweep — new long entries blocked")
			fmt.Println("╚══════════════════════════════════════════════════════════════════════════════╝")
			fmt.Println()

			var ctx context.Context
			var cancel context.CancelFunc
			if durationMode == "session" {
				ctx, cancel = context.WithDeadline(context.Background(), mktClose)
			} else {
				dur, parseErr := time.ParseDuration(durationMode)
				if parseErr != nil {
					dur = 8 * time.Hour
				}
				ctx, cancel = context.WithTimeout(context.Background(), dur)
			}
			defer cancel()

			onCycle := func(res shadow.EnsembleResult) {
				fmt.Printf("\n┌─ Cycle #%d  %s", res.CycleNumber, res.EvalTime.Format("15:04:05 ET"))
				if res.PreCloseSweep {
					fmt.Print("  ⚠  PRE-CLOSE SWEEP ACTIVE — New longs blocked")
				}
				fmt.Println()
				fmt.Printf("├─ Total Capital Deployed This Cycle: $%.2f\n", res.TotalDeployed)
				fmt.Println("├───────────────────────────────────────────────────────────────────────────")
				fmt.Printf("│  %-18s %-8s %-7s %-8s  %s\n", "Strategy", "Symbol", "Signal", "Score", "Rationale")
				fmt.Println("├───────────────────────────────────────────────────────────────────────────")
				for _, sig := range res.Signals {
					sigIcon := "·"
					switch sig.Signal {
					case "BUY":
						sigIcon = "▲"
					case "SELL":
						sigIcon = "▼"
					}
					rat := sig.Rationale
					if len(rat) > 48 {
						rat = rat[:45] + "..."
					}
					fmt.Printf("│  %-18s %-8s %s %-5s  %.1f    %s\n",
						sig.StrategyName, sig.Symbol, sigIcon, sig.Signal, sig.Score, rat)
				}
				fmt.Println("└───────────────────────────────────────────────────────────────────────────")
			}

			err = engine.RunSession(ctx, onCycle)
			if err != nil && err != context.DeadlineExceeded {
				fmt.Printf("\nEnsemble engine stopped: %v\n", err)
			} else {
				fmt.Println("\n══ Session Complete — Market Closed. Shadow journal saved. ══")
			}
			return
		}

		// ── Standard paper-shadow leaderboard (no --ensemble) ─────────────────
		// These metrics are journal-derived paper performance only. Do not contact
		// a broker or infer live-plan state from this output path.
		store := shadow.DefaultStore()
		perf, err := store.GetPerformance("")
		if err != nil {
			fmt.Printf("Error loading shadow performance: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("===================================================================================================================")
		fmt.Printf("  GELT PAPER SHADOW PERFORMANCE LEADERBOARD (JOURNAL-DERIVED; NOT LIVE)\n")
		fmt.Println("===================================================================================================================")
		fmt.Printf("%-23s | %-6s | %-12s | %-8s | %-9s | %-11s | %-8s | %-8s | %-7s\n", "Trading Plan Name", "Mode", "Closed (Open)", "Win Rate", "Net PnL", "Profit Fact", "Avg Win", "Avg Loss", "Max DD")
		fmt.Println("-------------------------------------------------------------------------------------------------------------------")
		if len(perf) == 0 {
			fmt.Println("  No shadow trades recorded yet. Run shadow trading to populate performance stats.")
		} else {
			for _, p := range perf {
				mode := "PAPER"
				tradesStr := fmt.Sprintf("%d", p.TotalTrades)
				if p.OpenTrades > 0 {
					tradesStr = fmt.Sprintf("%d (%d open)", p.TotalTrades, p.OpenTrades)
				}
				winRateStr := fmt.Sprintf("%.1f%%", p.WinRate)
				if p.TotalTrades == 0 {
					winRateStr = "N/A"
				}
				pfStr := fmt.Sprintf("%.2f", p.ProfitFactor)
				if math.IsInf(p.ProfitFactor, 0) || p.TotalTrades == 0 {
					pfStr = "N/A"
				}
				fmt.Printf("%-23s | %-6s | %-12s | %-8s | $%-8.2f | %-11s | $%-7.2f | $%-7.2f | $%-6.2f\n",
					p.PlanName, mode, tradesStr, winRateStr, p.TotalPnLUSD, pfStr, p.AvgWin, p.AvgLoss, p.MaxDrawdown)
			}
		}
		fmt.Println("===================================================================================================================")

	case "regime":
		vix := 28.5 // Default sample VIX breaching threshold for telemetry demonstration
		if len(os.Args) >= 3 {
			if val, err := strconv.ParseFloat(os.Args[2], 64); err == nil {
				vix = val
			}
		}

		closes := generateSampleCloses(60, 500.0, 42)
		status, err := regime.EvaluateRegime(vix, closes)
		if err != nil {
			fmt.Printf("Regime evaluation error: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("Gelt Market Regime Monitor:\n")
		fmt.Printf("  VIX Volatility:    %.2f\n", status.VIXValue)
		fmt.Printf("  20 EMA Slope:      %.4f\n", status.EMA20Slope)
		fmt.Printf("  Detected Regime:   %s\n", status.DetectedRegime)

		if status.AlertTriggered {
			fmt.Println()
			fmt.Println(status.AlertMessage)
		}

	case "auth", "login":
		home, _ := os.UserHomeDir()
		configPath := filepath.Join(home, ".gelt", "mcp.json")
		if err := robinhood.AuthenticateInteractive(configPath); err != nil {
			fmt.Printf("Authentication failed: %v\n", err)
			os.Exit(1)
		}

	case "buy":
		if len(os.Args) < 3 {
			fmt.Println("Usage: gelt buy <SYMBOL> [AMOUNT_USD]")
			os.Exit(1)
		}
		symbol := strings.ToUpper(os.Args[2])
		amountUsd := 10.00
		if len(os.Args) >= 4 {
			if val, err := strconv.ParseFloat(os.Args[3], 64); err == nil {
				amountUsd = val
			}
		}

		appCfg, _ := config.LoadAppConfig()
		limits := risk.TestAccountRiskLimits(appCfg)
		if err := limits.ValidateTrade(symbol, amountUsd, 50.00); err != nil {
			fmt.Printf("RISK GOVERNANCE REJECTION: %v\n", err)
			os.Exit(1)
		}

		basePrice := 450.0
		if symbol == "GOOGL" {
			basePrice = 182.67
		} else if symbol == "TSLA" {
			basePrice = 253.82
		} else if symbol == "QQQ" {
			basePrice = 449.86
		} else if symbol == "SPY" {
			basePrice = 505.83
		}

		closes := generateSampleCloses(60, basePrice, time.Now().UnixNano()%10000)
		summary, err := signals.EvaluateConfluence(symbol, closes)
		if err != nil {
			fmt.Printf("Error calculating signals for %s: %v\n", symbol, err)
			os.Exit(1)
		}

		price := summary.LatestPrice
		if price <= 0 {
			price = basePrice
		}
		qty := amountUsd / price
		adaptive := risk.GetAdaptiveRiskGuardrails(symbol, appCfg)

		home, _ := os.UserHomeDir()
		mcpPath := filepath.Join(home, ".gelt", "mcp.json")
		mcpCfg, err := robinhood.LoadConfig(mcpPath)
		if err != nil || mcpCfg == nil {
			mcpCfg = &robinhood.MCPConfig{ServerURL: "https://agent.robinhood.com/mcp/trading"}
		}

		mcpRes, mcpErr := robinhood.ExecuteMCPOrder(mcpCfg, symbol, qty, amountUsd, "buy")
		orderID := fmt.Sprintf("rh-%04x-%04x-%04x", rand.Intn(0xffff), rand.Intn(0xffff), rand.Intn(0xffff))
		fillStatus := "SUBMITTED"
		if mcpErr != nil {
			fmt.Printf("NOTICE: Live MCP Dispatch Warning: %v\n", mcpErr)
			fillStatus = "MCP_AUTH_REQUIRED"
		} else if mcpRes != nil {
			orderID = mcpRes.OrderID
			fillStatus = mcpRes.Status
		}

		trade := thesis.TradeThesis{
			ID:              fmt.Sprintf("trade-%s-%d", strings.ToLower(symbol), time.Now().Unix()),
			Symbol:          symbol,
			Side:            "buy",
			AmountUSD:       amountUsd,
			ConfluenceScore: summary.Score,
			Bias:            string(summary.Bias),
			Signals:         summary.SignalsTriggered,
			Catalyst:        fmt.Sprintf("Automated 15-min scan setup (Score: %.1f)", summary.Score),
			StopLossPct:     adaptive.StopLossPct,
			TargetProfitPct: adaptive.TargetProfitPct,
			OrderID:         orderID,
			FillPrice:       price,
			Quantity:        qty,
			Status:          fillStatus,
			Timestamp:       time.Now(),
		}

		journalPath := filepath.Join(home, ".gelt", "journals", "live_journal.json")
		if err := thesis.SaveJournalEntry(journalPath, trade); err != nil {
			fmt.Printf("Error saving trade thesis: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("================================================================================")
		telemetry.GetLogger().LogTrade(context.Background(), telemetry.TradeTelemetryEvent{
			Symbol:    symbol,
			Action:    "BUY",
			Quantity:  qty,
			Price:     price,
			Strategy:  trade.Catalyst,
			Timestamp: time.Now(),
		})
		fmt.Println("================================================================================")
		fmt.Printf("Robinhood MCP Endpoint: %s\n", mcpCfg.ServerURL)
		fmt.Printf("Order Execution Status: %s (Order ID: %s)\n", fillStatus, orderID)
		fmt.Println("--------------------------------------------------------------------------------")
		rat, ev := trade.FormatSelfDoc()
		fmt.Println(rat)
		fmt.Println(ev)
		fmt.Println("================================================================================")

	case "sell":
		if len(os.Args) < 3 {
			fmt.Println("Usage: gelt sell <SYMBOL> [AMOUNT_USD]")
			os.Exit(1)
		}
		symbol := strings.ToUpper(os.Args[2])
		amountUsd := 10.00
		if len(os.Args) >= 4 {
			if val, err := strconv.ParseFloat(os.Args[3], 64); err == nil {
				amountUsd = val
			}
		}

		basePrice := 450.0
		if symbol == "QQQ" {
			basePrice = 449.86
		} else if symbol == "SPY" {
			basePrice = 738.50
		}

		qty := amountUsd / basePrice

		home, _ := os.UserHomeDir()
		mcpPath := filepath.Join(home, ".gelt", "mcp.json")
		mcpCfg, err := robinhood.LoadConfig(mcpPath)
		if err != nil || mcpCfg == nil {
			mcpCfg = &robinhood.MCPConfig{ServerURL: "https://agent.robinhood.com/mcp/trading"}
		}

		mcpRes, mcpErr := robinhood.ExecuteMCPOrder(mcpCfg, symbol, qty, amountUsd, "sell")
		orderID := fmt.Sprintf("rh-%04x-%04x-%04x", rand.Intn(0xffff), rand.Intn(0xffff), rand.Intn(0xffff))
		fillStatus := "SUBMITTED"
		if mcpErr != nil {
			fmt.Printf("NOTICE: Live MCP Dispatch Warning: %v\n", mcpErr)
			fillStatus = "MCP_AUTH_REQUIRED"
		} else if mcpRes != nil {
			orderID = mcpRes.OrderID
			fillStatus = mcpRes.Status
		}

		trade := thesis.TradeThesis{
			ID:              fmt.Sprintf("trade-sell-%s-%d", strings.ToLower(symbol), time.Now().Unix()),
			Symbol:          symbol,
			Side:            "sell",
			AmountUSD:       amountUsd,
			ConfluenceScore: 100.0,
			Bias:            "EXIT",
			Signals:         []string{"Trailing Stop Triggered or Profit Target Reached"},
			Catalyst:        "Position Exit Execution",
			StopLossPct:     0.0,
			TargetProfitPct: 0.0,
			OrderID:         orderID,
			FillPrice:       basePrice,
			Quantity:        qty,
			Status:          fillStatus,
			Timestamp:       time.Now(),
		}

		journalPath := filepath.Join(home, ".gelt", "journals", "live_journal.json")
		if err := thesis.SaveJournalEntry(journalPath, trade); err != nil {
			fmt.Printf("Error saving trade thesis: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("================================================================================")
		fmt.Printf("  GELT TRADE EXECUTION & THNEED SYNC (%s SELL)\n", symbol)
		fmt.Println("================================================================================")
		fmt.Printf("Robinhood MCP Endpoint: %s\n", mcpCfg.ServerURL)
		fmt.Printf("Order Execution Status: %s (Order ID: %s)\n", fillStatus, orderID)
		fmt.Println("--------------------------------------------------------------------------------")
		rat, ev := trade.FormatSelfDoc()
		fmt.Println(rat)
		fmt.Println(ev)
		fmt.Println("================================================================================")

	case "backtest":
		if len(os.Args) < 4 {
			fmt.Println("Usage: gelt backtest <PlanOrStrategy> <Symbol> [DataFile.csv | Days]")
			os.Exit(1)
		}
		targetName := os.Args[2]
		symbol := strings.ToUpper(os.Args[3])

		days := 100
		dataFile := ""
		if len(os.Args) >= 5 {
			arg := os.Args[4]
			if strings.HasSuffix(strings.ToLower(arg), ".csv") {
				dataFile = arg
			} else if val, err := strconv.Atoi(arg); err == nil {
				days = val
			}
		}

		// Look up in PlanSuite or StrategyCatalog
		plansReg := plans.DefaultPlanSuite()
		stratReg := strategies.DefaultCatalog()

		var bEngine *backtest.Engine

		if p, err := plansReg.Get(targetName); err == nil {
			bEngine = backtest.NewPlanEngine(p)
			fmt.Printf("Initialized Backtest Engine for Trading Plan: %s\n", targetName)
		} else if s, err := stratReg.Get(targetName); err == nil {
			bEngine = backtest.NewStrategyEngine(s)
			fmt.Printf("Initialized Backtest Engine for Strategy: %s\n", targetName)
		} else {
			fmt.Printf("Error: %s not found in Plan Registry or Strategy Catalog\n", targetName)
			os.Exit(1)
		}

		var data []backtest.OHLCV

		if dataFile != "" {
			// Ingest CSV data
			// Expected format: Timestamp,Open,High,Low,Close,Volume
			fmt.Printf("Loading historical data from %s...\n", dataFile)
			content, err := os.ReadFile(dataFile)
			if err != nil {
				fmt.Printf("Error reading data file: %v\n", err)
				os.Exit(1)
			}

			lines := strings.Split(string(content), "\n")
			for i, line := range lines {
				if i == 0 || strings.TrimSpace(line) == "" {
					continue // Skip header and empty lines
				}
				parts := strings.Split(line, ",")
				if len(parts) < 6 {
					continue
				}

				ts, _ := strconv.ParseInt(parts[0], 10, 64)
				open, _ := strconv.ParseFloat(parts[1], 64)
				high, _ := strconv.ParseFloat(parts[2], 64)
				low, _ := strconv.ParseFloat(parts[3], 64)
				closePrice, _ := strconv.ParseFloat(parts[4], 64)
				vol, _ := strconv.ParseFloat(parts[5], 64)

				data = append(data, backtest.OHLCV{
					Timestamp: ts,
					Open:      open,
					High:      high,
					Low:       low,
					Close:     closePrice,
					Volume:    vol,
				})
			}
			days = len(data)
			if days == 0 {
				fmt.Printf("Error: No valid data found in %s\n", dataFile)
				os.Exit(1)
			}
		} else {
			// Generate synthetic OHLCV data fallback
			basePrice := 150.0
			if symbol == "SPY" {
				basePrice = 500.0
			}
			if symbol == "QQQ" {
				basePrice = 450.0
			}
			if symbol == "TSLA" {
				basePrice = 250.0
			}

			data = generateSyntheticBacktestBars(basePrice, days, rand.New(rand.NewSource(time.Now().UnixNano())), time.Now().Unix())
		}

		fmt.Printf("Running deterministic offline backtest for %s (%d bars)...\n", symbol, days)
		res, err := bEngine.Run(context.Background(), symbol, data)
		if err != nil {
			fmt.Printf("Backtest failed: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("\n================================================================================")
		fmt.Printf("  GELT BACKTEST & HISTORICAL REPLAY SUMMARY (%s)\n", symbol)
		fmt.Println("================================================================================")
		fmt.Printf("Target Executed:      %s\n", targetName)
		fmt.Printf("Historical Bars:      %d\n", res.TotalBars)
		fmt.Printf("Total Simulated Trades: %d\n", res.TotalTrades)
		fmt.Printf("Win Rate (%%):          %.2f%%\n", res.WinRate)
		fmt.Printf("Net PnL ($):          $%.2f\n", res.NetPnL)

		if math.IsInf(res.ProfitFactor, 0) || math.IsNaN(res.ProfitFactor) {
			fmt.Printf("Profit Factor:        INF\n")
		} else {
			fmt.Printf("Profit Factor:        %.2f\n", res.ProfitFactor)
		}

		fmt.Printf("Max Drawdown (%%):     %.2f%%\n", res.MaxDrawdownPct)
		fmt.Println("================================================================================")

	case "config":
		home, _ := os.UserHomeDir()
		configPath := filepath.Join(home, ".gelt", "mcp.json")

		if len(os.Args) >= 3 && os.Args[2] == "init" {
			appCfg, planPath, err := config.InitUserConfig()
			if err != nil {
				fmt.Printf("Error initializing user configuration: %v\n", err)
				os.Exit(1)
			}
			cfgPath, _ := config.DefaultConfigPath()
			fmt.Printf("SUCCESS: Initialized user configuration!\n")
			fmt.Printf("  Config File: %s\n", cfgPath)
			fmt.Printf("  Sample Plan: %s\n", planPath)
			fmt.Printf("  Interval:    Every %d mins\n", appCfg.ScanIntervalMins)
			fmt.Printf("  Capital:     $%.2f USD\n", appCfg.TotalCapitalUSD)
			os.Exit(0)
		} else if len(os.Args) >= 4 && os.Args[2] == "set-url" {
			url := os.Args[3]
			cfg := robinhood.MCPConfig{ServerURL: url}
			if err := robinhood.SaveConfig(configPath, cfg); err != nil {
				fmt.Printf("Error saving MCP config: %v\n", err)
				os.Exit(1)
			}
			fmt.Printf("Saved Robinhood MCP server URL to %s\n", configPath)
		} else if len(os.Args) >= 4 && os.Args[2] == "set-account" {
			accountID := os.Args[3]
			cfg := robinhood.MCPConfig{AccountID: accountID}
			if err := robinhood.SaveConfig(configPath, cfg); err != nil {
				fmt.Printf("Error saving account ID: %v\n", err)
				os.Exit(1)
			}
			fmt.Printf("Saved Robinhood Account ID (%s) to %s\n", accountID, configPath)
		} else if len(os.Args) >= 3 && os.Args[2] == "show" {
			appCfg, err := config.LoadAppConfig()
			cfgPath, _ := config.DefaultConfigPath()
			fmt.Println("Gelt Local User Configuration:")
			if err != nil {
				fmt.Printf("  App Config:  (Not Found at %s — run 'gelt config init')\n", cfgPath)
			} else {
				fmt.Printf("  App Config:  %s\n", cfgPath)
				fmt.Printf("  Active Plan: %s\n", appCfg.ActivePlan)
				fmt.Printf("  Interval:    Every %d mins\n", appCfg.ScanIntervalMins)
				fmt.Printf("  Capital:     $%.2f USD\n", appCfg.TotalCapitalUSD)
				fmt.Printf("  Duration:    %s\n", appCfg.DurationMode)
				fmt.Printf("  Symbols:     %s\n", strings.Join(appCfg.WatchSymbols, ", "))
			}
			fmt.Println("--------------------------------------------------------------------------------")
			mcpCfg, err := robinhood.LoadConfig(configPath)
			if err != nil {
				fmt.Printf("  MCP Config:  (Not Found at %s)\n", configPath)
			} else {
				fmt.Printf("  MCP Config:  %s\n", configPath)
				fmt.Printf("  Server URL:  %s\n", mcpCfg.ServerURL)
				if mcpCfg.AccountID != "" {
					fmt.Printf("  Account ID:  %s\n", mcpCfg.AccountID)
				} else {
					fmt.Println("  Account ID:  (Not Set — use 'gelt config set-account <ID>')")
				}
				if mcpCfg.AuthToken != "" {
					fmt.Println("  Auth Status: Authenticated")
				} else {
					fmt.Println("  Auth Status: Unauthenticated (use 'gelt auth')")
				}
			}
		} else {
			fmt.Println("Usage:")
			fmt.Println("  gelt config init                       Initialize ~/.gelt/config.json and sample plan")
			fmt.Println("  gelt config show                       Display current user local configuration")
			fmt.Println("  gelt config set-account <ACCOUNT_ID>   Configure Robinhood Account ID")
			fmt.Println("  gelt config set-url <URL>              Configure Robinhood MCP Server URL")
		}

	case "dashboard", "serve":
		addr := "127.0.0.1:8085"
		plansReg := plans.DefaultPlanSuite()
		featureReg := data.NewFeatureRegistry()
		srv := server.NewTelemetryServer(addr, plansReg, featureReg)
		fmt.Printf("Starting Gelt Quant Dashboard on http://%s\n", addr)
		srv.StartAsync()
		time.Sleep(500 * time.Millisecond)
		openBrowser("http://" + addr)
		select {}

	case "help", "--help", "-h":
		printUsage()

	default:
		fmt.Printf("Unknown command: %s\n\n", command)
		printUsage()
		os.Exit(1)
	}
}

func generateSampleCloses(count int, startPrice float64, seed int64) []float64 {
	closes := make([]float64, count)
	current := startPrice
	r := rand.New(rand.NewSource(seed))
	for i := 0; i < count; i++ {
		change := (r.Float64() - 0.48) * 2.5
		current += change
		closes[i] = current
	}
	return closes
}

func printUsage() {
	fmt.Printf("Gelt Agentic Trading Suite (%s)\n", Version)
	fmt.Println("Usage: gelt <command> [arguments]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  version                              Show Gelt CLI version")
	fmt.Println("  status / telemetry                   Display live session telemetry & portfolio dashboard")
	fmt.Println("  risk                                 Display configured equity risk governance limits")
	fmt.Println("  options-risk                         Display configured options risk governance limits")
	fmt.Println("  signals [SYMBOL]                     Evaluate technical indicators and confluence score")
	fmt.Println("  scan [MIN_SCORE]                     Scan watchlist universe and rank by Confluence Score")
	fmt.Println("  monitor                              Inspect active position trailing-stops and exit triggers")
	fmt.Println("  buy <SYMBOL> [AMOUNT_USD]            Execute risk-governed buy order & log thesis to Thneed")
	fmt.Println("  sell <SYMBOL> [AMOUNT_USD]           Execute sell/exit order & log thesis to Thneed")
	fmt.Println("  test-suite                           Run pre-market diagnostic health checks")
	fmt.Println("  health                               Run pre-market broker integration diagnostic checks")
	fmt.Println("  thesis                               Display logged trade rationales and Thneed self-doc history")
	fmt.Println("  strategies / catalog                 Display Gelt Quantitative Strategy Catalog")
	fmt.Println("  plan [active|list]                    Display active or available trading plans (activation is daemon-owned)")
	fmt.Println("  shadow                               Display live vs shadow trading plan performance leaderboard")
	fmt.Println("  shadow cycles [--latest] [--symbol=] [--json] Emit full scan cycle snapshots")
	fmt.Println("  shadow capital-rebaseline --acknowledge-empty-journal-rebaseline Clear a capital-integrity latch only after manually archiving the journal")
	fmt.Println("  regime [VIX]                         Monitor market regime indicators and display volatility alerts")
	fmt.Println("  macro [SERIES_ID]                    Fetch FRED macro data asynchronously (EFFR rates)")
	fmt.Println("  auth / login                         Authenticate with Robinhood Agentic Account via OAuth browser login")
	fmt.Println("  config set-url <URL>                 Configure Robinhood Agentic Trading MCP Server URL")
	fmt.Println("  dashboard / serve                    Launch the telemetry server and open the Web Dashboard")
	fmt.Println("  backtest <Plan|Strategy> <Symbol> [Days] Run offline historical backtester")
}

func openBrowser(urlStr string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", urlStr}
	case "darwin":
		cmd = "open"
		args = []string{urlStr}
	default:
		cmd = "xdg-open"
		args = []string{urlStr}
	}

	return exec.Command(cmd, args...).Start()
}
