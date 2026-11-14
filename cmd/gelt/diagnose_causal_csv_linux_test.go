//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestDiagnoseCausalCSVFileChild(t *testing.T) {
	var args []string
	for i, arg := range os.Args {
		if arg == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) == 0 || args[0] != "diagnose-causal-csv-child" {
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
	} else if args[2] != "active" {
		t.Fatal("invalid child mode")
	}
	os.Exit(runDiagnoseCausalCSV(ctx, []string{args[1]}, os.Stdout, os.Stderr))
}

func TestDiagnoseCausalCSVFIFOAndDevice(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unwritten.csv")
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ path, mode, want string }{
		{path, "active", "diagnose-causal-csv: input_file line=none field=none reason=open_failed\n"},
		{path, "canceled", "diagnose-causal-csv: canceled line=none field=none reason=canceled\n"},
		{"/dev/null", "active", "diagnose-causal-csv: input_file line=none field=none reason=open_failed\n"},
	} {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(exe, "-test.run=^TestDiagnoseCausalCSVFileChild$", "--", "diagnose-causal-csv-child", tc.path, tc.mode)
		cmd.Env = []string{"HOME=" + os.Getenv("HOME"), "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "DISCORD_WEBHOOK_ENABLE=false"}
		var out, diagnostic bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &diagnostic
		if err := cmd.Start(); err != nil {
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
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 || out.Len() != 0 || diagnostic.String() != tc.want {
			t.Fatalf("owned child: err=%v stdout=%q stderr=%q", err, out.String(), diagnostic.String())
		}
	}
}

func TestDiagnoseCausalCSVAdmittedDescriptorIsNotReopened(t *testing.T) {
	content := causalCLITestCSV("1,1,1,1,1,0")
	path := causalCLITestFile(t, content)
	f, err := openOfflineCSV(path)
	if err != nil {
		t.Fatal(err)
	}
	// Preserve the owned input inode and bytes while substituting its original
	// pathname with an unwritten FIFO after descriptor admission.
	retained := path + ".retained"
	if err := os.Rename(path, retained); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(path, 0600); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	var closeErr error
	owned := &diagnosticReadCloser{reader: f, onClose: func() { closeErr = f.Close() }}
	var out, diagnostic bytes.Buffer
	if code := diagnoseCausalCSVRead(context.Background(), owned, &out, &diagnostic); code != 0 || diagnostic.Len() != 0 || owned.closes != 1 || closeErr != nil {
		t.Fatalf("admitted inode: code=%d stdout=%q stderr=%q closes=%d closeErr=%v", code, out.String(), diagnostic.String(), owned.closes, closeErr)
	}
	actual, err := os.ReadFile(retained)
	if err != nil || string(actual) != content {
		t.Fatal("retained inode bytes changed")
	}
	if _, err := f.Stat(); !errors.Is(err, os.ErrClosed) {
		t.Fatal("descriptor was not closed")
	}
	if !strings.HasPrefix(out.String(), "Causal CSV syntax/domain check: passed\n") {
		t.Fatal("admitted descriptor was not read")
	}
}
