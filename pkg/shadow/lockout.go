package shadow

import (
	"sync"
	"time"
)

var (
	easternLocation *time.Location
	nyLocOnce       sync.Once
)

func getEasternLocation() *time.Location {
	nyLocOnce.Do(func() {
		loc, err := time.LoadLocation("America/New_York")
		if err != nil {
			easternLocation = time.Local
		} else {
			easternLocation = loc
		}
	})
	return easternLocation
}

// IsPromotionWindowOpen checks if strategy promotions are allowed based on the evaluation time.
// It returns false if the time is at or after 3:30 PM ET (15:30 ET).
func IsPromotionWindowOpen(evalTime time.Time) bool {
	etTime := evalTime.In(getEasternLocation())

	hour := etTime.Hour()
	minute := etTime.Minute()

	if hour > 15 {
		return false
	}

	if hour == 15 && minute >= 30 {
		return false
	}

	return true
}
