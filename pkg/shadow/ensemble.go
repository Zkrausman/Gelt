// Package shadow provides parallel paper forward-testing for inactive Gelt Trading Plans.
package shadow

import (
	"context"
	"errors"
	"fmt"
	"gelt/pkg/config"
	"gelt/pkg/notify"
	"gelt/pkg/plans"
	"gelt/pkg/robinhood"
	"gelt/pkg/strategies"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// EnsembleConfig controls the Multi-Strategy Shadow Portfolio Engine.
type EnsembleConfig struct {
	// StrategyNames is the ordered list of strategy names to run in ensemble.
	StrategyNames []string
	// TotalCapitalUSD is the unified capital budget shared across all strategies.
	TotalCapitalUSD float64
	// CapitalSplitPct is the fractional budget allocation per strategy (0.0-1.0).
	// If nil, capital is split evenly among strategies.
	CapitalSplitPct []float64
	// WatchSymbols is the universe of symbols each strategy evaluates.
	WatchSymbols      []string
	SyntheticPriceMap map[string]float64
	// ScanIntervalMins is how often (in minutes) the engine re-scans all symbols.
	ScanIntervalMins int
	// DurationMode controls when the engine stops: "session" = market close, or a duration string e.g. "2h".
	DurationMode string
	// VerboseLog enables per-tick console output.
	VerboseLog bool
	// MCPConfig is the authenticated Robinhood MCP client config for live quote fetching.
	// If nil or unauthenticated, the engine falls back to synthetic prices.
	MCPConfig       *robinhood.MCPConfig
	Slippage        config.SlippageConfig
	AIFailurePolicy string
	AIMaxRetries    int
	Catalog         *strategies.Registry
}

// DefaultEnsembleConfig returns a sensible production default for two strategies.
// It automatically loads the authenticated Robinhood MCP config if present.
func DefaultEnsembleConfig(strategyNames []string) EnsembleConfig {
	home, _ := os.UserHomeDir()
	mcpPath := filepath.Join(home, ".gelt", "mcp.json")
	mcpCfg, _ := robinhood.LoadConfig(mcpPath)
	appCfg, err := config.LoadAppConfig()
	var slip config.SlippageConfig
	if err == nil {
		slip = appCfg.Slippage
	} else {
		slip = config.SlippageConfig{
			CryptoPct:  0.0015,
			EquityPct:  0.0003,
			OptionsPct: 0.025,
		}
	}
	policy := "disable_strategy"
	retries := 3
	if err == nil && appCfg != nil {
		if appCfg.AIFailurePolicy != "" {
			policy = appCfg.AIFailurePolicy
		}
		if appCfg.AIMaxRetries >= 0 {
			retries = appCfg.AIMaxRetries
		}
	}
	return EnsembleConfig{
		StrategyNames:     strategyNames,
		TotalCapitalUSD:   50.00,
		WatchSymbols:      []string{"SPY", "QQQ", "NVDA", "TSLA", "GOOGL"},
		SyntheticPriceMap: config.DefaultSyntheticPriceMap(),
		ScanIntervalMins:  15,
		DurationMode:      "session",
		VerboseLog:        true,
		MCPConfig:         mcpCfg,
		Slippage:          slip,
		AIFailurePolicy:   policy,
		AIMaxRetries:      retries,
		Catalog:           strategies.DefaultCatalog(),
	}
}

// EnsembleSignal is a single evaluated signal from one strategy for one symbol.
type EnsembleSignal struct {
	LastPrice      float64
	StrategyName   string
	AssetClass     string
	Symbol         string
	Signal         string // "BUY", "SELL", "HOLD"
	Score          float64
	Rationale      string
	AllocatedUSD   float64
	StopLossPct    float64
	TargetPct      float64
	EvalTime       time.Time
	IsIntradayOnly bool
}

// EnsembleResult summarises one full scan cycle across all strategies.
type EnsembleResult struct {
	CycleNumber                int
	EvalTime                   time.Time
	Signals                    []EnsembleSignal
	TotalDeployed              float64
	PreCloseSweep              bool // true if the 3:50 PM ET gate fired this cycle
	CapitalReservationDegraded bool `json:"capital_reservation_degraded"`
}

// EnsembleEngine orchestrates concurrent multi-strategy shadow evaluation.
type EnsembleEngine struct {
	cfg          EnsembleConfig
	store        *Store
	timeFunc     func() time.Time
	loadLocation func(string) (*time.Location, error)
	disabledMu   sync.RWMutex
	disabled     map[string]bool

	// Test-only seams. Production must obtain validated provider data; it never
	// fabricates indicators, quotes, or bars.
	fetchIndicatorsOverride   func(symbol string) (LiveIndicators, error)
	fetchProviderBarsOverride func(symbol string) ([]ProviderBar, error)
	sendTradeAlert            func(planName, symbol, side, eventType string, entryPrice, exitPrice, pnlUSD, pnlPct float64)
	verbosef                  func(format string, args ...any) (int, error)
}

// NewEnsembleEngine constructs an EnsembleEngine with the given config.
func NewEnsembleEngine(cfg EnsembleConfig, store *Store) *EnsembleEngine {
	return &EnsembleEngine{cfg: cfg, store: store, loadLocation: time.LoadLocation, disabled: make(map[string]bool), sendTradeAlert: notify.SendTradeAlert, verbosef: fmt.Printf}
}

func (e *EnsembleEngine) alert(t ShadowTrade, eventType string) {
	e.sendTradeAlert(t.PlanName, t.Symbol, t.Side, eventType, t.EntryPrice, t.ExitPrice, t.PnLUSD, t.PnLPct)
}

func (e *EnsembleEngine) verbose(format string, args ...any) {
	if e.cfg.VerboseLog && e.verbosef != nil {
		_, _ = e.verbosef(format, args...)
	}
}

func totalPersistedOpenDeployment(trades []ShadowTrade) float64 {
	var total float64
	for _, trade := range trades {
		if trade.Status == "OPEN" {
			total += trade.AmountUSD
		}
	}
	return total
}
func (e *EnsembleEngine) getSlippagePct(assetClass string) float64 {
	switch strings.ToUpper(assetClass) {
	case "CRYPTO":
		return e.cfg.Slippage.CryptoPct
	case "OPTIONS":
		return e.cfg.Slippage.OptionsPct
	default:
		return e.cfg.Slippage.EquityPct
	}
}

// validateCapitalConfiguration rejects malformed budget allocation before any
// journal, provider, alert, or telemetry operation. Explicit splits must cover
// the complete budget exactly (within floating-point tolerance).
func (e *EnsembleEngine) validateCapitalConfiguration() error {
	const maxScanIntervalMinutes = int64(math.MaxInt64 / int64(time.Minute))
	if e.cfg.ScanIntervalMins <= 0 || int64(e.cfg.ScanIntervalMins) > maxScanIntervalMinutes {
		return fmt.Errorf("shadow scan interval must be a positive duration representable in nanoseconds")
	}
	if !isValidReservationAmount(e.cfg.TotalCapitalUSD) {
		return fmt.Errorf("shadow capital configuration requires a positive finite total budget")
	}
	for _, pct := range []float64{e.cfg.Slippage.CryptoPct, e.cfg.Slippage.EquityPct, e.cfg.Slippage.OptionsPct} {
		if math.IsNaN(pct) || math.IsInf(pct, 0) || pct < 0 || pct >= 1 {
			return fmt.Errorf("shadow slippage requires finite percentages in [0,1)")
		}
	}
	n := len(e.cfg.StrategyNames)
	if n == 0 || len(e.cfg.CapitalSplitPct) == 0 {
		return nil
	}
	if len(e.cfg.CapitalSplitPct) != n {
		return fmt.Errorf("shadow capital split count %d does not match strategy count %d", len(e.cfg.CapitalSplitPct), n)
	}
	var total float64
	for _, pct := range e.cfg.CapitalSplitPct {
		if !isValidReservationAmount(pct) {
			return fmt.Errorf("shadow capital split requires positive finite percentages")
		}
		total += pct
	}
	if math.Abs(total-1) > 1e-9 {
		return fmt.Errorf("shadow capital splits sum to %.12g, want 1", total)
	}
	return nil
}

// perStrategyCapital returns the capital slice, defaulting to even split.
func (e *EnsembleEngine) perStrategyCapital() []float64 {
	n := len(e.cfg.StrategyNames)
	if n == 0 {
		return nil
	}
	caps := make([]float64, n)
	if len(e.cfg.CapitalSplitPct) == n {
		for i, pct := range e.cfg.CapitalSplitPct {
			caps[i] = e.cfg.TotalCapitalUSD * pct
		}
	} else {
		evenShare := e.cfg.TotalCapitalUSD / float64(n)
		for i := range caps {
			caps[i] = evenShare
		}
	}
	return caps
}

const (
	providerSource        = "robinhood-mcp"
	marketDataFreshness   = 10 * time.Minute
	minimumEvaluationBars = 60
	maximumMarketValue    = 1e9
)

// LiveIndicators holds provider-computed values and their provider timestamp.
// ProviderTime is required so state changes cannot be driven by stale data.
type LiveIndicators struct {
	LastPrice    float64
	EMA20        float64
	EMA50        float64
	RSI14        float64
	VWAP         float64
	ATR          float64
	ProviderTime time.Time
	Source       string
}

// ProviderBar is one provider historical OHLCV bar. Shadow evaluation only
// receives these bars after their source, values, ordering, and recency pass validation.
type ProviderBar struct {
	BeginsAt time.Time
	Close    float64
	Volume   float64
	Source   string
}

// fetchLiveIndicators retrieves a real MCP quote and all required, timestamped
// technical indicators. It never substitutes an indicator for a quote.
func (e *EnsembleEngine) fetchLiveIndicators(symbol string) (LiveIndicators, error) {
	if e.fetchIndicatorsOverride != nil {
		ind, err := e.fetchIndicatorsOverride(symbol)
		if err != nil {
			return LiveIndicators{}, err
		}
		if err := validateLiveIndicators(ind, e.now()); err != nil {
			return LiveIndicators{}, err
		}
		return ind, nil
	}

	cfg := e.cfg.MCPConfig
	if cfg == nil || cfg.AuthToken == "" || cfg.ServerURL == "" {
		return LiveIndicators{}, fmt.Errorf("market data unavailable: missing or unauthenticated MCP config")
	}
	type result struct {
		ind *robinhood.TechnicalIndicatorResult
		err error
	}
	ch := make(chan struct {
		key string
		res result
	}, 5)
	for _, req := range []struct {
		key, typ string
		period   int
	}{
		{"ema20", "ema", 20},
		{"ema50", "ema", 50},
		{"rsi", "rsi", 14},
		{"vwap", "vwap", 0},
		{"atr", "atr", 14},
	} {
		req := req
		go func() {
			ind, err := robinhood.FetchTechnicalIndicator(cfg, symbol, req.typ, "5minute", req.period)
			ch <- struct {
				key string
				res result
			}{req.key, result{ind, err}}
		}()
	}
	values := make(map[string]float64, 5)
	var oldest time.Time
	for range 5 {
		r := <-ch
		if r.res.err != nil || r.res.ind == nil {
			return LiveIndicators{}, fmt.Errorf("market data unavailable: %s indicator fetch failed", r.key)
		}
		timestamp, err := time.Parse(time.RFC3339, r.res.ind.Latest.BeginsAt)
		if err != nil {
			return LiveIndicators{}, fmt.Errorf("market data unavailable: invalid %s provider timestamp: %w", r.key, err)
		}
		if oldest.IsZero() || timestamp.Before(oldest) {
			oldest = timestamp
		}
		values[r.key] = r.res.ind.Latest.Value
	}
	quote, err := robinhood.FetchLiveQuote(cfg, symbol)
	if err != nil || quote == nil {
		return LiveIndicators{}, fmt.Errorf("market data unavailable: live quote fetch failed")
	}
	ind := LiveIndicators{
		LastPrice: quote.LastPrice, EMA20: values["ema20"], EMA50: values["ema50"],
		RSI14: values["rsi"], VWAP: values["vwap"], ATR: values["atr"],
		ProviderTime: oldest, Source: providerSource,
	}
	if err := validateLiveIndicators(ind, e.now()); err != nil {
		return LiveIndicators{}, err
	}
	return ind, nil
}

func validateLiveIndicators(ind LiveIndicators, now time.Time) error {
	if ind.Source != providerSource {
		return fmt.Errorf("market data unavailable: unverified indicator source %q", ind.Source)
	}
	if ind.ProviderTime.IsZero() || ind.ProviderTime.After(now.Add(marketDataFreshness)) || now.Sub(ind.ProviderTime) > marketDataFreshness {
		return fmt.Errorf("market data unavailable: stale or invalid provider timestamp")
	}
	for name, value := range map[string]float64{
		"quote": ind.LastPrice, "ema20": ind.EMA20, "ema50": ind.EMA50,
		"vwap": ind.VWAP, "atr": ind.ATR,
	} {
		if !isSensiblePositive(value) {
			return fmt.Errorf("market data unavailable: invalid %s value", name)
		}
	}
	if math.IsNaN(ind.RSI14) || math.IsInf(ind.RSI14, 0) || ind.RSI14 <= 0 || ind.RSI14 > 100 {
		return fmt.Errorf("market data unavailable: invalid rsi value")
	}
	return nil
}

func isSensiblePositive(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0 && value <= maximumMarketValue
}

// fetchValidatedProviderBars requires actual historical OHLCV. The currently
// supported MCP contract exposes timestamped indicators but no OHLCV series, so
// production deliberately fails closed until that provider capability is added.
func (e *EnsembleEngine) fetchValidatedProviderBars(symbol string) ([]ProviderBar, error) {
	if e.fetchProviderBarsOverride == nil {
		return nil, fmt.Errorf("market data unavailable: verified provider historical OHLCV is unavailable")
	}
	bars, err := e.fetchProviderBarsOverride(symbol)
	if err != nil {
		return nil, err
	}
	if err := validateProviderBars(bars, e.now()); err != nil {
		return nil, err
	}
	return bars, nil
}

func validateProviderBars(bars []ProviderBar, now time.Time) error {
	if len(bars) < minimumEvaluationBars {
		return fmt.Errorf("market data unavailable: insufficient verified provider bars")
	}
	allSameClose, allSameVolume := true, true
	for i, bar := range bars {
		if bar.Source != providerSource || bar.BeginsAt.IsZero() || !isSensiblePositive(bar.Close) || !isSensiblePositive(bar.Volume) {
			return fmt.Errorf("market data unavailable: invalid provider OHLCV bar")
		}
		if i > 0 {
			if !bar.BeginsAt.After(bars[i-1].BeginsAt) {
				return fmt.Errorf("market data unavailable: unordered provider OHLCV bars")
			}
			allSameClose = allSameClose && bar.Close == bars[0].Close
			allSameVolume = allSameVolume && bar.Volume == bars[0].Volume
		}
	}
	latest := bars[len(bars)-1].BeginsAt
	if latest.After(now.Add(marketDataFreshness)) || now.Sub(latest) > marketDataFreshness {
		return fmt.Errorf("market data unavailable: stale provider OHLCV bars")
	}
	if allSameClose && allSameVolume {
		return fmt.Errorf("market data unavailable: synthetic/repeated provider OHLCV bars")
	}
	return nil
}

func (e *EnsembleEngine) fetchValidatedMarketData(symbol string) (LiveIndicators, []ProviderBar, error) {
	ind, err := e.fetchLiveIndicators(symbol)
	if err != nil {
		return LiveIndicators{}, nil, err
	}
	bars, err := e.fetchValidatedProviderBars(symbol)
	if err != nil {
		return LiveIndicators{}, nil, err
	}
	return ind, bars, nil
}

// scanSymbol runs all strategies against a single symbol concurrently, returning signals.
func (e *EnsembleEngine) scanSymbol(ctx context.Context, symbol string, caps []float64) ([]EnsembleSignal, error) {
	var mu sync.Mutex
	var wg sync.WaitGroup

	results := make([]EnsembleSignal, 0, len(e.cfg.StrategyNames))
	now := e.now()
	// Both current values and verified provider OHLCV are required before any
	// strategy or plan is allowed to evaluate.
	indics, bars, err := e.fetchValidatedMarketData(symbol)
	if err != nil {
		return nil, err
	}
	for i, name := range e.cfg.StrategyNames {
		wg.Add(1)
		go func(stratName string, budget float64) {
			defer wg.Done()
			var sig, rationale, aClass string
			var slPct, tpPct float64
			var isIntradayOnly bool
			var evalErr error
			e.disabledMu.RLock()
			isDisabled := e.disabled[stratName]
			e.disabledMu.RUnlock()
			if isDisabled {
				return
			}
			maxRetries := e.cfg.AIMaxRetries
			if maxRetries < 0 {
				maxRetries = 0
			}
			for attempt := 0; attempt <= maxRetries; attempt++ {
				sig, rationale, aClass, slPct, tpPct, isIntradayOnly, evalErr = evaluateStrategyLive(stratName, symbol, bars, now, e.cfg.Catalog)
				if evalErr == nil {
					break
				}
				if attempt < maxRetries {
					time.Sleep(100 * time.Millisecond)
				}
			}
			if evalErr != nil {
				if e.cfg.AIFailurePolicy == "disable_strategy" {
					e.disabledMu.Lock()
					e.disabled[stratName] = true
					e.disabledMu.Unlock()
					fmt.Printf("[AI FAILURE] Strategy %s disabled due to recurring API errors: %v\n", stratName, evalErr)
					sig = "HOLD"
					rationale = "AI bridge failed, strategy disabled"
				} else if e.cfg.AIFailurePolicy == "exit" || e.cfg.AIFailurePolicy == "halt_daemon" {
					fmt.Printf("[AI FAILURE] Halting daemon due to recurring API errors: %v\n", evalErr)
					e.disabledMu.Lock()
					e.disabled["__FATAL_EXIT__"] = true
					e.disabledMu.Unlock()
					return
				} else if e.cfg.AIFailurePolicy == "alert_and_hold" {
					fmt.Printf("[AI FAILURE] Alert: Strategy %s encountered recurring API errors: %v\n", stratName, evalErr)
					sig = "HOLD"
					rationale = "AI bridge failed, holding"
				}
			}
			mu.Lock()
			results = append(results, EnsembleSignal{
				LastPrice:      indics.LastPrice,
				StrategyName:   stratName,
				AssetClass:     aClass,
				Symbol:         symbol,
				Signal:         sig,
				Score:          scoreForSignal(sig),
				Rationale:      rationale,
				AllocatedUSD:   budget,
				StopLossPct:    slPct,
				TargetPct:      tpPct,
				EvalTime:       now,
				IsIntradayOnly: isIntradayOnly,
			})
			mu.Unlock()
		}(name, caps[i])
	}
	wg.Wait()

	e.disabledMu.RLock()
	doExit := e.disabled["__FATAL_EXIT__"]
	e.disabledMu.RUnlock()
	if doExit {
		return nil, fmt.Errorf("AI failure policy requested daemon halt")
	}

	return results, nil
}

func (e *EnsembleEngine) persistCycle(cycle int, now time.Time, signals []EnsembleSignal, preClose, capitalReservationDegraded bool, onCycle func(EnsembleResult)) error {
	var result EnsembleResult
	if err := e.store.withMutation(e.store.filePath, func() error {
		if err := e.store.verifyCapitalReservationLocked(e.cfg.TotalCapitalUSD); err != nil {
			if errors.Is(err, ErrShadowCapitalDegraded) && !errors.Is(err, ErrShadowIdentityDegraded) && !errors.Is(err, ErrShadowRebaselinePending) && !errors.Is(err, ErrShadowJournalHalted) {
				capitalReservationDegraded = true
			} else {
				return err
			}
		}
		if err := e.store.haltStateLocked(); err != nil {
			return err
		}
		trades, err := e.store.loadTrades()
		if err != nil {
			return fmt.Errorf("load journal before cycle result: %w", err)
		}
		capitalState, err := e.store.loadCapitalReservationState()
		if err != nil {
			return fmt.Errorf("load capital reservation state before cycle result: %w", err)
		}
		result = EnsembleResult{CycleNumber: cycle, EvalTime: now, Signals: signals, TotalDeployed: totalPersistedOpenDeployment(trades), PreCloseSweep: preClose, CapitalReservationDegraded: capitalReservationDegraded || capitalState.Degraded}
		results, err := e.store.loadCycles()
		if err != nil {
			return fmt.Errorf("load cycles before append: %w", err)
		}
		results = append(results, result)
		if err := marshalAndReplace(e.store.cyclesFilePath, results, e.store.replace); err != nil {
			return err
		}
		// Publish while the journal snapshot remains locked. A rebaseline or
		// reservation cannot make this durable cycle stale before its callback.
		if onCycle != nil {
			onCycle(result)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("persist coherent shadow cycle: %w", err)
	}
	return nil
}

// RunSession runs the ensemble engine until session end or context cancellation.
// It calls onCycle (if non-nil) after every successfully persisted, final cycle state.
func (e *EnsembleEngine) RunSession(ctx context.Context, onCycle func(EnsembleResult)) error {
	if err := e.validateCapitalConfiguration(); err != nil {
		return err
	}
	// Pre-close and session gates depend on ET in every duration mode; do not
	// mutate the journal or emit alerts using a substituted clock.
	sessionET, err := e.loadLocation("America/New_York")
	if err != nil {
		return fmt.Errorf("load America/New_York session location: %w", err)
	}
	interval := time.Duration(e.cfg.ScanIntervalMins) * time.Minute
	caps := e.perStrategyCapital()
	cycle := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		cycle++
		now := e.now()
		// Fail closed before reading or mutating the journal, fetching market data,
		// emitting alerts, or persisting a cycle when the configured budget is invalid.
		capitalReservationDegraded := false
		if err := e.store.VerifyCapitalReservation(e.cfg.TotalCapitalUSD); err != nil {
			if errors.Is(err, ErrShadowCapitalDegraded) {
				// Identity-corrupt records cannot be conditionally updated without
				// risking an ambiguous mutation. Other capital latches preserve MTM
				// and liquidation but block all new BUYs.
				if errors.Is(err, ErrShadowIdentityDegraded) || errors.Is(err, ErrShadowRebaselinePending) || errors.Is(err, ErrShadowJournalHalted) {
					slog.Error("shadow capital reservation is halt-class degraded; halting session without journal mutation", "error", err)
					return fmt.Errorf("shadow capital reservation halt-class degradation: %w", err)
				}
				capitalReservationDegraded = true
				slog.Warn("shadow capital reservation is degraded; entries will be blocked", "error", err)
			} else {
				return fmt.Errorf("verify shadow capital reservation: %w", err)
			}
		}
		// ── Mark-to-Market (MTM) Sweep ──────────────────────────────────────────
		trades, err := e.store.Load()
		if err != nil {
			slog.Error("shadow journal load failed; halting session", "error", err)
			return fmt.Errorf("load shadow journal: %w", err)
		}
		{
			var expectedOpenTrades, openTradesToUpdate []ShadowTrade
			for _, t := range trades {
				if t.Status == "OPEN" {
					expectedOpenTrades = append(expectedOpenTrades, t)
					ind, _, err := e.fetchValidatedMarketData(t.Symbol)
					if err != nil {
						return fmt.Errorf("fetch market data for open trade %q: %w", t.ID, err)
					}
					if ind.LastPrice > 0 {
						if ind.LastPrice > t.PeakPrice {
							t.PeakPrice = ind.LastPrice
						}
						t.PnLUSD = (ind.LastPrice - t.EntryPrice) * t.Quantity
						if t.EntryPrice > 0 {
							t.PnLPct = ((ind.LastPrice - t.EntryPrice) / t.EntryPrice) * 100.0
						}
						var exitPrice float64
						var closed bool
						stopPrice := t.PeakPrice * (1.0 - (t.StopLossPct / 100.0))
						targetPrice := t.EntryPrice * (1.0 + (t.TargetPct / 100.0))
						if t.StopLossPct > 0 && ind.LastPrice <= stopPrice {
							exitPrice = ind.LastPrice
							closed = true
						} else if t.TargetPct > 0 && ind.LastPrice >= targetPrice {
							exitPrice = ind.LastPrice
							closed = true
						}
						if closed {
							t.Status = "CLOSED"
							slippagePct := e.getSlippagePct(t.AssetClass)
							t.MarketPrice = exitPrice
							fillPrice := exitPrice * (1 - slippagePct)
							t.ExitPrice = fillPrice
							t.FillPrice = fillPrice
							t.SlippageUSD += math.Abs(fillPrice-exitPrice) * t.Quantity
							t.ExitTime = now
							t.PnLUSD = (fillPrice - t.EntryPrice) * t.Quantity
							if t.EntryPrice > 0 {
								t.PnLPct = ((fillPrice - t.EntryPrice) / t.EntryPrice) * 100.0
							}
						}
						openTradesToUpdate = append(openTradesToUpdate, t)
					}
				}
			}
			if len(openTradesToUpdate) > 0 {
				if err := e.store.updateTradesIfCurrent(expectedOpenTrades, openTradesToUpdate); err != nil {
					slog.Error("shadow mark-to-market persistence failed; halting session", "error", err)
					return fmt.Errorf("persist mark-to-market updates: %w", err)
				}
				for _, t := range openTradesToUpdate {
					if t.Status == "CLOSED" {
						e.verbose("[SHADOW] Trade %s closed after persisted update. Entry: %.2f, Exit: %.2f, PnL: $%.2f (%.2f%%)\n", t.ID, t.EntryPrice, t.ExitPrice, t.PnLUSD, t.PnLPct)
						e.alert(t, "persisted exit")
					}
				}
			}
		}
		// ── 3:50 PM ET Pre-Close Sweep ──────────────────────────────────────────
		// Convert current time to ET for the intraday gate check.
		nowET := now
		if sessionET != nil {
			nowET = now.In(sessionET)
		}
		preClose := nowET.Weekday() != time.Saturday && nowET.Weekday() != time.Sunday && nowET.Hour() == 15 && nowET.Minute() >= 50
		// Session mode may stay alive overnight solely to mark crypto trades.
		// Keep non-crypto entries inside the fixed regular equity window; market
		// holiday and early-close handling remains intentionally deferred to ZAR-204.
		equityClosed := nowET.Weekday() == time.Saturday || nowET.Weekday() == time.Sunday || nowET.Hour() < 9 || (nowET.Hour() == 9 && nowET.Minute() < 30) || nowET.Hour() >= 16
		// Liquidate OPEN positions generated by strategies with IntradayOnly == true
		if preClose {
			trades, err := e.store.Load()
			if err != nil {
				slog.Error("shadow pre-close journal load failed; halting session", "error", err)
				return fmt.Errorf("load pre-close journal: %w", err)
			}
			{
				var expectedToUpdate, toUpdate []ShadowTrade
				for _, t := range trades {
					if t.Status == "OPEN" && t.IntradayOnly && !strings.EqualFold(t.AssetClass, "CRYPTO") {
						expectedToUpdate = append(expectedToUpdate, t)
						ind, _, err := e.fetchValidatedMarketData(t.Symbol)
						if err != nil {
							return fmt.Errorf("fetch market data for pre-close trade %q: %w", t.ID, err)
						}
						t.Status = "CLOSED"
						slippagePct := e.getSlippagePct(t.AssetClass)
						t.MarketPrice = ind.LastPrice
						fillPrice := ind.LastPrice * (1 - slippagePct)
						t.ExitPrice = fillPrice
						t.FillPrice = fillPrice
						t.SlippageUSD += math.Abs(fillPrice-ind.LastPrice) * t.Quantity
						t.ExitTime = now
						t.PnLUSD = (fillPrice - t.EntryPrice) * t.Quantity
						if t.EntryPrice > 0 {
							t.PnLPct = ((fillPrice - t.EntryPrice) / t.EntryPrice) * 100.0
						}
						toUpdate = append(toUpdate, t)
					}
				}
				if len(toUpdate) > 0 {
					if err := e.store.updateTradesIfCurrent(expectedToUpdate, toUpdate); err != nil {
						slog.Error("shadow pre-close persistence failed; halting session", "error", err)
						return fmt.Errorf("persist pre-close updates: %w", err)
					}
					for _, t := range toUpdate {
						e.verbose("[SHADOW] Trade %s liquidated at 15:50 ET after persisted update. Entry: %.2f, Exit: %.2f, PnL: $%.2f (%.2f%%)\n", t.ID, t.EntryPrice, t.ExitPrice, t.PnLUSD, t.PnLPct)
						e.alert(t, "PRE_CLOSE_EXIT")
					}
				}
			}
		}
		var allSignals []EnsembleSignal
		for _, sym := range e.cfg.WatchSymbols {
			sigs, scanErr := e.scanSymbol(ctx, sym, caps)
			if scanErr != nil {
				return scanErr
			}
			for _, s := range sigs {
				if s.Signal == "BUY" {
					if e.cfg.DurationMode == "session" && equityClosed && !strings.EqualFold(s.AssetClass, "CRYPTO") {
						// Apply the off-RTH safety reason before duplicate detection so the
						// persisted signal truthfully records why entry was prohibited.
						s.Signal = "HOLD"
						s.Rationale = fmt.Sprintf("[EQUITY SESSION CLOSED] New non-crypto long entry blocked outside weekday 09:30-16:00 ET. %s", s.Rationale)
					} else {
						trades, err := e.store.Load()
						if err != nil {
							slog.Error("shadow entry journal load failed; halting session", "error", err)
							return fmt.Errorf("load shadow journal before entry: %w", err)
						}
						for _, t := range trades {
							if t.Status == "OPEN" && strings.EqualFold(t.PlanName, s.StrategyName) && strings.EqualFold(t.Symbol, sym) {
								s.Signal = "HOLD"
								s.Rationale = fmt.Sprintf("[%s] Position already OPEN for %s", s.StrategyName, sym)
								break
							}
						}
					}
				}
				if s.Signal == "BUY" {
					if preClose && !strings.EqualFold(s.AssetClass, "CRYPTO") {
						s.Signal = "HOLD"
						s.Rationale = "[PRE-CLOSE SWEEP] New long entry blocked after 15:50 ET. " + s.Rationale
					} else if strings.Contains(strings.ToLower(s.StrategyName), "aichoice") || strings.Contains(strings.ToLower(s.StrategyName), "ai_choice") {
						trades, err := e.store.Load()
						if err != nil {
							slog.Error("shadow AI-choice journal load failed; halting session", "error", err)
							return fmt.Errorf("load shadow journal for AI choice: %w", err)
						}
						openCount := 0
						for _, t := range trades {
							if t.Status == "OPEN" && (strings.EqualFold(t.PlanName, s.StrategyName) || strings.Contains(strings.ToLower(t.PlanName), "ai_choice")) {
								openCount++
							}
						}
						if openCount >= 2 {
							s.Signal = "HOLD"
							s.Rationale = "[AI CHOICE] Position limit reached (max 2 positions at a time)"
						}
					}
					if s.Signal == "BUY" {
						slippagePct := e.getSlippagePct(s.AssetClass)
						fillPrice := s.LastPrice * (1 + slippagePct)
						qty := s.AllocatedUSD / fillPrice
						// Record paper trade before claiming a successful entry.
						trade := ShadowTrade{
							ID:           fmt.Sprintf("shadow-%s-%s-%d", strings.ToLower(s.StrategyName), strings.ToLower(sym), now.UnixNano()),
							PlanName:     s.StrategyName,
							Symbol:       sym,
							AssetClass:   s.AssetClass,
							Side:         "buy",
							EntryPrice:   fillPrice,
							PeakPrice:    fillPrice,
							ExitPrice:    0,
							MarketPrice:  s.LastPrice,
							FillPrice:    fillPrice,
							Quantity:     qty,
							AmountUSD:    s.AllocatedUSD,
							PnLUSD:       0,
							PnLPct:       0,
							StopLossPct:  s.StopLossPct,
							TargetPct:    s.TargetPct,
							SlippagePct:  slippagePct,
							SlippageUSD:  math.Abs(fillPrice-s.LastPrice) * qty,
							Status:       "OPEN",
							IntradayOnly: s.IsIntradayOnly,
							SignalTime:   s.EvalTime,
							EntryTime:    now,
						}
						if err := e.store.ReserveTrade(trade, e.cfg.TotalCapitalUSD); err != nil {
							switch {
							case errors.Is(err, ErrInsufficientShadowCapital):
								s.Signal = "HOLD"
								s.Rationale = "[CAPITAL RESERVATION] Insufficient unreserved shadow capital. " + s.Rationale
							case errors.Is(err, ErrShadowCapitalDegraded):
								capitalReservationDegraded = true
								s.Signal = "HOLD"
								s.Rationale = "[CAPITAL RESERVATION DEGRADED] New entry blocked until an operator completes an empty-journal rebaseline. " + s.Rationale
								slog.Warn("shadow entry blocked by degraded capital reservation", "error", err, "symbol", sym, "plan", s.StrategyName)
							default:
								slog.Error("shadow entry reservation failed; halting session", "error", err, "symbol", sym, "plan", s.StrategyName)
								return fmt.Errorf("reserve shadow entry: %w", err)
							}
						} else {
							e.alert(trade, "BUY_SIGNAL")
						}
					}
				} else if s.Signal == "SELL" {
					trades, err := e.store.Load()
					if err != nil {
						slog.Error("shadow sell journal load failed; halting session", "error", err)
						return fmt.Errorf("load shadow journal before sell: %w", err)
					}
					{
						var expectedToUpdate, toUpdate []ShadowTrade
						for _, t := range trades {
							if t.Status == "OPEN" && t.Symbol == sym && t.PlanName == s.StrategyName {
								expectedToUpdate = append(expectedToUpdate, t)
								t.Status = "CLOSED"
								slippagePct := e.getSlippagePct(t.AssetClass)
								t.MarketPrice = s.LastPrice
								fillPrice := s.LastPrice * (1 - slippagePct)
								t.ExitPrice = fillPrice
								t.FillPrice = fillPrice
								t.SlippageUSD += math.Abs(fillPrice-s.LastPrice) * t.Quantity
								t.ExitTime = now
								t.PnLUSD = (fillPrice - t.EntryPrice) * t.Quantity
								if t.EntryPrice > 0 {
									t.PnLPct = ((fillPrice - t.EntryPrice) / t.EntryPrice) * 100.0
								}
								toUpdate = append(toUpdate, t)
							}
						}
						if len(toUpdate) > 0 {
							if err := e.store.updateTradesIfCurrent(expectedToUpdate, toUpdate); err != nil {
								slog.Error("shadow sell persistence failed; halting session", "error", err)
								return fmt.Errorf("persist sell updates: %w", err)
							}
							for _, t := range toUpdate {
								e.verbose("[SHADOW] Trade %s closed by SELL signal after persisted update. Entry: %.2f, Exit: %.2f, PnL: $%.2f (%.2f%%)\n", t.ID, t.EntryPrice, t.ExitPrice, t.PnLUSD, t.PnLPct)
								e.alert(t, "SELL_SIGNAL")
							}
						}
					}
				}
				allSignals = append(allSignals, s)
			}
		}
		// Check market-close exit condition for "session" mode before publishing the
		// cycle so telemetry only observes the final persisted state.
		if e.cfg.DurationMode == "session" {
			closeET := now.In(sessionET)
			if closeET.Hour() > 16 || (closeET.Hour() == 16 && closeET.Minute() >= 0) {
				// Force-close all remaining OPEN intraday shadow trades at 16:00 ET
				trades, err := e.store.Load()
				if err != nil {
					slog.Error("shadow end-of-day journal load failed; halting session", "error", err)
					return fmt.Errorf("load shadow journal for end-of-day: %w", err)
				}
				{
					var expectedToUpdate, toUpdate []ShadowTrade
					for _, t := range trades {
						if t.Status == "OPEN" && t.IntradayOnly && !strings.EqualFold(t.AssetClass, "CRYPTO") {
							expectedToUpdate = append(expectedToUpdate, t)
							ind, _, err := e.fetchValidatedMarketData(t.Symbol)
							if err != nil {
								return fmt.Errorf("fetch market data for end-of-day trade %q: %w", t.ID, err)
							}
							t.Status = "CLOSED"
							slippagePct := e.getSlippagePct(t.AssetClass)
							t.MarketPrice = ind.LastPrice
							fillPrice := ind.LastPrice * (1 - slippagePct)
							t.ExitPrice = fillPrice
							t.FillPrice = fillPrice
							t.SlippageUSD += math.Abs(fillPrice-ind.LastPrice) * t.Quantity
							t.ExitTime = now
							t.PnLUSD = (fillPrice - t.EntryPrice) * t.Quantity
							if t.EntryPrice > 0 {
								t.PnLPct = ((fillPrice - t.EntryPrice) / t.EntryPrice) * 100.0
							}
							toUpdate = append(toUpdate, t)
						}
					}
					if len(toUpdate) > 0 {
						if err := e.store.updateTradesIfCurrent(expectedToUpdate, toUpdate); err != nil {
							slog.Error("shadow end-of-day persistence failed; halting session", "error", err)
							return fmt.Errorf("persist end-of-day updates: %w", err)
						}
						for _, t := range toUpdate {
							e.verbose("[SHADOW] Trade %s force-closed at EoD after persisted update. Entry: %.2f, Exit: %.2f, PnL: $%.2f (%.2f%%)\n", t.ID, t.EntryPrice, t.ExitPrice, t.PnLUSD, t.PnLPct)
							e.alert(t, "END_OF_DAY_EXIT")
						}
					}
				}
				if err := e.persistCycle(cycle, now, allSignals, preClose, capitalReservationDegraded, onCycle); err != nil {
					slog.Error("shadow cycle persistence failed; halting session", "error", err)
					return err
				}
				trades, err = e.store.Load()
				if err != nil {
					slog.Error("shadow post-close journal load failed; halting session", "error", err)
					return fmt.Errorf("load shadow journal after end-of-day: %w", err)
				}
				for _, t := range trades {
					if t.Status == "OPEN" && strings.EqualFold(t.AssetClass, "CRYPTO") {
						goto nextCycle
					}
				}
				return nil // Equity market closed and no crypto position requires monitoring.
			}
		}
		if err := e.persistCycle(cycle, now, allSignals, preClose, capitalReservationDegraded, onCycle); err != nil {
			slog.Error("shadow cycle persistence failed; halting session", "error", err)
			return err
		}
	nextCycle:
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
		}
	}
}

// ── Strategy evaluation on verified provider OHLCV ───────────────────────────
// evaluateStrategyLive dispatches only provider-supplied historical closes and volumes.
func evaluateStrategyLive(stratName, symbol string, bars []ProviderBar, evalTime time.Time, cat *strategies.Registry) (signal, rationale, assetClass string, stopPct, targetPct float64, isIntradayOnly bool, err error) {
	if err := validateProviderBars(bars, evalTime); err != nil {
		return "HOLD", "", "", 0, 0, false, err
	}
	closes := make([]float64, len(bars))
	vols := make([]float64, len(bars))
	for i, bar := range bars {
		closes[i] = bar.Close
		vols[i] = bar.Volume
	}
	suite := plans.DefaultPlanSuite()
	if p, err := suite.Get(stratName); err == nil {
		res, err := p.Evaluate(context.Background(), evalTime, symbol, closes, vols)
		return string(res.ConsensusSignal), res.Rationale, string(res.AssetClass), res.StopLossPct, res.TargetPct, true, err
	}
	if cat != nil {
		if s, err := cat.Get(stratName); err == nil {
			res, err := s.Evaluate(context.Background(), evalTime, symbol, closes, vols)
			return string(res.Signal), res.Rationale, string(res.AssetClass), res.StopLossPct, res.TargetPct, s.IsIntradayOnly(), err
		}
	}
	return "HOLD", fmt.Sprintf("Unknown strategy/plan: %s", stratName), "EQUITY", 0.0, 0.0, false, nil
}

// scoreForSignal maps signal to a numeric score for display.
func scoreForSignal(sig string) float64 {
	switch sig {
	case "BUY":
		return 85.0
	case "SELL":
		return 30.0
	default:
		return 50.0
	}
}

// ── Inline lightweight indicator implementations ─────────────────────────────
func emaOf(prices []float64, period int) float64 {
	if len(prices) < period {
		return prices[len(prices)-1]
	}
	k := 2.0 / float64(period+1)
	ema := prices[0]
	for _, p := range prices[1:] {
		ema = p*k + ema*(1-k)
	}
	return ema
}
func rsiOf(prices []float64, period int) float64 {
	if len(prices) < period+1 {
		return 50.0
	}
	var gains, losses float64
	for i := len(prices) - period; i < len(prices); i++ {
		delta := prices[i] - prices[i-1]
		if delta > 0 {
			gains += delta
		} else {
			losses -= delta
		}
	}
	avgG := gains / float64(period)
	avgL := losses / float64(period)
	if avgL == 0 {
		return 100.0
	}
	rs := avgG / avgL
	return 100.0 - (100.0 / (1.0 + rs))
}
func vwapOf(closes, volumes []float64) float64 {
	n := len(closes)
	if n == 0 {
		return 0
	}
	var cumPV, cumV float64
	for i := 0; i < n; i++ {
		cumPV += closes[i] * volumes[i]
		cumV += volumes[i]
	}
	if cumV == 0 {
		return closes[n-1]
	}
	return cumPV / cumV
}
func (e *EnsembleEngine) now() time.Time {
	if e.timeFunc != nil {
		return e.timeFunc()
	}
	return time.Now()
}
