package sentiment

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"gelt/pkg/data"
)

// RedditProvider implements data.FeatureProvider for Reddit sentiment analysis.
type RedditProvider struct {
	client   *data.RedditClient
	analyzer *SentimentAnalyzer
}

// NewRedditProvider creates a new RedditProvider.
func NewRedditProvider(client *data.RedditClient, analyzer *SentimentAnalyzer) *RedditProvider {
	return &RedditProvider{
		client:   client,
		analyzer: analyzer,
	}
}

// Fetch implements FeatureProvider.Fetch to retrieve and score Reddit posts.
func (p *RedditProvider) Fetch(ctx context.Context, req data.FeatureRequest) ([]data.DataPoint, error) {
	// Parse FeatureKey, expecting format: Reddit.<subreddit>.<keyword>
	parts := strings.SplitN(req.FeatureKey, ".", 3)
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid reddit feature key format: %s", req.FeatureKey)
	}

	subreddit := parts[1]
	keyword := strings.ToLower(parts[2])

	// Fetch posts
	posts, err := p.client.FetchSubreddit(ctx, subreddit, 100)
	if err != nil {
		return nil, err
	}

	// Calculate total number of buckets required
	if req.Start.After(req.End) {
		return nil, fmt.Errorf("start time cannot be after end time")
	}
	if req.Resolution <= 0 {
		return nil, fmt.Errorf("resolution must be strictly positive")
	}

	// Buckets to aggregate sentiment
	type bucketData struct {
		totalScore float64
		count      int
	}
	buckets := make(map[time.Time]*bucketData)

	// Create all buckets with neutral score
	curr := req.Start.Truncate(req.Resolution)
	for !curr.After(req.End) {
		buckets[curr] = &bucketData{}
		curr = curr.Add(req.Resolution)
	}

	for _, post := range posts {
		// Filter by time window
		if post.CreatedAt.Before(req.Start) || post.CreatedAt.After(req.End) {
			continue
		}

		// Filter by keyword
		titleLower := strings.ToLower(post.Title)
		bodyLower := strings.ToLower(post.Body)

		if !strings.Contains(titleLower, keyword) && !strings.Contains(bodyLower, keyword) {
			continue
		}

		// Calculate sentiment
		combinedText := post.Title + " " + post.Body
		score, _ := p.analyzer.EvaluateText(combinedText)

		// Determine time bucket
		bucketTime := post.CreatedAt.Truncate(req.Resolution)

		if _, exists := buckets[bucketTime]; exists {
			buckets[bucketTime].totalScore += score
			buckets[bucketTime].count++
		}
	}

	var dataPoints []data.DataPoint
	for ts, bData := range buckets {
		avgScore := 0.0 // neutral
		if bData.count > 0 {
			avgScore = bData.totalScore / float64(bData.count)
		}

		// Ensure bounded between -1.0 and 1.0
		if avgScore > 1.0 {
			avgScore = 1.0
		} else if avgScore < -1.0 {
			avgScore = -1.0
		}

		dataPoints = append(dataPoints, data.DataPoint{
			Timestamp: ts,
			Value:     avgScore,
			Meta: map[string]any{
				"count": bData.count,
			},
		})
	}

	// Ensure chronological order
	sort.Slice(dataPoints, func(i, j int) bool {
		return dataPoints[i].Timestamp.Before(dataPoints[j].Timestamp)
	})

	return dataPoints, nil
}
