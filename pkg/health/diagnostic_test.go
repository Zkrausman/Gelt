package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gelt/pkg/robinhood"
)

func TestRunPreMarketCheck_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			// Ping
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method == "POST" {
			var req robinhood.MCPRequest
			json.NewDecoder(r.Body).Decode(&req)

			if req.Method == "ping" {
				w.WriteHeader(http.StatusOK)
				return
			}

			if req.Method == "tools/call" && req.Params.Name == "get_account" {
				if got := req.Params.Arguments["account_number"]; got != "acct-test-001" {
					t.Errorf("account_number = %v, want configured synthetic test identifier", got)
				}
				w.WriteHeader(http.StatusOK)
				resMap := map[string]interface{}{
					"buying_power": 150.00,
				}
				resBytes, _ := json.Marshal(resMap)
				resp := robinhood.MCPResponse{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result:  resBytes,
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &robinhood.MCPConfig{
		ServerURL: server.URL,
		AuthToken: "valid_token",
		AccountID: "acct-test-001",
	}

	report := RunPreMarketCheck(cfg)

	if !report.MCPReachable {
		t.Errorf("Expected MCP to be reachable")
	}
	if !report.OAuthValid {
		t.Errorf("Expected OAuth to be valid")
	}
	if !report.AccountHealth {
		t.Errorf("Expected Account Health to be healthy")
	}
}

func TestRunPreMarketCheck_LowBuyingPower(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method == "POST" {
			var req robinhood.MCPRequest
			json.NewDecoder(r.Body).Decode(&req)
			if req.Method == "tools/call" && req.Params.Name == "get_account" {
				w.WriteHeader(http.StatusOK)
				resMap := map[string]interface{}{
					"buying_power": 50.00,
				}
				resBytes, _ := json.Marshal(resMap)
				resp := robinhood.MCPResponse{
					JSONRPC: "2.0",
					ID:      req.ID,
					Result:  resBytes,
				}
				json.NewEncoder(w).Encode(resp)
				return
			}
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &robinhood.MCPConfig{
		ServerURL: server.URL,
		AuthToken: "valid_token",
		AccountID: "acct-test-002",
	}

	report := RunPreMarketCheck(cfg)

	if !report.MCPReachable {
		t.Errorf("Expected MCP to be reachable")
	}
	if report.AccountHealth {
		t.Errorf("Expected Account Health to fail due to low buying power")
	}
}

func TestCheckAccountHealthRequiresConfiguredAccountID(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ok, message := checkAccountHealth(&robinhood.MCPConfig{ServerURL: server.URL})
	if ok {
		t.Fatal("checkAccountHealth succeeded without an account identifier")
	}
	if message != "Account identifier is not configured" {
		t.Fatalf("unexpected diagnostic: %q", message)
	}
	if requests != 0 {
		t.Fatalf("made %d HTTP requests without an account identifier", requests)
	}
}
