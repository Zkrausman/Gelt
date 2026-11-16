package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestUnknownCommandFixedDiagnosticAndUsage(t *testing.T) {
	var out, diagnostic bytes.Buffer
	if code := runUnknownCommand(&out, &diagnostic); code != 1 || out.String() != globalHelp(Version) || diagnostic.String() != "gelt: unknown_command\n" {
		t.Fatalf("unknown command must have fixed streams and exit1: code=%d stderr=%q", code, diagnostic.String())
	}
	if out.Len() > offlineHelpMaxBytes {
		t.Fatal("usage exceeds existing help bound")
	}
}

type unknownCommandWriter struct {
	calls int
	short bool
	err   error
}

func (w *unknownCommandWriter) Write(p []byte) (int, error) {
	w.calls++
	if w.err != nil {
		return 0, w.err
	}
	if w.short {
		return len(p) / 2, nil
	}
	return len(p), nil
}

func TestUnknownCommandWriterFailuresStayFailures(t *testing.T) {
	for _, name := range []string{"nil", "short", "error"} {
		t.Run(name, func(t *testing.T) {
			var out io.Writer
			writer := &unknownCommandWriter{short: name == "short"}
			if name == "error" {
				writer.err = errors.New("OWNED_PRIVATE_WRITER_ERROR")
			}
			if name != "nil" {
				out = writer
			}
			var diagnostic bytes.Buffer
			if runUnknownCommand(out, &diagnostic) != 1 || writer.calls > 1 || diagnostic.String() != unknownCommandDiagnostic+"gelt help: output_error\n" {
				t.Fatal("output failure must retain fixed diagnostics with no retry")
			}
		})
	}
	var out bytes.Buffer
	if runUnknownCommand(&out, nil) != 1 || out.String() != globalHelp(Version) {
		t.Fatal("nil stderr must never produce success")
	}
	failed := &unknownCommandWriter{err: errors.New("OWNED_PRIVATE_STDERR_ERROR")}
	out.Reset()
	if runUnknownCommand(&out, failed) != 1 || failed.calls != 1 || out.String() != globalHelp(Version) {
		t.Fatal("stderr failure must not retry or suppress existing usage")
	}
}

func TestUnknownCommandProcess(t *testing.T) {
	if os.Getenv("GELT_UNKNOWN_COMMAND_HELPER") != "1" {
		return
	}
	for i, a := range os.Args {
		if a == "--" {
			os.Args = append([]string{"gelt"}, os.Args[i+1:]...)
			main()
			os.Exit(0)
		}
	}
	os.Exit(2)
}

func TestUnknownCommandProcessSuppressesOperand(t *testing.T) {
	for _, operand := range []string{"owned-typo", "", "OWNED_PRIVATE_CANARY\x1b[2J\r\nFORGED_LOG", strings.Repeat("OWNED_PRIVATE_", 320)} {
		t.Run(operand[:min(8, len(operand))], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestUnknownCommandProcess$", "--", operand)
			cmd.WaitDelay = 5 * time.Second
			home := t.TempDir()
			cmd.Dir = home
			cmd.Env = []string{"HOME=" + home, "USERPROFILE=" + home, "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "GELT_UNKNOWN_COMMAND_HELPER=1"}
			var out, diagnostic bytes.Buffer
			cmd.Stdout, cmd.Stderr = &out, &diagnostic
			err := cmd.Run()
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 1 || out.String() != globalHelp(Version) || diagnostic.String() != unknownCommandDiagnostic {
				t.Fatalf("fixed default dispatch rejected incorrectly: err=%v stderr=%q", err, diagnostic.String())
			}
		})
	}
}
