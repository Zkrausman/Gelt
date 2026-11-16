package main

import "io"

const versionCommandOutput = "gelt version " + Version + "\n"
const versionCommandOutputError = "gelt version: output_error\n"

// A successful status means the writer accepted the complete version body.
// This is not a persistence guarantee, and a failed write can leave a prefix.
func runVersionCommand(stdout, stderr io.Writer) int {
	if stdout != nil {
		n, err := stdout.Write([]byte(versionCommandOutput))
		if err == nil && n == len(versionCommandOutput) {
			return 0
		}
	}
	if stderr != nil {
		_, _ = stderr.Write([]byte(versionCommandOutputError))
	}
	return 1
}
