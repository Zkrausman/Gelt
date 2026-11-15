package main

import "io"

const unknownCommandDiagnostic = "gelt: unknown_command\n"

// No operand is accepted here: an unmatched token must not enter diagnostics.
func runUnknownCommand(stdout, stderr io.Writer) int {
	if stderr != nil {
		_, _ = io.WriteString(stderr, unknownCommandDiagnostic)
	}
	// Keep existing bounded usage and output-error handling, without retry.
	_ = writeOfflineHelp(globalHelp(Version), stdout, stderr)
	return 1
}
