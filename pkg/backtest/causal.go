package backtest

import (
	"context"
	"math"
	"reflect"
	"sort"
	"time"
	"unicode"
	"unicode/utf8"

	"gelt/pkg/plans"
	"gelt/pkg/strategies"
)

const (
	CausalModelIdentity  = "gelt.legacy-go.close-next-open.v1"
	CausalCostIdentity   = "frictionless_diagnostic"
	CausalOfflineLabel   = "unqualified_offline"
	CausalEntryBudgetUSD = 10.0
	CausalMaxBars        = 10000
	CausalMaxFills       = 20000
	causalMaxTimestamp   = int64(253402300799)
	causalMaxMoney       = 1000000.0
	causalMaxLevel       = 11000000.0
	causalNoBar          = -1
)

// CausalErrorCode identifies a bounded failure without retaining callback text.
type CausalErrorCode string

const (
	CausalInvalidInput      CausalErrorCode = "invalid_input"
	CausalInvalidSymbol     CausalErrorCode = "invalid_symbol"
	CausalInvalidEvaluator  CausalErrorCode = "invalid_evaluator"
	CausalEvaluatorIdentity CausalErrorCode = "evaluator_identity"
	CausalEvaluatorError    CausalErrorCode = "evaluator_error"
	CausalPlanMembership    CausalErrorCode = "plan_membership"
	CausalUnsupported       CausalErrorCode = "unsupported_condition"
	CausalNumericRange      CausalErrorCode = "numeric_range"
	CausalCanceled          CausalErrorCode = "canceled"
	CausalResourceLimit     CausalErrorCode = "resource_limit"
)

// CausalError contains only a fixed code and a bounded input index.
// BarIndex is -1 when the failure is not associated with a particular bar.
type CausalError struct {
	Code     CausalErrorCode `json:"code"`
	BarIndex int             `json:"bar_index"`
}

func (e *CausalError) Error() string {
	if e == nil {
		return "causal replay failed"
	}
	switch e.Code {
	case CausalInvalidInput:
		return "causal replay: invalid_input"
	case CausalInvalidSymbol:
		return "causal replay: invalid_symbol"
	case CausalInvalidEvaluator:
		return "causal replay: invalid_evaluator"
	case CausalEvaluatorIdentity:
		return "causal replay: evaluator_identity"
	case CausalEvaluatorError:
		return "causal replay: evaluator_error"
	case CausalPlanMembership:
		return "causal replay: plan_membership"
	case CausalUnsupported:
		return "causal replay: unsupported_condition"
	case CausalNumericRange:
		return "causal replay: numeric_range"
	case CausalCanceled:
		return "causal replay: canceled"
	case CausalResourceLimit:
		return "causal replay: resource_limit"
	default:
		return "causal replay failed"
	}
}

// CausalSignal contains validated identity and bounded numerical fields only.
type CausalSignal struct {
	Name        string                `json:"name"`
	Symbol      string                `json:"symbol"`
	Timestamp   time.Time             `json:"timestamp"`
	AssetClass  strategies.AssetClass `json:"asset_class"`
	Signal      strategies.SignalType `json:"signal"`
	Score       float64               `json:"score"`
	StopLossPct float64               `json:"stop_loss_pct"`
	TargetPct   float64               `json:"target_pct"`
}

// CausalEvaluation records one eligible close. Components are name-sorted;
// their order does not participate in, or recompute, plan consensus.
type CausalEvaluation struct {
	CausalSignal
	BarIndex     int            `json:"bar_index"`
	PrefixLength int            `json:"prefix_length"`
	Components   []CausalSignal `json:"components,omitempty"`
}

type CausalFillKind string
type CausalFillReason string

const (
	CausalEntry CausalFillKind = "entry"
	CausalExit  CausalFillKind = "exit"

	CausalNextOpenBuy  CausalFillReason = "next_open_buy"
	CausalNextOpenSell CausalFillReason = "next_open_sell"
	CausalStopGap      CausalFillReason = "stop_gap"
	CausalTargetGap    CausalFillReason = "target_gap"
	CausalStopTouch    CausalFillReason = "stop_touch"
	CausalTargetTouch  CausalFillReason = "target_touch"
)

// CausalFill is model evidence, not an execution or an actual holding.
// EvaluationBarIndex identifies the signal or active level responsible for
// this fill. EntrySignalBarIndex always identifies the original entry signal.
// Ambiguous is true for an intrabar stop/target collision resolved stop-first.
type CausalFill struct {
	Kind                CausalFillKind   `json:"kind"`
	Reason              CausalFillReason `json:"reason"`
	BarIndex            int              `json:"bar_index"`
	Timestamp           time.Time        `json:"timestamp"`
	EvaluationBarIndex  int              `json:"evaluation_bar_index"`
	EntrySignalBarIndex int              `json:"entry_signal_bar_index"`
	EntryBarIndex       int              `json:"entry_bar_index"`
	Price               float64          `json:"price"`
	Quantity            float64          `json:"quantity"`
	Notional            float64          `json:"notional"`
	GrossRealizedPnL    float64          `json:"gross_realized_pnl"`
	StopLoss            float64          `json:"stop_loss"`
	Target              float64          `json:"target"`
	Ambiguous           bool             `json:"ambiguous"`
}

type CausalTerminalPosition struct {
	Quantity                 float64   `json:"quantity"`
	EntryPrice               float64   `json:"entry_price"`
	LastClosePrice           float64   `json:"last_close_price"`
	GrossUnrealizedPnL       float64   `json:"gross_unrealized_pnl"`
	PeakPrice                float64   `json:"peak_price"`
	StopLoss                 float64   `json:"stop_loss"`
	Target                   float64   `json:"target"`
	StopEvaluationBarIndex   int       `json:"stop_evaluation_bar_index"`
	TargetEvaluationBarIndex int       `json:"target_evaluation_bar_index"`
	EntrySignalBarIndex      int       `json:"entry_signal_bar_index"`
	EntrySignalTimestamp     time.Time `json:"entry_signal_timestamp"`
	EntryBarIndex            int       `json:"entry_bar_index"`
	EntryTimestamp           time.Time `json:"entry_timestamp"`
	LastBarIndex             int       `json:"last_bar_index"`
	LastTimestamp            time.Time `json:"last_timestamp"`
}

type CausalProfitFactorReason string

const (
	CausalNoClosedTrades       CausalProfitFactorReason = "no_closed_trades"
	CausalNoLosingClosedTrades CausalProfitFactorReason = "no_losing_closed_trades"
)

// CausalResult deliberately does not embed the legacy Result.
type CausalResult struct {
	ModelIdentity           string                   `json:"model_identity"`
	CostIdentity            string                   `json:"cost_identity"`
	DataLabel               string                   `json:"data_label"`
	AuthorityLabel          string                   `json:"authority_label"`
	TargetName              string                   `json:"target_name"`
	Symbol                  string                   `json:"symbol"`
	TotalBars               int                      `json:"total_bars"`
	Evaluations             []CausalEvaluation       `json:"evaluations"`
	Fills                   []CausalFill             `json:"fills"`
	ClosedTradeCount        int                      `json:"closed_trade_count"`
	WinningClosedTradeCount int                      `json:"winning_closed_trade_count"`
	GrossRealizedPnL        float64                  `json:"gross_realized_pnl"`
	GrossProfit             float64                  `json:"gross_profit"`
	GrossLoss               float64                  `json:"gross_loss"`
	GrossProfitFactor       *float64                 `json:"gross_profit_factor"`
	GrossProfitFactorReason CausalProfitFactorReason `json:"gross_profit_factor_reason"`
	TerminalPosition        *CausalTerminalPosition  `json:"terminal_position"`
	PendingSignalUnfilled   bool                     `json:"pending_signal_unfilled"`
}

type causalMember struct {
	name     string
	strategy strategies.Strategy
	weight   float64
}

type causalEvaluator struct {
	name     string
	strategy strategies.Strategy
	plan     plans.TradingPlan
	members  []causalMember
}

type causalPosition struct {
	entry, quantity, peak, stop, target float64
	entrySignalBar, entryBar            int
	stopBar, targetBar                  int
}

func causalFailure(code CausalErrorCode, index int) (CausalResult, error) {
	return CausalResult{}, &CausalError{Code: code, BarIndex: index}
}

func causalFiniteRange(v, low, high float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= low && v <= high
}

func causalMoney(v float64) bool {
	return causalFiniteRange(v, -causalMaxMoney, causalMaxMoney)
}

func causalName(name string) bool {
	if len(name) == 0 || len(name) > 128 || !utf8.ValidString(name) {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func causalSymbol(symbol string) bool {
	if len(symbol) == 0 || len(symbol) > 16 || symbol[0] < 'A' || symbol[0] > 'Z' {
		return false
	}
	for i := 1; i < len(symbol); i++ {
		c := symbol[i]
		if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '-') {
			return false
		}
	}
	return true
}

func causalNil(v any) bool {
	if v == nil {
		return true
	}
	r := reflect.ValueOf(v)
	switch r.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return r.IsNil()
	default:
		return false
	}
}

func causalSameStrategy(a, b strategies.Strategy) bool {
	if reflect.TypeOf(a) != reflect.TypeOf(b) {
		return false
	}
	if reflect.ValueOf(a).Comparable() && reflect.ValueOf(b).Comparable() {
		return a == b
	}
	// Trusted value implementations may be noncomparable. This is a declared
	// membership comparison, not a snapshot of arbitrary evaluator internals.
	return reflect.DeepEqual(a, b)
}

func causalSnapshotEvaluator(e *Engine) (causalEvaluator, CausalErrorCode) {
	if e == nil || causalNil(e.strategy) == causalNil(e.plan) {
		return causalEvaluator{}, CausalInvalidEvaluator
	}
	v := causalEvaluator{strategy: e.strategy, plan: e.plan}
	if !causalNil(v.strategy) {
		v.name = v.strategy.Name()
		if !causalName(v.name) {
			return causalEvaluator{}, CausalInvalidEvaluator
		}
		return v, ""
	}
	v.name = v.plan.Name()
	if !causalName(v.name) {
		return causalEvaluator{}, CausalInvalidEvaluator
	}
	declared := v.plan.Strategies()
	if len(declared) < 1 || len(declared) > 16 {
		return causalEvaluator{}, CausalPlanMembership
	}
	total := 0.0
	seen := make(map[string]bool, len(declared))
	for _, ws := range declared {
		if causalNil(ws.Strategy) || !causalFiniteRange(ws.Weight, 0, 1) {
			return causalEvaluator{}, CausalPlanMembership
		}
		name := ws.Strategy.Name()
		if !causalName(name) || seen[name] {
			return causalEvaluator{}, CausalPlanMembership
		}
		seen[name] = true
		total += ws.Weight
		v.members = append(v.members, causalMember{name, ws.Strategy, ws.Weight})
	}
	if total <= 0 || !causalFiniteRange(total, 0, 16) {
		return causalEvaluator{}, CausalPlanMembership
	}
	sort.Slice(v.members, func(i, j int) bool { return v.members[i].name < v.members[j].name })
	return v, ""
}

func (v causalEvaluator) unchanged() bool {
	if !causalNil(v.strategy) {
		return v.strategy.Name() == v.name
	}
	if v.plan.Name() != v.name {
		return false
	}
	current := v.plan.Strategies()
	if len(current) != len(v.members) {
		return false
	}
	seen := make(map[string]bool, len(current))
	for _, ws := range current {
		if causalNil(ws.Strategy) {
			return false
		}
		name := ws.Strategy.Name()
		if seen[name] {
			return false
		}
		seen[name] = true
		found := false
		for _, member := range v.members {
			if member.name == name {
				found = ws.Weight == member.weight &&
					causalSameStrategy(ws.Strategy, member.strategy)
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func causalSignalIdentity(s strategies.StrategySignal, name, symbol string, at time.Time) bool {
	return s.StrategyName == name && s.Symbol == symbol &&
		s.Timestamp.Equal(at) && s.AssetClass == strategies.AssetEquity
}

func causalDomain(signal strategies.SignalType, score, stop, target float64) CausalErrorCode {
	if signal != strategies.SignalBuy && signal != strategies.SignalSell && signal != strategies.SignalHold {
		return CausalUnsupported
	}
	if !causalFiniteRange(score, 0, 100) ||
		!(stop == 0 || causalFiniteRange(stop, 0.01, 99.99)) ||
		!(target == 0 || causalFiniteRange(target, 0.01, 1000)) {
		return CausalNumericRange
	}
	return ""
}

func causalStrategyDomain(s strategies.StrategySignal) CausalErrorCode {
	if s.AgentPrompt != "" {
		return CausalUnsupported
	}
	if code := causalDomain(s.Signal, s.Score, s.StopLossPct, s.TargetPct); code != "" {
		return code
	}
	return ""
}

func causalNormalized(s strategies.StrategySignal, at time.Time) CausalSignal {
	return CausalSignal{
		Name: s.StrategyName, Symbol: s.Symbol, Timestamp: at,
		AssetClass: strategies.AssetEquity, Signal: s.Signal, Score: s.Score,
		StopLossPct: s.StopLossPct, TargetPct: s.TargetPct,
	}
}

func (v causalEvaluator) evaluate(
	ctx context.Context, at time.Time, symbol string, index int, closes, volumes []float64,
) (CausalEvaluation, CausalErrorCode) {
	if !v.unchanged() {
		if !causalNil(v.strategy) {
			return CausalEvaluation{}, CausalEvaluatorIdentity
		}
		return CausalEvaluation{}, CausalPlanMembership
	}
	if !causalNil(v.strategy) {
		s, err := v.strategy.Evaluate(ctx, at, symbol, closes, volumes)
		if ctx.Err() != nil {
			return CausalEvaluation{}, CausalCanceled
		}
		if err != nil {
			return CausalEvaluation{}, CausalEvaluatorError
		}
		if !v.unchanged() || !causalSignalIdentity(s, v.name, symbol, at) {
			return CausalEvaluation{}, CausalEvaluatorIdentity
		}
		if code := causalStrategyDomain(s); code != "" {
			return CausalEvaluation{}, code
		}
		return CausalEvaluation{
			CausalSignal: causalNormalized(s, at), BarIndex: index, PrefixLength: index + 1,
		}, ""
	}

	p, err := v.plan.Evaluate(ctx, at, symbol, closes, volumes)
	if ctx.Err() != nil {
		return CausalEvaluation{}, CausalCanceled
	}
	if err != nil {
		return CausalEvaluation{}, CausalEvaluatorError
	}
	if !v.unchanged() {
		return CausalEvaluation{}, CausalPlanMembership
	}
	if p.PlanName != v.name || p.Symbol != symbol || !p.Timestamp.Equal(at) ||
		p.AssetClass != strategies.AssetEquity {
		return CausalEvaluation{}, CausalEvaluatorIdentity
	}
	if len(p.StrategySignals) != len(v.members) {
		return CausalEvaluation{}, CausalPlanMembership
	}

	// Validate every component's identity before normalizing any component or
	// accepting top-level consensus. A valid parent cannot repair a child.
	byName := make(map[string]strategies.StrategySignal, len(v.members))
	for _, s := range p.StrategySignals {
		if _, duplicate := byName[s.StrategyName]; duplicate {
			return CausalEvaluation{}, CausalEvaluatorIdentity
		}
		found := false
		for _, member := range v.members {
			if s.StrategyName == member.name {
				found = true
				break
			}
		}
		if !found || !causalSignalIdentity(s, s.StrategyName, symbol, at) {
			return CausalEvaluation{}, CausalEvaluatorIdentity
		}
		byName[s.StrategyName] = s
	}
	if code := causalDomain(p.ConsensusSignal, p.WeightedScore, p.StopLossPct, p.TargetPct); code != "" {
		return CausalEvaluation{}, code
	}
	for _, member := range v.members {
		if code := causalStrategyDomain(byName[member.name]); code != "" {
			return CausalEvaluation{}, code
		}
	}
	out := CausalEvaluation{
		CausalSignal: CausalSignal{
			Name: v.name, Symbol: symbol, Timestamp: at, AssetClass: strategies.AssetEquity,
			Signal: p.ConsensusSignal, Score: p.WeightedScore,
			StopLossPct: p.StopLossPct, TargetPct: p.TargetPct,
		},
		BarIndex: index, PrefixLength: index + 1,
		Components: make([]CausalSignal, 0, len(v.members)),
	}
	for _, member := range v.members {
		out.Components = append(out.Components, causalNormalized(byName[member.name], at))
	}
	return out, ""
}

func causalValidateBars(data []OHLCV) (int, CausalErrorCode) {
	if len(data) < 1 {
		return causalNoBar, CausalInvalidInput
	}
	if len(data) > CausalMaxBars {
		return causalNoBar, CausalResourceLimit
	}
	for i, b := range data {
		if b.Timestamp <= 0 || b.Timestamp > causalMaxTimestamp ||
			(i > 0 && b.Timestamp <= data[i-1].Timestamp) ||
			!causalFiniteRange(b.Open, 0.01, 1000000) ||
			!causalFiniteRange(b.High, 0.01, 1000000) ||
			!causalFiniteRange(b.Low, 0.01, 1000000) ||
			!causalFiniteRange(b.Close, 0.01, 1000000) ||
			!causalFiniteRange(b.Volume, 0, 1000000000000) ||
			b.Low > b.Open || b.Low > b.Close || b.Open > b.High ||
			b.Close > b.High || b.Low > b.High {
			return i, CausalInvalidInput
		}
	}
	return causalNoBar, ""
}

func causalLevels(stop, target float64) bool {
	return (stop == 0 || causalFiniteRange(stop, math.SmallestNonzeroFloat64, causalMaxLevel)) &&
		(target == 0 || causalFiniteRange(target, math.SmallestNonzeroFloat64, causalMaxLevel)) &&
		(stop == 0 || target == 0 || stop < target)
}

func causalNewPosition(price float64, evaluation CausalEvaluation, bar int) (*causalPosition, CausalErrorCode) {
	return causalNewPositionWithQuantity(price, CausalEntryBudgetUSD/price, evaluation, bar)
}

// The original wrapper retains exactly 10/open. Only fee mode supplies a
// different quantity; protection arithmetic and its supported domain are shared.
func causalNewPositionWithQuantity(
	price, quantity float64, evaluation CausalEvaluation, bar int,
) (*causalPosition, CausalErrorCode) {
	p := &causalPosition{
		entry: price, quantity: quantity, peak: price,
		entrySignalBar: evaluation.BarIndex, entryBar: bar,
		stopBar: causalNoBar, targetBar: causalNoBar,
	}
	if !causalFiniteRange(p.quantity, 0.00001, 1000) {
		return nil, CausalNumericRange
	}
	if evaluation.StopLossPct > 0 {
		p.stop = price - price*evaluation.StopLossPct/100
		p.stopBar = evaluation.BarIndex
		if !(p.stop > 0 && p.stop < price) {
			return nil, CausalNumericRange
		}
	}
	if evaluation.TargetPct > 0 {
		p.target = price + price*evaluation.TargetPct/100
		p.targetBar = evaluation.BarIndex
		if !(p.target > price) {
			return nil, CausalNumericRange
		}
	}
	if !causalLevels(p.stop, p.target) {
		return nil, CausalNumericRange
	}
	return p, ""
}

func (p *causalPosition) update(high float64, e CausalEvaluation) CausalErrorCode {
	if p.stop > 0 && e.StopLossPct == 0 || p.target > 0 && e.TargetPct == 0 {
		return CausalUnsupported
	}
	peak := math.Max(p.peak, high)
	stop, target := p.stop, p.target
	stopBar, targetBar := p.stopBar, p.targetBar
	if e.StopLossPct > 0 {
		candidate := peak - peak*e.StopLossPct/100
		if !causalFiniteRange(candidate, math.SmallestNonzeroFloat64, causalMaxLevel) {
			return CausalNumericRange
		}
		if candidate > stop {
			stop, stopBar = candidate, e.BarIndex
		}
	}
	if e.TargetPct > 0 {
		candidate := p.entry + p.entry*e.TargetPct/100
		if candidate != target {
			target, targetBar = candidate, e.BarIndex
		}
	}
	if !causalLevels(stop, target) {
		return CausalNumericRange
	}
	p.peak, p.stop, p.target = peak, stop, target
	p.stopBar, p.targetBar = stopBar, targetBar
	return ""
}

func causalAppendFill(
	res *CausalResult, p *causalPosition, kind CausalFillKind, reason CausalFillReason,
	bar int, timestamp int64, evaluationBar int, price float64, ambiguous bool,
) CausalErrorCode {
	if len(res.Fills) >= CausalMaxFills {
		return CausalResourceLimit
	}
	notional := price * p.quantity
	if !causalFiniteRange(price, math.SmallestNonzeroFloat64, causalMaxLevel) ||
		!causalFiniteRange(notional, 0, causalMaxMoney) {
		return CausalNumericRange
	}
	pnl := 0.0
	gross, profit, loss := res.GrossRealizedPnL, res.GrossProfit, res.GrossLoss
	if kind == CausalExit {
		pnl = (price - p.entry) * p.quantity
		gross += pnl
		if pnl > 0 {
			profit += pnl
		} else {
			loss -= pnl
		}
		if !causalMoney(pnl) || !causalMoney(gross) ||
			!causalFiniteRange(profit, 0, causalMaxMoney) ||
			!causalFiniteRange(loss, 0, causalMaxMoney) {
			return CausalNumericRange
		}
	}
	res.Fills = append(res.Fills, CausalFill{
		Kind: kind, Reason: reason, BarIndex: bar, Timestamp: time.Unix(timestamp, 0).UTC(),
		EvaluationBarIndex: evaluationBar, EntrySignalBarIndex: p.entrySignalBar,
		EntryBarIndex: p.entryBar, Price: price, Quantity: p.quantity,
		Notional: notional, GrossRealizedPnL: pnl, StopLoss: p.stop, Target: p.target,
		Ambiguous: ambiguous,
	})
	if kind == CausalExit {
		res.ClosedTradeCount++
		if pnl > 0 {
			res.WinningClosedTradeCount++
		}
		res.GrossRealizedPnL, res.GrossProfit, res.GrossLoss = gross, profit, loss
	}
	return ""
}

// Accounting stays adjacent to actual modeled fills. Fatal failure discards
// both traces; neither trace is published incrementally.
func causalRecordFill(
	res *CausalResult, funded *causalFundedState, fee *causalFeeScenarioState, execution *causalExecutionScenarioState, p *causalPosition,
	kind CausalFillKind, reason CausalFillReason, bar int, timestamp int64,
	evaluationBar int, price float64, ambiguous bool,
) CausalErrorCode {
	if code := causalAppendFill(res, p, kind, reason, bar, timestamp, evaluationBar, price, ambiguous); code != "" {
		return code
	}
	if funded != nil {
		return funded.fill(res.Fills[len(res.Fills)-1], len(res.Fills)-1)
	}
	if fee != nil {
		return fee.fill(res.Fills[len(res.Fills)-1], len(res.Fills)-1)
	}
	if execution != nil {
		return execution.fill(res.Fills[len(res.Fills)-1], len(res.Fills)-1)
	}
	return ""
}

// RunCausal performs the fixed, opt-in, gross frictionless OHLC replay.
// It does not call Init or reset an evaluator. Callers must exclusively own a
// freshly initialized trusted evaluator and exclusively own input during
// preflight. Copies protect runner bars and later prefixes, not arbitrary
// callback state or plan-child interactions. Concurrent/reentrant use is not
// supported. Cancellation checks do not preempt an uncooperative callback.
func (e *Engine) RunCausal(ctx context.Context, symbol string, data []OHLCV) (CausalResult, error) {
	return e.runCausal(ctx, symbol, data, nil, nil)
}

// runCausal is the single event loop. Accounting cannot select a price, change
// a touch predicate or reevaluate a close. Fee/execution modes supply quantity
// at the pre-entry gate. The three closed private accounting states are exclusive.
// Execution prices affect only the new accounting trace, never reference triggers.
type causalReplayProfile uint8

const (
	causalProfileInvalid causalReplayProfile = iota
	causalProfileShipped20
	causalProfileTrend50
)

func (e *Engine) runCausal(
	ctx context.Context, symbol string, data []OHLCV,
	funded *causalFundedState, fee *causalFeeScenarioState, executionMode ...*causalExecutionScenarioState,
) (CausalResult, error) {
	return e.runCausalProfile(causalProfileShipped20, ctx, symbol, data, funded, fee, executionMode...)
}

func (e *Engine) runCausalProfile(profile causalReplayProfile, ctx context.Context, symbol string, data []OHLCV,
	funded *causalFundedState, fee *causalFeeScenarioState, executionMode ...*causalExecutionScenarioState,
) (CausalResult, error) {
	if profile != causalProfileShipped20 && profile != causalProfileTrend50 {
		return causalFailure(CausalInvalidInput, causalNoBar)
	}
	if profile == causalProfileTrend50 {
		if funded != nil || fee != nil || len(executionMode) != 1 || executionMode[0] == nil || e == nil || !causalNil(e.plan) {
			return causalFailure(CausalInvalidInput, causalNoBar)
		}
		trend, ok := e.strategy.(*strategies.TrendConfluenceStrategy)
		if !ok || trend == nil || trend.Name() != "TrendConfluence" || trend.BuyScoreThreshold != 75 || trend.SellScoreThreshold != 0 || executionMode[0].result.ModelIdentity != Trend50StrategyModelIdentity {
			return causalFailure(CausalInvalidEvaluator, causalNoBar)
		}
	}
	return e.runCausalCore(profile, ctx, symbol, data, funded, fee, executionMode...)
}

// runCausalCore is the one event loop after profile admission. Same-package
// tests can exercise its transitions with synthetic strategies; the product
// path always goes through runCausalProfile's owned-strategy admission.
func (e *Engine) runCausalCore(profile causalReplayProfile, ctx context.Context, symbol string, data []OHLCV,
	funded *causalFundedState, fee *causalFeeScenarioState, executionMode ...*causalExecutionScenarioState,
) (CausalResult, error) {
	if profile != causalProfileShipped20 && profile != causalProfileTrend50 {
		return causalFailure(CausalInvalidInput, causalNoBar)
	}
	firstEvaluation := 19
	if profile == causalProfileTrend50 {
		firstEvaluation = 49
	}
	var execution *causalExecutionScenarioState
	if len(executionMode) > 1 {
		return causalFailure(CausalInvalidInput, causalNoBar)
	}
	if len(executionMode) == 1 {
		execution = executionMode[0]
	}
	if funded != nil && fee != nil || execution != nil && (funded != nil || fee != nil) {
		return causalFailure(CausalInvalidInput, causalNoBar)
	}
	if index, code := causalValidateBars(data); code != "" {
		return causalFailure(code, index)
	}
	if !causalSymbol(symbol) {
		return causalFailure(CausalInvalidSymbol, causalNoBar)
	}
	bars := append([]OHLCV(nil), data...)
	evaluator, code := causalSnapshotEvaluator(e)
	if code != "" {
		return causalFailure(code, causalNoBar)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	res := CausalResult{
		ModelIdentity: CausalModelIdentity, CostIdentity: CausalCostIdentity,
		DataLabel: CausalOfflineLabel, AuthorityLabel: CausalOfflineLabel,
		TargetName: evaluator.name, Symbol: symbol, TotalBars: len(bars),
	}
	if funded != nil {
		res.ModelIdentity, res.CostIdentity = FundedCausalModelIdentity, FundedCausalCostIdentity
	}
	if fee != nil {
		res.ModelIdentity, res.CostIdentity = FeeScenarioCausalModelIdentity, FeeScenarioCausalCostIdentity
	}
	if execution != nil {
		res.ModelIdentity, res.CostIdentity = ExecutionScenarioCausalModelIdentity, ExecutionScenarioCausalCostIdentity
		if profile == causalProfileTrend50 {
			res.ModelIdentity = Trend50StrategyModelIdentity
		}
	}
	var position *causalPosition
	var pending *CausalEvaluation

	for i, bar := range bars {
		if ctx.Err() != nil {
			return causalFailure(CausalCanceled, i)
		}
		exited := false
		closePosition := func(reason CausalFillReason, price float64, source int, ambiguous bool) CausalErrorCode {
			code := causalRecordFill(&res, funded, fee, execution, position, CausalExit, reason, i, bar.Timestamp, source, price, ambiguous)
			if code == "" {
				position, exited = nil, true
			}
			return code
		}

		// Opening protection has priority over the previous close's explicit exit.
		if position != nil {
			switch {
			case position.stop > 0 && bar.Open <= position.stop:
				code = closePosition(CausalStopGap, bar.Open, position.stopBar, false)
			case position.target > 0 && bar.Open >= position.target:
				code = closePosition(CausalTargetGap, position.target, position.targetBar, false)
			case pending != nil && pending.Signal == strategies.SignalSell:
				code = closePosition(CausalNextOpenSell, bar.Open, pending.BarIndex, false)
			default:
				code = ""
			}
			if code != "" {
				return causalFailure(code, i)
			}
		}
		if !exited && position == nil && pending != nil && pending.Signal == strategies.SignalBuy {
			allowed := true
			var quantity float64
			if funded != nil {
				allowed, code = funded.entryGate(bar, i, *pending)
				if code != "" {
					return causalFailure(code, i)
				}
			}
			if fee != nil {
				quantity, allowed, code = fee.entryGate(bar, i, *pending)
				if code != "" {
					return causalFailure(code, i)
				}
			}
			if execution != nil {
				quantity, allowed, code = execution.entryGate(bar, i, *pending)
				if code != "" {
					return causalFailure(code, i)
				}
			}
			if allowed {
				if fee != nil || execution != nil {
					position, code = causalNewPositionWithQuantity(bar.Open, quantity, *pending, i)
				} else {
					position, code = causalNewPosition(bar.Open, *pending, i)
				}
				if code != "" {
					return causalFailure(code, i)
				}
				if code = causalRecordFill(&res, funded, fee, execution, position, CausalEntry, CausalNextOpenBuy,
					i, bar.Timestamp, pending.BarIndex, bar.Open, false); code != "" {
					return causalFailure(code, i)
				}
			}
		}
		// BUY while active and SELL while flat are consumed no-ops.
		// An unaffordable flat BUY is also consumed, with a separate nonfill record.
		pending = nil

		if position != nil {
			stopHit := position.stop > 0 && bar.Low <= position.stop
			targetHit := position.target > 0 && bar.High >= position.target
			if stopHit {
				code = closePosition(CausalStopTouch, position.stop, position.stopBar, targetHit)
			} else if targetHit {
				code = closePosition(CausalTargetTouch, position.target, position.targetBar, false)
			} else {
				code = ""
			}
			if code != "" {
				return causalFailure(code, i)
			}
		}
		if i < firstEvaluation {
			if funded != nil {
				if code = funded.mark(bar, i, position); code != "" {
					return causalFailure(code, i)
				}
			}
			if fee != nil {
				if code = fee.mark(bar, i, position); code != "" {
					return causalFailure(code, i)
				}
			}
			if execution != nil {
				if code = execution.mark(bar, i, position); code != "" {
					return causalFailure(code, i)
				}
			}
			continue
		}

		closes, volumes := make([]float64, i+1), make([]float64, i+1)
		for j := 0; j <= i; j++ {
			closes[j], volumes[j] = bars[j].Close, bars[j].Volume
		}
		at := time.Unix(bar.Timestamp, 0).UTC()
		evaluation, evalCode := evaluator.evaluate(ctx, at, symbol, i, closes, volumes)
		if evalCode != "" {
			return causalFailure(evalCode, i)
		}
		if len(res.Evaluations) >= CausalMaxBars {
			return causalFailure(CausalResourceLimit, i)
		}
		res.Evaluations = append(res.Evaluations, evaluation)
		if position != nil {
			if code = position.update(bar.High, evaluation); code != "" {
				return causalFailure(code, i)
			}
		}
		pending = &evaluation
		if funded != nil {
			if code = funded.mark(bar, i, position); code != "" {
				return causalFailure(code, i)
			}
		}
		if fee != nil {
			if code = fee.mark(bar, i, position); code != "" {
				return causalFailure(code, i)
			}
		}
		if execution != nil {
			if code = execution.mark(bar, i, position); code != "" {
				return causalFailure(code, i)
			}
		}
	}

	// This flag records a final directional signal lacking a successor bar,
	// including one that would have been an explicit no-op at that next open.
	res.PendingSignalUnfilled = pending != nil &&
		(pending.Signal == strategies.SignalBuy || pending.Signal == strategies.SignalSell)
	if position != nil {
		last := len(bars) - 1
		unrealized := (bars[last].Close - position.entry) * position.quantity
		if !causalMoney(unrealized) {
			return causalFailure(CausalNumericRange, last)
		}
		res.TerminalPosition = &CausalTerminalPosition{
			Quantity: position.quantity, EntryPrice: position.entry,
			LastClosePrice: bars[last].Close, GrossUnrealizedPnL: unrealized,
			PeakPrice: position.peak, StopLoss: position.stop, Target: position.target,
			StopEvaluationBarIndex: position.stopBar, TargetEvaluationBarIndex: position.targetBar,
			EntrySignalBarIndex:  position.entrySignalBar,
			EntrySignalTimestamp: time.Unix(bars[position.entrySignalBar].Timestamp, 0).UTC(),
			EntryBarIndex:        position.entryBar,
			EntryTimestamp:       time.Unix(bars[position.entryBar].Timestamp, 0).UTC(),
			LastBarIndex:         last, LastTimestamp: time.Unix(bars[last].Timestamp, 0).UTC(),
		}
	}
	switch {
	case res.ClosedTradeCount == 0:
		res.GrossProfitFactorReason = CausalNoClosedTrades
	case res.GrossLoss == 0:
		res.GrossProfitFactorReason = CausalNoLosingClosedTrades
	default:
		ratio := res.GrossProfit / res.GrossLoss
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) {
			return causalFailure(CausalNumericRange, len(bars)-1)
		}
		res.GrossProfitFactor = &ratio
	}
	return res, nil
}
