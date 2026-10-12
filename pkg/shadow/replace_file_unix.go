//go:build !windows

package shadow

import (
	"os"
	"path/filepath"
)

func replaceFile(tempPath, targetPath string) error {
	return os.Rename(tempPath, targetPath)
}

// syncJournalDir makes the rename durable on filesystems that support syncing
// directories. It is intentionally a no-op on platforms without that contract.
func syncJournalDir(dir string) error {
	file, err := os.Open(filepath.Clean(dir))
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}
