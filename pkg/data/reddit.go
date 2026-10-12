package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sort"
	"time"
)

// RedditPost represents a single post extracted from Reddit.
type RedditPost struct {
	Title     string
	Body      string
	Score     int
	CreatedAt time.Time
}

// RedditClient handles communication with the Reddit API.
type RedditClient struct {
	ClientID     string
	ClientSecret string
	HTTPClient   *http.Client
	Token        string
	TokenExpiry  time.Time
	BaseURL      string
	AuthURL      string
}

// NewRedditClient initializes a Reddit API client using environment variables.
func NewRedditClient() *RedditClient {
	return &RedditClient{
		ClientID:     os.Getenv("REDDIT_CLIENT_ID"),
		ClientSecret: os.Getenv("REDDIT_CLIENT_SECRET"),
		HTTPClient:   &http.Client{Timeout: 10 * time.Second},
		BaseURL:      "https://oauth.reddit.com",
		AuthURL:      "https://www.reddit.com/api/v1/access_token",
	}
}

func (c *RedditClient) authenticate(ctx context.Context) error {
	if time.Now().Before(c.TokenExpiry) && c.Token != "" {
		return nil
	}

	data := url.Values{}
	data.Set("grant_type", "client_credentials")

	req, err := http.NewRequestWithContext(ctx, "POST", c.AuthURL, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}

	req.SetBasicAuth(c.ClientID, c.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "GeltTradingEngine/0.1.0")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to authenticate with reddit, status: %d", resp.StatusCode)
	}

	var authResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return err
	}

	c.Token = authResp.AccessToken
	// Subtract 60 seconds as a buffer
	c.TokenExpiry = time.Now().Add(time.Duration(authResp.ExpiresIn-60) * time.Second)

	return nil
}

// FetchSubreddit queries the given subreddit for hot posts.
func (c *RedditClient) FetchSubreddit(ctx context.Context, subreddit string, limit int) ([]RedditPost, error) {
	if err := c.authenticate(ctx); err != nil {
		return nil, err
	}

	u := fmt.Sprintf("%s/r/%s/hot.json?limit=%d", c.BaseURL, subreddit, limit)
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("User-Agent", "GeltTradingEngine/0.1.0")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("reddit api returned status: %d", resp.StatusCode)
	}

	var result struct {
		Data struct {
			Children []struct {
				Data struct {
					Title      string  `json:"title"`
					Selftext   string  `json:"selftext"`
					Score      int     `json:"score"`
					CreatedUTC float64 `json:"created_utc"`
				} `json:"data"`
			} `json:"children"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var posts []RedditPost
	for _, child := range result.Data.Children {
		posts = append(posts, RedditPost{
			Title:     child.Data.Title,
			Body:      child.Data.Selftext,
			Score:     child.Data.Score,
			CreatedAt: time.Unix(int64(child.Data.CreatedUTC), 0),
		})
	}

	return posts, nil
}

// RedditCache stores the latest reddit posts in a thread-safe manner.
type RedditCache struct {
	mu    sync.RWMutex
	posts map[string][]RedditPost
}

// NewRedditCache creates a new RedditCache.
func NewRedditCache() *RedditCache {
	return &RedditCache{
		posts: make(map[string][]RedditPost),
	}
}

// Update updates the cached posts for a subreddit.
func (c *RedditCache) Update(subreddit string, posts []RedditPost) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.posts[subreddit] = posts
}

// Get retrieves the cached posts for a subreddit.
func (c *RedditCache) Get(subreddit string) []RedditPost {
	c.mu.RLock()
	defer c.mu.RUnlock()

	posts := make([]RedditPost, len(c.posts[subreddit]))
	copy(posts, c.posts[subreddit])
	return posts
}

// RedditEngine manages the polling and caching of Reddit data.
type RedditEngine struct {
	Client *RedditClient
	Cache  *RedditCache
}

// NewRedditEngine creates a new RedditEngine.
func NewRedditEngine(client *RedditClient, cache *RedditCache) *RedditEngine {
	return &RedditEngine{
		Client: client,
		Cache:  cache,
	}
}

// StartPolling starts fetching Reddit posts at the specified interval.
func (e *RedditEngine) StartPolling(ctx context.Context, subreddits []string, interval time.Duration, limit int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Initial fetch
	e.pollAll(ctx, subreddits, limit)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.pollAll(ctx, subreddits, limit)
		}
	}
}

func (e *RedditEngine) pollAll(ctx context.Context, subreddits []string, limit int) {
	for _, sub := range subreddits {
		posts, err := e.Client.FetchSubreddit(ctx, sub, limit)
		if err == nil {
			e.Cache.Update(sub, posts)
		}
	}
}

// RedditProvider implements FeatureProvider for Reddit data.
type RedditProvider struct {
	cache *RedditCache
}

// Fetch retrieves data points for a specific Reddit feature request.
// Format: Social.Reddit.Mentions.<subreddit>.<keyword>
func (p *RedditProvider) Fetch(ctx context.Context, req FeatureRequest) ([]DataPoint, error) {
	prefix := "Social.Reddit.Mentions."
	if !strings.HasPrefix(req.FeatureKey, prefix) {
		return nil, fmt.Errorf("invalid feature key for RedditProvider: %s", req.FeatureKey)
	}

	parts := strings.SplitN(strings.TrimPrefix(req.FeatureKey, prefix), ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid feature key format: expected Social.Reddit.Mentions.<subreddit>.<keyword>")
	}

	subreddit := parts[0]
	keyword := strings.ToLower(parts[1])

	posts := p.cache.Get(subreddit)

	counts := make(map[int64]float64)
	var times []int64

	for _, post := range posts {
		if post.CreatedAt.Before(req.Start) || post.CreatedAt.After(req.End) {
			continue
		}

		titleMentions := strings.Count(strings.ToLower(post.Title), keyword)
		bodyMentions := strings.Count(strings.ToLower(post.Body), keyword)
		totalMentions := titleMentions + bodyMentions

		if totalMentions > 0 {
			bucketTime := post.CreatedAt.Truncate(req.Resolution).Unix()
			if _, exists := counts[bucketTime]; !exists {
				times = append(times, bucketTime)
			}
			counts[bucketTime] += float64(totalMentions)
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

// RegisterRedditProvider registers a new RedditProvider with the FeatureRegistry.
func RegisterRedditProvider(registry *FeatureRegistry, cache *RedditCache) {
	registry.Register("Social.Reddit.Mentions.", &RedditProvider{cache: cache})
}
