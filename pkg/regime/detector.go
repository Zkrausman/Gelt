package regime

import (
	"context"
	"gelt/pkg/macro"
)

// State represents the discrete market regime.
type State string

const (
	RegimeBullish  State = "RegimeBullish"
	RegimeBearish  State = "RegimeBearish"
	RegimeVolatile State = "RegimeVolatile"
)

// RegimeDetector defines the interface for detecting market regimes based on macro data.
type RegimeDetector interface {
	Detect(ctx context.Context) State
}

// Detector is the concrete implementation of RegimeDetector.
type Detector struct {
	provider macro.MacroProvider
}

// NewDetector creates a new RegimeDetector using the given macro.MacroProvider.
func NewDetector(provider macro.MacroProvider) *Detector {
	return &Detector{
		provider: provider,
	}
}

// Detect evaluates the current market regime. It safely defaults to RegimeVolatile
// if any macro data ingestion fails or returns invalid results.
func (d *Detector) Detect(ctx context.Context) State {
	if d.provider == nil {
		return RegimeVolatile
	}

	vix, err := d.provider.FetchVIX(ctx)
	if err != nil || vix <= 0 {
		return RegimeVolatile
	}

	spyTrend, err := d.provider.FetchSPYTrend(ctx)
	if err != nil || spyTrend <= 0 {
		return RegimeVolatile
	}

	// Simple heuristic to translate raw macro indicators into discrete states:
	if vix >= 30.0 {
		return RegimeVolatile
	} else if vix >= 20.0 {
		return RegimeBearish
	}

	return RegimeBullish
}
