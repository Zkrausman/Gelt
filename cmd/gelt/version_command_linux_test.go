package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"
)

func TestVersionCommandMainBrokenPipes(t *testing.T) {
	for _, diagnosticPipe := range []bool{false, true} {
		name := "stdout"
		if diagnosticPipe {
			name = "diagnostic"
		}
		t.Run(name, func(t *testing.T) {
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Close()
			if err := reader.Close(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			home := t.TempDir()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestVersionCommandProcess$")
			cmd.WaitDelay = 5 * time.Second
			cmd.Dir = home
			cmd.Env = []string{"HOME=" + home, "PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C", "TZ=UTC", "GELT_VERSION_COMMAND_HELPER=1"}
			var out, diagnostic bytes.Buffer
			if diagnosticPipe {
				// Close stdout after runtime startup so the helper attempts its
				// fixed diagnostic on the still-valid, readerless stderr pipe.
				cmd.Env = append(cmd.Env, "GELT_VERSION_COMMAND_CLOSE_STDOUT=1")
				cmd.Stdout, cmd.Stderr = &out, writer
			} else {
				cmd.Stdout, cmd.Stderr = writer, &diagnostic
			}
			err = cmd.Run()
			var exit *exec.ExitError
			if ctx.Err() != nil || !errors.As(err, &exit) {
				t.Fatalf("owned broken pipe must finish with a child failure: %v", err)
			}
			status, ok := exit.Sys().(syscall.WaitStatus)
			if !ok || !status.Signaled() || status.Signal() != syscall.SIGPIPE {
				t.Fatalf("ordinary SIGPIPE disposition changed: %v", exit.ProcessState)
			}
			if out.Len() != 0 || diagnostic.Len() != 0 {
				t.Fatal("signal termination must not be claimed as a returned fixed diagnostic")
			}
		})
	}
}
