package data

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRedditClient_FetchSubreddit(t *testing.T) {
	// Setup mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/access_token") {
			// Mock authentication response
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token": "mock_token",
				"expires_in":   3600,
			})
			return
		}

		if strings.HasPrefix(r.URL.Path, "/r/wallstreetbets/hot.json") {
			// Mock reddit API response
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{
				"data": {
					"children": [
						{
							"data": {
								"title": "GME to the moon",
								"selftext": "Buy and hold",
								"score": 1337,
								"created_utc": 1629828383
							}
						}
					]
				}
			}`))
			return
		}

		http.NotFound(w, r)
	}))
	defer server.Close()

	client := &RedditClient{
		ClientID:     "mock_client_id",
		ClientSecret: "mock_client_secret",
		HTTPClient:   server.Client(),
		BaseURL:      server.URL,
		AuthURL:      server.URL + "/api/v1/access_token",
	}

	ctx := context.Background()
	posts, err := client.FetchSubreddit(ctx, "wallstreetbets", 1)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(posts) != 1 {
		t.Fatalf("expected 1 post, got %d", len(posts))
	}

	post := posts[0]
	if post.Title != "GME to the moon" {
		t.Errorf("expected title 'GME to the moon', got '%s'", post.Title)
	}
	if post.Body != "Buy and hold" {
		t.Errorf("expected body 'Buy and hold', got '%s'", post.Body)
	}
	if post.Score != 1337 {
		t.Errorf("expected score 1337, got %d", post.Score)
	}
	expectedTime := time.Unix(1629828383, 0)
	if !post.CreatedAt.Equal(expectedTime) {
		t.Errorf("expected time %v, got %v", expectedTime, post.CreatedAt)
	}
}

func TestRedditEngine_StartPolling(t *testing.T) {
	// Setup mock server
	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/access_token") {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token": "mock_token",
				"expires_in":   3600,
			})
			return
		}

		if strings.HasPrefix(r.URL.Path, "/r/options/hot.json") {
			callCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{
				"data": {
					"children": [
						{
							"data": {
								"title": "Options Test",
								"selftext": "Test body",
								"score": 100,
								"created_utc": 1629828383
							}
						}
					]
				}
			}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := &RedditClient{
		ClientID:     "mock_client_id",
		ClientSecret: "mock_client_secret",
		HTTPClient:   server.Client(),
		BaseURL:      server.URL,
		AuthURL:      server.URL + "/api/v1/access_token",
	}

	cache := NewRedditCache()
	engine := NewRedditEngine(client, cache)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start polling in a separate goroutine with a short interval
	go engine.StartPolling(ctx, []string{"options"}, 10*time.Millisecond, 1)

	// Allow some time for polling to occur
	time.Sleep(100 * time.Millisecond)

	posts := cache.Get("options")
	if len(posts) != 1 {
		t.Fatalf("expected 1 cached post, got %d", len(posts))
	}

	post := posts[0]
	if post.Title != "Options Test" {
		t.Errorf("expected title 'Options Test', got '%s'", post.Title)
	}

	if callCount.Load() < 2 {
		t.Errorf("expected at least 2 API calls, got %d", callCount.Load())
	}
}

func TestRedditProvider_Fetch(t *testing.T) {
	cache := NewRedditCache()
	now := time.Now().UTC()
	cache.Update("wallstreetbets", []RedditPost{
		{Title: "GME to the moon", Body: "GME GME", CreatedAt: now.Add(-2 * time.Hour)},
		{Title: "AMC is dead", Body: "No GME here", CreatedAt: now.Add(-1 * time.Hour)},
		{Title: "Random post", Body: "Nothing to see", CreatedAt: now},
		{Title: "gme is cool", Body: "I like gme", CreatedAt: now.Add(1 * time.Hour)}, // Outside end time
	})

	provider := &RedditProvider{cache: cache}

	tests := []struct {
		name        string
		req         FeatureRequest
		expectError bool
		expectCount int
		expectVal   []float64
	}{
		{
			name: "Valid request for GME",
			req: FeatureRequest{
				FeatureKey: "Social.Reddit.Mentions.wallstreetbets.gme",
				Start:      now.Add(-3 * time.Hour),
				End:        now.Add(10 * time.Minute),
				Resolution: 1 * time.Hour,
			},
			expectError: false,
			expectCount: 2,
			expectVal:   []float64{3.0, 1.0}, // 3 mentions in first post, 1 in second
		},
		{
			name: "Invalid prefix",
			req: FeatureRequest{
				FeatureKey: "Invalid.Prefix.wallstreetbets.gme",
				Start:      now.Add(-3 * time.Hour),
				End:        now,
				Resolution: 1 * time.Hour,
			},
			expectError: true,
			expectCount: 0,
		},
		{
			name: "Invalid format",
			req: FeatureRequest{
				FeatureKey: "Social.Reddit.Mentions.wallstreetbets",
				Start:      now.Add(-3 * time.Hour),
				End:        now,
				Resolution: 1 * time.Hour,
			},
			expectError: true,
			expectCount: 0,
		},
		{
			name: "Dot in keyword",
			req: FeatureRequest{
				FeatureKey: "Social.Reddit.Mentions.wallstreetbets.a.b",
				Start:      now.Add(-3 * time.Hour),
				End:        now,
				Resolution: 1 * time.Hour,
			},
			expectError: false,
			expectCount: 0, // Should parse correctly but find 0 mentions
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pts, err := provider.Fetch(context.Background(), tt.req)
			if (err != nil) != tt.expectError {
				t.Fatalf("expected error %v, got %v", tt.expectError, err)
			}
			if err == nil {
				if len(pts) != tt.expectCount {
					t.Fatalf("expected %d points, got %d", tt.expectCount, len(pts))
				}
				if tt.expectCount > 0 {
					for i, val := range tt.expectVal {
						if pts[i].Value != val {
							t.Errorf("expected point %d to have value %f, got %f", i, val, pts[i].Value)
						}
					}
				}
			}
		})
	}
}

func TestRegisterRedditProvider(t *testing.T) {
	registry := NewFeatureRegistry()
	cache := NewRedditCache()

	RegisterRedditProvider(registry, cache)

	prefixes := registry.ListRegisteredPrefixes()
	found := false
	for _, p := range prefixes {
		if p == "Social.Reddit.Mentions." {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("expected Social.Reddit.Mentions. to be registered")
	}
}
