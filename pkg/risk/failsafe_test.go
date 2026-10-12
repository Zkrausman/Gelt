package risk

import "testing"

func TestFailSafe(t *testing.T) {
    fs := NewFailSafe(3)

    if fs.IsTripped() {
        t.Fatalf("Expected new FailSafe not to be tripped")
    }

    fs.RecordFailure()
    fs.RecordFailure()

    if fs.IsTripped() {
        t.Fatalf("Expected FailSafe not to be tripped after 2 failures")
    }

    fs.RecordFailure()

    if !fs.IsTripped() {
        t.Fatalf("Expected FailSafe to be tripped after 3 failures")
    }

    fs.RecordSuccess()

    if fs.IsTripped() {
        t.Fatalf("Expected FailSafe to reset after success")
    }
}
