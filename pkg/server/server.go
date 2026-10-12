package server

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"

	"gelt/pkg/broker"
	"gelt/pkg/data"
	"gelt/pkg/health"
	"gelt/pkg/plans"
	"gelt/pkg/regime"
	"gelt/pkg/config"
	"gelt/pkg/risk"
	"gelt/pkg/robinhood"
	"gelt/pkg/shadow"
	"gelt/pkg/store"
)

// TelemetryServer provides system state via REST endpoints
type TelemetryServer struct {
	activePlanEngine *plans.PlanRegistry
	featureRegistry  *data.FeatureRegistry
	address          string
	mux              *http.ServeMux
	store            *store.Store
	metricSymbol     string
}

// NewTelemetryServer initializes a new TelemetryServer
func NewTelemetryServer(address string, activeEngine *plans.PlanRegistry, featureRegistry *data.FeatureRegistry) *TelemetryServer {
	if featureRegistry == nil {
		featureRegistry = data.NewFeatureRegistry()
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "gelt_journal.db"
	}
	sStore, err := store.NewStore(dbPath)
	if err != nil {
		fmt.Printf("Warning: Failed to initialize store for TelemetryServer: %v\n", err)
	}

	sym := ""
	if appCfg, err := config.LoadAppConfig(); err == nil && len(appCfg.WatchSymbols) > 0 {
		sym = appCfg.WatchSymbols[0]
	}

	s := &TelemetryServer{
		address:          address,
		mux:              http.NewServeMux(),
		activePlanEngine: activeEngine,
		featureRegistry:  featureRegistry,
		store:            sStore,
		metricSymbol:     sym,
	}
	s.setupRoutes()
	return s
}
func (s *TelemetryServer) setupRoutes() {
	s.mux.HandleFunc("/api/v1/health", s.handleHealth)
	s.mux.HandleFunc("/api/v1/regime", s.handleRegime)
	s.mux.HandleFunc("/api/v1/risk", s.handleRisk)
	s.mux.HandleFunc("/api/v1/shadow", s.handleShadow)
	s.mux.HandleFunc("/api/v1/metrics", s.handleMetrics)
	s.mux.HandleFunc("/api/v1/features", s.handleFeatures)
	s.mux.HandleFunc("/api/v1/features/query", s.handleFeatureQuery)
	s.mux.HandleFunc("/api/v1/strategies/dynamic", s.handleDynamicStrategies)
	s.mux.HandleFunc("/api/v1/strategies/dynamic/", s.handleDynamicStrategies)

	// Serve static files
	s.serveStaticFiles()
}

// Start runs the server and blocks.
func (s *TelemetryServer) Start() error {
	server := &http.Server{
		Addr:    s.address,
		Handler: s.mux,
	}
	fmt.Printf("Starting Gelt Telemetry Server on http://%s\n", s.address)
	return server.ListenAndServe()
}

// StartAsync runs the server in a goroutine.
func (s *TelemetryServer) StartAsync() {
	go func() {
		if err := s.Start(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Telemetry Server Error: %v\n", err)
		}
	}()
}

func (s *TelemetryServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	home, _ := os.UserHomeDir()
	cfg, err := robinhood.LoadConfig(fmt.Sprintf("%s/.gelt/gelt_mcp.json", home))
	var status health.HealthReport
	if err == nil {
		status = health.RunPreMarketCheck(cfg)
	} else {
		status = health.HealthReport{
			MCPReachable:  false,
			OAuthValid:    false,
			AccountHealth: false,
			LatencyMs:     0,
			Checks: []health.CheckResult{
				{Name: "MCP Server Pulse", Status: "FAIL", Latency: 0, Message: "Config missing"},
				{Name: "OAuth State", Status: "FAIL", Latency: 0, Message: "Config missing"},
				{Name: "Account Health", Status: "FAIL", Latency: 0, Message: "Config missing"},
			},
		}
	}

	json.NewEncoder(w).Encode(status)
}

func (s *TelemetryServer) handleRegime(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	closePrices := []float64{150, 151, 152, 149, 148, 145, 140, 138, 135, 133, 130, 132, 131, 134, 135, 137, 139, 141, 143, 145, 147}

	reg, _ := regime.EvaluateRegime(18.5, closePrices)

	planReg := plans.DefaultPlanSuite()
	planNames := planReg.List()

	resp := map[string]interface{}{
		"vix":                reg.VIXValue,
		"ema20_slope":        reg.EMA20Slope,
		"is_volatile":        reg.AlertTriggered,
		"recommended_action": reg.RecommendedPlan,
		"active_plan":        "options-alpha",
		"available_plans":    planNames,
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *TelemetryServer) handleRisk(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	appCfg, _ := config.LoadAppConfig()
	gov := risk.DefaultRiskLimits(appCfg)

	resp := map[string]interface{}{
		"daily_cap":         gov.DailyLossCapUsd,
		"current_drawdown":  0.0,
		"max_position_size": gov.MaxPositionPct,
		"active_positions":  []map[string]interface{}{},
	}

	home, _ := os.UserHomeDir()
	cfg, err := robinhood.LoadConfig(fmt.Sprintf("%s/.gelt/gelt_mcp.json", home))
	if err == nil {
		telemetry, err := broker.GetAccountTelemetry(cfg)
		if err == nil && telemetry != nil {
			var positions []map[string]interface{}
			for _, p := range telemetry.Positions {
				positions = append(positions, map[string]interface{}{
					"symbol":         p.Symbol,
					"qty":            p.Quantity,
					"unrealized_pnl": p.UnrealizedPnL,
					"atr_stop":       0.0,
				})
			}
			resp["active_positions"] = positions
		} else {
			fmt.Printf("Warning: Failed to fetch live account telemetry: %v\n", err)
		}
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *TelemetryServer) handleShadow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	store := shadow.DefaultStore()
	perf, _ := store.GetPerformance("options-alpha")
	if len(perf) == 0 {
		perf = append(perf, shadow.PlanPerformance{
			PlanName:    "options-alpha",
			IsLive:      true,
			TotalTrades: 0,
			WinRate:     0.0,
			TotalPnLUSD: 0.0,
		})
	}

	for i := range perf {
		if math.IsInf(perf[i].ProfitFactor, 0) || math.IsNaN(perf[i].ProfitFactor) {
			perf[i].ProfitFactor = 999.0
		}
	}

	json.NewEncoder(w).Encode(perf)
}

func (s *TelemetryServer) handleFeatures(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.featureRegistry == nil {
		s.featureRegistry = data.NewFeatureRegistry()
	}

	key := r.URL.Query().Get("key")
	if key != "" {
		s.handleFeatureQuery(w, r)
		return
	}

	streams := s.featureRegistry.ListFeatures()
	prefixes := s.featureRegistry.ListRegisteredPrefixes()

	resp := map[string]interface{}{
		"available_prefixes": prefixes,
		"streams":            streams,
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *TelemetryServer) handleFeatureQuery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.featureRegistry == nil {
		s.featureRegistry = data.NewFeatureRegistry()
	}

	key := r.URL.Query().Get("key")
	if key == "" {
		if s.metricSymbol == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status":  "CONFIG_INVALID",
				"message": "No feature key provided and no default watch symbols configured",
			})
			return
		}
		key = "Equity." + s.metricSymbol
	}

	daysStr := r.URL.Query().Get("days")
	days := 30
	if val, err := strconv.Atoi(daysStr); err == nil && val > 0 {
		days = val
	}

	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")

	end := time.Now()
	start := end.AddDate(0, 0, -days)

	if startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}

	req := data.FeatureRequest{
		FeatureKey: key,
		Start:      start,
		End:        end,
		Resolution: 24 * time.Hour,
	}

	pts, err := s.featureRegistry.Query(r.Context(), req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"key":    key,
		"days":   days,
		"points": pts,
	}

	json.NewEncoder(w).Encode(resp)
}

// Close terminates the telemetry server connections and closes the underlying store.
func (s *TelemetryServer) Close() error {
	if s.store != nil {
		return s.store.Close()
	}
	return nil
}
