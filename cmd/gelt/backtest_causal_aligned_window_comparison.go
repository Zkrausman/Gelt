package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"gelt/pkg/backtest"
)

const alignedWindowCLIUsage = "Usage: gelt backtest-causal-aligned-window-compare <Symbol> <CSV> <StartInclusiveUnix> <EndExclusiveUnix> <InitialCash> <FixedFee> <FeeBps> <BuyBps> <SellBps>\n"

// These three private functions are fixed production routes. Tests can wrap
// them to count calls or supply failures; there is no caller-selectable family.
type alignedWindowRunners struct {
	Trend    func(context.Context, string, []backtest.OHLCV, backtest.DeclaredComparisonWindow, string, backtest.ExecutionScenario) (backtest.Trend50WindowComparisonResult, error)
	Breakout func(context.Context, string, []backtest.OHLCV, backtest.DeclaredComparisonWindow, string, backtest.ExecutionScenario) (backtest.WindowComparisonResult, error)
	Mean     func(context.Context, string, []backtest.OHLCV, backtest.DeclaredComparisonWindow, string, backtest.ExecutionScenario) (backtest.Mean20WindowComparisonResult, error)
}

func nativeAlignedWindowRunners() alignedWindowRunners {
	return alignedWindowRunners{
		Trend: backtest.RunTrend50WindowComparisonCausal,
		Breakout: func(ctx context.Context, symbol string, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario) (backtest.WindowComparisonResult, error) {
			engine, ok := newBacktestCausalEngine("BreakoutVol")
			if !ok {
				return backtest.WindowComparisonResult{}, &backtest.WindowComparisonError{Code: backtest.CausalInvalidEvaluator, BarIndex: -1}
			}
			return engine.RunWindowComparisonCausal(ctx, symbol, bars, w, cash, scenario)
		},
		Mean: backtest.RunMean20WindowComparisonCausal,
	}
}

func runBacktestCausalAlignedWindowComparison(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	return runAlignedWindowInput(ctx, args, stdout, stderr, func(path string) (io.ReadCloser, error) { return openOfflineCSV(path) }, parseBacktestCausalCSV, nativeAlignedWindowRunners())
}

// Production fixes the opener/parser above. The explicit private dependencies
// let disposable tests observe one admitted lifecycle, including close errors.
func runAlignedWindowInput(ctx context.Context, args []string, stdout, stderr io.Writer, open func(string) (io.ReadCloser, error), parse func(io.Reader) ([]backtest.OHLCV, error), runners alignedWindowRunners) int {
	if len(args) != 9 {
		return alignedWindowFail(stderr, "input", "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return alignedWindowFail(stderr, "input", "canceled")
	}
	f, err := open(args[1])
	if err != nil {
		return alignedWindowFail(stderr, "input", "input_file")
	}
	bars, parseErr := parse(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return alignedWindowFail(stderr, "input", "resource_limit")
		case causalCSVRead:
			return alignedWindowFail(stderr, "input", "input_file")
		default:
			return alignedWindowFail(stderr, "input", "invalid_csv")
		}
	}
	if closeErr != nil {
		return alignedWindowFail(stderr, "input", "input_file")
	}
	if ctx.Err() != nil {
		return alignedWindowFail(stderr, "input", "canceled")
	}
	start, ok := windowCLIUnix(args[2], true)
	if !ok {
		return alignedWindowFail(stderr, "input", "invalid_window")
	}
	end, ok := windowCLIUnix(args[3], false)
	if !ok {
		return alignedWindowFail(stderr, "input", "invalid_window")
	}
	return runAlignedWindowData(ctx, args[0], bars, backtest.DeclaredComparisonWindow{StartInclusiveUnix: start, EndExclusiveUnix: end}, args[4], backtest.ExecutionScenario{FixedFee: args[5], FeeBps: args[6], BuyAdverseBps: args[7], SellAdverseBps: args[8]}, stdout, stderr, runners)
}

func runAlignedWindowData(ctx context.Context, symbol string, bars []backtest.OHLCV, w backtest.DeclaredComparisonWindow, cash string, scenario backtest.ExecutionScenario, stdout, stderr io.Writer, runners alignedWindowRunners) int {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return alignedWindowFail(stderr, "input", "canceled")
	}
	original := append([]backtest.OHLCV(nil), bars...)
	var trendText, breakoutText, meanText string
	var baseline alignedWindowProjection
	// Each result's lifetime is confined to its phase: retain the bounded text
	// and shared-control projection rather than three strategy traces.
	{
		if runners.Trend == nil {
			return alignedWindowFail(stderr, "input", "replay_failed")
		}
		r, err := runners.Trend(ctx, symbol, append([]backtest.OHLCV(nil), original...), w, cash, scenario)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "TrendConfluence", "canceled")
		}
		if err != nil {
			family, code := alignedWindowNativeError("TrendConfluence", err)
			return alignedWindowFail(stderr, family, code)
		}
		text, ok := backtestCausalTrend50WindowComparisonSummary(ctx, r, original, symbol, w, cash, scenario)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "TrendConfluence", "canceled")
		}
		if !ok {
			return alignedWindowFail(stderr, "TrendConfluence", "invalid_result")
		}
		trendText = text
		facts := alignedWindowFacts{r.Window, r.SourceTotalBars, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.ScoredBars, r.Replay.Symbol, r.Replay.Scale, r.Replay.InitialModelCashUnits, r.Replay.CostIdentity, r.Replay.ScenarioBasis, r.DataLabel, r.AuthorityLabel, r.SelectionHistory, r.Replay.Scenario}
		baseline, ok = projectAlignedWindow(ctx, facts, r.Replay.Cash, r.Replay.Passive, r.Cash, r.Passive, 50)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "alignment", "canceled")
		}
		if !ok {
			return alignedWindowFail(stderr, "alignment", "invalid_result")
		}
	}
	{
		if runners.Breakout == nil {
			return alignedWindowFail(stderr, "input", "replay_failed")
		}
		r, err := runners.Breakout(ctx, symbol, append([]backtest.OHLCV(nil), original...), w, cash, scenario)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "BreakoutVol", "canceled")
		}
		if err != nil {
			family, code := alignedWindowNativeError("BreakoutVol", err)
			return alignedWindowFail(stderr, family, code)
		}
		text, ok := backtestCausalWindowComparisonSummary(ctx, r, original, symbol, w, cash, scenario)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "BreakoutVol", "canceled")
		}
		if !ok {
			return alignedWindowFail(stderr, "BreakoutVol", "invalid_result")
		}
		breakoutText = text
		facts := alignedWindowFacts{r.Window, r.SourceTotalBars, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.ScoredBars, r.Replay.Symbol, r.Replay.Scale, r.Replay.InitialModelCashUnits, r.Replay.CostIdentity, r.Replay.ScenarioBasis, r.DataLabel, r.AuthorityLabel, r.SelectionHistory, r.Replay.Scenario}
		projection, ok := projectAlignedWindow(ctx, facts, r.Replay.Cash, r.Replay.Passive, r.Cash, r.Passive, 20)
		equal := ok && alignedWindowEqual(ctx, baseline, projection)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "alignment", "canceled")
		}
		if !equal {
			return alignedWindowFail(stderr, "alignment", "invalid_result")
		}
	}
	{
		if runners.Mean == nil {
			return alignedWindowFail(stderr, "input", "replay_failed")
		}
		r, err := runners.Mean(ctx, symbol, append([]backtest.OHLCV(nil), original...), w, cash, scenario)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "MeanReversion", "canceled")
		}
		if err != nil {
			family, code := alignedWindowNativeError("MeanReversion", err)
			return alignedWindowFail(stderr, family, code)
		}
		text, ok := mean20WindowCLISummary(ctx, r, original, symbol, w, cash, scenario)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "MeanReversion", "canceled")
		}
		if !ok {
			return alignedWindowFail(stderr, "MeanReversion", "invalid_result")
		}
		meanText = text
		facts := alignedWindowFacts{r.Window, r.SourceTotalBars, r.ScoreStartSourceIndex, r.ScoreEndExclusiveSourceIndex, r.ScoredBars, r.Replay.Symbol, r.Replay.Scale, r.Replay.InitialModelCashUnits, r.Replay.CostIdentity, r.Replay.ScenarioBasis, r.DataLabel, r.AuthorityLabel, r.SelectionHistory, r.Replay.Scenario}
		projection, ok := projectAlignedWindow(ctx, facts, r.Replay.Cash, r.Replay.Passive, r.Cash, r.Passive, 20)
		equal := ok && alignedWindowEqual(ctx, baseline, projection)
		if ctx.Err() != nil {
			return alignedWindowFail(stderr, "alignment", "canceled")
		}
		if !equal {
			return alignedWindowFail(stderr, "alignment", "invalid_result")
		}
	}
	header := alignedWindowHeader(baseline.Facts)
	body, ok := assembleAlignedWindowReport(header, breakoutText, trendText, meanText)
	if ctx.Err() != nil {
		return alignedWindowFail(stderr, "output", "canceled")
	}
	if !ok {
		return alignedWindowFail(stderr, "output", "invalid_result")
	}
	if stdout != nil {
		n, err := stdout.Write([]byte(body))
		if err == nil && n == len(body) {
			return 0
		}
	}
	return alignedWindowFail(stderr, "output", "output_error")
}

func alignedWindowNativeCode(code string) bool {
	switch code {
	case "invalid_window", "insufficient_warmup", "invalid_result", "resource_limit", "invalid_model_cash", "invalid_execution_scenario", "insufficient_exit_fee_cash", "invalid_input", "invalid_symbol", "invalid_evaluator", "evaluator_identity", "evaluator_error", "plan_membership", "unsupported_condition", "numeric_range", "canceled":
		return true
	default:
		return false
	}
}

func alignedWindowNativeError(family string, err error) (string, string) {
	code := ""
	switch family {
	case "TrendConfluence":
		var failure *backtest.Trend50WindowComparisonError
		if errors.As(err, &failure) && failure != nil {
			code = string(failure.Code)
		}
	case "BreakoutVol":
		var failure *backtest.WindowComparisonError
		if errors.As(err, &failure) && failure != nil {
			code = string(failure.Code)
		}
	case "MeanReversion":
		var failure *backtest.Mean20WindowComparisonError
		if errors.As(err, &failure) && failure != nil {
			code = string(failure.Code)
		}
	}
	if !alignedWindowNativeCode(code) {
		return "input", "replay_failed"
	}
	return family, code
}

func alignedWindowFail(stderr io.Writer, family, code string) int {
	valid := false
	switch family {
	case "input":
		switch code {
		case "invalid_arguments", "input_file", "invalid_csv", "resource_limit", "invalid_window", "canceled", "replay_failed":
			valid = true
		}
	case "TrendConfluence", "BreakoutVol", "MeanReversion":
		valid = alignedWindowNativeCode(code)
	case "alignment":
		valid = code == "invalid_result" || code == "canceled"
	case "output":
		valid = code == "invalid_result" || code == "canceled" || code == "output_error"
	}
	if !valid {
		family, code = "input", "replay_failed"
	}
	body := "backtest-causal-aligned-window-compare: " + family + ": " + code + "\n"
	if family == "input" && code == "invalid_arguments" {
		body = alignedWindowCLIUsage + body
	}
	if !alignedWindowText(body, 512) {
		body = "backtest-causal-aligned-window-compare: input: replay_failed\n"
	}
	if stderr != nil {
		_, _ = stderr.Write([]byte(body))
	}
	return 1
}

type alignedWindowFacts struct {
	Window                                                                                backtest.DeclaredComparisonWindow
	SourceTotalBars, ScoreStart, ScoreEnd, ScoredBars                                     int
	Symbol                                                                                string
	Scale                                                                                 int
	InitialCash, CostIdentity, ScenarioBasis, DataLabel, AuthorityLabel, SelectionHistory string
	Scenario                                                                              backtest.ExecutionScenarioCausalDeclaration
}

type alignedWindowDrawdown struct {
	Defined         bool
	Loss, Peak      string
	Percent         float64
	HasBar          bool
	Bar             int
	UndefinedReason string
}

type alignedWindowMark struct {
	Value    backtest.ExecutionScenarioCausalCloseMark // drawdown is carried below
	Drawdown alignedWindowDrawdown
}

type alignedWindowControlFinal struct {
	Symbol                                                                      string
	Scale                                                                       int
	InitialCash, EntryStatus, Cash                                              string
	Quantity                                                                    float64
	Principal, EntryFee, Basis, Value, Equity, Realized, Unrealized, Fees, Peak string
}

type alignedWindowControl struct {
	Final    alignedWindowControlFinal
	Entry    *backtest.ComparisonControlEntry // reason removed, indices scored
	Marks    []alignedWindowMark
	Drawdown alignedWindowDrawdown
}

type alignedWindowScore struct {
	Value                backtest.WindowComparisonScore // identity/drawdown/index pointers removed
	Drawdown             alignedWindowDrawdown
	HasSource, HasScored bool
	Source, Scored       int
}

type alignedWindowProjection struct {
	Facts                   alignedWindowFacts
	Cash, Passive           alignedWindowControl
	CashScore, PassiveScore alignedWindowScore
}

// projectAlignedWindow only translates metadata from already validated native
// results. It computes no money, price, position, score or drawdown arithmetic.
func projectAlignedWindow(ctx context.Context, facts alignedWindowFacts, cash, passive backtest.ComparisonControlResult, cashScore, passiveScore backtest.WindowComparisonScore, warmup int) (alignedWindowProjection, bool) {
	if ctx.Err() != nil || (warmup != 20 && warmup != 50) || facts.SourceTotalBars < 51 || facts.SourceTotalBars > backtest.CausalMaxBars || facts.ScoreStart < 50 || facts.ScoreEnd > facts.SourceTotalBars || facts.ScoreEnd <= facts.ScoreStart || facts.ScoredBars != facts.ScoreEnd-facts.ScoreStart {
		return alignedWindowProjection{}, false
	}
	if cash.Symbol != facts.Symbol || passive.Symbol != facts.Symbol || cash.Scale != facts.Scale || passive.Scale != facts.Scale || cash.InitialModelCashUnits != facts.InitialCash || passive.InitialModelCashUnits != facts.InitialCash {
		return alignedWindowProjection{}, false
	}
	p := alignedWindowProjection{Facts: facts}
	var ok bool
	p.Cash, ok = projectAlignedWindowControl(ctx, cash, warmup, facts.ScoredBars, false)
	if !ok {
		return alignedWindowProjection{}, false
	}
	p.Passive, ok = projectAlignedWindowControl(ctx, passive, warmup, facts.ScoredBars, true)
	if !ok {
		return alignedWindowProjection{}, false
	}
	p.CashScore, ok = projectAlignedWindowScore(cashScore, warmup, facts.ScoredBars, facts.ScoreStart)
	if !ok {
		return alignedWindowProjection{}, false
	}
	p.PassiveScore, ok = projectAlignedWindowScore(passiveScore, warmup, facts.ScoredBars, facts.ScoreStart)
	return p, ok && ctx.Err() == nil
}

func projectAlignedWindowDrawdown(d backtest.FundedCausalDrawdown, warmup, total int) (alignedWindowDrawdown, bool) {
	if (warmup != 20 && warmup != 50) || total <= warmup || total > backtest.CausalMaxBars {
		return alignedWindowDrawdown{}, false
	}
	if d.LossUnits == nil || d.PeakEquityUnits == nil || d.Percent == nil {
		return alignedWindowDrawdown{UndefinedReason: d.UndefinedReason}, d.LossUnits == nil && d.PeakEquityUnits == nil && d.Percent == nil && d.BarIndex == nil && d.UndefinedReason == backtest.FundedZeroInitialEquity
	}
	if d.UndefinedReason != "" || (d.BarIndex == nil) != (*d.LossUnits == "0") {
		return alignedWindowDrawdown{}, false
	}
	p := alignedWindowDrawdown{Defined: true, Loss: *d.LossUnits, Peak: *d.PeakEquityUnits, Percent: *d.Percent}
	if d.BarIndex != nil {
		if *d.BarIndex < warmup || *d.BarIndex >= total {
			return alignedWindowDrawdown{}, false
		}
		p.HasBar, p.Bar = true, *d.BarIndex-warmup
	}
	return p, true
}

func projectAlignedWindowControl(ctx context.Context, r backtest.ComparisonControlResult, warmup, scored int, passive bool) (alignedWindowControl, bool) {
	if (warmup != 20 && warmup != 50) || scored < 1 || scored > backtest.CausalMaxBars-warmup {
		return alignedWindowControl{}, false
	}
	total := warmup + scored
	if scored < 1 || total > backtest.CausalMaxBars || r.TotalBars != total || len(r.CloseMarks) != total || (r.Entry != nil) != passive {
		return alignedWindowControl{}, false
	}
	p := alignedWindowControl{Final: alignedWindowControlFinal{r.Symbol, r.Scale, r.InitialModelCashUnits, r.EntryStatus, r.FinalModelCashUnits, r.FinalModelQuantity, r.FinalPositionPrincipalUnits, r.FinalPositionEntryFeeUnits, r.FinalPositionTotalBasisUnits, r.FinalPositionValueUnits, r.FinalEquityUnits, r.NetRealizedAccountingPnLUnits, r.NetUnrealizedAccountingPnLUnits, r.AggregateFeeUnits, r.PeakCloseEquityUnits}, Marks: make([]alignedWindowMark, scored)}
	if r.Entry != nil {
		if r.Entry.BarIndex != warmup || r.Entry.PolicyDecisionBarIndex != warmup-1 {
			return alignedWindowControl{}, false
		}
		entry := *r.Entry
		entry.Reason = ""
		entry.BarIndex -= warmup
		entry.PolicyDecisionBarIndex -= warmup
		p.Entry = &entry
	}
	var ok bool
	p.Drawdown, ok = projectAlignedWindowDrawdown(r.MaxCloseMarkDrawdown, warmup, total)
	if !ok {
		return alignedWindowControl{}, false
	}
	for i := warmup; i < total; i++ {
		if ctx.Err() != nil || r.CloseMarks[i].BarIndex != i {
			return alignedWindowControl{}, false
		}
		mark := r.CloseMarks[i]
		dd, ok := projectAlignedWindowDrawdown(mark.CloseMarkDrawdown, warmup, total)
		if !ok || dd.HasBar && dd.Bar != i-warmup {
			return alignedWindowControl{}, false
		}
		mark.BarIndex -= warmup
		mark.CloseMarkDrawdown = backtest.FundedCausalDrawdown{}
		p.Marks[i-warmup] = alignedWindowMark{mark, dd}
	}
	return p, ctx.Err() == nil
}

func projectAlignedWindowScore(r backtest.WindowComparisonScore, warmup, scored, sourceStart int) (alignedWindowScore, bool) {
	if (warmup != 20 && warmup != 50) || scored < 1 || scored > backtest.CausalMaxBars-warmup || sourceStart < 50 || sourceStart > backtest.CausalMaxBars-scored {
		return alignedWindowScore{}, false
	}
	dd, ok := projectAlignedWindowDrawdown(r.MaxCloseMarkDrawdown, warmup, warmup+scored)
	if !ok || (r.DrawdownSourceBarIndex == nil) != (r.DrawdownScoredBarIndex == nil) || (r.DrawdownSourceBarIndex != nil) != dd.HasBar {
		return alignedWindowScore{}, false
	}
	p := alignedWindowScore{Value: r, Drawdown: dd}
	if r.DrawdownSourceBarIndex != nil {
		if *r.DrawdownSourceBarIndex != sourceStart+dd.Bar || *r.DrawdownScoredBarIndex < 0 || *r.DrawdownScoredBarIndex >= scored || *r.DrawdownScoredBarIndex != dd.Bar {
			return alignedWindowScore{}, false
		}
		p.HasSource, p.HasScored, p.Source, p.Scored = true, true, *r.DrawdownSourceBarIndex, *r.DrawdownScoredBarIndex
	}
	p.Value.ModelIdentity = ""
	p.Value.MaxCloseMarkDrawdown = backtest.FundedCausalDrawdown{}
	p.Value.DrawdownSourceBarIndex, p.Value.DrawdownScoredBarIndex = nil, nil
	return p, true
}

func alignedWindowEqual(ctx context.Context, a, b alignedWindowProjection) bool {
	return ctx.Err() == nil && a.Facts == b.Facts && a.CashScore == b.CashScore && a.PassiveScore == b.PassiveScore && alignedWindowControlEqual(ctx, a.Cash, b.Cash) && alignedWindowControlEqual(ctx, a.Passive, b.Passive) && ctx.Err() == nil
}

func alignedWindowControlEqual(ctx context.Context, a, b alignedWindowControl) bool {
	if a.Final != b.Final || a.Drawdown != b.Drawdown || (a.Entry == nil) != (b.Entry == nil) || len(a.Marks) != len(b.Marks) {
		return false
	}
	if a.Entry != nil && *a.Entry != *b.Entry {
		return false
	}
	for i := range a.Marks {
		if ctx.Err() != nil || a.Marks[i] != b.Marks[i] {
			return false
		}
	}
	return true
}

func alignedWindowHeader(f alignedWindowFacts) string {
	return fmt.Sprintf("GELT ALIGNED DECLARED-WINDOW COMPARISON\nInput: one admitted CSV parse; symbol: %s\nStart inclusive: %d; end exclusive: %d\nSource bars: %d; source score start: %d; score end exclusive: %d; scored bars: %d\nShared cash/passive controls: complete scored paths, entries, basis, fees, peaks and drawdowns checked equal.\nNative histories: BreakoutVol20 / TrendConfluence50 / MeanReversion20 prior bars; separate finite-prefix reseeding.\nData/authority: unqualified_offline; assumptions: uncalibrated_declared; selection history unestablished.\nFixed families; no ranking, tuning, edge, profitability or operating qualification claim.\n", f.Symbol, f.Window.StartInclusiveUnix, f.Window.EndExclusiveUnix, f.SourceTotalBars, f.ScoreStart, f.ScoreEnd, f.ScoredBars)
}

func alignedWindowText(body string, limit int) bool {
	return len(body) > 0 && len(body) <= limit && utf8.ValidString(body)
}

func assembleAlignedWindowReport(header, breakout, trend, mean string) (string, bool) {
	if !alignedWindowText(header, 2048) || !alignedWindowText(breakout, 8192) || !alignedWindowText(trend, 8192) || !alignedWindowText(mean, 8192) {
		return "", false
	}
	var out strings.Builder
	out.WriteString(header)
	out.WriteString("\n=== BreakoutVol ===\n")
	out.WriteString(breakout)
	out.WriteString("\n=== TrendConfluence ===\n")
	out.WriteString(trend)
	out.WriteString("\n=== MeanReversion ===\n")
	out.WriteString(mean)
	body := out.String()
	return body, alignedWindowText(body, 32768)
}
