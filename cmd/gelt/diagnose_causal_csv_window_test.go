package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
)

const windowDiagnostic = "diagnose-causal-csv: invalid_window line=none field=none reason=invalid_window\n"

func windowDiagnosticCSV(last string) string {
	rows := make([]string, 52)
	for i := range rows {
		rows[i] = fmt.Sprintf("%d,1,1,1,1,0", 100+i*2)
	}
	if last != "" {
		rows[len(rows)-1] = last
	}
	return causalCLITestCSV(strings.Join(rows, "\n"))
}

func TestDiagnoseCausalCSVWindowWarmup(t *testing.T) {
	for _, tc := range []struct {
		start, end, rows, warmup20, warmup50 string
	}{
		{"138", "146", "4", "insufficient", "insufficient"},
		{"140", "146", "3", "eligible", "insufficient"},
		{"198", "203", "3", "eligible", "insufficient"},
		{"200", "203", "2", "eligible", "eligible"},
		{"200", "202", "1", "eligible", "eligible"},
	} {
		t.Run(tc.start+"_"+tc.end, func(t *testing.T) {
			input := &diagnosticReadCloser{reader: strings.NewReader(windowDiagnosticCSV(""))}
			var stdout, stderr bytes.Buffer
			opens := 0
			code := runDiagnoseCausalCSVWithOpen(nil, []string{"PRIVATE_PATH", "--window", tc.start, tc.end}, &stdout, &stderr, func(path string) (io.ReadCloser, error) {
				opens++
				if path != "PRIVATE_PATH" {
					t.Fatalf("unexpected admitted operand %q", path)
				}
				return input, nil
			})
			want := fmt.Sprintf("Causal CSV window preflight: passed\nScored rows: %s\n20-row warmup: %s\n50-row warmup: %s\n"+
				"Scope: CSV, interval and warmup only; source authenticity, symbol, costs, strategy and operating admission not checked.\n",
				tc.rows, tc.warmup20, tc.warmup50)
			if code != 0 || stdout.String() != want || stderr.Len() != 0 || opens != 1 || input.closes != 1 {
				t.Fatalf("code=%d stdout=%q stderr=%q opens=%d closes=%d", code, stdout.String(), stderr.String(), opens, input.closes)
			}
		})
	}
}

func TestDiagnoseCausalCSVWindowOperands(t *testing.T) {
	for _, tc := range [][2]string{
		{"0200", "203"}, {"+200", "203"}, {"200", "203 "}, {"200", "2e2"},
		{"200", "253402300801"}, {"253402300800", "253402300801"},
		{"199", "203"}, {"200", "201"}, {"200", "204"}, {"200", "200"},
	} {
		t.Run(tc[0]+"_"+tc[1], func(t *testing.T) {
			input := &diagnosticReadCloser{reader: strings.NewReader(windowDiagnosticCSV(""))}
			var stdout, stderr bytes.Buffer
			if code := diagnoseCausalCSVRead(context.Background(), input, &stdout, &stderr, tc[:]...); code != 1 || stdout.Len() != 0 || stderr.String() != windowDiagnostic || input.closes != 1 {
				t.Fatalf("code=%d stdout=%q stderr=%q closes=%d", code, stdout.String(), stderr.String(), input.closes)
			}
		})
	}
}

func TestDiagnoseCausalCSVWindowCompatibility(t *testing.T) {
	const originalSuccess = "Causal CSV syntax/domain check: passed\nData rows: 1\n" +
		"Scope: unqualified input only; symbol, costs, warmup, strategy and operating admission not checked.\n"
	const originalUsage = "Usage: gelt diagnose-causal-csv <DataFile.csv>\n" +
		"diagnose-causal-csv: invalid_arguments line=none field=none reason=invalid_arguments\n"
	for _, args := range [][]string{{"CSV", "--window", "1"}, {"CSV", "--WINDOW", "1", "2"}, {"CSV", "--window", "1", "2", "extra"}} {
		var stdout, stderr bytes.Buffer
		code := runDiagnoseCausalCSVWithOpen(nil, args, &stdout, &stderr, func(string) (io.ReadCloser, error) {
			t.Fatal("wrong grammar opened input")
			return nil, nil
		})
		if code != 1 || stdout.Len() != 0 || stderr.String() != originalUsage {
			t.Fatalf("changed argument diagnostic: code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
		}
	}
	var stdout, stderr bytes.Buffer
	code := runDiagnoseCausalCSVWithOpen(nil, []string{"--window"}, &stdout, &stderr, func(path string) (io.ReadCloser, error) {
		if path != "--window" {
			t.Fatalf("single operand changed: %q", path)
		}
		return io.NopCloser(strings.NewReader(causalCLITestCSV("1,1,1,1,1,0"))), nil
	})
	if code != 0 || stdout.String() != originalSuccess || stderr.Len() != 0 {
		t.Fatalf("changed single-operand result: code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
}

func TestDiagnoseCausalCSVWindowFailurePrecedence(t *testing.T) {
	privateErr := errors.New("PRIVATE_FAILURE")
	for _, tc := range []struct {
		name, suffix, want string
		readErr, closeErr  error
		cancelOnClose      bool
	}{
		{"excluded syntax first", "202,1,1,1,PRIVATE_VALUE,0", "invalid_csv line=53 field=Close reason=noncanonical_number", nil, privateErr, true},
		{"excluded domain first", "202,2,1,1,1,0", "invalid_input line=53 field=OHLC reason=inconsistent_ohlc", nil, nil, false},
		{"read first", "", "input_file line=none field=none reason=read_failed", privateErr, privateErr, true},
		{"close first", "", "input_file line=none field=none reason=close_failed", nil, privateErr, true},
		{"canceled after close", "", "canceled line=none field=none reason=canceled", nil, nil, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			body := windowDiagnosticCSV(tc.suffix)
			input := &diagnosticReadCloser{reader: strings.NewReader(body), closeErr: tc.closeErr}
			if tc.readErr != nil {
				input.reader = &diagnosticErrorReader{content: []byte(body), err: tc.readErr}
			}
			if tc.cancelOnClose {
				input.onClose = cancel
			}
			var stdout, stderr bytes.Buffer
			if code := diagnoseCausalCSVRead(ctx, input, &stdout, &stderr, "0200", "202"); code != 1 || stdout.Len() != 0 || stderr.String() != "diagnose-causal-csv: "+tc.want+"\n" || input.closes != 1 {
				t.Fatalf("code=%d stdout=%q stderr=%q closes=%d", code, stdout.String(), stderr.String(), input.closes)
			}
		})
	}
}

func TestDiagnoseCausalCSVWindowCancelAndWrite(t *testing.T) {
	for _, at := range []int{3, 55, 107} {
		ctx := &diagnosticCancelContext{Context: context.Background(), cancelAt: at}
		input := &diagnosticReadCloser{reader: strings.NewReader(windowDiagnosticCSV(""))}
		output, diagnostic := &offlineHelpWriter{}, &offlineHelpWriter{}
		if code := diagnoseCausalCSVRead(ctx, input, output, diagnostic, "200", "203"); code != 1 || output.calls != 0 || diagnostic.calls != 1 || string(diagnostic.body) != "diagnose-causal-csv: canceled line=none field=none reason=canceled\n" || input.closes != 1 {
			t.Fatalf("cancellation at check %d did not stop output", at)
		}
	}
	for _, err := range []error{nil, errors.New("PRIVATE_WRITE")} {
		input := &diagnosticReadCloser{reader: strings.NewReader(windowDiagnosticCSV(""))}
		output := &offlineHelpWriter{n: 1, err: err}
		diagnostic := &offlineHelpWriter{err: errors.New("PRIVATE_DIAGNOSTIC")}
		if code := diagnoseCausalCSVRead(context.Background(), input, output, diagnostic, "200", "203"); code != 1 || output.calls != 1 || diagnostic.calls != 1 || string(diagnostic.body) != "diagnose-causal-csv: output_error\n" || input.closes != 1 {
			t.Fatal("failed output was retried or leaked an error")
		}
	}
}
