package sentiment

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gelt/pkg/data"
)

func TestRedditProvider_Fetch(t *testing.T) {
	// Setup mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/access_token") {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token": "mock_token",
				"expires_in":   3600,
			})
			return
		}

		if strings.HasPrefix(r.URL.Path, "/r/wallstreetbets/hot.json") {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{
				"data": {
					"children": [
						{
							"data": {
								"title": "GME to the moon",
								"selftext": "Buy and hold, it is printing",
								"score": 100,
								"created_utc": 1629828383
							}
						},
						{
							"data": {
								"title": "GME is tanking",
								"selftext": "I am losing money",
								"score": 50,
								"created_utc": 1629828383
							}
						},
						{
							"data": {
								"title": "AAPL looking good",
								"selftext": "Calls on AAPL",
								"score": 10,
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

	client := &data.RedditClient{
		ClientID:     "mock_client_id",
		ClientSecret: "mock_client_secret",
		HTTPClient:   server.Client(),
		BaseURL:      server.URL,
		AuthURL:      server.URL + "/api/v1/access_token",
	}

	analyzer := NewSentimentAnalyzer()
	provider := NewRedditProvider(client, analyzer)
	ctx := context.Background()

	// 1629828383 is August 24, 2021 6:06:23 PM GMT
	reqStart := time.Unix(1629824400, 0) // 1629824400 is 5:00 PM GMT
	reqEnd := time.Unix(1629831600, 0)   // 1629831600 is 7:00 PM GMT

	// Test case 1: Fetch GME sentiment, expect 3 hourly buckets: 5PM, 6PM, 7PM
	reqGME := data.FeatureRequest{
		FeatureKey: "Reddit.wallstreetbets.gme",
		Start:      reqStart,
		End:        reqEnd,
		Resolution: time.Hour,
	}

	points, err := provider.Fetch(ctx, reqGME)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(points) != 3 {
		t.Fatalf("expected 3 data points (continuous hourly buckets), got %d", len(points))
	}

	if points[0].Value != 0.0 {
		t.Errorf("expected 5PM bucket to be neutral 0.0, got %f", points[0].Value)
	}
	if points[0].Meta["count"].(int) != 0 {
		t.Errorf("expected 5PM bucket count to be 0")
	}

	if points[1].Value == 0.0 {
		t.Errorf("expected 6PM bucket to be non-zero due to GME posts, got %f", points[1].Value)
	}
	if points[1].Meta["count"].(int) != 2 {
		t.Errorf("expected 6PM bucket count to be 2 for GME")
	}

	if points[2].Value != 0.0 {
		t.Errorf("expected 7PM bucket to be neutral 0.0, got %f", points[2].Value)
	}

	// Test Chronological Order
	if !points[0].Timestamp.Before(points[1].Timestamp) || !points[1].Timestamp.Before(points[2].Timestamp) {
		t.Errorf("expected data points to be strictly chronological")
	}
}
