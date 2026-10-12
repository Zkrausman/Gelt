# Robinhood Trader Skill Package (`robinhood-trader`)

Automated risk-managed trading agent skill for Robinhood Agentic Trading via Model Context Protocol (MCP) and Gelt governance suite.

## Architecture

```mermaid
graph TD
    TraderMD["skills/robinhood-trader/SKILL.md"] --> RiskEngine["pkg/risk/risk.go"]
    TraderMD --> MCPClient["pkg/robinhood/mcp.go"]
    TraderMD --> Scripts["skills/robinhood-trader/scripts/"]
    TraderMD --> References["skills/robinhood-trader/references/"]
    TraderMD --> Examples["skills/robinhood-trader/examples/"]

    MCPClient --> RobinhoodMCP["Robinhood Agentic MCP Server"]
    RiskEngine --> RiskLimits["pkg/risk (TestAccountRiskLimits: $10/Trade, 20% Max)"]
```

## Description
Equips AI agents with financial governance, technical indicator rules, and MCP order execution instructions for Robinhood Agentic Trading.
