package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestVersionCommandCompleteOutput(t *testing.T) {
	var out, diagnostic bytes.Buffer
	if code := runVersionCommand(&out, &diagnostic); code != 0 || out.String() != "gelt version "+Version+"\n" || diagnostic.Len() != 0 {
		t.Fatalf("version output/status changed: code=%d output=%q diagnostic=%q", code, out.String(), diagnostic.String())
	}
	out.Reset()
	if runVersionCommand(&out, nil) != 0 || out.String() != versionCommandOutput {
		t.Fatal("successful stdout does not require stderr")
	}
}

type versionCommandWriter struct {
	calls int
	count int
	err   error
	body  []byte
}

func (w *versionCommandWriter) Write(p []byte) (int, error) {
	w.calls++
	w.body = append(w.body, p...)
	return w.count, w.err
}

func TestVersionCommandFailedOutputNeverSucceedsOrRetries(t *testing.T) {
	privateError := errors.New("OWNED_PRIVATE_WRITER_ERROR\x1b[2J\n")
	for _, tc := range []struct {
		name  string
		count int
		err   error
	}{
		{"nil", 0, nil},
		{"zero", 0, nil},
		{"short", len(versionCommandOutput) - 1, nil},
		{"negative", -1, nil},
		{"oversized", len(versionCommandOutput) + 1, nil},
		{"error", 0, privateError},
		{"full-with-error", len(versionCommandOutput), privateError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := &versionCommandWriter{count: tc.count, err: tc.err}
			var stdout io.Writer = w
			if tc.name == "nil" {
				stdout = nil
			}
			var diagnostic bytes.Buffer
			if code := runVersionCommand(stdout, &diagnostic); code != 1 || diagnostic.String() != "gelt version: output_error\n" {
				t.Fatalf("incomplete write must fail with fixed diagnostic: code=%d diagnostic=%q", code, diagnostic.String())
			}
			wantCalls := 1
			if tc.name == "nil" {
				wantCalls = 0
			}
			if w.calls != wantCalls || w.calls == 1 && string(w.body) != versionCommandOutput {
				t.Fatal("stdout write must be one complete fixed body, without retry")
			}
		})
	}
}

func TestVersionCommandDiagnosticFailuresRemainFailed(t *testing.T) {
	if runVersionCommand(nil, nil) != 1 {
		t.Fatal("nil writers must fail")
	}
	for _, tc := range []struct {
		name  string
		count int
		err   error
	}{
		{"short", 1, nil},
		{"error", 0, errors.New("OWNED_PRIVATE_DIAGNOSTIC_ERROR")},
		{"success", len(versionCommandOutputError), nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := &versionCommandWriter{count: tc.count, err: tc.err}
			if runVersionCommand(nil, w) != 1 || w.calls != 1 || string(w.body) != versionCommandOutputError {
				t.Fatal("diagnostic failure must not retry, leak writer errors or turn into success")
			}
		})
	}
}

func TestVersionCommandProcess(t *testing.T) {
	if os.Getenv("GELT_VERSION_COMMAND_HELPER") != "1" {
		return
	}
	if os.Getenv("GELT_VERSION_COMMAND_CLOSE_STDOUT") == "1" {
		if err := os.Stdout.Close(); err != nil {
			os.Exit(2)
		}
	}
	os.Args = []string{"gelt", "version", "OWNED_IGNORED_OPERAND"}
	main()
	os.Exit(2)
}

func TestVersionCommandMainOutputAndStatus(t *testing.T) {
	for _, closeStdout := range []bool{false, true} {
		name := "complete"
		if closeStdout {
			name = "closed-stdout"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			home := t.TempDir()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestVersionCommandProcess$")
			cmd.WaitDelay = 5 * time.Second
			cmd.Dir = home
			cmd.Env = []string{"HOME=" + home, "USERPROFILE=" + home, "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "GELT_VERSION_COMMAND_HELPER=1"}
			if closeStdout {
				cmd.Env = append(cmd.Env, "GELT_VERSION_COMMAND_CLOSE_STDOUT=1")
			}
			var out, diagnostic bytes.Buffer
			cmd.Stdout, cmd.Stderr = &out, &diagnostic
			err := cmd.Run()
			if closeStdout {
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != 1 || out.Len() != 0 || diagnostic.String() != versionCommandOutputError {
					t.Fatalf("closed stdout must fail: err=%v diagnostic=%q", err, diagnostic.String())
				}
			} else if err != nil || out.String() != versionCommandOutput || diagnostic.Len() != 0 {
				t.Fatalf("successful main output changed: err=%v output=%q diagnostic=%q", err, out.String(), diagnostic.String())
			}
		})
	}
}
