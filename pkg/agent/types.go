package agent

import "context"

// AntigravityAgentClient defines the interface for interacting with the Antigravity Agent.
type AntigravityAgentClient interface {
	Dispatch(ctx context.Context, payload InteractionPayload) (*InteractionResponse, error)
}

// Config holds the configuration for the Antigravity Agent client.
type Config struct {
	Endpoint   string
	APIKey     string
}

// InteractionPayload represents a prompt or multi-turn payload to the agent.
type InteractionPayload struct {
	SessionID string `json:"session_id,omitempty"`
	Prompt    string `json:"prompt"`
}

// InteractionResponse is the expected output from the agent.
type InteractionResponse struct {
	SessionID string     `json:"session_id"`
	Artifact  string     `json:"artifact"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// ToolCall represents a tool invocation requested by the agent.
type ToolCall struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}
