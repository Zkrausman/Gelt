package main

import (
	"context"
	"fmt"
	"gelt/pkg/backtest"
	"reflect"
	"strconv"
	"strings"
	"time"
)

func mean20CLIReferences(r backtest.Mean20ComparisonResult, bars []backtest.OHLCV) bool {
	n := len(bars)
	replay := r.Strategy.ReferenceReplay
	at := func(i int, t time.Time) bool {
		return i >= 0 && i < n && t.Equal(time.Unix(bars[i].Timestamp, 0).UTC())
	}
	for _, f := range replay.Fills {
		if !at(f.BarIndex, f.Timestamp) || f.BarIndex < 20 || f.EvaluationBarIndex < 19 || f.EvaluationBarIndex >= f.BarIndex || f.EntrySignalBarIndex < 19 || f.EntrySignalBarIndex >= n || f.EntryBarIndex != f.EntrySignalBarIndex+1 || f.EntryBarIndex >= n {
			return false
		}
	}
	for _, x := range r.Strategy.RejectedEntries {
		if !at(x.BarIndex, x.Timestamp) || x.BarIndex < 20 || x.EvaluationBarIndex != x.BarIndex-1 || !at(x.EvaluationBarIndex, x.EvaluationTimestamp) {
			return false
		}
	}
	if p := replay.TerminalPosition; p != nil {
		if !at(p.EntrySignalBarIndex, p.EntrySignalTimestamp) || p.EntrySignalBarIndex < 19 || !at(p.EntryBarIndex, p.EntryTimestamp) || p.EntryBarIndex != p.EntrySignalBarIndex+1 || p.LastBarIndex != n-1 || !at(p.LastBarIndex, p.LastTimestamp) || p.StopEvaluationBarIndex < -1 || p.StopEvaluationBarIndex >= n || p.TargetEvaluationBarIndex < -1 || p.TargetEvaluationBarIndex >= n {
			return false
		}
	}
	return true
}
func mean20WindowCLIResultValid(ctx context.Context, r backtest.Mean20WindowComparisonResult, full []backtest.OHLCV, symbol string, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	s, e, ok := windowCLISelection(ctx, full, w)
	if !ok {
		return false
	}
	offset := s - 20
	bars := full[offset:e]
	if !mean20CLIResultValid(ctx, r.Replay, bars, symbol, cash, scenario) || ctx.Err() != nil || !mean20CLIReferences(r.Replay, bars) {
		return false
	}
	initial, ok := comparisonCLIInputUnits(cash, fundedCLIMaxUnits)
	if !ok {
		return false
	}
	fixed, bps, target, ok := executionScenarioCLIDeclaration(r.Replay.Scenario)
	if !ok {
		return false
	}
	buy, buyOK := executionCLIAdverseRate(scenario.BuyAdverseBps)
	sell, sellOK := executionCLIAdverseRate(scenario.SellAdverseBps)
	if !buyOK || !sellOK || !windowReferenceEvents(ctx, bars, r.Replay.Strategy, initial, fixed, bps, target, buy, sell) {
		return false
	}
	strategy, ok := windowCLIScore(ctx, r.Replay.Strategy.ModelIdentity, r.Replay.Strategy.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(strategy.MaxCloseMarkDrawdown, r.Replay.Strategy.MaxCloseMarkDrawdown) {
		return false
	}
	flat, ok := windowCLIScore(ctx, r.Replay.Cash.ModelIdentity, r.Replay.Cash.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(flat.MaxCloseMarkDrawdown, r.Replay.Cash.MaxCloseMarkDrawdown) {
		return false
	}
	passive, ok := windowCLIScore(ctx, r.Replay.Passive.ModelIdentity, r.Replay.Passive.CloseMarks, initial, offset)
	if !ok || !reflect.DeepEqual(passive.MaxCloseMarkDrawdown, r.Replay.Passive.MaxCloseMarkDrawdown) {
		return false
	}
	expected := backtest.Mean20WindowComparisonResult{ModelIdentity: backtest.Mean20WindowComparisonModelIdentity, ReplayProfileIdentity: backtest.Mean20ComparisonModelIdentity, EvaluationPolicyIdentity: backtest.Mean20EvaluationPolicyIdentity, ResetPolicy: backtest.Mean20WindowResetPolicy, CadencePolicy: "bar_index_only_cadence_and_session_unqualified", IntradayEligibility: "unestablished", SelectionPolicy: backtest.WindowComparisonSelectionPolicy, DataLabel: backtest.CausalOfflineLabel, AuthorityLabel: backtest.CausalOfflineLabel, SelectionHistory: "unestablished", Window: w, SourceTotalBars: len(full), WarmupStartSourceIndex: offset, ScoreStartSourceIndex: s, ScoreEndExclusiveSourceIndex: e, ExcludedBeforeWarmupCount: offset, ExcludedAfterScoreCount: len(full) - e, WarmupBars: 20, ScoredBars: e - s, ConsumedBars: e - offset, Replay: r.Replay, Strategy: strategy, Cash: flat, Passive: passive}
	return reflect.DeepEqual(r, expected) && ctx.Err() == nil
}
func mean20WindowCLISummary(ctx context.Context, r backtest.Mean20WindowComparisonResult, full []backtest.OHLCV, symbol string, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) (string, bool) {
	if !mean20WindowCLIResultValid(ctx, r, full, symbol, w, cash, scenario) {
		return "", false
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Evaluation policy: %s; reset: %s; BB20 x2; RSI14 thresholds 35/65; ATR proxy14 stop/target 0.5/1.5; chop 0.015/14; defaults uncalibrated. Intraday eligibility and selection history unestablished.\n", r.EvaluationPolicyIdentity, r.ResetPolicy)
	fmt.Fprintf(&b, "Offline declared-window comparison: %s\nPolicy: %s; symbol: %s\nStart inclusive: %d; end exclusive: %d\nSource bars: %d; warmup: %d; scored: %d; consumed: %d; excluded before warmup: %d; after score: %d\nSource warmup start: %d; score start: %d; score end exclusive: %d; source index = replay index + %d; scored index = replay index - 20\nData/authority: unqualified_offline; declared_window; selection_history_unestablished; assumptions: uncalibrated_declared\n", r.ModelIdentity, r.SelectionPolicy, symbol, w.StartInclusiveUnix, w.EndExclusiveUnix, r.SourceTotalBars, r.WarmupBars, r.ScoredBars, r.ConsumedBars, r.ExcludedBeforeWarmupCount, r.ExcludedAfterScoreCount, r.WarmupStartSourceIndex, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.WarmupStartSourceIndex)
	fmt.Fprintf(&b, "Initial model cash: %s; fee-inclusive entry cap: 10.00000000; fixed fee: %s; fee bps: %s; buy adverse bps: %s; sell adverse bps: %s\n", fundedCLIDecimal(r.Replay.InitialModelCashUnits), fundedCLIDecimal(r.Replay.Scenario.FixedFeeUnits), r.Replay.Scenario.FeeBps, r.Replay.Scenario.BuyAdverseBps, r.Replay.Scenario.SellAdverseBps)
	b.WriteString("Model | cash | open value | equity | realized PnL | unrealized PnL | net PnL | fees | quantity | maximum close-mark drawdown | DD source/scored indices\n")
	for _, x := range []backtest.WindowComparisonScore{r.Strategy, r.Cash, r.Passive} {
		dd := "undefined:" + x.MaxCloseMarkDrawdown.UndefinedReason
		if x.MaxCloseMarkDrawdown.Percent != nil {
			dd = fmt.Sprintf("%.8g%%", *x.MaxCloseMarkDrawdown.Percent)
		}
		source, scored := "none", "none"
		if x.DrawdownSourceBarIndex != nil {
			source = strconv.Itoa(*x.DrawdownSourceBarIndex)
			scored = strconv.Itoa(*x.DrawdownScoredBarIndex)
		}
		fmt.Fprintf(&b, "%s | %s | %s | %s | %s | %s | %s | %s | %.17g | %s | %s/%s\n", x.ModelIdentity, fundedCLIDecimal(x.EndingCashUnits), fundedCLIDecimal(x.EndingPositionValueUnits), fundedCLIDecimal(x.EndingEquityUnits), fundedCLIDecimal(x.NetRealizedAccountingPnLUnits), fundedCLIDecimal(x.NetUnrealizedAccountingPnLUnits), fundedCLIDecimal(x.NetAccountingPnLUnits), fundedCLIDecimal(x.AggregateFeeUnits), x.EndingModelQuantity, dd, source, scored)
	}
	fmt.Fprintf(&b, "Passive entry: %s; first eligible replay index20/source %d\n", r.Replay.Passive.EntryStatus, r.ScoreStartSourceIndex)
	if e := r.Replay.Passive.Entry; e != nil {
		fmt.Fprintf(&b, "Passive required debit: %s; principal: %s; entry fee: %s; available cash: %s; reference price: %.17g; execution price: %.17g\n", fundedCLIDecimal(e.RequiredModelCashUnits), fundedCLIDecimal(e.PrincipalUnits), fundedCLIDecimal(e.FeeUnits), fundedCLIDecimal(e.AvailableModelCashUnits), e.ReferencePrice, e.ExecutionPrice)
	}
	fmt.Fprintf(&b, "Strategy terminal position open: %t; final directional signal unfilled: %t; closed trades: %d\nEnding equity strategy minus cash: %s; minus passive: %s\n", r.Replay.Strategy.ReferenceReplay.TerminalPosition != nil, r.Replay.Strategy.ReferenceReplay.PendingSignalUnfilled, r.Replay.Strategy.ReferenceReplay.ClosedTradeCount, fundedCLIDecimal(r.Replay.StrategyMinusCashUnits), fundedCLIDecimal(r.Replay.StrategyMinusPassiveUnits))
	b.WriteString("Controls do not evaluate strategies. Passive holds to the final scored close with no protection, rebalancing or terminal sale; SELL costs apply only to a SELL. Exposure, protection and turnover differ. No ranking, edge, profitability, untouched-data or qualification claim.\nOriginal OHLC reference events are checked conditional on normalized signals; indicator calculations and input authenticity are not independently verified.\n")
	return b.String(), b.Len() <= 8192
}
