//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"gelt/pkg/backtest"
)

func TestAlignedWindowFileChild(t *testing.T) {
	var args []string
	for i, arg := range os.Args {
		if arg == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) == 0 || args[0] != "aligned-window-child" {
		t.Skip("owned subprocess entry")
	}
	if len(args) != 3 {
		t.Fatal("invalid child operands")
	}
	ctx := context.Background()
	if args[2] == "canceled" {
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(ctx)
		cancel()
	}
	open := func(path string) (io.ReadCloser, error) { return openOfflineCSV(path) }
	if args[2] == "replace" {
		open = func(path string) (io.ReadCloser, error) {
			f, err := openOfflineCSV(path)
			if err != nil {
				return nil, err
			}
			if err = os.Rename(path, path+".retained"); err != nil {
				_ = f.Close()
				return nil, err
			}
			if err = syscall.Mkfifo(path, 0600); err != nil {
				_ = f.Close()
				return nil, err
			}
			return f, nil
		}
	} else if args[2] != "active" && args[2] != "canceled" {
		t.Fatal("invalid child mode")
	}
	opens, parses, closes := 0, 0, 0
	countOpen := func(path string) (io.ReadCloser, error) {
		opens++
		f, err := open(path)
		if err != nil {
			return nil, err
		}
		return &alignedTestOwnedFile{ReadCloser: f, closes: &closes}, nil
	}
	parse := func(r io.Reader) ([]backtest.OHLCV, error) { parses++; return parseBacktestCausalCSV(r) }
	code := runAlignedWindowInput(ctx, alignedTestArgs(args[1]), os.Stdout, os.Stderr, countOpen, parse, nativeAlignedWindowRunners())
	if opens > 1 || parses > 1 || closes > 1 || parses != closes {
		t.Fatal("owned child input lifecycle changed")
	}
	if args[2] == "replace" && (code != 0 || opens != 1 || parses != 1 || closes != 1) {
		t.Fatal("admitted descriptor was reopened or not consumed")
	}
	os.Exit(code)
}

type alignedTestOwnedFile struct {
	io.ReadCloser
	closes *int
}

func (f *alignedTestOwnedFile) Close() error { *f.closes++; return f.ReadCloser.Close() }

func alignedTestChild(t *testing.T, path, mode string, wantCode int, wantOut, wantErr string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestAlignedWindowFileChild$", "--", "aligned-window-child", path, mode)
	cmd.Env = []string{"HOME=" + os.Getenv("HOME"), "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "DISCORD_WEBHOOK_ENABLE=false"}
	var out, diagnostic bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &diagnostic
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	watchdog := time.NewTimer(30 * time.Second)
	select {
	case err = <-done:
		watchdog.Stop()
	case <-watchdog.C:
		killErr := cmd.Process.Kill()
		waitErr := <-done
		t.Fatalf("owned child watchdog expired (not an I/O deadline): kill=%v wait=%v", killErr, waitErr)
	}
	code := 0
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			t.Fatal(err)
		}
		code = exit.ExitCode()
	}
	if code != wantCode || out.String() != wantOut || diagnostic.String() != wantErr {
		t.Fatalf("child code=%d stdout=%q stderr=%q", code, out.String(), diagnostic.String())
	}
}

func TestAlignedWindowLinuxDescriptorsAndChildSettlement(t *testing.T) {
	bars, csv := alignedTestFixture()
	b, tr, m, p := alignedTestNativeSections(t, bars, alignedTestWindow(), "100", alignedTestScenario())
	want, ok := assembleAlignedWindowReport(alignedWindowHeader(p.Facts), b, tr, m)
	if !ok {
		t.Fatal("native report fixture rejected")
	}
	regular := causalCLITestFile(t, csv)
	link := filepath.Join(t.TempDir(), "link.csv")
	if err := os.Symlink(regular, link); err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(t.TempDir(), "broken.csv")
	if err := os.Symlink(filepath.Join(t.TempDir(), "missing"), broken); err != nil {
		t.Fatal(err)
	}
	fifo := filepath.Join(t.TempDir(), "unwritten.csv")
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{regular, link} {
		alignedTestChild(t, path, "active", 0, want, "")
	}
	for _, path := range []string{fifo, broken, filepath.Join(t.TempDir(), "PRIVATE_MISSING"), t.TempDir(), "/dev/null"} {
		alignedTestChild(t, path, "active", 1, "", "backtest-causal-aligned-window-compare: input: input_file\n")
	}
	alignedTestChild(t, fifo, "canceled", 1, "", "backtest-causal-aligned-window-compare: input: canceled\n")
	replaced := causalCLITestFile(t, csv)
	alignedTestChild(t, replaced, "replace", 0, want, "")
	for _, path := range []string{regular, replaced + ".retained"} {
		actual, err := os.ReadFile(path)
		if err != nil || string(actual) != csv {
			t.Fatal("owned input bytes changed")
		}
	}
}
