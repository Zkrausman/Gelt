package robinhood

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSaveAndLoadConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "mcp.json")

	originalCfg := MCPConfig{
		ServerURL: "https://mcp.robinhood.com/v1/agentic/test-user",
		AccountID: "AGENTIC_123456",
	}

	if err := SaveConfig(configPath, originalCfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	loadedCfg, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if loadedCfg.ServerURL != originalCfg.ServerURL {
		t.Errorf("expected ServerURL %s, got %s", originalCfg.ServerURL, loadedCfg.ServerURL)
	}

	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatalf("os.Stat failed: %v", err)
	}

	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Errorf("expected permissions 0600, got %04o", info.Mode().Perm())
	}
}

func TestGetLatestRTHOpen(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("failed to load timezone: %v", err)
	}

	tests := []struct {
		name     string
		now      time.Time
		expected time.Time
	}{
		{
			name:     "Tuesday during RTH",
			now:      time.Date(2023, 10, 10, 14, 0, 0, 0, loc), // Tuesday 2:00 PM ET
			expected: time.Date(2023, 10, 10, 9, 30, 0, 0, loc).UTC(),
		},
		{
			name:     "Tuesday before RTH",
			now:      time.Date(2023, 10, 10, 8, 0, 0, 0, loc),       // Tuesday 8:00 AM ET
			expected: time.Date(2023, 10, 9, 9, 30, 0, 0, loc).UTC(), // Monday 9:30 AM ET
		},
		{
			name:     "Monday before RTH",
			now:      time.Date(2023, 10, 9, 8, 0, 0, 0, loc),        // Monday 8:00 AM ET
			expected: time.Date(2023, 10, 6, 9, 30, 0, 0, loc).UTC(), // Friday 9:30 AM ET
		},
		{
			name:     "Saturday",
			now:      time.Date(2023, 10, 7, 12, 0, 0, 0, loc),       // Saturday 12:00 PM ET
			expected: time.Date(2023, 10, 6, 9, 30, 0, 0, loc).UTC(), // Friday 9:30 AM ET
		},
		{
			name:     "Sunday",
			now:      time.Date(2023, 10, 8, 12, 0, 0, 0, loc),       // Sunday 12:00 PM ET
			expected: time.Date(2023, 10, 6, 9, 30, 0, 0, loc).UTC(), // Friday 9:30 AM ET
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getLatestRTHOpen(tt.now)
			if !got.Equal(tt.expected) {
				t.Errorf("getLatestRTHOpen() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestResolveMCPTimeout(t *testing.T) {
	tests := []struct {
		name       string
		cfgTimeout int
		expected   int
		expectErr  bool
	}{
		{"Configured to 30", 30, 30, false},
		{"Configured to 0 (default)", 0, 15, false},
		{"Configured to -1 (error)", -1, 0, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveMCPTimeout(tc.cfgTimeout)
			if tc.expectErr {
				if err == nil {
					t.Errorf("expected error, got nil")
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				if got != tc.expected {
					t.Errorf("expected %d, got %d", tc.expected, got)
				}
			}
		})
	}
}

func TestGenerateOAuthState(t *testing.T) {
	state1, err := generateOAuthState()
	if err != nil {
		t.Fatalf("generateOAuthState() failed: %v", err)
	}

	state2, err := generateOAuthState()
	if err != nil {
		t.Fatalf("generateOAuthState() failed on second call: %v", err)
	}

	if state1 == state2 {
		t.Errorf("generateOAuthState() returned predictable state: %s", state1)
	}

	if len(state1) < 22 {
		// 16 bytes base64 encoded is 22 chars without padding, 24 with.
		t.Errorf("generateOAuthState() returned state that is too short (expected at least 22 chars): %d", len(state1))
	}

	if strings.Contains(state1, "=") || strings.Contains(state1, "+") || strings.Contains(state1, "/") {
		t.Errorf("generateOAuthState() contains non-URL-safe characters: %s", state1)
	}
}

func TestOAuthCallbackHandler_StateMismatch(t *testing.T) {
	expectedState := "secure-state"
	codeChan := make(chan string, 1)
	errChan := make(chan error, 1)

	handler := OAuthCallbackHandler(expectedState, codeChan, errChan)

	req, _ := http.NewRequest("GET", "/callback?code=fake-code&state=bad-state", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected HTTP 400 Bad Request, got %d", rr.Code)
	}

	select {
	case err := <-errChan:
		if !strings.Contains(err.Error(), "OAuth state mismatch") {
			t.Errorf("expected state mismatch error, got: %v", err)
		}
	default:
		t.Errorf("expected error in errChan, got none")
	}

	select {
	case <-codeChan:
		t.Errorf("expected no code in codeChan, got one")
	default:
	}
}

func TestOAuthCallbackHandler_StateMatch(t *testing.T) {
	expectedState := "secure-state-match"
	codeChan := make(chan string, 1)
	errChan := make(chan error, 1)

	handler := OAuthCallbackHandler(expectedState, codeChan, errChan)

	req, _ := http.NewRequest("GET", "/callback?code=valid-auth-code&state=secure-state-match", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected HTTP 200 OK, got %d", rr.Code)
	}

	select {
	case code := <-codeChan:
		if code != "valid-auth-code" {
			t.Errorf("expected valid-auth-code, got: %s", code)
		}
	default:
		t.Errorf("expected code in codeChan, got none")
	}

	select {
	case err := <-errChan:
		t.Errorf("expected no error in errChan, got: %v", err)
	default:
	}
}

func TestAuthenticateInteractive_ConfigErrors(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("USERPROFILE", tempDir)
	t.Setenv("HOME", tempDir)

	// 2. Malformed Config: Should abort immediately with a config parsing error
	// before it ever tries to open a browser or block.
	cfgPath := filepath.Join(tempDir, ".gelt", "config.json")
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0755); err != nil {
		t.Fatalf("failed to create config dir: %v", err)
	}
	if err := os.WriteFile(cfgPath, []byte("NOT VALID JSON"), 0644); err != nil {
		t.Fatalf("failed to write malformed config: %v", err)
	}

	err := AuthenticateInteractive(tempDir)
	if err == nil {
		t.Fatalf("expected error for malformed config, got nil")
	}
	if !strings.Contains(err.Error(), "failed to load configuration") {
		t.Errorf("expected load configuration error, got: %v", err)
	}
}

// mockErrorReader is an io.Reader that always returns an error.
type mockErrorReader struct{}

func (m *mockErrorReader) Read(p []byte) (n int, err error) {
	return 0, fmt.Errorf("simulated entropy failure")
}

// mockDeterministicReader is an io.Reader that returns a repeating sequence of bytes.
type mockDeterministicReader struct {
	sequence []byte
	pos      int
}

func (m *mockDeterministicReader) Read(p []byte) (n int, err error) {
	if len(m.sequence) == 0 {
		return 0, fmt.Errorf("empty sequence")
	}
	for i := range p {
		p[i] = m.sequence[m.pos]
		m.pos = (m.pos + 1) % len(m.sequence)
	}
	return len(p), nil
}

type crMockReader struct {
	fn func(p []byte) (n int, err error)
}

func (c crMockReader) Read(p []byte) (n int, err error) {
	return c.fn(p)
}

func TestExecuteMCPOrder_Deterministic(t *testing.T) {
	testRandReader := &mockDeterministicReader{sequence: []byte{0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0}}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success": true}`))
	}))
	defer ts.Close()

	cfg := &MCPConfig{
		ServerURL: ts.URL,
		AccountID: "TEST_ACCOUNT",
		AuthToken: "mock-token",
	}

	result, err := executeMCPOrderInternal(cfg, "AAPL", 1.0, 150.0, "buy", testRandReader)
	if err != nil {
		t.Fatalf("ExecuteMCPOrder failed: %v", err)
	}

	if result.OrderID != "rh-mcp-1234-5678" {
		t.Errorf("expected deterministic OrderID 'rh-mcp-1234-5678', got %q", result.OrderID)
	}
	if result.Status != "FILLED" {
		t.Errorf("expected Status 'FILLED', got %q", result.Status)
	}
}

func TestExecuteMCPOrder_EntropyFailure(t *testing.T) {
	testRandReader := &mockErrorReader{}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success": true}`))
	}))
	defer ts.Close()

	cfg := &MCPConfig{
		ServerURL: ts.URL,
		AccountID: "TEST_ACCOUNT",
		AuthToken: "mock-token",
	}

	_, err := executeMCPOrderInternal(cfg, "AAPL", 1.0, 150.0, "buy", testRandReader)
	if err == nil {
		t.Fatal("expected ExecuteMCPOrder to fail due to entropy failure, but it succeeded")
	}

	if !strings.Contains(err.Error(), "secure reference ID") {
		t.Errorf("expected error to mention 'secure reference ID', got: %v", err)
	}
}

func TestExecuteMCPOrder_FallbackEntropyFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`invalid json`)) // Forces the JSON decoder to fail, hitting fallback block
	}))
	defer ts.Close()

	cfg := &MCPConfig{
		ServerURL: ts.URL,
		AccountID: "TEST_ACCOUNT",
		AuthToken: "mock-token",
	}

	testRandReader := &mockErrorReader{}
	_, err := executeMCPOrderInternal(cfg, "AAPL", 1.0, 150.0, "buy", testRandReader)
	if err == nil {
		t.Fatal("expected ExecuteMCPOrder to fail on ref_id, but it succeeded")
	}

	// Now try an approach that only fails on the fallback Order ID.
	type controlledReader struct {
		reads int
	}
	cr := &controlledReader{}
	var controlledFunc func(p []byte) (n int, err error)
	controlledFunc = func(p []byte) (n int, err error) {
		cr.reads++
		if cr.reads == 1 {
			// First read is for ref_id
			for i := range p {
				p[i] = 0x12
			}
			return len(p), nil
		}
		// Subsequent read should fail
		return 0, fmt.Errorf("mock entropy failure for order id")
	}
	testRandReader2 := crMockReader{fn: controlledFunc}

	_, err = executeMCPOrderInternal(cfg, "AAPL", 1.0, 150.0, "buy", testRandReader2)
	if err == nil {
		t.Fatal("expected ExecuteMCPOrder to fail on fallback order id, but it succeeded")
	}
	if !strings.Contains(err.Error(), "secure fallback order ID") {
		t.Errorf("expected error to mention 'secure fallback order ID', got: %v", err)
	}
}

func TestExecuteMCPOrder_ConcurrentSafe(t *testing.T) {
	// Verify parallel requests do not interact/panic when hitting internal execution
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success": true}`))
	}))
	defer ts.Close()

	cfg := &MCPConfig{
		ServerURL: ts.URL,
		AccountID: "TEST_ACCOUNT",
		AuthToken: "mock-token",
	}

	done := make(chan error, 50)
	for i := 0; i < 50; i++ {
		go func() {
			mockReader := &mockDeterministicReader{sequence: []byte{0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88}}
			res, err := executeMCPOrderInternal(cfg, "AAPL", 1.0, 150.0, "buy", mockReader)
			if err != nil {
				done <- err
				return
			}
			if res == nil || res.OrderID == "" {
				done <- fmt.Errorf("expected valid order ID")
				return
			}
			done <- nil
		}()
	}

	for i := 0; i < 50; i++ {
		err := <-done
		if err != nil {
			t.Errorf("concurrent execution failed: %v", err)
		}
	}
}
