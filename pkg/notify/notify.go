package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"gelt/pkg/config"
)

// GetWebhookURL returns the configured Discord webhook URL from environment variable or ~/.gelt/config.json.
// Returns empty string if enable_webhooks is false in AppConfig or DISCORD_WEBHOOK_ENABLE=false.
func GetWebhookURL() string {
	if envEnable := os.Getenv("DISCORD_WEBHOOK_ENABLE"); envEnable == "false" || envEnable == "0" {
		return ""
	}
	appCfg, err := config.LoadAppConfig()
	if err == nil && !appCfg.EnableWebhooks && os.Getenv("DISCORD_WEBHOOK_URL") == "" {
		return ""
	}
	if env := os.Getenv("DISCORD_WEBHOOK_URL"); env != "" {
		return env
	}
	if err == nil && appCfg.DiscordWebhookURL != "" {
		return appCfg.DiscordWebhookURL
	}
	return ""
}

// AlertSeverity represents the severity level of the notification.
type AlertSeverity string

// SeverityInfo indicates an informational notification
const SeverityInfo AlertSeverity = "info"

// SeverityWarning indicates a warning notification
const SeverityWarning AlertSeverity = "warning"

// SeverityCritical indicates a critical notification
const SeverityCritical AlertSeverity = "critical"

// WebhookPayload represents the standard JSON payload structure for notifications.
type WebhookPayload struct {
	Timestamp   time.Time     `json:"timestamp"`
	Severity    AlertSeverity `json:"severity"`
	EventType   string        `json:"event_type"`
	PayloadData string        `json:"payload_data"`
	RawPayload  []byte        `json:"-"`
}

// WebhookDispatcher handles asynchronous delivery of webhook payloads.
type WebhookDispatcher struct {
	mu       sync.RWMutex
	endpoint string
	client   *http.Client
	queue    chan WebhookPayload
}

// DispatcherOption configures a WebhookDispatcher.
type DispatcherOption func(*WebhookDispatcher)

// WithTimeout configures the HTTP client timeout for the dispatcher.
func WithTimeout(d time.Duration) DispatcherOption {
	return func(w *WebhookDispatcher) {
		w.client.Timeout = d
	}
}

// Global default dispatcher
var DefaultDispatcher *WebhookDispatcher

func init() {
	endpoint := GetWebhookURL()
	DefaultDispatcher = NewWebhookDispatcher(endpoint)
}

// NewWebhookDispatcher creates and starts a new thread-safe WebhookDispatcher.
func NewWebhookDispatcher(endpoint string, opts ...DispatcherOption) *WebhookDispatcher {
	dispatcher := &WebhookDispatcher{
		endpoint: endpoint,
		client: &http.Client{
			Timeout: 2 * time.Second, // max 2 seconds per requirement
		},
		queue: make(chan WebhookPayload, 100), // Buffer to avoid blocking producers
	}

	for _, opt := range opts {
		opt(dispatcher)
	}
	// Start background worker
	go dispatcher.startWorker()
	return dispatcher
}

// SetEndpoint updates the webhook URL for the global default dispatcher
func (d *WebhookDispatcher) SetEndpoint(endpoint string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.endpoint = endpoint
}

// Dispatch queues a webhook alert asynchronously. It does not block.
func (d *WebhookDispatcher) Dispatch(severity AlertSeverity, eventType string, data string) {
	d.mu.RLock()
	ep := d.endpoint
	d.mu.RUnlock()
	if ep == "" || ep == "http://localhost:8080/webhook" {
		return
	}

	payload := WebhookPayload{
		Timestamp:   time.Now().UTC(),
		Severity:    severity,
		EventType:   eventType,
		PayloadData: data,
	}

	select {
	case d.queue <- payload:
		// Payload queued successfully
	default:
		// Queue is full, drop it to prevent blocking
		log.Printf("[NOTIFY ERROR] Webhook queue full, dropped alert: %s - %s", eventType, severity)
	}
}

func (d *WebhookDispatcher) startWorker() {
	for payload := range d.queue {
		d.send(payload)
	}
}

// send performs the HTTP POST to the webhook endpoint.
func (d *WebhookDispatcher) send(payload WebhookPayload) {
	d.mu.RLock()
	ep := d.endpoint
	d.mu.RUnlock()

	if ep == "" || ep == "http://localhost:8080/webhook" {
		return
	}

	var jsonData []byte
	var err error
	if len(payload.RawPayload) > 0 {
		jsonData = payload.RawPayload
	} else {
		jsonData, err = json.Marshal(payload)
		if err != nil {
			log.Printf("[NOTIFY ERROR] Failed to marshal webhook payload: %v", err)
			return
		}
	}

	req, err := http.NewRequestWithContext(context.Background(), "POST", ep, bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("[NOTIFY ERROR] Failed to create request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	// The client has a 2-second timeout, fulfilling the requirement.
	resp, err := d.client.Do(req)
	if err != nil {
		log.Printf("[NOTIFY ERROR] Webhook dispatch failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[NOTIFY ERROR] Webhook responded with status: %d", resp.StatusCode)
	}
}

// DispatchDiscord marshals a DiscordWebhook to JSON and queues it asynchronously. It does not block.
func (d *WebhookDispatcher) DispatchDiscord(webhook DiscordWebhook, severity AlertSeverity, eventType string) {
	d.mu.RLock()
	ep := d.endpoint
	d.mu.RUnlock()
	if ep == "" || ep == "http://localhost:8080/webhook" {
		return
	}

	jsonData, err := json.Marshal(webhook)
	if err != nil {
		log.Printf("[NOTIFY ERROR] Failed to marshal discord webhook payload: %v", err)
		return
	}

	payload := WebhookPayload{
		Timestamp:   time.Now().UTC(),
		Severity:    severity,
		EventType:   eventType,
		PayloadData: "Discord Rich Embed",
		RawPayload:  jsonData,
	}

	select {
	case d.queue <- payload:
		// Payload queued successfully
	default:
		// Queue is full, drop it to prevent blocking
		log.Printf("[NOTIFY ERROR] Webhook queue full, dropped discord alert: %s - %s", eventType, severity)
	}
}
