//go:build windows

package shadow

import "golang.org/x/sys/windows"

// MoveFileEx replaces an existing destination on Windows, unlike os.Rename
// when a reader has recently released the old canonical journal.
func replaceFile(tempPath, targetPath string) error {
	return windows.MoveFileEx(windows.StringToUTF16Ptr(tempPath), windows.StringToUTF16Ptr(targetPath), windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}

// Windows MoveFileEx with MOVEFILE_WRITE_THROUGH is the platform durability
// boundary; Windows does not expose a portable directory Sync equivalent.
func syncJournalDir(string) error { return nil }
