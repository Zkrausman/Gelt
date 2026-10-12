//go:build windows

package shadow

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// lockJournal serializes mutations across Store instances and processes that
// share one journal path. Windows LockFileEx locks the lock-file byte range
// until it is explicitly released or the handle is closed.
func lockJournal(path string) (func() error, error) {
	file, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open journal lock: %w", err)
	}
	var overlapped windows.Overlapped
	if err := windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &overlapped); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("acquire journal lock: %w", err)
	}
	return func() error {
		unlockErr := windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, &overlapped)
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
