package notify

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const disabledSentinel = "http://localhost:8080/webhook"

type capturedRequest struct{ url, body, contentType string }
type captureTransport struct{ requests chan capturedRequest }

func (c captureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	b, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	c.requests <- capturedRequest{r.URL.String(), string(b), r.Header.Get("Content-Type")}
	return &http.Response{StatusCode: http.StatusNoContent, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
}

func waitSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for owned operation")
	}
}
func receive(t *testing.T, ch <-chan capturedRequest) capturedRequest {
	t.Helper()
	select {
	case r := <-ch:
		return r
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for request")
		return capturedRequest{}
	}
}
func ownedDispatcher(t *testing.T, resolver func() string, capacity int) (*WebhookDispatcher, chan capturedRequest, func()) {
	t.Helper()
	requests := make(chan capturedRequest, 256)
	d := &WebhookDispatcher{resolver: resolver, client: &http.Client{Transport: captureTransport{requests}}, queue: make(chan WebhookPayload, capacity)}
	done := make(chan struct{})
	go func() { defer close(done); d.startWorker() }()
	var once sync.Once
	stop := func() { once.Do(func() { close(d.queue); waitSignal(t, done) }) }
	t.Cleanup(stop)
	return d, requests, stop
}

func TestLazyResolutionPayloads(t *testing.T) {
	for _, discordFirst := range []bool{false, true} {
		t.Run(map[bool]string{false: "regular-first", true: "discord-first"}[discordFirst], func(t *testing.T) {
			var calls atomic.Int32
			d, requests, stop := ownedDispatcher(t, func() string { calls.Add(1); return "https://resolved.invalid/hook" }, 10)
			if calls.Load() != 0 {
				t.Fatal("resolver called at construction")
			}
			regular := func() { d.Dispatch(SeverityCritical, "risk", "details") }
			discord := func() { d.DispatchDiscord(DiscordWebhook{Content: "hello"}, SeverityInfo, "discord") }
			if discordFirst {
				discord()
				regular()
			} else {
				regular()
				discord()
			}
			first, second := receive(t, requests), receive(t, requests)
			stop()
			if calls.Load() != 1 {
				t.Fatalf("resolver calls = %d", calls.Load())
			}
			for _, req := range []capturedRequest{first, second} {
				if req.url != "https://resolved.invalid/hook" || req.contentType != "application/json" {
					t.Fatalf("request = %+v", req)
				}
			}
			if discordFirst {
				first, second = second, first
			}
			var payload WebhookPayload
			if err := json.Unmarshal([]byte(first.body), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Timestamp.IsZero() || payload.Severity != SeverityCritical || payload.EventType != "risk" || payload.PayloadData != "details" {
				t.Fatalf("payload = %+v", payload)
			}
			if second.body != `{"content":"hello"}` {
				t.Fatalf("discord body = %s", second.body)
			}
		})
	}
}

func TestLazyDisabledAndExplicitEndpoints(t *testing.T) {
	for _, endpoint := range []string{"", disabledSentinel} {
		t.Run("lazy-"+endpoint, func(t *testing.T) {
			var calls atomic.Int32
			d, requests, stop := ownedDispatcher(t, func() string { calls.Add(1); return endpoint }, 10)
			d.Dispatch(SeverityInfo, "first", "")
			stop()
			if calls.Load() != 1 || len(requests) != 0 {
				t.Fatalf("calls=%d requests=%d", calls.Load(), len(requests))
			}
			// No worker is needed: disabled producer paths must not enqueue after resolution.
			d.queue = make(chan WebhookPayload, 2)
			d.Dispatch(SeverityInfo, "later", "")
			d.DispatchDiscord(DiscordWebhook{Content: "later"}, SeverityInfo, "later")
			if len(d.queue) != 0 || calls.Load() != 1 {
				t.Fatal("disabled dispatcher queued or resolved again")
			}
		})
		t.Run("explicit-"+endpoint, func(t *testing.T) {
			d, requests, stop := ownedDispatcher(t, nil, 2)
			d.SetEndpoint(endpoint)
			d.Dispatch(SeverityInfo, "disabled", "")
			d.DispatchDiscord(DiscordWebhook{Content: "disabled"}, SeverityInfo, "disabled")
			stop()
			if len(requests) != 0 {
				t.Fatal("disabled explicit dispatcher sent a request")
			}
			// Check the producer paths with no worker consuming the queue.
			d.queue = make(chan WebhookPayload, 2)
			d.Dispatch(SeverityInfo, "disabled", "")
			d.DispatchDiscord(DiscordWebhook{Content: "disabled"}, SeverityInfo, "disabled")
			if len(d.queue) != 0 {
				t.Fatal("disabled explicit dispatcher queued")
			}
		})
	}
}

func TestLazyOverrideBeforeAndAfter(t *testing.T) {
	var calls atomic.Int32
	d, requests, stop := ownedDispatcher(t, func() string { calls.Add(1); return "https://resolved.invalid" }, 10)
	d.SetEndpoint("https://first.invalid")
	d.Dispatch(SeverityInfo, "before", "")
	if req := receive(t, requests); req.url != "https://first.invalid" {
		t.Fatal(req)
	}
	d.SetEndpoint("https://second.invalid")
	d.Dispatch(SeverityInfo, "after", "")
	if req := receive(t, requests); req.url != "https://second.invalid" {
		t.Fatal(req)
	}
	stop()
	if calls.Load() != 0 {
		t.Fatal("overridden resolver called")
	}

	d, requests, stop = ownedDispatcher(t, func() string { calls.Add(1); return "https://resolved.invalid" }, 10)
	d.Dispatch(SeverityInfo, "resolve", "")
	if req := receive(t, requests); req.url != "https://resolved.invalid" {
		t.Fatal(req)
	}
	d.SetEndpoint("https://later.invalid")
	d.Dispatch(SeverityInfo, "later", "")
	if req := receive(t, requests); req.url != "https://later.invalid" {
		t.Fatal(req)
	}
	stop()
	if calls.Load() != 1 {
		t.Fatalf("calls = %d", calls.Load())
	}
}

func TestLazyBlockedResolverOverrideAndQueue(t *testing.T) {
	for _, endpoint := range []string{"https://override.invalid", "", disabledSentinel} {
		t.Run(endpoint, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			var calls atomic.Int32
			d, requests, stop := ownedDispatcher(t, func() string { calls.Add(1); close(entered); <-release; return "https://late.invalid" }, 1)
			t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
			d.Dispatch(SeverityInfo, "first", "")
			waitSignal(t, entered)
			sentinel := WebhookPayload{EventType: "queue-sentinel"}
			d.queue <- sentinel
			finished := make(chan struct{})
			t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); waitSignal(t, finished) })
			go func() {
				defer close(finished)
				var wg sync.WaitGroup
				for i := 0; i < 8; i++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						d.Dispatch(SeverityInfo, "drop", "")
						d.DispatchDiscord(DiscordWebhook{Content: "drop"}, SeverityInfo, "drop")
					}()
				}
				d.SetEndpoint(endpoint)
				wg.Wait()
			}()
			waitSignal(t, finished)
			if len(d.queue) != 1 {
				t.Fatalf("queue length = %d", len(d.queue))
			}
			if got := <-d.queue; got.EventType != sentinel.EventType {
				t.Fatalf("queue changed: %+v", got)
			}
			releaseOnce.Do(func() { close(release) })
			stop()
			if calls.Load() != 1 {
				t.Fatalf("calls = %d", calls.Load())
			}
			if endpoint == "https://override.invalid" {
				if len(requests) != 1 {
					t.Fatalf("requests = %d", len(requests))
				}
				if req := <-requests; req.url != endpoint {
					t.Fatal(req)
				}
			} else if len(requests) != 0 {
				t.Fatalf("disabled override sent %d requests", len(requests))
			}
		})
	}
}
