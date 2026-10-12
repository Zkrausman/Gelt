//go:build !windows

package shadow

import (
	"fmt"
	"os"
	"syscall"
)

// lockJournal serializes mutations across Store instances and processes that
// share one journal path. Readers do not need this lock because replacements
// are atomic: they see the complete old document or complete new document.
func lockJournal(path string) (func() error, error) {
	file, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open journal lock: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("acquire journal lock: %w", err)
	}
	return func() error {
		unlockErr := syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		closeErr := file.Close()
		if unlockErr != nil {
			return fmt.Errorf("release journal lock: %w", unlockErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close journal lock: %w", closeErr)
		}
		return nil
	}, nil
}
