//go:build !linux

package main

import "os"

// Unsupported platforms retain their previous input-opening behavior.
func openOfflineCSV(path string) (*os.File, error) {
	return os.Open(path)
}
