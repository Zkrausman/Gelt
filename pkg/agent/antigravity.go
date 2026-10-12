package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"gelt/pkg/macro"
)

type client struct {
	config     Config
	httpClient *http.Client
}

// NewAntigravityAgentClient creates a new AntigravityAgentClient.
func NewAntigravityAgentClient(cfg Config) AntigravityAgentClient {
	// The endpoint must be configured by the caller
	return &client{
		config:     cfg,
		httpClient: &http.Client{},
	}
}

func (c *client) Dispatch(ctx context.Context, payload InteractionPayload) (*InteractionResponse, error) {
	if c.config.Endpoint == "" {
		return nil, fmt.Errorf("agent endpoint not configured")
	}

	// We'll perform up to 5 turns to prevent infinite loops in the multi-turn session
	maxTurns := 5
	var currentPayload InteractionPayload = payload
	var finalResponse *InteractionResponse

	for turn := 0; turn < maxTurns; turn++ {
		data, err := json.Marshal(currentPayload)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal payload on turn %d: %w", turn, err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.Endpoint, bytes.NewBuffer(data))
		if err != nil {
			return nil, fmt.Errorf("failed to create request on turn %d: %w", turn, err)
		}

		req.Header.Set("Content-Type", "application/json")
		if c.config.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("agent request failed on turn %d: %w", turn, err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("unexpected status code on turn %d: %d", turn, resp.StatusCode)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response body on turn %d: %w", turn, err)
		}

		var interactionResp InteractionResponse
		if err := json.Unmarshal(body, &interactionResp); err != nil {
			return nil, fmt.Errorf("failed to unmarshal response on turn %d: %w", turn, err)
		}

		finalResponse = &interactionResp

		// Execution loop for tool calls
		if len(interactionResp.ToolCalls) > 0 {
			var toolResults []string
			for _, tc := range interactionResp.ToolCalls {
				if tc.Name == "ReadShadowJournal" {
					data, err := ReadShadowJournal()
					if err != nil {
						toolResults = append(toolResults, fmt.Sprintf("ReadShadowJournal failed: %v", err))
					} else {
						toolResults = append(toolResults, fmt.Sprintf("ReadShadowJournal success: %s", string(data)))
					}
				} else if tc.Name == "WriteRegimeMatrix" {
					var m macro.RegimeMatrix
					b, err := json.Marshal(tc.Arguments)
					if err != nil {
						toolResults = append(toolResults, fmt.Sprintf("WriteRegimeMatrix arguments invalid: %v", err))
						continue
					}
					if err := json.Unmarshal(b, &m); err != nil {
						toolResults = append(toolResults, fmt.Sprintf("WriteRegimeMatrix unmarshal failed: %v", err))
						continue
					}
					if err := WriteRegimeMatrix(m); err != nil {
						toolResults = append(toolResults, fmt.Sprintf("WriteRegimeMatrix execution failed: %v", err))
					} else {
						toolResults = append(toolResults, "WriteRegimeMatrix success")
					}
				} else {
					toolResults = append(toolResults, fmt.Sprintf("Unknown tool: %s", tc.Name))
				}
			}

			// Re-dispatch the results back to the agent for the next turn
			currentPayload = InteractionPayload{
				SessionID: interactionResp.SessionID,
				Prompt:    fmt.Sprintf("Tool results: %v", toolResults),
			}
			continue
		}

		// If there are no tool calls, the session is complete
		break
	}

	return finalResponse, nil
}

// ReadShadowJournal is a tool binding that allows the remote agent to read the local shadow journal.
// It strictly limits reads to the default shadow journal path to prevent path traversal vulnerabilities.
func ReadShadowJournal() ([]byte, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home, ".gelt", "journals", "shadow_journal.json")
	return os.ReadFile(path)
}

// WriteRegimeMatrix is a tool binding that dumps structured output to ~/.gelt/regime_matrix.json.
func WriteRegimeMatrix(matrix macro.RegimeMatrix) error {
	macro.MatrixMutex.Lock()
	defer macro.MatrixMutex.Unlock()

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get user home dir: %w", err)
	}
	geltDir := filepath.Join(home, ".gelt")
	if err := os.MkdirAll(geltDir, 0755); err != nil {
		return fmt.Errorf("failed to create .gelt directory: %w", err)
	}
	path := filepath.Join(geltDir, "regime_matrix.json")

	data, err := json.MarshalIndent(matrix, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal regime matrix: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write regime matrix to file: %w", err)
	}

	return nil
}
