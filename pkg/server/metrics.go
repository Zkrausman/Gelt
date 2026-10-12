package server

import (
	"encoding/json"
	"net/http"
	"runtime"
	"time"

)

func (s *TelemetryServer) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if s.metricSymbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "CONFIG_INVALID",
			"message": "No watch symbols configured",
		})
		return
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	memMB := m.Alloc / 1024 / 1024

	var score float64
	if s.activePlanEngine != nil {
		closes := make([]float64, 21)
		volumes := make([]float64, 21)
		eval, _ := s.activePlanEngine.EvaluateActive(r.Context(), time.Now(), s.metricSymbol, closes, volumes)
		score = eval.WeightedScore
	}

	resp := map[string]interface{}{
		"memory_usage_mb":  memMB,
		"confidence_score": score,
	}

	json.NewEncoder(w).Encode(resp)
}
