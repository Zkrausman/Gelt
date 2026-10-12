// Package main provides the LLM Orchestrator listener for Gelt Agentic Trading Suite.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AgentReviewPayload represents an intercepted AGENT_REVIEW signal event.
type AgentReviewPayload struct {
	Symbol        string  `json:"symbol"`
	StrategyName  string  `json:"strategy_name"`
	Signal        string  `json:"signal"`
	Prompt        string  `json:"agent_prompt"`
	Rationale     string  `json:"rationale"`
	BuyThreshold  float64 `json:"buy_threshold"`
	SellThreshold float64 `json:"sell_threshold"`
}

// GeminiRequest represents the REST payload structure for Gemini API generateContent endpoint.
type GeminiRequest struct {
	Contents []GeminiContent `json:"contents"`
}

type GeminiContent struct {
	Parts []GeminiPart `json:"parts"`
}

type GeminiPart struct {
	Text string `json:"text"`
}

// GeminiResponse represents the REST response structure from Gemini API generateContent endpoint.
type GeminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

// loadEnvFile reads .env file from the working directory or user home directory and sets environment variables.
func loadEnvFile() {
	paths := []string{".env"}
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, ".env"))
	}

	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				val = strings.Trim(val, `"'`)
				os.Setenv(key, val)
			}
		}
	}
}

var bridge = NewAntigravityAgentBridge()

// AskLLM delegates prompt evaluation to the Antigravity Agentic Bridge.
func AskLLM(symbol, prompt string, buyThreshold, sellThreshold float64) float64 {
	score, _, _ := bridge.EvaluateThesis(context.Background(), symbol, prompt, buyThreshold, sellThreshold)
	return score
}

func main() {
	loadEnvFile()

	fmt.Println("================================================================================")
	fmt.Println("  GELT LLM AGENT ORCHESTRATOR & LISTENER SERVICE")
	fmt.Println("================================================================================")
	fmt.Println("Listening for AGENT_REVIEW signals from stdin or journal logs...")
	fmt.Println("--------------------------------------------------------------------------------")

	// 1. Process stdin stream if piped
	stat, _ := os.Stdin.Stat()
	if (stat.Mode() & os.ModeCharDevice) == 0 {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := scanner.Text()
			processLine(line)
		}
		return
	}

	// 2. Continuous tail loop on ~/.gelt/gelt_shadow_journal.json
	home, _ := os.UserHomeDir()
	journalPath := filepath.Join(home, ".gelt", "journals", "shadow_journal.json")
	fmt.Printf("Tailing shadow journal log file at: %s\n", journalPath)

	processedIDs := make(map[string]bool)
	for {
		data, err := os.ReadFile(journalPath)
		if err == nil && len(data) > 0 {
			var rawList []map[string]interface{}
			if json.Unmarshal(data, &rawList) == nil {
				for _, entry := range rawList {
					id, _ := entry["id"].(string)
					sig, _ := entry["signal"].(string)
					status, _ := entry["status"].(string)

					if (sig == "AGENT_REVIEW" || status == "AGENT_REVIEW" || strings.Contains(fmt.Sprintf("%v", entry), "AGENT_REVIEW")) && !processedIDs[id] {
						sym, _ := entry["symbol"].(string)
						prompt, _ := entry["agent_prompt"].(string)

						buyThresh := 75.0
						if b, ok := entry["buy_threshold"].(float64); ok && b != 0.0 {
							buyThresh = b
						}
						sellThresh := 35.0
						if s, ok := entry["sell_threshold"].(float64); ok && s != 0.0 {
							sellThresh = s
						}

						_ = AskLLM(sym, prompt, buyThresh, sellThresh)
						if id != "" {
							processedIDs[id] = true
						}
					}
				}
			}
		}
		time.Sleep(3 * time.Second)
	}
}

func processLine(line string) {
	if strings.Contains(line, "AGENT_REVIEW") {
		var payload AgentReviewPayload
		if err := json.Unmarshal([]byte(line), &payload); err == nil && payload.Symbol != "" {
			b := payload.BuyThreshold
			if b == 0.0 {
				b = 75.0
			}
			s := payload.SellThreshold
			if s == 0.0 {
				s = 35.0
			}
			_ = AskLLM(payload.Symbol, payload.Prompt, b, s)
		} else {
			symbol := "CRYPTO_ASSET"
			for _, sym := range []string{"BTC", "ETH", "SOL", "AVAX"} {
				if strings.Contains(line, sym) {
					symbol = sym
					break
				}
			}
			prompt := "It's up to you to decide what to buy and sell, just no more than two positions at a time"
			_ = AskLLM(symbol, prompt, 75.0, 35.0)
		}
	}
}
