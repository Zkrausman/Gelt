package main

import (
	"io"
	"unicode/utf8"
)

const offlineHelpMaxBytes = 16384

const offlineCommandList = `Supplied-CSV offline commands:
  backtest-causal                         BreakoutVol reference replay
  backtest-causal-funded                  BreakoutVol declared-cash diagnostic
  backtest-causal-fees                    BreakoutVol filled-side fee diagnostic
  backtest-causal-execution               BreakoutVol adverse execution-price diagnostic
  backtest-causal-compare                 BreakoutVol strategy/cash/passive, whole input
  backtest-causal-window-compare          BreakoutVol strategy/cash/passive, selected period
  backtest-causal-trend50-compare          TrendConfluence strategy/cash/passive, whole input
  backtest-causal-trend50-window-compare   TrendConfluence strategy/cash/passive, selected period
  backtest-causal-meanrev-compare          MeanReversion strategy/cash/passive, whole or --window
`

const offlineInputHelp = `Input and declarations:
  On Linux, CSV inputs must be regular files; symlinks to regular files work.
  FIFOs, directories and devices are rejected with input_file.
  CSV header must be exactly Timestamp,Open,High,Low,Close,Volume.
  Supply strictly increasing Unix-second timestamps in 1..253402300799.
  Use canonical unsigned ASCII numeric tokens: no leading-zero integer parts,
  quoting, BOM, whitespace, signs or exponents. LF and CRLF are accepted.
  Limits: 1 MiB (1048576 bytes), 10000 rows, 32 bytes per numeric token.
  Finite OHLC prices must be 0.01..1000000; Low <= Open/Close <= High;
  volume must be 0..1e12. Prices use float64 parsing, not exact decimals.
  Where declared: cash is fixed8 (up to 8 decimal places) in 0..1000000;
  fixed filled-side fee is fixed8 in 0..<10; fee bps 0..10000;
  buy/sell adverse bps 0..9999. Rates are unsigned integer tokens.
  A simulated entry cap is 10 inclusive of entry fee. No cash resizing, loan,
  forced terminal sell or SELL cost without a SELL. Costs/defaults are
  uncalibrated assumptions.

Selected periods:
  START is inclusive; END is exclusive. Use exact supplied timestamps, except
  END may be the complete source's last timestamp plus one second (not the
  next cadence interval). Require a nonempty score interval and exactly the
  profile's 20 or 50 preceding warmup rows. All original rows, including excluded
  rows, are validated. Finite-prefix strategy reseeding can differ from filtering
  a whole-history run, including RSI/EMA memory.

Limits of interpretation:
  Supplied-data authenticity, adequate/converged history, cadence/session
  eligibility, statistical edge, profitability and operating admission remain
  unestablished. These are supplied-data simulations with no live acquisition.
`

const offlineChooserHelp = `Gelt supplied-CSV offline chooser

` + offlineCommandList + `
Strategy and period:
  BreakoutVol: backtest-causal-compare for whole input;
    backtest-causal-window-compare for a selected period.
    Fixed 20-close warmup; first evaluation index 19; first eligible fill index 20.
  TrendConfluence: backtest-causal-trend50-compare for whole input;
    backtest-causal-trend50-window-compare for a selected period.
    Fixed 50-close warmup; first evaluation index 49; first eligible fill index 50.
  MeanReversion: backtest-causal-meanrev-compare for whole input;
    append --window START END for a selected period.
    Fixed 20-close warmup; first evaluation index 19; first eligible fill index 20.
  Indices are zero-based. Comparisons include the strategy, flat cash and one
  passive lot. Reference/funded/fees/execution commands are separate diagnostics.

Get exact syntax: gelt help NAME (or NAME --help / NAME -h).
Example: gelt help backtest-causal-trend50-window-compare

` + offlineInputHelp

const offlineBreakoutProfile = `Profile: literal target BreakoutVol only; no plan routes.
Fixed 20-close warmup; first evaluation index 19; first eligible next-open fill index 20.
`
const offlineTrendProfile = `Profile: literal target TrendConfluence only; fixed 50-close profile and warmup.
First evaluation index 49; first eligible next-open fill index 50.
`
const offlineMeanProfile = `Profile: literal target MeanReversion only; owned defaults, fixed 20-close warmup.
First evaluation index 19; first eligible next-open fill index 20.
Bollinger 20 x2, RSI14 thresholds 35/65, ATR proxy14 stop/target 0.5/1.5;
defaults are uncalibrated. Append --window START END after the cost declarations.
`

func globalHelp(version string) string {
	return "Gelt Agentic Trading Suite (" + version + ")\nUsage: gelt <command> [arguments]\n\n" +
		offlineCommandList + "\nStart with gelt help offline; get exact syntax with gelt help NAME.\n\n" +
		"Other commands:\n" + otherCommandHelp
}

const otherCommandHelp = `  version                              Show Gelt CLI version
  status / telemetry                   Display live session telemetry & portfolio dashboard
  risk                                 Display configured equity risk governance limits
  options-risk                         Display configured options risk governance limits
  signals [SYMBOL]                     Evaluate technical indicators and confluence score
  scan [MIN_SCORE]                     Scan watchlist universe and rank by Confluence Score
  monitor                              Inspect active position trailing-stops and exit triggers
  buy <SYMBOL> [AMOUNT_USD]            Execute risk-governed buy order & log thesis to Thneed
  sell <SYMBOL> [AMOUNT_USD]           Execute sell/exit order & log thesis to Thneed
  test-suite                           Run pre-market diagnostic health checks
  health                               Run pre-market broker integration diagnostic checks
  thesis                               Display logged trade rationales and Thneed self-doc history
  strategies / catalog                 Display Gelt Quantitative Strategy Catalog
  plan [active|list]                    Display active or available trading plans (activation is daemon-owned)
  shadow                               Display live vs shadow trading plan performance leaderboard
  shadow cycles [--latest] [--symbol=] [--json] Emit full scan cycle snapshots
  shadow capital-rebaseline --acknowledge-empty-journal-rebaseline Clear a capital-integrity latch only after manually archiving the journal
  regime [VIX]                         Monitor market regime indicators and display volatility alerts
  macro [SERIES_ID]                    Fetch FRED macro data asynchronously (EFFR rates)
  auth / login                         Authenticate with Robinhood Agentic Account via OAuth browser login
  config set-url <URL>                 Configure Robinhood Agentic Trading MCP Server URL
  dashboard / serve                    Launch the telemetry server and open the Web Dashboard
  backtest <Plan|Strategy> <Symbol> [DataFile.csv | Days] Run legacy CSV/generated-synthetic diagnostic
`

// offlineDetailHelp uses the existing syntax constants without invoking handlers.
func offlineDetailHelp(topic string) (string, bool) {
	var usage, purpose, profile string
	switch topic {
	case "backtest-causal":
		usage = causalCLIUsage
		purpose = "Purpose: reference signal/next-open replay; no declared-cash or fee scenario.\n"
		profile = offlineBreakoutProfile
	case "backtest-causal-funded":
		usage = fundedCLIUsage
		purpose = "Purpose: declared-cash affordability diagnostic with zero modeled costs.\n"
		profile = offlineBreakoutProfile
	case "backtest-causal-fees":
		usage = feeScenarioCLIUsage
		purpose = "Purpose: declared-cash diagnostic with fixed and bps fees on filled sides.\n"
		profile = offlineBreakoutProfile
	case "backtest-causal-execution":
		usage = executionScenarioCLIUsage
		purpose = "Purpose: declared-cash/fee diagnostic with adverse buy/sell execution prices.\n"
		profile = offlineBreakoutProfile
	case "backtest-causal-compare":
		usage = comparisonCLIUsage
		purpose = "Purpose: whole-input strategy, flat-cash and one-passive-lot comparison.\n"
		profile = offlineBreakoutProfile
	case "backtest-causal-window-compare":
		usage = windowCLIUsage
		purpose = "Purpose: selected-period strategy, flat-cash and one-passive-lot comparison.\nSTART/END precede cash and cost declarations in this command.\n"
		profile = offlineBreakoutProfile
	case "backtest-causal-trend50-compare":
		usage = trend50CLIUsage
		purpose = "Purpose: whole-input strategy, flat-cash and one-passive-lot comparison.\n"
		profile = offlineTrendProfile
	case "backtest-causal-trend50-window-compare":
		usage = trend50WindowCLIUsage
		purpose = "Purpose: selected-period strategy, flat-cash and one-passive-lot comparison.\nSTART/END precede cash and cost declarations in this command.\n"
		profile = offlineTrendProfile
	case "backtest-causal-meanrev-compare":
		usage = mean20CLIUsage
		purpose = "Purpose: whole-input or selected-period strategy, flat-cash and one-passive-lot comparison.\n"
		profile = offlineMeanProfile
	default:
		return "", false
	}
	return usage + "\n" + purpose + profile + "\n" + offlineInputHelp, true
}

// runOfflineHelp claims only the closed help grammar; other arguments keep normal dispatch.
func runOfflineHelp(args []string, stdout, stderr io.Writer) (handled bool, code int) {
	if len(args) == 0 {
		return false, 0
	}
	switch args[0] {
	case "help", "--help", "-h":
		switch len(args) {
		case 1:
			return true, writeOfflineHelp(globalHelp(Version), stdout, stderr)
		case 2:
			if args[1] == "offline" {
				return true, writeOfflineHelp(offlineChooserHelp, stdout, stderr)
			}
			if body, ok := offlineDetailHelp(args[1]); ok {
				return true, writeOfflineHelp(body, stdout, stderr)
			}
			return true, offlineHelpFail(stderr, "gelt help: unsupported_topic\n")
		default:
			return true, offlineHelpFail(stderr, "gelt help: invalid_arguments\n")
		}
	}
	if len(args) == 2 && (args[1] == "--help" || args[1] == "-h") {
		if body, ok := offlineDetailHelp(args[0]); ok {
			return true, writeOfflineHelp(body, stdout, stderr)
		}
	}
	return false, 0
}

func writeOfflineHelp(body string, stdout, stderr io.Writer) int {
	if len(body) == 0 || len(body) > offlineHelpMaxBytes || !utf8.ValidString(body) {
		return offlineHelpFail(stderr, "gelt help: invalid_output\n")
	}
	if stdout == nil {
		return offlineHelpFail(stderr, "gelt help: output_error\n")
	}
	n, err := stdout.Write([]byte(body))
	if err != nil || n != len(body) {
		return offlineHelpFail(stderr, "gelt help: output_error\n")
	}
	return 0
}

func offlineHelpFail(stderr io.Writer, diagnostic string) int {
	if stderr != nil {
		_, _ = stderr.Write([]byte(diagnostic))
	}
	return 1
}
