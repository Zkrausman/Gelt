package data

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	query := `
	CREATE TABLE IF NOT EXISTS feature_cache (
		feature_key TEXT NOT NULL,
		timestamp INTEGER NOT NULL,
		value REAL NOT NULL,
		meta TEXT,
		PRIMARY KEY(feature_key, timestamp)
	);

	CREATE INDEX IF NOT EXISTS idx_feature_cache_key_time
	ON feature_cache(feature_key, timestamp);

	CREATE TABLE IF NOT EXISTS feature_meta (
		feature_key TEXT PRIMARY KEY,
		last_updated DATETIME NOT NULL,
		cached_start INTEGER NOT NULL,
		cached_end INTEGER NOT NULL
	);
	`
	if _, err := db.Exec(query); err != nil {
		t.Fatalf("failed to create tables: %v", err)
	}

	return db
}

func TestCachingProvider(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	now := time.Now().Truncate(time.Second) // truncate to avoid nanosecond precision issues with sqlite

	mock := &mockProvider{
		points: []DataPoint{
			{Timestamp: now, Value: 100.0, Meta: map[string]any{"source": "test"}},
		},
	}

	cacheProvider := NewCachingProvider(mock, db, 1*time.Minute)

	req := FeatureRequest{
		FeatureKey: "Test.Feature",
		Start:      now.Add(-1 * time.Hour),
		End:        now.Add(1 * time.Hour),
	}

	// 1. First fetch should hit the mock provider (cache miss)
	points, err := cacheProvider.Fetch(context.Background(), req)
	if err != nil {
		t.Fatalf("first fetch failed: %v", err)
	}
	if len(points) != 1 || points[0].Value != 100.0 {
		t.Fatalf("expected 1 point with value 100, got %v", points)
	}

	// Change mock data to verify cache hit
	mock.points = []DataPoint{
		{Timestamp: now, Value: 200.0, Meta: nil},
	}

	// 2. Second fetch should hit the cache (cache hit, value still 100)
	points2, err := cacheProvider.Fetch(context.Background(), req)
	if err != nil {
		t.Fatalf("second fetch failed: %v", err)
	}
	if len(points2) != 1 || points2[0].Value != 100.0 {
		t.Fatalf("expected cache hit with value 100, got %v", points2)
	}
	// Verify meta was parsed correctly
	if points2[0].Meta["source"] != "test" {
		t.Errorf("expected meta 'source' to be 'test', got %v", points2[0].Meta["source"])
	}

	// 3. Make cache stale
	_, err = db.Exec("UPDATE feature_meta SET last_updated = ? WHERE feature_key = ?", now.Add(-2*time.Minute), req.FeatureKey)
	if err != nil {
		t.Fatalf("failed to make cache stale: %v", err)
	}

	// 4. Third fetch should hit the mock provider again (cache stale)
	points3, err := cacheProvider.Fetch(context.Background(), req)
	if err != nil {
		t.Fatalf("third fetch failed: %v", err)
	}
	if len(points3) != 1 || points3[0].Value != 200.0 {
		t.Fatalf("expected 1 point with value 200, got %v", points3)
	}
}

func TestCachingProviderDifferentRange(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	now := time.Now().Truncate(time.Second)

	mock := &mockProvider{
		points: []DataPoint{
			{Timestamp: now, Value: 100.0, Meta: nil},
		},
	}

	cacheProvider := NewCachingProvider(mock, db, 1*time.Minute)

	req1 := FeatureRequest{
		FeatureKey: "Test.Feature",
		Start:      now.Add(-1 * time.Hour),
		End:        now,
	}

	// 1. Fetch req1 (cache miss)
	points1, err := cacheProvider.Fetch(context.Background(), req1)
	if err != nil {
		t.Fatalf("first fetch failed: %v", err)
	}
	if len(points1) != 1 || points1[0].Value != 100.0 {
		t.Fatalf("expected 1 point with value 100, got %v", points1)
	}

	// Change mock data
	mock.points = []DataPoint{
		{Timestamp: now.Add(1 * time.Hour), Value: 200.0, Meta: nil},
	}

	req2 := FeatureRequest{
		FeatureKey: "Test.Feature",
		Start:      now.Add(-30 * time.Minute),
		End:        now.Add(-10 * time.Minute),
	}

	// 2. Fetch req2 (should be a cache HIT because the range is completely inside req1's range)
	points2, err := cacheProvider.Fetch(context.Background(), req2)
	if err != nil {
		t.Fatalf("second fetch failed: %v", err)
	}
	// The DB query won't return anything since our mock data was at `now`, which is outside req2.
	// But it should NOT hit the fallback provider (value should not be 200). It will just return empty.
	if len(points2) != 0 {
		t.Fatalf("expected cache hit but empty results, got %v", points2)
	}

	req3 := FeatureRequest{
		FeatureKey: "Test.Feature",
		Start:      now,
		End:        now.Add(1 * time.Hour),
	}

	// 3. Fetch req3 (should be a cache miss because it asks for data beyond req1's End)
	points3, err := cacheProvider.Fetch(context.Background(), req3)
	if err != nil {
		t.Fatalf("third fetch failed: %v", err)
	}
	if len(points3) != 1 || points3[0].Value != 200.0 {
		t.Fatalf("expected 1 point with value 200 (cache miss due to out-of-bounds range), got %v", points3)
	}
}
