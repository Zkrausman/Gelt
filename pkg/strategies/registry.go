package strategies

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"gelt/pkg/data"
)

// Registry manages available quantitative strategies.
type Registry struct {
	mu         sync.RWMutex
	strategies map[string]Strategy
}

// NewRegistry initializes an empty Strategy Registry.
func NewRegistry() *Registry {
	return &Registry{
		strategies: make(map[string]Strategy),
	}
}

// Register adds a new strategy to the registry.
func (r *Registry) Register(s Strategy) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.strategies[s.Name()] = s
}

// Get retrieves a strategy by name (case-insensitive fallback).
func (r *Registry) Get(name string) (Strategy, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, exists := r.strategies[name]
	if !exists {
		for k, str := range r.strategies {
			if strings.EqualFold(k, name) {
				return str, nil
			}
		}
		return nil, fmt.Errorf("strategy %q not found in registry", name)
	}
	return s, nil
}

// List returns all registered strategies sorted by name.
func (r *Registry) List() []Strategy {
	r.mu.RLock()
	defer r.mu.RUnlock()

	list := make([]Strategy, 0, len(r.strategies))
	for _, s := range r.strategies {
		list = append(list, s)
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].Name() < list[j].Name()
	})

	return list
}

// EvaluateAll runs all registered strategies on a symbol and returns their signals.
func (r *Registry) EvaluateAll(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) ([]StrategySignal, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var signals []StrategySignal
	for _, s := range r.strategies {
		sig, err := s.Evaluate(ctx, evalTime, symbol, closes, volumes)
		if err != nil {
			continue
		}
		signals = append(signals, sig)
	}

	sort.Slice(signals, func(i, j int) bool {
		return signals[i].Score > signals[j].Score
	})

	return signals, nil
}

// DefaultCatalog initializes the standard Gelt Strategy Catalog with all default strategies.
func DefaultCatalog() *Registry {
	reg := NewRegistry()
	reg.Register(NewTrendConfluenceStrategy())
	reg.Register(NewMeanReversionStrategy())
	reg.Register(NewMeanReversionBBStrategy())
	reg.Register(NewBreakoutVolStrategy())
	reg.Register(NewVWAPReboundStrategy())
	reg.Register(NewVWAPStrategy())
	reg.Register(NewMACDStrategy())
	reg.Register(NewMACDCryptoStrategy())
	reg.Register(NewAIChoiceStrategy(""))
	reg.Register(NewAIChoiceCryptoStrategy(""))
	reg.Register(NewRandomStrategy())
	reg.Register(NewRandomCryptoStrategy())
	reg.Register(NewVWAPCryptoStrategy())
	reg.Register(NewLongOptionsStrategy())
	reg.Register(NewVerticalSpreadStrategy())

	featureReg := data.NewFeatureRegistry()
	for _, s := range reg.List() {
		s.Init(featureReg)
	}
	return reg
}
