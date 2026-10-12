// Package main provides the LLM Orchestrator listener and Antigravity Agentic Bridge for Gelt.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gelt/pkg/config"
	"gelt/pkg/risk"
	"gelt/pkg/thesis"
)

// DefaultAuthorizedModels specifies the default set of authorized Gemini models for random sampling & failover.
var DefaultAuthorizedModels = []string{
	"gemini-3.6-flash",
	"gemini-3.5-flash",
	"gemini-3.1-flash-lite",
	"gemini-flash-latest",
	"gemini-2.5-pro",
	"gemini-2.5-flash-lite",
}

// GetAuthorizedModels returns the user-configured model pool from GEMINI_MODELS env var,
// ~/.gelt/config.json gemini_models, or defaults to DefaultAuthorizedModels if unspecified.
func GetAuthorizedModels() []string {
	envModels := os.Getenv("GEMINI_MODELS")
	if envModels != "" {
		parts := strings.Split(envModels, ",")
		var cleaned []string
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				cleaned = append(cleaned, trimmed)
			}
		}
		if len(cleaned) > 0 {
			return cleaned
		}
	}
	if appCfg, err := config.LoadAppConfig(); err == nil && len(appCfg.GeminiModels) > 0 {
		return appCfg.GeminiModels
	}
	return DefaultAuthorizedModels
}

// AgenticBridge defines the interface for evaluating AI trade theses.
type AgenticBridge interface {
	EvaluateThesis(ctx context.Context, symbol string, prompt string, buyThreshold float64, sellThreshold float64) (float64, *thesis.TradeThesis, error)
}

// AgenticDecision represents the multi-part structured JSON output from Gemini API.
type AgenticDecision struct {
	Score       float64 `json:"score"`
	Explanation string  `json:"explanation"`
}

// AntigravityAgentBridge implements AgenticBridge using Gemini API REST calls and local OKF self-doc sync.
type AntigravityAgentBridge struct {
	BrainPath   string
	JournalPath string
}

// NewAntigravityAgentBridge creates a new instance of AntigravityAgentBridge.
func NewAntigravityAgentBridge() *AntigravityAgentBridge {
	home, _ := os.UserHomeDir()
	return &AntigravityAgentBridge{
		BrainPath:   strings.TrimSpace(os.Getenv("GELT_BEADS_BRAIN_PATH")),
		JournalPath: filepath.Join(home, ".gelt", "journals", "ai_theses.json"),
	}
}

// EvaluateThesis processes an AGENT_REVIEW signal, queries Gemini API / agentic heuristics, and records an OKF trade thesis.
func (b *AntigravityAgentBridge) EvaluateThesis(ctx context.Context, symbol, prompt string, buyThreshold float64, sellThreshold float64) (float64, *thesis.TradeThesis, error) {
	portfolioCapital := getNotional()
	tradeSize := portfolioCapital / 4.0

	appCfg, _ := config.LoadAppConfig()
	riskProfile := risk.TestAccountRiskLimits(appCfg)
	if err := riskProfile.ValidateTrade(symbol, tradeSize, portfolioCapital); err != nil {
		tradeSize = riskProfile.MaxTradeUsd
	}
	if symbol == "" {
		symbol = "CRYPTO"
	}
	if prompt == "" {
		prompt = "It's up to you to decide what to buy and sell, just no more than two positions at a time"
	}
	if buyThreshold == 0.0 {
		buyThreshold = 75.0
	}
	if sellThreshold == 0.0 {
		sellThreshold = 35.0
	}

	loadEnvFile()

	score, explanation, modelUsed := b.queryGeminiDecision(symbol, prompt)

	bias := "NEUTRAL"
	side := "hold"
	if score >= buyThreshold {
		bias = "BULLISH"
		side = "buy"
	} else if score <= sellThreshold {
		bias = "BEARISH"
		side = "sell"
	}

	t := &thesis.TradeThesis{
		ID:              fmt.Sprintf("thesis-ai-%s-%d", strings.ToLower(symbol), time.Now().UnixNano()),
		Symbol:          symbol,
		Side:            side,
		AmountUSD:       tradeSize,
		ConfluenceScore: score,
		Bias:            bias,
		Signals:         []string{"AGY_AGENTIC_REVIEW", "PROMPT_EVALUATION"},
		Catalyst:        explanation,
		ModelUsed:       modelUsed,
		StopLossPct:     3.5,
		TargetProfitPct: 7.0,
		Status:          "AI_ORCHESTRATED",
		Timestamp:       time.Now(),
	}

	// 1. Save local journal entry
	_ = thesis.SaveJournalEntry(b.JournalPath, *t)

	// The bridge has no verified market-price/provenance contract. It must never
	// create a shadow entry; only EnsembleEngine's atomic capital reservation
	// path may persist promotable paper positions.
	if side == "buy" {
		fmt.Printf("[Antigravity Bridge] BUY thesis for [%s] was not recorded as a shadow trade: verified price/provenance and capital-reservation contracts are unavailable.\n", symbol)
	}

	// 2. Format OKF self-documentation blocks
	rationale, evidence := t.FormatSelfDoc()

	// 3. Write clean markdown only when an explicit local destination is configured.
	if brainPath := strings.TrimSpace(b.BrainPath); brainPath != "" {
		thesesDir := filepath.Join(brainPath, "theses")
		if err := os.MkdirAll(thesesDir, 0755); err == nil {
			cleanRationale := strings.ReplaceAll(rationale, "[bd-3qwe self-doc] ", "")
			cleanEvidence := strings.ReplaceAll(evidence, "[bd-3qwe self-doc] ", "")
			content := fmt.Sprintf("# Antigravity AI Thesis: %s (%s) [Model: %s]\n\n%s\n\n%s\n", symbol, bias, modelUsed, cleanRationale, cleanEvidence)
			fileName := fmt.Sprintf("ai_thesis_%s_%d.md", strings.ToLower(symbol), time.Now().Unix())
			_ = os.WriteFile(filepath.Join(thesesDir, fileName), []byte(content), 0644)
		}
	}

	return score, t, nil
}

func (b *AntigravityAgentBridge) queryGeminiDecision(symbol, prompt string) (float64, string, string) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		if appCfg, err := config.LoadAppConfig(); err == nil && appCfg.GeminiAPIKey != "" {
			apiKey = appCfg.GeminiAPIKey
		}
	}
	if apiKey == "" {
		fmt.Println("[Antigravity Bridge WARNING] GEMINI_API_KEY environment variable and config.json gemini_api_key are not set. Defaulting to neutral score 50.0 (HOLD)")
		return 50.0, "GEMINI_API_KEY not set", "n/a"
	}

	fmt.Printf("[Antigravity Bridge] Evaluating agentic market thesis for [%s]...\n", symbol)

	systemPrompt := "You are a quantitative trading AI. Evaluate the prompt and output ONLY a valid JSON object with two keys: \"score\" (a float between 0.0 and 100.0) and \"explanation\" (a concise 1-2 sentence quantitative market rationale). Do not output any markdown code blocks or extra text. Prompt: " + symbol + " - " + prompt + " CRITICAL CONSTRAINT: Do NOT use Thneed beads, RAG tags, or any bracketed identifiers like [bd-...] in your response."

	reqBody := GeminiRequest{
		Contents: []GeminiContent{
			{
				Parts: []GeminiPart{
					{Text: systemPrompt},
				},
			},
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		fmt.Printf("[Antigravity Bridge ERROR] Failed to marshal request: %v\n", err)
		return 50.0, "Failed to marshal request", "n/a"
	}

	// Load user-configured authorized models and randomly shuffle for model sampling
	authorized := GetAuthorizedModels()
	models := make([]string, len(authorized))
	copy(models, authorized)
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	r.Shuffle(len(models), func(i, j int) {
		models[i], models[j] = models[j], models[i]
	})

	var lastErr error
	var resp *http.Response
	var usedModel string

	client := &http.Client{Timeout: 10 * time.Second}

	for _, modelName := range models {
		endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", modelName)
		req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(data))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-goog-api-key", apiKey)

		r, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		if r.StatusCode == http.StatusOK {
			resp = r
			usedModel = modelName
			break
		} else {
			errBytes, _ := io.ReadAll(r.Body)
			lastErr = fmt.Errorf("HTTP %d (%s) for model %s: %s", r.StatusCode, r.Status, modelName, string(errBytes))
			r.Body.Close()
		}
	}

	if resp == nil {
		fmt.Printf("[Antigravity Bridge WARNING] Gemini API request failed across all authorized models: %v. Falling back to agentic heuristic...\n", lastErr)
		r := rand.New(rand.NewSource(time.Now().UnixNano()))
		score := 30.0
		if r.Float64() >= 0.5 {
			score = 85.0
		}
		return score, "Agentic heuristic fallback decision", "heuristic-fallback"
	}
	defer resp.Body.Close()

	var geminiResp GeminiResponse
	if err := json.NewDecoder(resp.Body).Decode(&geminiResp); err != nil {
		fmt.Printf("[Antigravity Bridge ERROR] Failed to decode Gemini JSON: %v\n", err)
		return 50.0, "Failed to decode API JSON", usedModel
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return 50.0, "Empty API candidate response", usedModel
	}

	rawText := geminiResp.Candidates[0].Content.Parts[0].Text
	cleanText := strings.TrimSpace(rawText)
	cleanText = strings.TrimPrefix(cleanText, "```json")
	cleanText = strings.TrimPrefix(cleanText, "```")
	cleanText = strings.TrimSuffix(cleanText, "```")
	cleanText = strings.TrimSpace(cleanText)

	var dec AgenticDecision
	if err := json.Unmarshal([]byte(cleanText), &dec); err == nil && dec.Explanation != "" {
		fmt.Printf("[Antigravity Bridge] Agentic Decision for [%s] via Model [%s]: Score %.1f | Rationale: %q\n", symbol, usedModel, dec.Score, dec.Explanation)
		return dec.Score, dec.Explanation, usedModel
	}

	// Fallback to float parsing if JSON unmarshaling fails
	score, err := strconv.ParseFloat(cleanText, 64)
	if err != nil {
		fmt.Printf("[Antigravity Bridge ERROR] Failed to parse decision JSON/float from Gemini response %q: %v\n", rawText, err)
		return 50.0, "Failed to parse API decision payload", usedModel
	}

	fmt.Printf("[Antigravity Bridge] Agentic Decision Score for [%s] via Model [%s]: %.1f\n", symbol, usedModel, score)
	return score, fmt.Sprintf("Evaluated score %.1f", score), usedModel
}

func getNotional() float64 {
	appCfg, err := config.LoadAppConfig()
	if err == nil && appCfg.TotalCapitalUSD > 0 {
		return appCfg.TotalCapitalUSD
	}
	return 50.0
}
