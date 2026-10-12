# Gelt Notification Engine (`pkg/notify`)

The `pkg/notify` package provides asynchronous, thread-safe HTTP webhook dispatching for risk governance events, regime alerts, and trade execution notifications in Gelt.

## Architecture

```mermaid
graph TD
    Alert["Risk Event / Regime Alert / Trade Execution"] --> Dispatcher["pkg/notify/webhook.go (WebhookDispatcher)"]
    Queue["Buffered Payload Queue (chan WebhookPayload)"] --> Dispatcher
    Dispatcher --> HTTP["Asynchronous Non-Blocking HTTP Post"]
    HTTP --> Endpoint["Configured Webhook URL"]
```

## Features

- **Non-Blocking Ingestion**: Queues alerts asynchronously via buffered channels, guaranteeing 0ms latency impact on main trading threads.
- **Alert Severities**: Categorizes alerts by severity levels (`INFO`, `WARNING`, `CRITICAL`).
- **Thread-Safe Dispatcher**: Provides global and custom webhook dispatchers with context cancellation support.
