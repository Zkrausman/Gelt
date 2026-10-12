package shadow

import (
	"testing"
	"time"
)

func TestIsPromotionWindowOpen(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("failed to load location: %v", err)
	}

	tests := []struct {
		name     string
		evalTime time.Time
		want     bool
	}{
		{
			name:     "10:00 ET",
			evalTime: time.Date(2023, 1, 10, 10, 0, 0, 0, loc),
			want:     true,
		},
		{
			name:     "15:29 ET",
			evalTime: time.Date(2023, 1, 10, 15, 29, 0, 0, loc),
			want:     true,
		},
		{
			name:     "15:30 ET",
			evalTime: time.Date(2023, 1, 10, 15, 30, 0, 0, loc),
			want:     false,
		},
		{
			name:     "15:55 ET",
			evalTime: time.Date(2023, 1, 10, 15, 55, 0, 0, loc),
			want:     false,
		},
		{
			name:     "16:00 ET",
			evalTime: time.Date(2023, 1, 10, 16, 0, 0, 0, loc),
			want:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsPromotionWindowOpen(tt.evalTime); got != tt.want {
				t.Errorf("IsPromotionWindowOpen() = %v, want %v", got, tt.want)
			}
		})
	}
}
