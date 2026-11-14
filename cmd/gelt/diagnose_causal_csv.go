package main

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"unicode/utf8"

	"gelt/pkg/backtest"
)

const (
	diagnoseCausalCSVUsage       = "Usage: gelt diagnose-causal-csv <DataFile.csv>\n"
	diagnoseCausalCSVMaxBytes    = 512
	diagnoseCausalCSVUnavailable = "diagnose-causal-csv: diagnostic_unavailable\n"
)

type causalCSVDiagnostic struct {
	Code, Field, Reason string
	Line                int // zero is the fixed absence sentinel, rendered as none
}

// runDiagnoseCausalCSV checks only the explicitly supplied file. It never
// constructs an engine, resolves configuration or interprets trading inputs.
func runDiagnoseCausalCSV(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 {
		return failDiagnoseCausalCSV(stderr, causalCSVDiagnostic{
			Code: "invalid_arguments", Field: "none", Reason: "invalid_arguments",
		}, true)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		return failDiagnoseCausalCSV(stderr, canceledCausalCSVDiagnostic(), false)
	}
	f, err := openOfflineCSV(args[0])
	if err != nil {
		return failDiagnoseCausalCSV(stderr, causalCSVDiagnostic{
			Code: "input_file", Field: "none", Reason: "open_failed",
		}, false)
	}
	return diagnoseCausalCSVRead(ctx, f, stdout, stderr)
}

// diagnoseCausalCSVRead owns the admitted descriptor and makes exactly one
// close attempt, even after a read or syntax failure. Context checks do not
// interrupt a blocked read or impose a filesystem deadline.
func diagnoseCausalCSVRead(ctx context.Context, input io.ReadCloser, stdout, stderr io.Writer) int {
	bars, issue := parseDetailedCausalCSV(input)
	closeErr := input.Close()
	if issue != nil {
		return failDiagnoseCausalCSV(stderr, causalCSVDiagnostic{
			Code: string(issue.Code), Line: issue.Line, Field: issue.Field, Reason: issue.Reason,
		}, false)
	}
	if closeErr != nil {
		return failDiagnoseCausalCSV(stderr, causalCSVDiagnostic{
			Code: "input_file", Field: "none", Reason: "close_failed",
		}, false)
	}
	if ctx.Err() != nil {
		return failDiagnoseCausalCSV(stderr, canceledCausalCSVDiagnostic(), false)
	}
	if issue := backtest.DiagnoseCausalBars(bars); issue != nil {
		diagnostic, ok := causalBarsDiagnostic(issue, len(bars))
		if !ok {
			return writeDiagnoseCausalCSVFailure(stderr, diagnoseCausalCSVUnavailable)
		}
		return failDiagnoseCausalCSV(stderr, diagnostic, false)
	}
	if ctx.Err() != nil {
		return failDiagnoseCausalCSV(stderr, canceledCausalCSVDiagnostic(), false)
	}
	body, ok := diagnoseCausalCSVSuccess(len(bars))
	if !ok {
		return writeDiagnoseCausalCSVFailure(stderr, diagnoseCausalCSVUnavailable)
	}
	if stdout != nil {
		n, err := stdout.Write([]byte(body))
		if err == nil && n == len(body) {
			return 0
		}
	}
	return writeDiagnoseCausalCSVFailure(stderr, "diagnose-causal-csv: output_error\n")
}

func canceledCausalCSVDiagnostic() causalCSVDiagnostic {
	return causalCSVDiagnostic{Code: "canceled", Field: "none", Reason: "canceled"}
}

// causalBarsDiagnostic checks the public issue against the actual parsed input
// length before converting its zero-based index into a physical CSV line.
func causalBarsDiagnostic(issue *backtest.CausalInputIssue, rows int) (causalCSVDiagnostic, bool) {
	if issue == nil || rows < 0 {
		return causalCSVDiagnostic{}, false
	}
	d := causalCSVDiagnostic{Code: string(issue.Code), Field: issue.Field, Reason: issue.Reason}
	switch {
	case rows == 0:
		if issue.Code != backtest.CausalInvalidInput || issue.BarIndex != -1 ||
			issue.Field != "none" || issue.Reason != "empty_input" {
			return causalCSVDiagnostic{}, false
		}
	case rows > backtest.CausalMaxBars:
		if issue.Code != backtest.CausalResourceLimit || issue.BarIndex != -1 ||
			issue.Field != "none" || issue.Reason != "row_limit" {
			return causalCSVDiagnostic{}, false
		}
	default:
		if issue.Code != backtest.CausalInvalidInput || issue.BarIndex < 0 || issue.BarIndex >= rows {
			return causalCSVDiagnostic{}, false
		}
		d.Line = issue.BarIndex + 2
		if issue.Reason == "empty_input" {
			return causalCSVDiagnostic{}, false
		}
	}
	_, ok := causalCSVDiagnosticText(d)
	return d, ok
}

func causalCSVNumericField(field string) bool {
	switch field {
	case "Timestamp", "Open", "High", "Low", "Close", "Volume":
		return true
	default:
		return false
	}
}

// causalCSVDiagnosticText is a closed vocabulary/coordinate boundary, not a
// formatter for arbitrary errors. Validate combinations before any rendering.
func causalCSVDiagnosticText(d causalCSVDiagnostic) (string, bool) {
	absent := d.Line == 0 && d.Field == "none"
	dataLine := d.Line >= 2 && d.Line <= backtest.CausalMaxBars+1
	valid := false
	switch d.Code {
	case "resource_limit":
		valid = absent && (d.Reason == "byte_limit" || d.Reason == "row_limit")
	case "input_file":
		valid = absent && (d.Reason == "open_failed" || d.Reason == "read_failed" || d.Reason == "close_failed")
	case "invalid_csv":
		switch d.Reason {
		case "invalid_utf8", "missing_data":
			valid = absent
		case "header_mismatch":
			valid = d.Line == 1 && d.Field == "none"
		case "field_count":
			valid = dataLine && d.Field == "none"
		case "noncanonical_number", "token_too_long", "number_conversion":
			valid = dataLine && causalCSVNumericField(d.Field)
		}
	case "invalid_input":
		switch d.Reason {
		case "empty_input":
			valid = absent
		case "out_of_range":
			valid = dataLine && causalCSVNumericField(d.Field)
		case "not_strictly_increasing":
			valid = dataLine && d.Line >= 3 && d.Field == "Timestamp"
		case "inconsistent_ohlc":
			valid = dataLine && d.Field == "OHLC"
		}
	case "canceled":
		valid = absent && d.Reason == "canceled"
	case "invalid_arguments":
		valid = absent && d.Reason == "invalid_arguments"
	}
	if !valid {
		return "", false
	}
	line := "none"
	if d.Line != 0 {
		line = strconv.Itoa(d.Line)
	}
	body := "diagnose-causal-csv: " + d.Code + " line=" + line + " field=" + d.Field + " reason=" + d.Reason + "\n"
	return body, validDiagnoseCausalCSVBody(body)
}

func validDiagnoseCausalCSVBody(body string) bool {
	return len(body) > 0 && len(body) <= diagnoseCausalCSVMaxBytes && utf8.ValidString(body)
}

func diagnoseCausalCSVSuccess(rows int) (string, bool) {
	if rows < 1 || rows > backtest.CausalMaxBars {
		return "", false
	}
	body := fmt.Sprintf("Causal CSV syntax/domain check: passed\nData rows: %d\n"+
		"Scope: unqualified input only; symbol, costs, warmup, strategy and operating admission not checked.\n", rows)
	return body, validDiagnoseCausalCSVBody(body)
}

func failDiagnoseCausalCSV(stderr io.Writer, diagnostic causalCSVDiagnostic, usage bool) int {
	body, ok := causalCSVDiagnosticText(diagnostic)
	if usage {
		ok = ok && diagnostic.Code == "invalid_arguments"
		body = diagnoseCausalCSVUsage + body
	}
	if !ok || !validDiagnoseCausalCSVBody(body) {
		body = diagnoseCausalCSVUnavailable
	}
	return writeDiagnoseCausalCSVFailure(stderr, body)
}

func writeDiagnoseCausalCSVFailure(stderr io.Writer, body string) int {
	if !validDiagnoseCausalCSVBody(body) {
		body = diagnoseCausalCSVUnavailable
	}
	if stderr != nil {
		_, _ = stderr.Write([]byte(body))
	}
	return 1
}
