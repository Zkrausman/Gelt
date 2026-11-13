//go:build linux

package main

import (
	"os"
	"syscall"
)

// openOfflineCSV admits the opened object, never a prior pathname observation.
// Nonblocking open avoids waiting for a FIFO peer before its type is known.
func openOfflineCSV(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	return admitOfflineCSVFile(f)
}

// admitOfflineCSVFile owns f until it transfers an admitted regular descriptor
// to the caller. Every rejected descriptor gets exactly one close attempt.
func admitOfflineCSVFile(f *os.File) (*os.File, error) {
	info, statErr := f.Stat()
	if statErr == nil && info.Mode().IsRegular() {
		return f, nil
	}
	closeErr := f.Close()
	if statErr != nil {
		return nil, statErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return nil, causalCSVRead
}
