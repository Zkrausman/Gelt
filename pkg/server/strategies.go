package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"gelt/pkg/strategies"
)

// handleDynamicStrategies multiplexes GET, POST, DELETE for dynamic strategies.
func (s *TelemetryServer) handleDynamicStrategies(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		http.Error(w, `{"error": "store not initialized"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		s.handleGetDynamicStrategies(w, r)
	case http.MethodPost:
		s.handlePostDynamicStrategy(w, r)
	case http.MethodDelete:
		s.handleDeleteDynamicStrategy(w, r)
	default:
		http.Error(w, `{"error": "method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (s *TelemetryServer) handleGetDynamicStrategies(w http.ResponseWriter, r *http.Request) {
	strats, err := s.store.GetDynamicStrategies()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	// We need to return a valid JSON list or object. Let's parse the definitions and return them.
	// `strats` is map[string][]byte where []byte is JSON strings.
	var results []map[string]interface{}
	for id, defBytes := range strats {
		var def map[string]interface{}
		if err := json.Unmarshal(defBytes, &def); err == nil {
			def["id"] = id
			results = append(results, def)
		}
	}

	if results == nil {
		results = []map[string]interface{}{}
	}
	json.NewEncoder(w).Encode(results)
}

func (s *TelemetryServer) handlePostDynamicStrategy(w http.ResponseWriter, r *http.Request) {
	var def strategies.DynamicStrategyDefinition
	if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "invalid request payload: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	if err := def.Validate(); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "validation failed: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	id := uuid.New().String()
	defBytes, err := json.Marshal(def)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "failed to serialize strategy: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	if err := s.store.InsertDynamicStrategy(id, defBytes); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "failed to save strategy: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	resp := map[string]string{"id": id, "status": "created"}
	json.NewEncoder(w).Encode(resp)
}

func (s *TelemetryServer) handleDeleteDynamicStrategy(w http.ResponseWriter, r *http.Request) {
	// Parse ID from /api/v1/strategies/dynamic/{id}
	prefix := "/api/v1/strategies/dynamic/"
	path := r.URL.Path

	id := strings.TrimPrefix(path, prefix)
	if id == "" {
		// Maybe it was passed as a query param
		id = r.URL.Query().Get("id")
	}

	if id == "" {
		http.Error(w, `{"error": "missing strategy id"}`, http.StatusBadRequest)
		return
	}

	if err := s.store.DeleteDynamicStrategy(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "failed to delete strategy: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	resp := map[string]string{"id": id, "status": "deleted"}
	json.NewEncoder(w).Encode(resp)
}
