package backtest

import (
	"context"
	"fmt"
	"math"
	"time"

	"gelt/pkg/plans"
	"gelt/pkg/risk"

	"gelt/pkg/strategies"
)

// OHLCV represents a single historical price bar.
type OHLCV struct {
	Timestamp int64
	Open      float64
	High      float64
	Low       float64
	Close     float64
	Volume    float64
}

// Result holds the performance summary of a backtest run.
type Result struct {
	TotalBars      int
	TotalTrades    int
	WinningTrades  int
	WinRate        float64
	NetPnL         float64
	ProfitFactor   float64
	MaxDrawdownPct float64
}

// Position tracks an active simulated paper trade.
type Position struct {
	EntryPrice float64
	Quantity   float64
	StopLoss   float64
	Target     float64
	PeakPrice  float64
}

// Engine encapsulates the backtester harness.
type Engine struct {
	strategy strategies.Strategy
	plan     plans.TradingPlan
}

// NewStrategyEngine creates a backtester for a single Strategy.
func NewStrategyEngine(s strategies.Strategy) *Engine {
	return &Engine{strategy: s}
}

// NewPlanEngine creates a backtester for a Trading Plan ensemble.
func NewPlanEngine(p plans.TradingPlan) *Engine {
	return &Engine{plan: p}
}

// validateHistoricalBars rejects malformed input before any strategy or plan evaluation.
func validateHistoricalBars(data []OHLCV) error {
	if len(data) == 0 {
		return fmt.Errorf("no historical data provided")
	}

	for i, bar := range data {
		if bar.Timestamp <= 0 {
			return fmt.Errorf("bar %d: timestamp must be positive Unix seconds", i)
		}
		if i > 0 && bar.Timestamp <= data[i-1].Timestamp {
			return fmt.Errorf("bar %d: timestamp %d is not after bar %d timestamp %d", i, bar.Timestamp, i-1, data[i-1].Timestamp)
		}

		values := []struct {
			name  string
			value float64
		}{
			{"open", bar.Open},
			{"high", bar.High},
			{"low", bar.Low},
			{"close", bar.Close},
			{"volume", bar.Volume},
		}
		for _, value := range values {
			if math.IsNaN(value.value) || math.IsInf(value.value, 0) {
				return fmt.Errorf("bar %d: %s must be finite", i, value.name)
			}
		}

		if bar.Open <= 0 || bar.High <= 0 || bar.Low <= 0 || bar.Close <= 0 {
			return fmt.Errorf("bar %d: OHLC prices must be positive", i)
		}
		if bar.Volume < 0 {
			return fmt.Errorf("bar %d: volume must be nonnegative", i)
		}
		if bar.Low > bar.Open || bar.Low > bar.Close || bar.Open > bar.High || bar.Close > bar.High || bar.Low > bar.High {
			return fmt.Errorf("bar %d: inconsistent OHLC bounds (require low <= open, close <= high and low <= high)", i)
		}
	}

	return nil
}

// Run executes the deterministic backtest over the provided OHLCV series.
func (e *Engine) Run(ctx context.Context, symbol string, data []OHLCV) (Result, error) {
	if err := validateHistoricalBars(data); err != nil {
		return Result{}, err
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var res Result
	res.TotalBars = len(data)

	var activePos *Position

	// Track cumulative PnL for drawdown calculation
	var peakAccountValue float64 = 10000.0 // Starting dummy capital
	accountValue := peakAccountValue

	grossProfit := 0.0
	grossLoss := 0.0

	for i := 1; i < len(data); i++ {
		// Provide history up to the current bar
		var closes []float64
		var volumes []float64
		for j := 0; j <= i; j++ {
			closes = append(closes, data[j].Close)
			volumes = append(volumes, data[j].Volume)
		}

		currentBar := data[i]
		barTime := time.Unix(currentBar.Timestamp, 0).UTC()

		// 1. Check open position for exit (Stop Loss or Profit Target)
		if activePos != nil {
			// Update peak price for trailing stop logic if needed (strategies handle their own SL, but we'll simulate basic hit)
			if currentBar.High > activePos.PeakPrice {
				activePos.PeakPrice = currentBar.High
			}

			// Update dynamic trailing stop-loss based on peak price and strategy StopLossPct
			// For this simulation, we'll maintain the initial percentage as trailing
			var trailingSlPct float64
			var targetPct float64

			if e.plan != nil {
				eval, _ := e.plan.Evaluate(ctx, barTime, symbol, closes, volumes)
				trailingSlPct = eval.StopLossPct
				targetPct = eval.TargetPct
			} else if e.strategy != nil {
				eval, _ := e.strategy.Evaluate(ctx, barTime, symbol, closes, volumes)
				trailingSlPct = eval.StopLossPct
				targetPct = eval.TargetPct
			}

			// Recalculate trailing stop based on PeakPrice
			if trailingSlPct > 0 {
				newStop := activePos.PeakPrice * (1.0 - (trailingSlPct / 100.0))
				if newStop > activePos.StopLoss {
					activePos.StopLoss = newStop
				}
			}
			if targetPct > 0 {
				activePos.Target = activePos.EntryPrice * (1.0 + (targetPct / 100.0))
			}

			// Simple check against low and high for stops and targets
			exitHit := false
			exitPrice := 0.0

			if activePos.StopLoss > 0 && currentBar.Low <= activePos.StopLoss {
				exitHit = true
				exitPrice = activePos.StopLoss // Simplistic execution at SL price
			} else if activePos.Target > 0 && currentBar.High >= activePos.Target {
				exitHit = true
				exitPrice = activePos.Target
			}

			if exitHit {
				pnl := (exitPrice - activePos.EntryPrice) * activePos.Quantity
				res.TotalTrades++
				res.NetPnL += pnl
				accountValue += pnl

				if pnl > 0 {
					res.WinningTrades++
					grossProfit += pnl
				} else {
					grossLoss -= pnl // keep it positive for profit factor
				}

				if accountValue > peakAccountValue {
					peakAccountValue = accountValue
				}

				drawdown := (peakAccountValue - accountValue) / peakAccountValue * 100.0
				if drawdown > res.MaxDrawdownPct {
					res.MaxDrawdownPct = drawdown
				}

				activePos = nil
				continue // Trade closed this bar, don't open a new one same bar to keep it simple
			}
		}

		// 2. Evaluate Signals
		var signal strategies.SignalType
		var slPct, targetPct float64

		// To avoid too many trades due to minimum periods of indicators, we check if enough data is present.
		// Strategies usually require at least 20 bars.
		if len(closes) < 20 {
			continue
		}

		if e.plan != nil {
			eval, err := e.plan.Evaluate(ctx, barTime, symbol, closes, volumes)
			if err != nil {
				continue
			}
			if eval.ConsensusSignal == strategies.SignalAgentReview {
				return res, fmt.Errorf("strategy contains AgentPrompts which are not supported in backtesting")
			}
			signal = eval.ConsensusSignal
			slPct = eval.StopLossPct
			targetPct = eval.TargetPct
		} else if e.strategy != nil {
			eval, err := e.strategy.Evaluate(ctx, barTime, symbol, closes, volumes)
			if err != nil {
				continue
			}
			if eval.Signal == strategies.SignalAgentReview {
				return res, fmt.Errorf("strategy contains AgentPrompts which are not supported in backtesting")
			}
			signal = eval.Signal
			slPct = eval.StopLossPct
			targetPct = eval.TargetPct
		} else {
			return res, fmt.Errorf("engine has no strategy or plan configured")
		}

		// 3. Execute Entry Signal
		if signal == strategies.SignalBuy && activePos == nil {
			// Calculate position size based on RiskProfile limits

			limits := risk.TestAccountRiskLimits(nil)
			tradeUsd := limits.MaxTradeUsd // Default to maximum allowed trade size
			entryPrice := currentBar.Close
			qty := tradeUsd / entryPrice

			stopPrice := entryPrice * (1.0 - (slPct / 100.0))
			targetPrice := entryPrice * (1.0 + (targetPct / 100.0))

			activePos = &Position{
				EntryPrice: entryPrice,
				Quantity:   qty,
				StopLoss:   stopPrice,
				Target:     targetPrice,
				PeakPrice:  entryPrice,
			}
		} else if signal == strategies.SignalSell && activePos != nil {
			// Explicit sell signal closes position
			exitPrice := currentBar.Close
			pnl := (exitPrice - activePos.EntryPrice) * activePos.Quantity
			res.TotalTrades++
			res.NetPnL += pnl
			accountValue += pnl

			if pnl > 0 {
				res.WinningTrades++
				grossProfit += pnl
			} else {
				grossLoss -= pnl
			}

			if accountValue > peakAccountValue {
				peakAccountValue = accountValue
			}

			drawdown := (peakAccountValue - accountValue) / peakAccountValue * 100.0
			if drawdown > res.MaxDrawdownPct {
				res.MaxDrawdownPct = drawdown
			}

			activePos = nil
		}
	}

	// Close out any remaining position at end of backtest
	if activePos != nil {
		exitPrice := data[len(data)-1].Close
		pnl := (exitPrice - activePos.EntryPrice) * activePos.Quantity
		res.TotalTrades++
		res.NetPnL += pnl

		if pnl > 0 {
			res.WinningTrades++
			grossProfit += pnl
		} else {
			grossLoss -= pnl
		}

		// No need to update max drawdown for last bar since backtest ends here,
		// but for exactness:
		accountValue += pnl
		if accountValue > peakAccountValue {
			peakAccountValue = accountValue
		}
		drawdown := (peakAccountValue - accountValue) / peakAccountValue * 100.0
		if drawdown > res.MaxDrawdownPct {
			res.MaxDrawdownPct = drawdown
		}
	}

	if res.TotalTrades > 0 {
		res.WinRate = (float64(res.WinningTrades) / float64(res.TotalTrades)) * 100.0
	}

	if grossLoss > 0 {
		res.ProfitFactor = grossProfit / grossLoss
	} else if grossProfit > 0 {
		res.ProfitFactor = math.Inf(1)
	} else {
		res.ProfitFactor = 0.0
	}

	return res, nil
}
