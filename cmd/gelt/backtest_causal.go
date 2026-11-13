package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"gelt/pkg/backtest"
	"gelt/pkg/data"
	"gelt/pkg/strategies"
)

const (
	causalCSVMaxBytes     = 1048576
	causalCSVMaxToken     = 32
	causalSummaryMaxBytes = 4096
	causalCSVHeader       = "Timestamp,Open,High,Low,Close,Volume"
	causalCLIUsage        = "Usage: gelt backtest-causal <Target> <Symbol> <DataFile.csv>\n" +
		"Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n"
)

// causalCSVError retains only a fixed local code, never reader or input text.
type causalCSVError string

func (e causalCSVError) Error() string { return string(e) }

const (
	causalCSVInvalid causalCSVError = "invalid_csv"
	causalCSVLimit   causalCSVError = "resource_limit"
	causalCSVRead    causalCSVError = "input_file"
)

// parseBacktestCausalCSV reads at most max+1 bytes before interpreting input.
// It enforces syntax and resource bounds. RunCausal owns numerical/domain
// validation of the complete parsed series. ParseFloat uses float64 rounding;
// this parser does not provide exact-decimal arithmetic.
func parseBacktestCausalCSV(r io.Reader) ([]backtest.OHLCV, error) {
	content, err := io.ReadAll(io.LimitReader(r, causalCSVMaxBytes+1))
	if len(content) > causalCSVMaxBytes {
		return nil, causalCSVLimit
	}
	if err != nil {
		return nil, causalCSVRead
	}
	if !utf8.Valid(content) {
		return nil, causalCSVInvalid
	}

	lines := bytes.Split(content, []byte{'\n'})
	// Remove exactly one permitted final line ending.
	if len(lines) > 1 && len(lines[len(lines)-1]) == 0 {
		lines = lines[:len(lines)-1]
	}
	if len(lines) < 2 {
		return nil, causalCSVInvalid
	}
	if len(lines)-1 > backtest.CausalMaxBars {
		return nil, causalCSVLimit
	}

	bars := make([]backtest.OHLCV, 0, len(lines)-1)
	for i, raw := range lines {
		line := raw
		// A CR is accepted only as part of a CRLF line ending.
		terminated := i < len(lines)-1 || content[len(content)-1] == '\n'
		if terminated && len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		if i == 0 {
			if string(line) != causalCSVHeader {
				return nil, causalCSVInvalid
			}
			continue
		}
		fields := bytes.Split(line, []byte{','})
		if len(fields) != 6 {
			return nil, causalCSVInvalid
		}
		for j, field := range fields {
			if !causalCSVNumber(field, j != 0) {
				return nil, causalCSVInvalid
			}
		}
		ts, err := strconv.ParseInt(string(fields[0]), 10, 64)
		if err != nil {
			return nil, causalCSVInvalid
		}
		var values [5]float64
		for j := range values {
			values[j], err = strconv.ParseFloat(string(fields[j+1]), 64)
			if err != nil || math.IsNaN(values[j]) || math.IsInf(values[j], 0) {
				return nil, causalCSVInvalid
			}
		}
		bars = append(bars, backtest.OHLCV{
			Timestamp: ts,
			Open:      values[0],
			High:      values[1],
			Low:       values[2],
			Close:     values[3],
			Volume:    values[4],
		})
	}
	return bars, nil
}

// causalCSVNumber accepts canonical unsigned ASCII integer/decimal syntax.
func causalCSVNumber(token []byte, decimal bool) bool {
	if len(token) == 0 || len(token) > causalCSVMaxToken {
		return false
	}
	i := 0
	for i < len(token) && token[i] >= '0' && token[i] <= '9' {
		i++
	}
	if i == 0 || i > 1 && token[0] == '0' {
		return false
	}
	if i == len(token) {
		return true
	}
	if !decimal || token[i] != '.' || i+1 == len(token) {
		return false
	}
	for i++; i < len(token); i++ {
		if token[i] < '0' || token[i] > '9' {
			return false
		}
	}
	return true
}

// newBacktestCausalEngine resolves only the selected offline CLI subset.
// No catalog, plan suite, configuration, or provider is initialized.
func newBacktestCausalEngine(target string) (*backtest.Engine, bool) {
	if target != "BreakoutVol" {
		return nil, false
	}
	s := strategies.NewBreakoutVolStrategy()
	if err := s.Init(&data.FeatureRegistry{}); err != nil {
		return nil, false
	}
	return backtest.NewStrategyEngine(s), true
}

// runBacktestCausal receives arguments excluding the command name.
// Exactly target, symbol and CSV path are required.
func runBacktestCausal(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 3 {
		_, _ = io.WriteString(stderr, causalCLIUsage)
		return causalCLIFail(stderr, "invalid_arguments")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return causalCLIFail(stderr, "canceled")
	}

	f, err := openOfflineCSV(args[2])
	if err != nil {
		return causalCLIFail(stderr, "input_file")
	}
	bars, parseErr := parseBacktestCausalCSV(f)
	closeErr := f.Close()
	if parseErr != nil {
		switch parseErr {
		case causalCSVLimit:
			return causalCLIFail(stderr, "resource_limit")
		case causalCSVRead:
			return causalCLIFail(stderr, "input_file")
		default:
			return causalCLIFail(stderr, "invalid_csv")
		}
	}
	if closeErr != nil {
		return causalCLIFail(stderr, "input_file")
	}
	if ctx.Err() != nil {
		return causalCLIFail(stderr, "canceled")
	}

	// Parse the entire CSV before resolving or evaluating a target.
	engine, ok := newBacktestCausalEngine(args[0])
	if !ok {
		if args[0] != "BreakoutVol" {
			_, _ = io.WriteString(stderr,
				"Supported target: BreakoutVol only (offline standalone subset; plan routes unsupported).\n")
			return causalCLIFail(stderr, "unsupported_target")
		}
		return causalCLIFail(stderr, "invalid_evaluator")
	}
	return runBacktestCausalEngine(ctx, args[1], bars, engine, stdout, stderr)
}

// runBacktestCausalEngine is a typed local execution seam for synthetic tests.
// The CLI always constructs its engine through newBacktestCausalEngine.
func runBacktestCausalEngine(
	ctx context.Context,
	symbol string,
	bars []backtest.OHLCV,
	engine *backtest.Engine,
	stdout, stderr io.Writer,
) int {
	result, err := engine.RunCausal(ctx, symbol, bars)
	if err != nil {
		return causalCLIFail(stderr, causalCLIEngineError(err))
	}
	summary, ok := backtestCausalSummary(result)
	if !ok {
		return causalCLIFail(stderr, "invalid_result")
	}
	n, err := io.WriteString(stdout, summary)
	if err != nil || n != len(summary) {
		return causalCLIFail(stderr, "output_error")
	}
	return 0
}

func causalCLIEngineError(err error) string {
	var failure *backtest.CausalError
	if !errors.As(err, &failure) || failure == nil {
		return "replay_failed"
	}
	switch failure.Code {
	case backtest.CausalInvalidInput:
		return "invalid_input"
	case backtest.CausalInvalidSymbol:
		return "invalid_symbol"
	case backtest.CausalInvalidEvaluator:
		return "invalid_evaluator"
	case backtest.CausalEvaluatorIdentity:
		return "evaluator_identity"
	case backtest.CausalEvaluatorError:
		return "evaluator_error"
	case backtest.CausalPlanMembership:
		return "plan_membership"
	case backtest.CausalUnsupported:
		return "unsupported_condition"
	case backtest.CausalNumericRange:
		return "numeric_range"
	case backtest.CausalCanceled:
		return "canceled"
	case backtest.CausalResourceLimit:
		return "resource_limit"
	default:
		return "replay_failed"
	}
}

// Only fixed literals can cross the error-output boundary.
func causalCLIFail(stderr io.Writer, code string) int {
	switch code {
	case "invalid_arguments", "input_file", "invalid_csv", "resource_limit",
		"unsupported_target", "invalid_input", "invalid_symbol",
		"invalid_evaluator", "evaluator_identity", "evaluator_error",
		"plan_membership", "unsupported_condition", "numeric_range",
		"canceled", "invalid_result", "output_error", "replay_failed":
	default:
		code = "replay_failed"
	}
	_, _ = io.WriteString(stderr, "backtest-causal: "+code+"\n")
	return 1
}

func causalCLIFinite(v, low, high float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= low && v <= high
}

// backtestCausalSummary prints no arbitrary result text or event history.
// Scientific notation bounds every finite float's display length, including
// a finite profit factor near MaxFloat64. Rounding is display-only.
// The final explicit byte check also protects future format changes.
func backtestCausalSummary(r backtest.CausalResult) (string, bool) {
	if r.ModelIdentity != backtest.CausalModelIdentity ||
		r.CostIdentity != backtest.CausalCostIdentity ||
		r.DataLabel != backtest.CausalOfflineLabel ||
		r.AuthorityLabel != backtest.CausalOfflineLabel ||
		r.TotalBars < 1 || r.TotalBars > backtest.CausalMaxBars ||
		len(r.Evaluations) > r.TotalBars || len(r.Fills) > backtest.CausalMaxFills ||
		r.ClosedTradeCount < 0 || r.ClosedTradeCount > backtest.CausalMaxBars ||
		r.WinningClosedTradeCount < 0 ||
		r.WinningClosedTradeCount > r.ClosedTradeCount ||
		!causalCLIFinite(r.GrossRealizedPnL, -1000000, 1000000) ||
		!causalCLIFinite(r.GrossProfit, 0, 1000000) ||
		!causalCLIFinite(r.GrossLoss, 0, 1000000) {
		return "", false
	}

	pf := ""
	if r.GrossProfitFactor == nil {
		switch {
		case r.ClosedTradeCount == 0 &&
			r.GrossProfitFactorReason == backtest.CausalNoClosedTrades:
			pf = "null (no_closed_trades)"
		case r.ClosedTradeCount > 0 && r.GrossLoss == 0 &&
			r.GrossProfitFactorReason == backtest.CausalNoLosingClosedTrades:
			pf = "null (no_losing_closed_trades)"
		default:
			return "", false
		}
	} else {
		if r.ClosedTradeCount == 0 || r.GrossLoss <= 0 ||
			r.GrossProfitFactorReason != "" ||
			!causalCLIFinite(*r.GrossProfitFactor, 0, math.MaxFloat64) {
			return "", false
		}
		pf = fmt.Sprintf("%.12e", *r.GrossProfitFactor)
	}

	if p := r.TerminalPosition; p != nil {
		if !causalCLIFinite(p.Quantity, 0.00001, 1000) ||
			!causalCLIFinite(p.EntryPrice, 0.01, 1000000) ||
			!causalCLIFinite(p.LastClosePrice, 0.01, 1000000) ||
			!causalCLIFinite(p.GrossUnrealizedPnL, -1000000, 1000000) ||
			!causalCLIFinite(p.StopLoss, 0, 11000000) ||
			!causalCLIFinite(p.Target, 0, 11000000) ||
			(p.StopLoss > 0 && p.Target > 0 && p.StopLoss >= p.Target) ||
			p.EntrySignalBarIndex < 19 ||
			p.EntryBarIndex <= p.EntrySignalBarIndex ||
			p.EntryBarIndex >= r.TotalBars ||
			p.LastBarIndex != r.TotalBars-1 {
			return "", false
		}
	}

	var out strings.Builder
	out.WriteString("GELT CAUSAL CSV REPLAY SUMMARY\n")
	fmt.Fprintf(&out, "Model: %s\nCost: %s\nData: %s\nAuthority: %s\n",
		backtest.CausalModelIdentity, backtest.CausalCostIdentity,
		backtest.CausalOfflineLabel, backtest.CausalOfflineLabel)
	out.WriteString("Metrics: gross frictionless diagnostics; costs and equity/drawdown not modeled.\n")
	out.WriteString("Arithmetic: float64; displayed figures rounded only; no fill-policy rounding.\n")
	out.WriteString("Fills: close signal / next open; final position is a model position.\n")
	fmt.Fprintf(&out, "Bars: %d\nEvaluations: %d\nModel fills: %d\n",
		r.TotalBars, len(r.Evaluations), len(r.Fills))
	fmt.Fprintf(&out, "Closed trades: %d\nWinning closed trades: %d\n",
		r.ClosedTradeCount, r.WinningClosedTradeCount)
	fmt.Fprintf(&out, "Gross realized PnL: %.12e\nGross profit: %.12e\nGross loss: %.12e\n",
		r.GrossRealizedPnL, r.GrossProfit, r.GrossLoss)
	fmt.Fprintf(&out, "Gross profit factor: %s\n", pf)
	if p := r.TerminalPosition; p != nil {
		out.WriteString("Final open model position: present\n")
		fmt.Fprintf(&out, "Quantity: %.12e\nEntry price: %.12e\nLast close price: %.12e\n",
			p.Quantity, p.EntryPrice, p.LastClosePrice)
		fmt.Fprintf(&out, "Gross unrealized PnL: %.12e\nActive stop (0=disabled): %.12e\nActive target (0=disabled): %.12e\n",
			p.GrossUnrealizedPnL, p.StopLoss, p.Target)
		fmt.Fprintf(&out, "Entry signal bar: %d\nEntry fill bar: %d\nFinal bar: %d\n",
			p.EntrySignalBarIndex, p.EntryBarIndex, p.LastBarIndex)
	} else {
		out.WriteString("Final open model position: none\n")
	}
	fmt.Fprintf(&out, "Final directional signal pending: %t\n", r.PendingSignalUnfilled)
	out.WriteString("Pending means no successor bar; may be a no-op, not an actual unfilled order.\n")
	if out.Len() > causalSummaryMaxBytes {
		return "", false
	}
	return out.String(), true
}
