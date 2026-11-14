package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"gelt/pkg/backtest"
)

func TestDiagnoseCausalCSVParserCoordinates(t *testing.T) {
	for _, ending := range []string{"\n", "\r\n"} {
		for _, final := range []bool{false, true} {
			for _, row := range []int{0, 21, 9999} {
				for col, field := range []string{"Timestamp", "Open", "High", "Low", "Close", "Volume"} {
					var csv strings.Builder
					csv.WriteString(causalCSVHeader)
					for i := 0; i <= row; i++ {
						fields := []string{fmt.Sprint(i + 1), "1", "1", "1", "1", "0"}
						if i == row {
							fields[col] = "PRIVATE_BAD_TOKEN"
						}
						csv.WriteString(ending + strings.Join(fields, ","))
					}
					if final {
						csv.WriteString(ending)
					}
					bars, issue := parseDetailedCausalCSV(strings.NewReader(csv.String()))
					want := &causalCSVInputIssue{causalCSVInvalid, row + 2, field, "noncanonical_number"}
					if bars != nil || !reflect.DeepEqual(issue, want) {
						t.Fatalf("ending=%q final=%t row=%d col=%d: issue=%+v", ending, final, row, col, issue)
					}
					body, ok := causalCSVDiagnosticText(causalCSVDiagnostic{string(issue.Code), issue.Field, issue.Reason, issue.Line})
					wantBody := fmt.Sprintf("diagnose-causal-csv: invalid_csv line=%d field=%s reason=noncanonical_number\n", row+2, field)
					if !ok || body != wantBody {
						t.Fatal("coordinates or fixed output differ")
					}
					_, legacyErr := parseBacktestCausalCSV(strings.NewReader(csv.String()))
					if legacyErr != causalCSVInvalid {
						t.Fatal("legacy error class/equality changed")
					}
				}
			}
		}
	}
}

func TestDiagnoseCausalCSVParserReasonsAndPrecedence(t *testing.T) {
	good := causalCLITestCSV("1,1,1,1,1,0")
	cases := []struct {
		name, csv string
		want      causalCSVInputIssue
	}{
		{"empty", "", causalCSVInputIssue{causalCSVInvalid, 0, "none", "missing_data"}},
		{"header-only", causalCSVHeader + "\n", causalCSVInputIssue{causalCSVInvalid, 0, "none", "missing_data"}},
		{"missing-before-header", "PRIVATE_HEADER", causalCSVInputIssue{causalCSVInvalid, 0, "none", "missing_data"}},
		{"header", "PRIVATE_HEADER\n1,1,1,1,1,0", causalCSVInputIssue{causalCSVInvalid, 1, "none", "header_mismatch"}},
		{"utf8-before-header", "PRIVATE_HEADER\n\xff", causalCSVInputIssue{causalCSVInvalid, 0, "none", "invalid_utf8"}},
		{"count-before-token", causalCLITestCSV("PRIVATE_TOKEN,1,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 2, "none", "field_count"}},
		{"empty-token", causalCLITestCSV("1,,1,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 2, "Open", "noncanonical_number"}},
		{"column-order", causalCLITestCSV("1,BAD,BAD,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 2, "Open", "noncanonical_number"}},
		{"conversion", causalCLITestCSV("9223372036854775808,1,1,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 2, "Timestamp", "number_conversion"}},
		{"tokens-before-conversion", causalCLITestCSV("9223372036854775808,1,BAD,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 2, "High", "noncanonical_number"}},
		{"row-conversion-before-later-lexical", causalCLITestCSV("9223372036854775808,1,1,1,1,0", "2,1,BAD,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 2, "Timestamp", "number_conversion"}},
		{"syntax-before-domain", causalCLITestCSV("1,0,1,1,1,0", "2,1,BAD,1,1,0"), causalCSVInputIssue{causalCSVInvalid, 3, "High", "noncanonical_number"}},
		{"blank-row", good + "\n\n", causalCSVInputIssue{causalCSVInvalid, 3, "none", "field_count"}},
		{"bare-cr", good + "\r", causalCSVInputIssue{causalCSVInvalid, 2, "Volume", "noncanonical_number"}},
		{"rows-before-header", "BAD" + strings.Repeat("\nBAD", 10001), causalCSVInputIssue{causalCSVLimit, 0, "none", "row_limit"}},
		{"utf8-before-rows", "BAD" + strings.Repeat("\nBAD", 10001) + "\xff", causalCSVInputIssue{causalCSVInvalid, 0, "none", "invalid_utf8"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bars, got := parseDetailedCausalCSV(strings.NewReader(tc.csv))
			if bars != nil || !reflect.DeepEqual(got, &tc.want) {
				t.Fatalf("issue=%+v, want=%+v", got, tc.want)
			}
			bars, old := parseBacktestCausalCSV(strings.NewReader(tc.csv))
			if bars != nil || old != tc.want.Code {
				t.Fatal("old fixed error changed")
			}
		})
	}
	for col := 0; col < 6; col++ {
		for _, n := range []int{31, 32, 33} {
			fields := []string{"1", "1", "1", "1", "1", "0"}
			fields[col] = "1." + strings.Repeat("0", n-2)
			reason := ""
			if col == 0 {
				reason = "noncanonical_number"
			}
			if n == 33 {
				reason = "token_too_long"
			}
			bars, got := parseDetailedCausalCSV(strings.NewReader(causalCLITestCSV(strings.Join(fields, ","))))
			if reason == "" {
				if got != nil || len(bars) != 1 {
					t.Fatal("valid token boundary rejected")
				}
			} else if !reflect.DeepEqual(got, &causalCSVInputIssue{causalCSVInvalid, 2, causalCSVField(col), reason}) || bars != nil {
				t.Fatalf("column=%d size=%d: %+v", col, n, got)
			}
		}
	}
	for _, n := range []int{31, 32, 33} {
		_, issue := parseDetailedCausalCSV(strings.NewReader(causalCLITestCSV(strings.Repeat("9", n) + ",1,1,1,1,0")))
		reason := "number_conversion"
		if n == 33 {
			reason = "token_too_long"
		}
		if !reflect.DeepEqual(issue, &causalCSVInputIssue{causalCSVInvalid, 2, "Timestamp", reason}) {
			t.Fatalf("timestamp size=%d: %+v", n, issue)
		}
	}
	// Canonical decimal values retain ParseFloat's float64 rounding, including a
	// domain boundary whose decimal spelling lies just below the minimum.
	bars, issue := parseDetailedCausalCSV(strings.NewReader(causalCLITestCSV("1,0.0099999999999999999,1,0.01,1,0")))
	if issue != nil || len(bars) != 1 || bars[0].Open != .01 || backtest.DiagnoseCausalBars(bars) != nil {
		t.Fatal("float64 rounding policy changed")
	}
}

// Increasing timestamps make these exact byte-bound fixtures independently
// valid for domain admission as well as syntax. The older parser-only builder
// deliberately repeats timestamps and cannot be a positive command oracle.
func diagnosticSizedCSV(t *testing.T, size int) string {
	t.Helper()
	const rows = 7000
	const baseSize = 173930
	extra := size - baseSize
	if extra < 0 || extra > rows*5*29 {
		t.Fatal("invalid increasing-timestamp exact-size fixture request")
	}
	var out strings.Builder
	out.WriteString(causalCSVHeader + "\n")
	for i := 1; i <= rows; i++ {
		fmt.Fprint(&out, i)
		for col := 0; col < 5; col++ {
			n := min(extra, 29)
			extra -= n
			out.WriteString(",1.0" + strings.Repeat("0", n))
		}
		out.WriteByte('\n')
	}
	if extra != 0 || out.Len() != size {
		t.Fatal("increasing-timestamp exact-size fixture construction failed")
	}
	return out.String()
}

func TestDiagnoseCausalCSVPositiveExactByteBounds(t *testing.T) {
	for _, size := range []int{1048575, 1048576, 1048577} {
		r := &causalCLICountReader{reader: strings.NewReader(diagnosticSizedCSV(t, size))}
		owned := &diagnosticReadCloser{reader: r}
		var out, diagnostic bytes.Buffer
		code := diagnoseCausalCSVRead(context.Background(), owned, &out, &diagnostic)
		if size <= 1048576 {
			want := "Causal CSV syntax/domain check: passed\nData rows: 7000\nScope: unqualified input only; symbol, costs, warmup, strategy and operating admission not checked.\n"
			if code != 0 || out.String() != want || diagnostic.Len() != 0 {
				t.Fatalf("admitted exact byte boundary: size=%d code=%d stderr=%q", size, code, diagnostic.String())
			}
		} else if code != 1 || out.Len() != 0 || diagnostic.String() != "diagnose-causal-csv: resource_limit line=none field=none reason=byte_limit\n" {
			t.Fatal("one-over byte boundary changed")
		}
		if r.read != size || owned.closes != 1 {
			t.Fatal("bounded read/close ownership changed")
		}
	}
}

func TestDiagnoseCausalCSVOldDetailedHelpBytes(t *testing.T) {
	// SHA-256 and lengths freeze the nine detailed bodies from before this
	// additive command; the expected values do not reuse their shared constants.
	for _, tc := range []struct {
		name, digest string
		size         int
	}{
		{"backtest-causal", "2252c0dcce6572e1574c96fe671a2d2dc9ea2dd7cd689b5cb3c229e6c91d4f09", 2151},
		{"backtest-causal-funded", "5aebef05bd975ddd753822dce7a312df7c22a51aff23f3132a366071b02cc833", 2172},
		{"backtest-causal-fees", "4f1010a694194e122fe719d06ec4d9b656b19d99942256e8239ddfde6a4ab8c2", 2199},
		{"backtest-causal-execution", "a936efba4d01b59eacb4837873d5eba242634b7a13eb938f5ef8672ed47ad2bd", 2240},
		{"backtest-causal-compare", "2a7351c692c87634d1f22f51fbc0f2546cd78d21bd234bfe806e2b5880bf79de", 2233},
		{"backtest-causal-window-compare", "12676fba40cd9ad23561b36f05df8a4b214da04803aaddd2ea041868245ef6b3", 2258},
		{"backtest-causal-trend50-compare", "0439033bb0aa6a42a90e2a05d2ab39d6fe0f976b0ecb5c57726ac38650ee5604", 2157},
		{"backtest-causal-trend50-window-compare", "e77685893cf3f8a1812b10cabde01f41a5fade1eb7b030045bf3f8e346acb5ba", 2270},
		{"backtest-causal-meanrev-compare", "0299285c178a8f18aa290f37f181528e24ba15d8dfcfe42867c8bf230bab40de", 2303},
	} {
		body, ok := offlineDetailHelp(tc.name)
		if !ok || len(body) != tc.size || fmt.Sprintf("%x", sha256.Sum256([]byte(body))) != tc.digest {
			t.Fatalf("old detailed help bytes changed: %s", tc.name)
		}
	}
	for _, body := range []string{globalHelp(Version), offlineChooserHelp} {
		if strings.Count(body, "  diagnose-causal-csv ") != 1 {
			t.Fatal("new command must appear exactly once in each discovery listing")
		}
	}
}

func TestDiagnoseCausalCSVParserByteReadPrecedence(t *testing.T) {
	for _, n := range []int{causalCSVMaxBytes - 1, causalCSVMaxBytes, causalCSVMaxBytes + 1} {
		r := &causalCLICountReader{reader: strings.NewReader(causalCLITestSizedCSV(t, n))}
		bars, issue := parseDetailedCausalCSV(r)
		if n <= causalCSVMaxBytes {
			if issue != nil || len(bars) != 7000 {
				t.Fatal("exact byte bound changed")
			}
		} else if !reflect.DeepEqual(issue, &causalCSVInputIssue{causalCSVLimit, 0, "none", "byte_limit"}) || bars != nil {
			t.Fatal("byte-limit issue changed")
		}
		if r.read != n || r.read > causalCSVMaxBytes+1 {
			t.Fatal("read bound changed")
		}
	}
	for _, n := range []int{1, causalCSVMaxBytes + 1} {
		r := &diagnosticErrorReader{content: bytes.Repeat([]byte{'x'}, n), err: errors.New("PRIVATE_READER")}
		_, issue := parseDetailedCausalCSV(r)
		want := &causalCSVInputIssue{causalCSVRead, 0, "none", "read_failed"}
		if n > causalCSVMaxBytes {
			want = &causalCSVInputIssue{causalCSVLimit, 0, "none", "byte_limit"}
		}
		if !reflect.DeepEqual(issue, want) || r.read > causalCSVMaxBytes+1 {
			t.Fatalf("read/byte precedence: %+v", issue)
		}
	}
}

type diagnosticErrorReader struct {
	content []byte
	err     error
	read    int
}

func (r *diagnosticErrorReader) Read(p []byte) (int, error) {
	n := copy(p, r.content)
	r.content = r.content[n:]
	r.read += n
	if len(r.content) == 0 {
		return n, r.err
	}
	return n, nil
}

func TestDiagnoseCausalCSVSuccessAndDomainLocations(t *testing.T) {
	for _, ending := range []string{"\n", "\r\n"} {
		for _, final := range []bool{false, true} {
			for _, n := range []int{1, 2, 10000} {
				var csv strings.Builder
				csv.WriteString(causalCSVHeader)
				for i := 1; i <= n; i++ {
					fmt.Fprintf(&csv, "%s%d,1,1,1,1,0", ending, i)
				}
				if final {
					csv.WriteString(ending)
				}
				path := causalCLITestFile(t, csv.String())
				var out, diagnostic bytes.Buffer
				code := runDiagnoseCausalCSV(nil, []string{path}, &out, &diagnostic)
				want := fmt.Sprintf("Causal CSV syntax/domain check: passed\nData rows: %d\nScope: unqualified input only; symbol, costs, warmup, strategy and operating admission not checked.\n", n)
				if code != 0 || out.String() != want || diagnostic.Len() != 0 {
					t.Fatalf("success: code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
				}
				actual, err := os.ReadFile(path)
				if err != nil || string(actual) != csv.String() {
					t.Fatal("input bytes changed")
				}
			}
		}
	}
	for _, tc := range []struct{ row, field, reason string }{
		{"0,1,1,1,1,0", "Timestamp", "out_of_range"},
		{"253402300800,1,1,1,1,0", "Timestamp", "out_of_range"},
		{"2,0,1,1,1,0", "Open", "out_of_range"},
		{"2,1,1000001,1,1,0", "High", "out_of_range"},
		{"2,1,1,0,1,0", "Low", "out_of_range"},
		{"2,1,1,1,1000001,0", "Close", "out_of_range"},
		{"2,1,1,1,1,1000000000001", "Volume", "out_of_range"},
		{"2,1,2,1.5,2,0", "OHLC", "inconsistent_ohlc"},
		{"1,1,1,1,1,0", "Timestamp", "not_strictly_increasing"},
	} {
		path := causalCLITestFile(t, causalCLITestCSV("1,1,1,1,1,0", tc.row))
		var out, diagnostic bytes.Buffer
		code := runDiagnoseCausalCSV(context.Background(), []string{path}, &out, &diagnostic)
		want := "diagnose-causal-csv: invalid_input line=3 field=" + tc.field + " reason=" + tc.reason + "\n"
		if code != 1 || out.Len() != 0 || diagnostic.String() != want {
			t.Fatalf("domain: code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
		}
	}
}

func TestDiagnoseCausalCSVArgumentsCancellationAndFiles(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, args := range [][]string{nil, {}, {"PRIVATE_PATH", "EXTRA"}} {
		var out bytes.Buffer
		diagnostic := &offlineHelpWriter{}
		code := runDiagnoseCausalCSV(ctx, args, &out, diagnostic)
		want := diagnoseCausalCSVUsage + "diagnose-causal-csv: invalid_arguments line=none field=none reason=invalid_arguments\n"
		if code != 1 || out.Len() != 0 || diagnostic.calls != 1 || string(diagnostic.body) != want {
			t.Fatal("arity must precede cancellation and use one fixed stderr attempt")
		}
	}
	var out, diagnostic bytes.Buffer
	if code := runDiagnoseCausalCSV(ctx, []string{"PRIVATE_NONEXISTENT"}, &out, &diagnostic); code != 1 || out.Len() != 0 || diagnostic.String() != "diagnose-causal-csv: canceled line=none field=none reason=canceled\n" {
		t.Fatal("pre-canceled input must not be opened")
	}
	regular := causalCLITestFile(t, causalCLITestCSV("1,1,1,1,1,0"))
	link := filepath.Join(t.TempDir(), "link.csv")
	broken := filepath.Join(t.TempDir(), "broken.csv")
	if err := os.Symlink(regular, link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "missing"), broken); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{link, regular} {
		out.Reset()
		diagnostic.Reset()
		if code := runDiagnoseCausalCSV(nil, []string{path}, &out, &diagnostic); code != 0 || diagnostic.Len() != 0 {
			t.Fatal("regular/symlink compatibility changed")
		}
	}
	for _, path := range []string{broken, filepath.Join(t.TempDir(), "PRIVATE_MISSING"), t.TempDir()} {
		out.Reset()
		diagnostic.Reset()
		if code := runDiagnoseCausalCSV(nil, []string{path}, &out, &diagnostic); code != 1 || out.Len() != 0 || diagnostic.String() != "diagnose-causal-csv: input_file line=none field=none reason=open_failed\n" {
			t.Fatal("file failure must be fixed and location-free")
		}
	}
}

type diagnosticReadCloser struct {
	reader   io.Reader
	closeErr error
	closes   int
	onClose  func()
}

func (r *diagnosticReadCloser) Read(p []byte) (int, error) { return r.reader.Read(p) }
func (r *diagnosticReadCloser) Close() error {
	r.closes++
	if r.onClose != nil {
		r.onClose()
	}
	return r.closeErr
}

func TestDiagnoseCausalCSVReadCloseAndCancellationPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name, content, reason string
		readErr, closeErr     error
		cancel                bool
	}{
		{"syntax-close-cancel", causalCLITestCSV("1,1,BAD,1,1,0"), "invalid_csv line=2 field=High reason=noncanonical_number", nil, errors.New("PRIVATE_CLOSE"), true},
		{"read-close-cancel", causalCLITestCSV("1,1,BAD,1,1,0"), "input_file line=none field=none reason=read_failed", errors.New("PRIVATE_READ"), errors.New("PRIVATE_CLOSE"), true},
		{"close-cancel", causalCLITestCSV("1,1,1,1,1,0"), "input_file line=none field=none reason=close_failed", nil, errors.New("PRIVATE_CLOSE"), true},
		{"cancel-before-domain", causalCLITestCSV("1,0,1,1,1,0"), "canceled line=none field=none reason=canceled", nil, nil, true},
		{"domain", causalCLITestCSV("1,0,1,1,1,0"), "invalid_input line=2 field=Open reason=out_of_range", nil, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var reader io.Reader = strings.NewReader(tc.content)
			if tc.readErr != nil {
				reader = &diagnosticErrorReader{content: []byte(tc.content), err: tc.readErr}
			}
			r := &diagnosticReadCloser{reader: reader, closeErr: tc.closeErr}
			if tc.cancel {
				r.onClose = cancel
			}
			var out, diagnostic bytes.Buffer
			if code := diagnoseCausalCSVRead(ctx, r, &out, &diagnostic); code != 1 || out.Len() != 0 || diagnostic.String() != "diagnose-causal-csv: "+tc.reason+"\n" || r.closes != 1 {
				t.Fatalf("code=%d closes=%d out=%q err=%q", code, r.closes, out.String(), diagnostic.String())
			}
		})
	}
	// Err's second observation in this seam occurs after domain admission.
	ctx := &diagnosticCancelContext{Context: context.Background(), cancelAt: 2}
	r := &diagnosticReadCloser{reader: strings.NewReader(causalCLITestCSV("1,1,1,1,1,0"))}
	var out, diagnostic bytes.Buffer
	if code := diagnoseCausalCSVRead(ctx, r, &out, &diagnostic); code != 1 || out.Len() != 0 || diagnostic.String() != "diagnose-causal-csv: canceled line=none field=none reason=canceled\n" || ctx.calls != 2 || r.closes != 1 {
		t.Fatal("cancellation after domain admission must precede success")
	}
}

type diagnosticCancelContext struct {
	context.Context
	calls, cancelAt int
}

func (c *diagnosticCancelContext) Err() error {
	c.calls++
	if c.calls >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func TestDiagnoseCausalCSVClosedDiagnosticBoundary(t *testing.T) {
	valid := []causalCSVDiagnostic{
		{Code: "resource_limit", Field: "none", Reason: "byte_limit"},
		{Code: "resource_limit", Field: "none", Reason: "row_limit"},
		{Code: "input_file", Field: "none", Reason: "open_failed"},
		{Code: "input_file", Field: "none", Reason: "read_failed"},
		{Code: "input_file", Field: "none", Reason: "close_failed"},
		{Code: "invalid_csv", Field: "none", Reason: "invalid_utf8"},
		{Code: "invalid_csv", Field: "none", Reason: "missing_data"},
		{Code: "invalid_csv", Field: "none", Reason: "header_mismatch", Line: 1},
		{Code: "invalid_csv", Field: "none", Reason: "field_count", Line: 2},
		{Code: "invalid_input", Field: "none", Reason: "empty_input"},
		{Code: "invalid_input", Field: "Timestamp", Reason: "not_strictly_increasing", Line: 3},
		{Code: "invalid_input", Field: "OHLC", Reason: "inconsistent_ohlc", Line: 10001},
		canceledCausalCSVDiagnostic(),
		{Code: "invalid_arguments", Field: "none", Reason: "invalid_arguments"},
	}
	for _, field := range []string{"Timestamp", "Open", "High", "Low", "Close", "Volume"} {
		for _, reason := range []string{"noncanonical_number", "token_too_long", "number_conversion"} {
			valid = append(valid, causalCSVDiagnostic{Code: "invalid_csv", Field: field, Reason: reason, Line: 10001})
		}
		valid = append(valid, causalCSVDiagnostic{Code: "invalid_input", Field: field, Reason: "out_of_range", Line: 2})
	}
	for _, d := range valid {
		body, ok := causalCSVDiagnosticText(d)
		if !ok || !utf8.ValidString(body) || len(body) > 512 || body == "" {
			t.Fatalf("valid combination rejected: %+v", d)
		}
		for _, replace := range []func(*causalCSVDiagnostic){
			func(d *causalCSVDiagnostic) { d.Code = "PRIVATE\xff" },
			func(d *causalCSVDiagnostic) { d.Field = "PRIVATE\n" },
			func(d *causalCSVDiagnostic) { d.Reason = strings.Repeat("PRIVATE", 100) },
			func(d *causalCSVDiagnostic) { d.Line = -1 },
			func(d *causalCSVDiagnostic) { d.Line = 10002 },
			func(d *causalCSVDiagnostic) { d.Line = math.MaxInt },
		} {
			forged := d
			replace(&forged)
			var diagnostic bytes.Buffer
			if body, ok := causalCSVDiagnosticText(forged); ok || body != "" {
				t.Fatal("forged issue admitted")
			}
			if code := failDiagnoseCausalCSV(&diagnostic, forged, false); code != 1 || diagnostic.String() != diagnoseCausalCSVUnavailable {
				t.Fatal("forged issue leaked")
			}
		}
	}
	for _, forged := range []causalCSVDiagnostic{
		{Code: "invalid_csv", Field: "Open", Reason: "header_mismatch", Line: 1},
		{Code: "invalid_csv", Field: "OHLC", Reason: "noncanonical_number", Line: 2},
		{Code: "invalid_input", Field: "Timestamp", Reason: "not_strictly_increasing", Line: 2},
		{Code: "invalid_input", Field: "Open", Reason: "inconsistent_ohlc", Line: 2},
		{Code: "invalid_input", Field: "OHLC", Reason: "out_of_range", Line: 2},
		{Code: "input_file", Field: "none", Reason: "number_conversion"},
		{Code: "resource_limit", Field: "none", Reason: "token_too_long"},
		{Code: "invalid_csv", Field: "none", Reason: "missing_data", Line: 1},
	} {
		if _, ok := causalCSVDiagnosticText(forged); ok {
			t.Fatalf("inconsistent combination admitted: %+v", forged)
		}
	}
}

func TestDiagnoseCausalCSVPublicIssueCoordinates(t *testing.T) {
	for _, tc := range []struct {
		issue *backtest.CausalInputIssue
		rows  int
		valid bool
	}{
		{nil, 1, false},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: 0, Field: "Open", Reason: "out_of_range"}, 1, true},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: 9999, Field: "High", Reason: "out_of_range"}, 10000, true},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: 1, Field: "Open", Reason: "out_of_range"}, 1, false},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: math.MaxInt, Field: "Open", Reason: "out_of_range"}, 1, false},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: -1, Field: "none", Reason: "empty_input"}, 0, true},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: -1, Field: "none", Reason: "empty_input"}, 1, false},
		{&backtest.CausalInputIssue{Code: backtest.CausalResourceLimit, BarIndex: -1, Field: "none", Reason: "row_limit"}, 10001, true},
		{&backtest.CausalInputIssue{Code: backtest.CausalResourceLimit, BarIndex: -1, Field: "none", Reason: "row_limit"}, 10000, false},
		{&backtest.CausalInputIssue{Code: "PRIVATE", BarIndex: 0, Field: "Open", Reason: "out_of_range"}, 1, false},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: 0, Field: "none", Reason: "empty_input"}, 1, false},
		{&backtest.CausalInputIssue{Code: backtest.CausalInvalidInput, BarIndex: 0, Field: "Open", Reason: "out_of_range"}, -1, false},
	} {
		d, ok := causalBarsDiagnostic(tc.issue, tc.rows)
		if ok != tc.valid {
			t.Fatalf("coordinate validation: issue=%+v rows=%d got=%t", tc.issue, tc.rows, ok)
		}
		if ok && tc.issue.BarIndex >= 0 && d.Line != tc.issue.BarIndex+2 {
			t.Fatal("physical line conversion changed")
		}
	}
}

func TestDiagnoseCausalCSVOutputBoundsAndFailures(t *testing.T) {
	for _, n := range []int{1, 10000} {
		body, ok := diagnoseCausalCSVSuccess(n)
		if !ok || !validDiagnoseCausalCSVBody(body) {
			t.Fatal("valid success body rejected")
		}
	}
	for _, n := range []int{-1, 0, 10001, math.MaxInt} {
		if body, ok := diagnoseCausalCSVSuccess(n); ok || body != "" {
			t.Fatal("invalid success count admitted")
		}
	}
	for _, body := range []string{strings.Repeat("x", 512), strings.Repeat("é", 256)} {
		if !validDiagnoseCausalCSVBody(body) {
			t.Fatal("exact body byte boundary rejected")
		}
	}
	for _, body := range []string{"", "PRIVATE\xff", strings.Repeat("x", 513), strings.Repeat("é", 257)} {
		if validDiagnoseCausalCSVBody(body) {
			t.Fatal("invalid body admitted")
		}
	}
	body, _ := diagnoseCausalCSVSuccess(1)
	{
		output, diagnostic := &offlineHelpWriter{n: len(body)}, &offlineHelpWriter{}
		r := &diagnosticReadCloser{reader: strings.NewReader(causalCLITestCSV("1,1,1,1,1,0"))}
		if code := diagnoseCausalCSVRead(context.Background(), r, output, diagnostic); code != 0 || output.calls != 1 || string(output.body) != body || diagnostic.calls != 0 || r.closes != 1 {
			t.Fatal("success must use one complete stdout attempt after closing")
		}
	}
	for _, output := range []io.Writer{nil, &offlineHelpWriter{}, &offlineHelpWriter{n: 1}, &offlineHelpWriter{n: len(body) - 1}, &offlineHelpWriter{n: len(body), err: errors.New("PRIVATE_OUTPUT")}, &offlineHelpWriter{n: 1, err: io.ErrClosedPipe}} {
		r := &diagnosticReadCloser{reader: strings.NewReader(causalCLITestCSV("1,1,1,1,1,0"))}
		diagnostic := &offlineHelpWriter{err: errors.New("PRIVATE_STDERR")}
		if code := diagnoseCausalCSVRead(context.Background(), r, output, diagnostic); code != 1 || diagnostic.calls != 1 || string(diagnostic.body) != "diagnose-causal-csv: output_error\n" || r.closes != 1 {
			t.Fatal("output failure retry/leak")
		}
		if w, ok := output.(*offlineHelpWriter); ok && w.calls != 1 {
			t.Fatal("stdout retried")
		}
	}
	for _, stderr := range []io.Writer{nil, &offlineHelpWriter{}, &offlineHelpWriter{n: 1, err: errors.New("PRIVATE_STDERR")}} {
		r := &diagnosticReadCloser{reader: strings.NewReader("PRIVATE_BAD_HEADER\n1,1,1,1,1,0")}
		out := &offlineHelpWriter{}
		if code := diagnoseCausalCSVRead(context.Background(), r, out, stderr); code != 1 || out.calls != 0 {
			t.Fatal("stderr failure changed rejection")
		}
		if w, ok := stderr.(*offlineHelpWriter); ok && w.calls != 1 {
			t.Fatal("stderr retried")
		}
	}
	for _, flag := range []string{"--help", "-h"} {
		for _, args := range [][]string{{"help", "diagnose-causal-csv"}, {"diagnose-causal-csv", flag}} {
			var out, diagnostic bytes.Buffer
			if handled, code := runOfflineHelp(args, &out, &diagnostic); !handled || code != 0 || out.String() != diagnoseCausalCSVHelp || diagnostic.Len() != 0 {
				t.Fatal("new help alias changed")
			}
		}
		var out, diagnostic bytes.Buffer
		if handled, _ := runOfflineHelp([]string{"diagnose-causal-csv", "./" + flag}, &out, &diagnostic); handled {
			t.Fatal("literal help filename intercepted")
		}
	}
}
