package data

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

type CachingProvider struct {
	Fallback FeatureProvider
	DB       *sql.DB
	TTL      time.Duration
}

func NewCachingProvider(fallback FeatureProvider, db *sql.DB, ttl time.Duration) *CachingProvider {
	return &CachingProvider{
		Fallback: fallback,
		DB:       db,
		TTL:      ttl,
	}
}

func (c *CachingProvider) Fetch(ctx context.Context, req FeatureRequest) ([]DataPoint, error) {
	// Check if data is stale
	var lastUpdated time.Time
	var cachedStart, cachedEnd int64
	err := c.DB.QueryRowContext(ctx, "SELECT last_updated, cached_start, cached_end FROM feature_meta WHERE feature_key = ?", req.FeatureKey).Scan(&lastUpdated, &cachedStart, &cachedEnd)

	stale := false
	if err == sql.ErrNoRows {
		stale = true
	} else if err != nil {
		return nil, fmt.Errorf("failed to query feature_meta: %w", err)
	} else if time.Since(lastUpdated) > c.TTL {
		stale = true
	} else if req.Start.Unix() < cachedStart || req.End.Unix() > cachedEnd {
		stale = true
	}

	if !stale {
		// Fetch from cache
		rows, err := c.DB.QueryContext(ctx, "SELECT timestamp, value, meta FROM feature_cache WHERE feature_key = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC", req.FeatureKey, req.Start.Unix(), req.End.Unix())
		if err != nil {
			return nil, fmt.Errorf("failed to query feature_cache: %w", err)
		}
		defer rows.Close()

		var points []DataPoint
		for rows.Next() {
			var pt DataPoint
			var metaStr sql.NullString
			// SQLite driver typically parses DATETIME columns into time.Time
			var ts int64
			if err := rows.Scan(&ts, &pt.Value, &metaStr); err != nil {
				return nil, fmt.Errorf("failed to scan cached point: %w", err)
			}
			pt.Timestamp = time.Unix(ts, 0)
			if metaStr.Valid && metaStr.String != "" {
				if err := json.Unmarshal([]byte(metaStr.String), &pt.Meta); err != nil {
					return nil, fmt.Errorf("failed to unmarshal meta: %w", err)
				}
			}
			points = append(points, pt)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}

		// Wait, if no data was found in cache but we are not stale, maybe it is genuinely empty.
		// However, it's safer to just return what we got if there's any data, or if there's no data
		// maybe just fallback, though if it's not stale it means we recently synced and there just wasn't data.
		// Let's return it either way.
		return points, nil
	}

	// Stale or no data found in cache (because no entry in feature_meta), fallback
	points, err := c.Fallback.Fetch(ctx, req)
	if err != nil {
		return nil, err
	}

	// Update cache
	if err := c.updateCache(ctx, req, points); err != nil {
		// Log the error but don't fail the request
		log.Printf("failed to update cache for feature %s: %v", req.FeatureKey, err)
	}

	return points, nil
}

func (c *CachingProvider) updateCache(ctx context.Context, req FeatureRequest, points []DataPoint) error {
	tx, err := c.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, "INSERT OR IGNORE INTO feature_cache (feature_key, timestamp, value, meta) VALUES (?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, pt := range points {
		var metaStr *string
		if pt.Meta != nil {
			b, err := json.Marshal(pt.Meta)
			if err != nil {
				return err
			}
			s := string(b)
			metaStr = &s
		}
		if _, err := stmt.ExecContext(ctx, req.FeatureKey, pt.Timestamp.Unix(), pt.Value, metaStr); err != nil {
			return err
		}
	}

	// Get existing boundaries to expand them if necessary
	var cachedStart, cachedEnd int64
	err = tx.QueryRowContext(ctx, "SELECT cached_start, cached_end FROM feature_meta WHERE feature_key = ?", req.FeatureKey).Scan(&cachedStart, &cachedEnd)

	newStart := req.Start.Unix()
	newEnd := req.End.Unix()

	if err == nil {
		if cachedStart < newStart {
			newStart = cachedStart
		}
		if cachedEnd > newEnd {
			newEnd = cachedEnd
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO feature_meta (feature_key, last_updated, cached_start, cached_end)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(feature_key) DO UPDATE SET last_updated = excluded.last_updated, cached_start = excluded.cached_start, cached_end = excluded.cached_end`,
		req.FeatureKey, time.Now(), newStart, newEnd)
	if err != nil {
		return err
	}

	return tx.Commit()
}
