package portfolio

import (
	"database/sql"
	"log"
	"sync"
)

// Rebalancer computes and stores dynamic weights based on real-time trade journal metrics.
type Rebalancer struct {
	mu      sync.RWMutex
	db      *sql.DB
	weights map[string]float64
}

// NewRebalancer creates a new Rebalancer instance connected to the provided SQLite database.
func NewRebalancer(db *sql.DB) *Rebalancer {
	return &Rebalancer{
		db:      db,
		weights: make(map[string]float64),
	}
}

// UpdateWeights queries the trades table to aggregate realized PnL per strategy plan
// and updates the internal weights map.
func (r *Rebalancer) UpdateWeights() {
	if r.db == nil {
		return
	}

	query := `
		SELECT active_plan, SUM(realized_pnl)
		FROM trades
		GROUP BY active_plan
	`

	rows, err := r.db.Query(query)
	if err != nil {
		log.Printf("Rebalancer failed to query trades: %v", err)
		return
	}
	defer rows.Close()

	newWeights := make(map[string]float64)

	for rows.Next() {
		var plan string
		var pnl float64
		if err := rows.Scan(&plan, &pnl); err != nil {
			log.Printf("Rebalancer failed to scan row: %v", err)
			continue
		}

		// Example weight calculation: Base weight is 1.0, and increases with profit.
		weight := 1.0 + (pnl / 1000.0)
		if weight < 0.1 { // Set a floor to prevent zero/negative capital requirements
			weight = 0.1
		}
		newWeights[plan] = weight
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rebalancer rows error: %v", err)
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Only update weights for plans that had data; others implicitly keep default 1.0
	for k, v := range newWeights {
		r.weights[k] = v
	}
}

// GetWeight returns the dynamically calculated weight for a given plan.
// Defaults to 1.0 if not found.
func (r *Rebalancer) GetWeight(plan string) float64 {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if weight, exists := r.weights[plan]; exists {
		return weight
	}
	return 1.0 // Default weight
}
