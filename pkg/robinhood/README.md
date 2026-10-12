# Gelt Robinhood MCP Integration (`pkg/robinhood`)

The `pkg/robinhood` package provides OAuth 2.0 PKCE authentication, Model Context Protocol (MCP) tool invocation, and order routing to the Robinhood Agentic Trading Server.

## Architecture

```mermaid
graph TD
    CLI["cmd/gelt/main.go"] --> MCP["pkg/robinhood/mcp.go (ExecuteMCPOrder)"]
    MCP --> Auth["~/.gemini/gelt_mcp.json (Bearer Auth Token)"]
    Auth --> Server["https://agent.robinhood.com/mcp/trading"]
    Server --> Fill["OrderResult (Fill Price & Order ID)"]
```

## Features

- **OAuth 2.0 PKCE Interactive Login**: Automatically launches browser login flow with local HTTP callback handler to acquire bearer authentication tokens.
- **MCP Tool Invocation**: Dispatches JSON-RPC 2.0 tool requests (`place_equity_order`) to the Robinhood Agentic Server.
- **Config Persistence**: Saves endpoint URLs and bearer tokens securely in `~/.gemini/gelt_mcp.json`.
