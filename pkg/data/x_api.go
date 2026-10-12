package data

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type XPost struct {
	ID        string
	Text      string
	CreatedAt time.Time
}

type XClient struct {
	APIKey      string
	APISecret   string
	BearerToken string
	HTTPClient  *http.Client
	BaseURL     string
}

func NewXClient() *XClient {
	return &XClient{
		APIKey:      os.Getenv("X_API_KEY"),
		APISecret:   os.Getenv("X_API_SECRET"),
		BearerToken: os.Getenv("X_BEARER_TOKEN"),
		HTTPClient:  &http.Client{Timeout: 10 * time.Second},
		BaseURL:     "https://api.twitter.com/2",
	}
}

func (c *XClient) SearchRecent(ctx context.Context, query string, maxResults int) ([]XPost, error) {
	if c.BearerToken == "" {
		return nil, fmt.Errorf("X_BEARER_TOKEN is not set")
	}

	u, err := url.Parse(fmt.Sprintf("%s/tweets/search/recent", c.BaseURL))
	if err != nil {
		return nil, err
	}

	q := u.Query()
	q.Set("query", query)
	q.Set("max_results", fmt.Sprintf("%d", maxResults))
	q.Set("tweet.fields", "created_at")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.BearerToken)
	req.Header.Set("User-Agent", "GeltTradingEngine/0.1.0")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("X api returned status: %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			ID        string `json:"id"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
		} `json:"data"`
		Meta struct {
			NextToken string `json:"next_token"`
		} `json:"meta"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var posts []XPost
	for _, item := range result.Data {
		createdAt, err := time.Parse(time.RFC3339, item.CreatedAt)
		if err != nil {
			slog.Warn("failed to parse X post created_at", "id", item.ID, "created_at", item.CreatedAt, "error", err)
			createdAt = time.Now() // fallback
		}
		posts = append(posts, XPost{
			ID:        item.ID,
			Text:      item.Text,
			CreatedAt: createdAt,
		})
	}

	return posts, nil
}

type XCache struct {
	mu    sync.RWMutex
	posts map[string][]XPost
}

func NewXCache() *XCache {
	return &XCache{
		posts: make(map[string][]XPost),
	}
}

func (c *XCache) Update(query string, posts []XPost) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.posts[query] = posts
}

func (c *XCache) Get(query string) []XPost {
	c.mu.RLock()
	defer c.mu.RUnlock()

	posts := make([]XPost, len(c.posts[query]))
	copy(posts, c.posts[query])
	return posts
}

type XEngine struct {
	Client *XClient
	Cache  *XCache
}

func NewXEngine(client *XClient, cache *XCache) *XEngine {
	return &XEngine{
		Client: client,
		Cache:  cache,
	}
}

func (e *XEngine) StartPolling(ctx context.Context, queries []string, interval time.Duration, maxResults int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Initial fetch
	e.pollAll(ctx, queries, maxResults)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.pollAll(ctx, queries, maxResults)
		}
	}
}

func (e *XEngine) pollAll(ctx context.Context, queries []string, maxResults int) {
	for _, query := range queries {
		posts, err := e.Client.SearchRecent(ctx, query, maxResults)
		if err == nil {
			e.Cache.Update(query, posts)
			slog.Info("polled X data successfully", "query", query, "results", len(posts))
		} else {
			slog.Error("failed to poll X data", "query", query, "error", err)
		}
	}
}

type XProvider struct {
	cache *XCache
}

func (p *XProvider) Fetch(ctx context.Context, req FeatureRequest) ([]DataPoint, error) {
	prefix := "Social.X.Mentions."
	if !strings.HasPrefix(req.FeatureKey, prefix) {
		return nil, fmt.Errorf("invalid feature key for XProvider: %s", req.FeatureKey)
	}

	parts := strings.SplitN(strings.TrimPrefix(req.FeatureKey, prefix), ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid feature key format: expected Social.X.Mentions.<query>.<keyword>")
	}

	query := parts[0]
	keyword := strings.ToLower(parts[1])

	posts := p.cache.Get(query)

	counts := make(map[int64]float64)
	var times []int64

	for _, post := range posts {
		if post.CreatedAt.Before(req.Start) || post.CreatedAt.After(req.End) {
			continue
		}

		mentions := strings.Count(strings.ToLower(post.Text), keyword)
		if mentions > 0 {
			bucketTime := post.CreatedAt.Truncate(req.Resolution).Unix()
			if _, exists := counts[bucketTime]; !exists {
				times = append(times, bucketTime)
			}
			counts[bucketTime] += float64(mentions)
		}
	}

	sort.Slice(times, func(i, j int) bool {
		return times[i] < times[j]
	})

	var dataPoints []DataPoint
	for _, t := range times {
		dataPoints = append(dataPoints, DataPoint{
			Timestamp: time.Unix(t, 0).UTC(),
			Value:     counts[t],
		})
	}

	return dataPoints, nil
}

func RegisterXProvider(registry *FeatureRegistry, cache *XCache) {
	registry.Register("Social.X.Mentions.", &XProvider{cache: cache})
}
