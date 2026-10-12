package shadow

import (
	"fmt"
	"os"
	"path/filepath"
)

// durableReplace writes a private shadow-journal file (0600) through the
// common durable replacement path.
func durableReplace(path string, data []byte) error {
	return durableReplaceFile(path, data, 0600, 0700)
}

// durableReplaceArtifact writes a daemon status or telemetry artifact without
// truncating a prior canonical file. These artifacts remain world-readable
// within their owner-controlled directory for dashboard/status consumers.
func durableReplaceArtifact(path string, data []byte, mode os.FileMode) error {
	return durableReplaceFile(path, data, mode, 0755)
}

// durableReplaceFile writes a complete document to a private temporary file,
// syncs and closes it, then atomically replaces the canonical path. Before the
// rename, every error preserves the previous canonical artifact and removes
// only the temporary file. A post-rename directory-sync error is propagated so
// callers fail closed when crash durability cannot be confirmed.
func durableReplaceFile(path string, data []byte, mode, dirMode os.FileMode) error {
	return durableReplaceFileWithOps(path, data, mode, dirMode, replaceFile, syncJournalDir)
}

// durableReplaceFileWithReplacer is the deterministic replacement fault-injection seam.
func durableReplaceFileWithReplacer(path string, data []byte, mode, dirMode os.FileMode, replacer func(string, string) error) error {
	return durableReplaceFileWithOps(path, data, mode, dirMode, replacer, syncJournalDir)
}

// durableReplaceFileWithOps is the deterministic durable-write fault-injection seam.
func durableReplaceFileWithOps(path string, data []byte, mode, dirMode os.FileMode, replacer func(string, string) error, syncDir func(string) error) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return fmt.Errorf("create durable artifact directory %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("create durable artifact temporary file: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(mode.Perm()); err != nil {
		return fmt.Errorf("set durable artifact temporary mode: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fmt.Errorf("write durable artifact temporary file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("sync durable artifact temporary file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close durable artifact temporary file: %w", err)
	}
	if err := replacer(tmpPath, path); err != nil {
		return fmt.Errorf("replace durable artifact: %w", err)
	}
	if err := syncDir(dir); err != nil {
		return fmt.Errorf("sync durable artifact directory after replacement: %w", err)
	}
	return nil
}
