package data

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestXClient_SearchRecent(t *testing.T) {
	mockResponse := `{
		"data": [
			{"id": "1", "text": "Testing $AAPL", "created_at": "2023-01-01T00:00:00Z"},
			{"id": "2", "text": "Another test", "created_at": "2023-01-01T01:00:00Z"}
		],
		"meta": {
			"next_token": "token123"
		}
	}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tweets/search/recent" {
			t.Errorf("expected path /tweets/search/recent, got %s", r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-token" {
			t.Errorf("expected Authorization header 'Bearer test-token', got %s", auth)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(mockResponse))
	}))
	defer server.Close()

	client := NewXClient()
	client.BearerToken = "test-token"
	client.BaseURL = server.URL

	ctx := context.Background()
	posts, err := client.SearchRecent(ctx, "$AAPL", 10)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(posts) != 2 {
		t.Fatalf("expected 2 posts, got %d", len(posts))
	}

	if posts[0].ID != "1" || posts[0].Text != "Testing $AAPL" {
		t.Errorf("unexpected post content: %+v", posts[0])
	}
}

func TestXClient_SearchRecent_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("{invalid json}"))
	}))
	defer server.Close()

	client := NewXClient()
	client.BearerToken = "test-token"
	client.BaseURL = server.URL

	ctx := context.Background()
	_, err := client.SearchRecent(ctx, "$AAPL", 10)
	if err == nil {
		t.Fatalf("expected error for invalid JSON")
	}
}

func TestXEngine_StartPolling(t *testing.T) {
	mockResponse := `{
		"data": [
			{"id": "1", "text": "Testing $AAPL", "created_at": "2023-01-01T00:00:00Z"}
		]
	}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(mockResponse))
	}))
	defer server.Close()

	client := NewXClient()
	client.BearerToken = "test-token"
	client.BaseURL = server.URL

	cache := NewXCache()
	engine := NewXEngine(client, cache)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go engine.StartPolling(ctx, []string{"$AAPL"}, 10*time.Millisecond, 10)

	time.Sleep(50 * time.Millisecond)

	posts := cache.Get("$AAPL")
	if len(posts) == 0 {
		t.Fatalf("expected posts in cache")
	}

	if posts[0].Text != "Testing $AAPL" {
		t.Errorf("unexpected post text: %s", posts[0].Text)
	}
}

func TestXProvider_Fetch(t *testing.T) {
	cache := NewXCache()
	now := time.Now()
	cache.Update("$AAPL", []XPost{
		{ID: "1", Text: "I love $AAPL", CreatedAt: now},
		{ID: "2", Text: "Hate $aapl", CreatedAt: now.Add(time.Hour)},
		{ID: "3", Text: "No mention", CreatedAt: now.Add(2 * time.Hour)},
	})

	provider := &XProvider{cache: cache}

	req := FeatureRequest{
		FeatureKey: "Social.X.Mentions.$AAPL.$aapl",
		Start:      now.Add(-time.Hour),
		End:        now.Add(3 * time.Hour),
		Resolution: time.Hour,
	}

	ctx := context.Background()
	points, err := provider.Fetch(ctx, req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(points) != 2 {
		t.Fatalf("expected 2 data points, got %d", len(points))
	}

	if points[0].Value != 1 || points[1].Value != 1 {
		t.Errorf("expected values to be 1, got %f and %f", points[0].Value, points[1].Value)
	}
}

func TestRegisterXProvider(t *testing.T) {
	registry := NewFeatureRegistry()
	cache := NewXCache()
	RegisterXProvider(registry, cache)

	prefixes := registry.ListRegisteredPrefixes()
	found := false
	for _, p := range prefixes {
		if p == "Social.X.Mentions." {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected Social.X.Mentions. to be registered")
	}
}
