package notify

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestWebhookDispatcher_Delivery(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)

	var receivedPayload WebhookPayload

	// Create a local HTTP mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer wg.Done()

		if r.Method != http.MethodPost {
			t.Errorf("Expected POST request, got %s", r.Method)
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("Failed to read request body: %v", err)
			return
		}

		err = json.Unmarshal(body, &receivedPayload)
		if err != nil {
			t.Errorf("Failed to parse JSON payload: %v", err)
			return
		}

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Initialize the dispatcher with the mock server URL
	dispatcher := NewWebhookDispatcher(server.URL, WithTimeout(100*time.Millisecond))

	// Dispatch an alert
	dispatcher.Dispatch(SeverityCritical, "RISK_VIOLATION", "Trade exceeds max limit")

	// Wait for the background worker to process and send the payload
	// Adding a timeout in case it hangs
	c := make(chan struct{})
	go func() {
		defer close(c)
		wg.Wait()
	}()

	select {
	case <-c:
		// Done
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for webhook dispatch")
	}

	// Verify payload
	if receivedPayload.Severity != SeverityCritical {
		t.Errorf("Expected severity %s, got %s", SeverityCritical, receivedPayload.Severity)
	}
	if receivedPayload.EventType != "RISK_VIOLATION" {
		t.Errorf("Expected event_type RISK_VIOLATION, got %s", receivedPayload.EventType)
	}
	if receivedPayload.PayloadData != "Trade exceeds max limit" {
		t.Errorf("Expected payload_data 'Trade exceeds max limit', got %s", receivedPayload.PayloadData)
	}
	if receivedPayload.Timestamp.IsZero() {
		t.Errorf("Expected non-zero timestamp")
	}
}

func TestWebhookDispatcher_Timeout(t *testing.T) {
	// Create a local HTTP mock server that sleeps for 3 seconds (longer than the 2s timeout)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	dispatcher := NewWebhookDispatcher(server.URL, WithTimeout(100*time.Millisecond))

	start := time.Now()
	// Dispatch should be non-blocking
	dispatcher.Dispatch(SeverityInfo, "TEST", "Testing timeout")

	duration := time.Since(start)
	if duration > 100*time.Millisecond {
		t.Errorf("Dispatch blocked for %v, should be asynchronous", duration)
	}

	// Wait enough time to ensure the worker attempted the request and timed out
	// The client has a 2s timeout, we wait 2.5s
	time.Sleep(200 * time.Millisecond)

	// If the test hasn't panicked or crashed, the timeout behavior is handled gracefully
}

func TestWebhookDispatcher_QueueFull(t *testing.T) {
	dispatcher := &WebhookDispatcher{endpoint: "", client: &http.Client{Timeout: 2 * time.Second}, queue: make(chan WebhookPayload, 1)}

	// Temporarily replace queue with a small one for testing

	// Fill the queue
	dispatcher.queue <- WebhookPayload{}

	// Dispatch should not block even if queue is full
	start := time.Now()
	dispatcher.Dispatch(SeverityInfo, "TEST", "Queue full test")
	duration := time.Since(start)

	if duration > 100*time.Millisecond {
		t.Errorf("Dispatch blocked for %v on full queue, should be non-blocking", duration)
	}
}
