// Package shadow provides parallel paper forward-testing for inactive Gelt Trading Plans.
package shadow

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"

	"golang.org/x/text/unicode/norm"
	"time"

	"gelt/pkg/config"
)

// ShadowTrade tracks a single virtual paper trade executed by a shadow plan.
type ShadowTrade struct {
	ID           string    `json:"id"`
	PlanName     string    `json:"plan_name"`
	Symbol       string    `json:"symbol"`
	AssetClass   string    `json:"asset_class"`
	Side         string    `json:"side"` // "buy", "sell"
	EntryPrice   float64   `json:"entry_price"`
	PeakPrice    float64   `json:"peak_price"`
	ExitPrice    float64   `json:"exit_price"`
	MarketPrice  float64   `json:"market_price"`
	FillPrice    float64   `json:"fill_price"`
	Quantity     float64   `json:"quantity"`
	AmountUSD    float64   `json:"amount_usd"`
	PnLUSD       float64   `json:"pnl_usd"`
	PnLPct       float64   `json:"pnl_pct"`
	StopLossPct  float64   `json:"stop_loss_pct"`
	TargetPct    float64   `json:"target_pct"`
	SlippagePct  float64   `json:"slippage_pct"`
	SlippageUSD  float64   `json:"slippage_usd"`
	Status       string    `json:"status"` // "OPEN", "CLOSED"
	IntradayOnly bool      `json:"intraday_only"`
	SignalTime   time.Time `json:"signal_time"`
	EntryTime    time.Time `json:"entry_time"`
	ExitTime     time.Time `json:"exit_time"`
}

// PlanPerformance holds comparative performance stats for a trading plan.
type PlanPerformance struct {
	PlanName     string  `json:"plan_name"`
	IsLive       bool    `json:"is_live"`
	TotalTrades  int     `json:"total_trades"`
	OpenTrades   int     `json:"open_trades"`
	WinCount     int     `json:"win_count"`
	LossCount    int     `json:"loss_count"`
	WinRate      float64 `json:"win_rate"`
	TotalPnLUSD  float64 `json:"total_pnl_usd"`
	PnLPct       float64 `json:"pnl_pct"`
	ProfitFactor float64 `json:"profit_factor"`
	AvgWin       float64 `json:"avg_win"`
	AvgLoss      float64 `json:"avg_loss"`
	MaxDrawdown  float64 `json:"max_drawdown"`
}

// Store manages persistence of shadow trades in ~/.gelt/gelt_shadow_journal.json.
// ErrJournalConflict means the records used to calculate an update changed
// before the journal transaction acquired its exclusive lock. Callers must
// recompute from current state rather than overwriting a newer commit.
var (
	ErrJournalConflict           = errors.New("shadow journal conflict")
	ErrInsufficientShadowCapital = errors.New("insufficient shadow capital")
	ErrInvalidShadowReservation  = errors.New("invalid shadow capital reservation")
	ErrShadowCapitalDegraded     = errors.New("shadow capital reservation is degraded")
	ErrShadowIdentityDegraded    = errors.New("shadow journal identity is degraded")
	ErrShadowRebaselinePending   = errors.New("shadow capital rebaseline is pending")
	ErrShadowJournalHalted       = errors.New("shadow journal integrity is halted")
)

type Store struct {
	mu                   sync.RWMutex
	filePath             string
	cyclesFilePath       string
	capitalStateFilePath string
	rebaselineIntentPath string
	// replace and beforeConditionalUpdate are test seams. Production always uses
	// durableReplace and has no conditional-update hook.
	replace                 func(string, []byte) error
	beforeConditionalUpdate func()
}

// CapitalReservationState is durable provenance for a shadow-capital breach.
// A latched state makes the journal non-promotable until an operator rebases it.
type CapitalReservationState struct {
	SchemaVersion      int       `json:"schema_version"`
	Degraded           bool      `json:"degraded"`
	Reason             string    `json:"reason,omitempty"`
	LatchedAt          time.Time `json:"latched_at,omitempty"`
	RebaselineRequired bool      `json:"rebaseline_required"`
	RebaselinePending  bool      `json:"rebaseline_pending"`
	RebaselinedAt      time.Time `json:"rebaselined_at,omitempty"`
	RebaselineArchive  string    `json:"rebaseline_archive,omitempty"`
	CapitalBudgetUSD   float64   `json:"capital_budget_usd,omitempty"`
}

// NewStore initializes a Store instance.
func NewStore(filePath, cyclesFilePath string) *Store {
	return &Store{
		filePath:             filePath,
		cyclesFilePath:       cyclesFilePath,
		capitalStateFilePath: filePath + ".capital-state.json",
		rebaselineIntentPath: filePath + ".capital-rebaseline.intent",
		replace:              durableReplace,
	}
}

// DefaultStore returns a Store pointing to ~/.gelt/journals/shadow_journal.json.
func DefaultStore() *Store {
	config.MigrateLegacyFiles()
	journalsDir, err := config.UserJournalsDir()
	if err != nil {
		home, _ := os.UserHomeDir()
		journalsDir = filepath.Join(home, ".gelt", "journals")
	}
	path := filepath.Join(journalsDir, "shadow_journal.json")
	home, _ := os.UserHomeDir()
	cyclesPath := filepath.Join(home, ".gemini", "gelt_ensemble_cycles.json")
	return NewStore(path, cyclesPath)
}

func readJSON[T any](path, name string) ([]T, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []T{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", name, err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("parse %s: journal is empty", name)
	}
	var raw json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse %s: %w", name, err)
	}
	if len(raw) == 0 || raw[0] != '[' {
		return nil, fmt.Errorf("parse %s: journal must be a JSON array", name)
	}
	var values []T
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, fmt.Errorf("parse %s: %w", name, err)
	}
	return values, nil
}

func (s *Store) loadTrades() ([]ShadowTrade, error) {
	return readJSON[ShadowTrade](s.filePath, "shadow store")
}
func (s *Store) loadCycles() ([]EnsembleResult, error) {
	return readJSON[EnsembleResult](s.cyclesFilePath, "cycles store")
}

func (s *Store) rebaselineIntentPending() (bool, error) {
	_, err := os.Stat(s.rebaselineIntentPath)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, fmt.Errorf("inspect capital rebaseline intent: %w", err)
}

func (s *Store) loadCapitalReservationState() (CapitalReservationState, error) {
	data, err := os.ReadFile(s.capitalStateFilePath)
	if os.IsNotExist(err) {
		return CapitalReservationState{SchemaVersion: 1}, nil
	}
	if err != nil {
		return CapitalReservationState{}, fmt.Errorf("read capital reservation state: %w", err)
	}
	var state CapitalReservationState
	if err := json.Unmarshal(data, &state); err != nil {
		return CapitalReservationState{}, fmt.Errorf("parse capital reservation state: %w", err)
	}
	if state.SchemaVersion != 1 {
		return CapitalReservationState{}, fmt.Errorf("parse capital reservation state: unsupported schema version %d", state.SchemaVersion)
	}
	if state.Degraded && (state.Reason == "" || state.LatchedAt.IsZero() || !state.RebaselineRequired) {
		return CapitalReservationState{}, fmt.Errorf("parse capital reservation state: degraded state lacks required provenance")
	}
	if state.RebaselinePending && (!state.Degraded || state.RebaselineArchive == "") {
		return CapitalReservationState{}, fmt.Errorf("parse capital reservation state: rebaseline pending state lacks required provenance")
	}
	return state, nil
}

// LoadCapitalReservationState returns durable capital-integrity provenance.
func (s *Store) LoadCapitalReservationState() (CapitalReservationState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadCapitalReservationState()
}

func (s *Store) latchCapitalReservation(reason string) error {
	state, err := s.loadCapitalReservationState()
	if err != nil {
		return err
	}
	if state.Degraded {
		return nil
	}
	state = CapitalReservationState{
		SchemaVersion:      1,
		Degraded:           true,
		Reason:             reason,
		LatchedAt:          time.Now().UTC(),
		RebaselineRequired: true,
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal capital reservation state: %w", err)
	}
	if err := s.replace(s.capitalStateFilePath, data); err != nil {
		return fmt.Errorf("durably latch capital reservation state: %w", err)
	}
	return nil
}

// RebaselineCapitalReservation performs a failure-closed multi-file transition.
// It archives a durable copy while retaining the canonical journal, records a
// durable pending halt, then replaces the canonical journal. Any later failure
// leaves the pending latch and prevents engine mutation or publication.
func (s *Store) RebaselineCapitalReservation() error {
	return s.withMutation(s.filePath, func() error {
		state, err := s.loadCapitalReservationState()
		if err != nil {
			return err
		}
		if !state.Degraded || state.RebaselinePending {
			return fmt.Errorf("%w: no resumable capital rebaseline is available", ErrShadowCapitalDegraded)
		}
		journal, err := os.ReadFile(s.filePath)
		if err != nil {
			return fmt.Errorf("%w: read journal before capital rebaseline: %v", ErrShadowCapitalDegraded, err)
		}
		trades, err := s.loadTrades()
		if err != nil {
			return fmt.Errorf("load journal before capital rebaseline: %w", err)
		}
		if len(trades) == 0 {
			return fmt.Errorf("%w: journal is already empty; refusing unauditable rebaseline", ErrShadowCapitalDegraded)
		}
		archive := s.filePath + ".rebaseline-archive-" + time.Now().UTC().Format("20060102T150405.000000000Z")
		if err := s.replace(archive, journal); err != nil {
			return fmt.Errorf("durably archive tainted shadow journal: %w", err)
		}
		state.RebaselinePending = true
		state.RebaselineArchive = filepath.Base(archive)
		pending, err := json.MarshalIndent(state, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal pending capital rebaseline state: %w", err)
		}
		if err := s.replace(s.capitalStateFilePath, pending); err != nil {
			return fmt.Errorf("durably record pending capital rebaseline: %w", err)
		}
		if err := s.replace(s.rebaselineIntentPath, []byte("pending\n")); err != nil {
			return fmt.Errorf("durably record rebaseline completion intent: %w", err)
		}
		if err := s.replace(s.filePath, []byte("[]\n")); err != nil {
			return fmt.Errorf("create empty shadow journal after pending rebaseline: %w", err)
		}
		complete := CapitalReservationState{SchemaVersion: 1, RebaselinedAt: time.Now().UTC(), RebaselineArchive: filepath.Base(archive)}
		data, err := json.MarshalIndent(complete, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal completed capital rebaseline state: %w", err)
		}
		if err := s.replace(s.capitalStateFilePath, data); err != nil {
			return fmt.Errorf("durably record completed capital rebaseline: %w", err)
		}
		if err := os.Remove(s.rebaselineIntentPath); err != nil {
			return fmt.Errorf("clear rebaseline completion intent: %w", err)
		}
		if err := syncJournalDir(filepath.Dir(s.rebaselineIntentPath)); err != nil {
			// The clean state may be visible even though intent removal is not crash
			// durable. Restore the halt marker before returning; if restoration also
			// fails, surface both errors and leave startup fail-closed on uncertainty.
			if restoreErr := s.replace(s.rebaselineIntentPath, []byte("pending\n")); restoreErr != nil {
				return fmt.Errorf("sync cleared rebaseline completion intent: %w; restore pending intent: %v", err, restoreErr)
			}
			return fmt.Errorf("sync cleared rebaseline completion intent: %w; pending intent restored", err)
		}
		return nil
	})
}

// Load Trades reads shadow trades from disk. Atomic replacement ensures each
// successful read observes a complete old or new document.
func (s *Store) Load() ([]ShadowTrade, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadTrades()
}

func marshalAndReplace[T any](path string, values []T, replace func(string, []byte) error) error {
	data, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal journal: %w", err)
	}
	if err := replace(path, data); err != nil {
		return fmt.Errorf("durably replace journal: %w", err)
	}
	return nil
}

// withMutation serializes a complete journal transaction. The path lock is an
// OS-level lock, so separately-created Stores and other processes cannot lose a
// read-modify-write update. Lock release errors are surfaced to the caller.
func (s *Store) withMutation(path string, mutate func() error) (err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create journal directory: %w", err)
	}
	unlock, err := lockJournal(path)
	if err != nil {
		return err
	}
	defer func() {
		if unlockErr := unlock(); err == nil && unlockErr != nil {
			err = unlockErr
		}
	}()
	return mutate()
}

// Save writes a complete replacement atomically. It first validates any
// existing journal so normal callers cannot silently replace corrupt history.
// Callers that need to mutate existing trades must use AddTrade or UpdateTrades.
func (s *Store) save(trades []ShadowTrade) error {
	return s.withMutation(s.filePath, func() error {
		if _, err := s.loadTrades(); err != nil {
			return fmt.Errorf("load trades before save: %w", err)
		}
		return marshalAndReplace(s.filePath, trades, s.replace)
	})
}

// AddTrade appends a new trade in one serialized read-validate-mutate-replace transaction.
func (s *Store) addTrade(t ShadowTrade) error {
	return s.withMutation(s.filePath, func() error {
		trades, err := s.loadTrades()
		if err != nil {
			return fmt.Errorf("load trades before add: %w", err)
		}
		trades = append(trades, t)
		return marshalAndReplace(s.filePath, trades, s.replace)
	})
}

// VerifyCapitalReservation latches invalid or over-capital OPEN journal state
// before a cycle publishes or promotion consumes its records. It permits MTM
// and liquidation to continue, but callers must suppress new entries when it
// returns ErrShadowCapitalDegraded.
func (s *Store) VerifyCapitalReservation(totalCapitalUSD float64) error {
	return s.withMutation(s.filePath, func() error {
		return s.verifyCapitalReservationLocked(totalCapitalUSD)
	})
}

// WithCapitalReservationGuard verifies capital-integrity provenance and holds
// the same journal lock through fn. Use it for a promotion or alert side effect
// that must not race a concurrent degradation latch.
func (s *Store) WithCapitalReservationGuard(totalCapitalUSD float64, fn func() error) error {
	if fn == nil {
		return fmt.Errorf("capital reservation guard requires an action")
	}
	return s.withMutation(s.filePath, func() error {
		if err := s.verifyCapitalReservationLocked(totalCapitalUSD); err != nil {
			return err
		}
		return fn()
	})
}

// ReserveTrade atomically reserves aggregate capital by appending an OPEN
// shadow trade. The capacity decision and append share the path-scoped journal
// lock, so separate engines or Store instances cannot over-allocate between a
// capacity check and the journal write.
func (s *Store) ReserveTrade(t ShadowTrade, totalCapitalUSD float64) error {
	if t.Status != "OPEN" || !isValidReservationAmount(t.AmountUSD) {
		return fmt.Errorf("%w: new OPEN trade with a positive finite amount is required", ErrInvalidShadowReservation)
	}
	if !isCanonicalIdentity(t.ID) || !isCanonicalIdentity(t.PlanName) || !isCanonicalIdentity(t.Symbol) {
		return fmt.Errorf("%w: new OPEN trade identity fields must be NFC without surrounding whitespace", ErrInvalidShadowReservation)
	}
	if t.ID == "" || t.PlanName == "" || t.Symbol == "" {
		return fmt.Errorf("%w: new OPEN trade requires non-blank ID, plan name, and symbol", ErrInvalidShadowReservation)
	}
	return s.withMutation(s.filePath, func() error {
		if err := s.verifyCapitalReservationLocked(totalCapitalUSD); err != nil {
			return err
		}
		trades, err := s.loadTrades()
		if err != nil {
			return fmt.Errorf("load trades before reserve: %w", err)
		}
		for _, existing := range trades {
			if sameIdentity(existing.ID, t.ID) {
				return fmt.Errorf("%w: duplicate trade ID %q", ErrInvalidShadowReservation, t.ID)
			}
			if existing.Status == "OPEN" && sameIdentity(existing.PlanName, t.PlanName) && sameIdentity(existing.Symbol, t.Symbol) {
				return fmt.Errorf("%w: open position already exists for plan %q and symbol %q", ErrInvalidShadowReservation, t.PlanName, t.Symbol)
			}
		}
		deployed := totalPersistedOpenDeployment(trades)
		if t.AmountUSD > totalCapitalUSD-deployed {
			return fmt.Errorf("%w: requested $%.2f with $%.2f capacity remaining", ErrInsufficientShadowCapital, t.AmountUSD, totalCapitalUSD-deployed)
		}
		trades = append(trades, t)
		return marshalAndReplace(s.filePath, trades, s.replace)
	})
}

func (s *Store) verifyCapitalReservationLocked(totalCapitalUSD float64) error {
	return s.verifyCapitalReservationLockedMode(totalCapitalUSD, true)
}

// verifyCapitalReservationLockedNonBinding validates journal integrity without
// initializing or changing the canonical journal budget. It is for read-only
// operational views such as the performance leaderboard.
func (s *Store) verifyCapitalReservationLockedNonBinding() error {
	state, err := s.loadCapitalReservationState()
	if err != nil {
		return err
	}
	return s.verifyCapitalReservationLockedMode(state.CapitalBudgetUSD, false)
}

func (s *Store) verifyCapitalReservationLockedMode(totalCapitalUSD float64, bindBudget bool) error {
	if pending, err := s.rebaselineIntentPending(); err != nil {
		return err
	} else if pending {
		return fmt.Errorf("%w: %w", ErrShadowCapitalDegraded, ErrShadowRebaselinePending)
	}
	state, err := s.loadCapitalReservationState()
	if err != nil {
		return err
	}
	if bindBudget {
		if !isValidReservationAmount(totalCapitalUSD) {
			return fmt.Errorf("%w: positive finite total budget is required", ErrInvalidShadowReservation)
		}
		if state.CapitalBudgetUSD == 0 {
			state.CapitalBudgetUSD = totalCapitalUSD
			data, marshalErr := json.MarshalIndent(state, "", "  ")
			if marshalErr != nil {
				return fmt.Errorf("marshal canonical shadow capital budget: %w", marshalErr)
			}
			if replaceErr := s.replace(s.capitalStateFilePath, data); replaceErr != nil {
				return fmt.Errorf("durably bind canonical shadow capital budget: %w", replaceErr)
			}
		} else if state.CapitalBudgetUSD != totalCapitalUSD {
			return fmt.Errorf("%w: configured budget $%.2f differs from journal budget $%.2f", ErrInvalidShadowReservation, totalCapitalUSD, state.CapitalBudgetUSD)
		}
	} else if state.CapitalBudgetUSD > 0 {
		totalCapitalUSD = state.CapitalBudgetUSD
	}
	trades, err := s.loadTrades()
	if err != nil {
		return fmt.Errorf("load trades before capital verification: %w", err)
	}
	// Identity integrity is always scanned before an existing generic latch is
	// returned: it is unsafe to conditionally mutate an ambiguous journal.
	for i, existing := range trades {
		id := strings.TrimSpace(existing.ID)
		if !isCanonicalIdentity(existing.ID) || id == "" {
			return s.identityDegradation("blank_or_noncanonical_trade_id")
		}
		for _, prior := range trades[:i] {
			if sameIdentity(prior.ID, existing.ID) {
				return s.identityDegradation("duplicate_trade_id")
			}
		}
		if existing.Status != "OPEN" && existing.Status != "CLOSED" {
			if err := s.latchCapitalReservation("invalid_trade_status"); err != nil {
				return err
			}
			return fmt.Errorf("%w: %w: invalid trade status %q", ErrShadowCapitalDegraded, ErrShadowJournalHalted, existing.Status)
		}
		if existing.Status != "OPEN" {
			continue
		}
		plan, symbol := strings.TrimSpace(existing.PlanName), strings.TrimSpace(existing.Symbol)
		if !isCanonicalIdentity(existing.PlanName) || !isCanonicalIdentity(existing.Symbol) || plan == "" || symbol == "" {
			return s.identityDegradation("blank_or_noncanonical_open_identity")
		}
		for _, prior := range trades[:i] {
			if prior.Status == "OPEN" && sameIdentity(prior.PlanName, existing.PlanName) && sameIdentity(prior.Symbol, existing.Symbol) {
				return s.identityDegradation("duplicate_open_plan_symbol")
			}
		}
	}
	if state.Degraded {
		if state.RebaselinePending {
			return fmt.Errorf("%w: %w", ErrShadowCapitalDegraded, ErrShadowRebaselinePending)
		}
		if isIdentityDegradationReason(state.Reason) {
			return fmt.Errorf("%w: %w: %s", ErrShadowCapitalDegraded, ErrShadowIdentityDegraded, state.Reason)
		}
		return fmt.Errorf("%w: %s", ErrShadowCapitalDegraded, state.Reason)
	}
	var deployed float64
	for _, existing := range trades {
		if existing.Status != "OPEN" {
			continue
		}
		if !isValidReservationAmount(existing.AmountUSD) {
			if err := s.latchCapitalReservation("invalid_open_amount"); err != nil {
				return err
			}
			return fmt.Errorf("%w: open trade %q has invalid amount_usd", ErrShadowCapitalDegraded, existing.ID)
		}
		deployed += existing.AmountUSD
		if math.IsInf(deployed, 0) || math.IsNaN(deployed) {
			if err := s.latchCapitalReservation("non_finite_open_deployment"); err != nil {
				return err
			}
			return fmt.Errorf("%w: open deployment is not finite", ErrShadowCapitalDegraded)
		}
	}
	if totalCapitalUSD > 0 && deployed > totalCapitalUSD {
		if err := s.latchCapitalReservation("open_deployment_exceeds_budget"); err != nil {
			return err
		}
		return fmt.Errorf("%w: persisted open deployment $%.2f exceeds budget $%.2f", ErrShadowCapitalDegraded, deployed, totalCapitalUSD)
	}
	return nil
}

func (s *Store) identityDegradation(reason string) error {
	if err := s.latchCapitalReservation(reason); err != nil {
		return err
	}
	return fmt.Errorf("%w: %w: %s", ErrShadowCapitalDegraded, ErrShadowIdentityDegraded, reason)
}

func isCanonicalIdentity(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && norm.NFC.IsNormalString(value)
}

func sameIdentity(left, right string) bool {
	return strings.EqualFold(norm.NFC.String(left), norm.NFC.String(right))
}

func (s *Store) haltStateLocked() error {
	if pending, err := s.rebaselineIntentPending(); err != nil {
		return err
	} else if pending {
		return fmt.Errorf("%w: %w", ErrShadowCapitalDegraded, ErrShadowRebaselinePending)
	}
	state, err := s.loadCapitalReservationState()
	if err != nil {
		return err
	}
	if state.RebaselinePending {
		return fmt.Errorf("%w: %w", ErrShadowCapitalDegraded, ErrShadowRebaselinePending)
	}
	if isIdentityDegradationReason(state.Reason) {
		return fmt.Errorf("%w: %w: %s", ErrShadowCapitalDegraded, ErrShadowIdentityDegraded, state.Reason)
	}
	if state.Reason == "invalid_trade_status" {
		return fmt.Errorf("%w: %w", ErrShadowCapitalDegraded, ErrShadowJournalHalted)
	}
	return nil
}

func isIdentityDegradationReason(reason string) bool {
	switch reason {
	case "blank_trade_id", "noncanonical_trade_id", "blank_or_noncanonical_trade_id", "duplicate_trade_id", "blank_open_identity", "noncanonical_open_identity", "blank_or_noncanonical_open_identity", "duplicate_open_plan_symbol":
		return true
	default:
		return false
	}
}

func isValidReservationAmount(amount float64) bool {
	return amount > 0 && !math.IsNaN(amount) && !math.IsInf(amount, 0)
}

func sortTradesByTime(trades []ShadowTrade) {
	sort.Slice(trades, func(i, j int) bool {
		ti := trades[i].ExitTime
		if ti.IsZero() {
			ti = trades[i].EntryTime
		}
		tj := trades[j].ExitTime
		if tj.IsZero() {
			tj = trades[j].EntryTime
		}
		return ti.Before(tj)
	})
}

// GetPerformance computes stats per plan.
func (s *Store) GetPerformance(livePlanName string) ([]PlanPerformance, error) {
	// Performance output is an operational claim. Reject degraded or malformed
	// journals rather than rendering an untrusted leaderboard as normal.
	var trades []ShadowTrade
	if err := s.withMutation(s.filePath, func() error {
		if err := s.verifyCapitalReservationLockedNonBinding(); err != nil {
			return err
		}
		var err error
		trades, err = s.loadTrades()
		return err
	}); err != nil {
		return nil, fmt.Errorf("shadow performance is unavailable while journal integrity is untrusted: %w", err)
	}
	planTradesMap := make(map[string][]ShadowTrade)
	for _, t := range trades {
		planTradesMap[t.PlanName] = append(planTradesMap[t.PlanName], t)
	}
	var list []PlanPerformance
	for planName, planTrades := range planTradesMap {
		sortTradesByTime(planTrades)
		p := PlanPerformance{PlanName: planName, IsLive: planName == livePlanName}
		var grossProfit, grossLoss, cumPnL, peakPnL, maxDD float64
		for _, t := range planTrades {
			if t.Status == "OPEN" {
				p.OpenTrades++
				continue
			}
			if !isFinitePromotionValue(t.PnLUSD) {
				return nil, fmt.Errorf("shadow performance is unavailable: closed trade %q has non-finite pnl", t.ID)
			}
			p.TotalTrades++
			p.TotalPnLUSD += t.PnLUSD
			if !isFinitePromotionValue(p.TotalPnLUSD) {
				return nil, fmt.Errorf("shadow performance is unavailable: closed pnl total overflowed for plan %q", planName)
			}
			if t.PnLUSD > 0 {
				p.WinCount++
				grossProfit += t.PnLUSD
			} else if t.PnLUSD < 0 {
				p.LossCount++
				grossLoss += math.Abs(t.PnLUSD)
			}
			cumPnL += t.PnLUSD
			if !isFinitePromotionValue(grossProfit) || !isFinitePromotionValue(grossLoss) || !isFinitePromotionValue(cumPnL) {
				return nil, fmt.Errorf("shadow performance is unavailable: aggregate metric overflowed for plan %q", planName)
			}
			if cumPnL > peakPnL {
				peakPnL = cumPnL
			}
			if dd := peakPnL - cumPnL; dd > maxDD {
				maxDD = dd
			}
		}
		if p.TotalTrades > 0 {
			p.WinRate = float64(p.WinCount) / float64(p.TotalTrades) * 100
		}
		if grossLoss > 0 {
			p.ProfitFactor = grossProfit / grossLoss
		} else if grossProfit > 0 {
			// Undefined all-win profit factor is deliberately rendered as unavailable
			// (zero), never as an infinite operational performance claim.
			p.ProfitFactor = 0
		}
		if p.WinCount > 0 {
			p.AvgWin = grossProfit / float64(p.WinCount)
		}
		if p.LossCount > 0 {
			p.AvgLoss = grossLoss / float64(p.LossCount)
		}
		p.MaxDrawdown = maxDD
		if !isFinitePromotionValue(p.WinRate) || !isFinitePromotionValue(p.ProfitFactor) || !isFinitePromotionValue(p.AvgWin) || !isFinitePromotionValue(p.AvgLoss) || !isFinitePromotionValue(p.MaxDrawdown) {
			return nil, fmt.Errorf("shadow performance is unavailable: derived metric is non-finite for plan %q", planName)
		}
		list = append(list, p)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].TotalPnLUSD > list[j].TotalPnLUSD })
	return list, nil
}

// UpdateTrades atomically replaces matching IDs while preserving concurrent appends
// and updates that happened before this transaction acquired the journal lock.
func (s *Store) updateTrades(updatedTrades []ShadowTrade) error {
	return s.withMutation(s.filePath, func() error {
		trades, err := s.loadTrades()
		if err != nil {
			return fmt.Errorf("load trades before update: %w", err)
		}
		updatedMap := make(map[string]ShadowTrade, len(updatedTrades))
		for _, t := range updatedTrades {
			updatedMap[t.ID] = t
		}
		for i, trade := range trades {
			if updated, ok := updatedMap[trade.ID]; ok {
				trades[i] = updated
			}
		}
		return marshalAndReplace(s.filePath, trades, s.replace)
	})
}

// UpdateTradesIfCurrent applies updates only when their corresponding expected
// records still match the current journal. It prevents a caller which computed
// an update outside the journal lock from replacing a newer same-record commit.
// Concurrent appends and unrelated trade updates are preserved.
func (s *Store) updateTradesIfCurrent(expectedTrades, updatedTrades []ShadowTrade) error {
	if s.beforeConditionalUpdate != nil {
		s.beforeConditionalUpdate()
	}
	return s.withMutation(s.filePath, func() error {
		if err := s.haltStateLocked(); err != nil {
			return err
		}
		if len(expectedTrades) == 0 || len(expectedTrades) != len(updatedTrades) {
			return fmt.Errorf("%w: expected and updated trade sets must be non-empty and equal-sized", ErrJournalConflict)
		}
		expected := make(map[string]ShadowTrade, len(expectedTrades))
		updates := make(map[string]ShadowTrade, len(updatedTrades))
		for _, trade := range expectedTrades {
			if trade.ID == "" {
				return fmt.Errorf("%w: expected trade has empty ID", ErrJournalConflict)
			}
			if _, duplicate := expected[trade.ID]; duplicate {
				return fmt.Errorf("%w: duplicate expected trade ID %q", ErrJournalConflict, trade.ID)
			}
			expected[trade.ID] = trade
		}
		for _, trade := range updatedTrades {
			if trade.ID == "" {
				return fmt.Errorf("%w: updated trade has empty ID", ErrJournalConflict)
			}
			if _, duplicate := updates[trade.ID]; duplicate {
				return fmt.Errorf("%w: duplicate updated trade ID %q", ErrJournalConflict, trade.ID)
			}
			if _, ok := expected[trade.ID]; !ok {
				return fmt.Errorf("%w: updated trade ID %q has no expected record", ErrJournalConflict, trade.ID)
			}
			updates[trade.ID] = trade
		}

		trades, err := s.loadTrades()
		if err != nil {
			return fmt.Errorf("load trades before conditional update: %w", err)
		}
		current := make(map[string]int, len(trades))
		for i, trade := range trades {
			if _, duplicate := current[trade.ID]; duplicate {
				return fmt.Errorf("%w: duplicate current trade ID %q", ErrJournalConflict, trade.ID)
			}
			current[trade.ID] = i
		}
		for id, before := range expected {
			i, ok := current[id]
			if !ok {
				return fmt.Errorf("%w: expected trade %q is missing", ErrJournalConflict, id)
			}
			if !reflect.DeepEqual(trades[i], before) {
				return fmt.Errorf("%w: trade %q changed before update", ErrJournalConflict, id)
			}
		}
		for id, updated := range updates {
			trades[current[id]] = updated
		}
		return marshalAndReplace(s.filePath, trades, s.replace)
	})
}

// SaveCycleResultGuarded appends a cycle only while the journal's current
// integrity state permits publication. It takes the journal lock first, then
// the independent cycle-artifact lock, preventing a halt-class transition from
// being published as a normal cycle after its snapshot was obtained.
func (s *Store) SaveCycleResultGuarded(totalCapitalUSD float64, result EnsembleResult) error {
	return s.withMutation(s.filePath, func() error {
		if err := s.verifyCapitalReservationLocked(totalCapitalUSD); err != nil {
			return err
		}
		if err := s.haltStateLocked(); err != nil {
			return err
		}
		// The journal lock remains held until the cycle artifact is durably
		// replaced, so a concurrent journal mutation cannot invalidate this
		// snapshot before publication. Do not call withMutation here: Store's
		// in-process mutex is intentionally non-reentrant.
		results, err := s.loadCycles()
		if err != nil {
			return fmt.Errorf("load cycles before append: %w", err)
		}
		results = append(results, result)
		return marshalAndReplace(s.cyclesFilePath, results, s.replace)
	})
}

// LoadCycleResults reads cycle results from disk.
func (s *Store) LoadCycleResults() ([]EnsembleResult, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadCycles()
}
