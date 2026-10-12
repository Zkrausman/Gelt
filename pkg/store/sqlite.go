package store

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// TradeRecord represents a single trade execution to be stored in the journal.
type TradeRecord struct {
	Timestamp      time.Time
	Symbol         string
	Side           string
	Quantity       float64
	ExecutionPrice float64
	RealizedPnL    float64
	ActivePlan     string
	MacroRegime    string
}

// Store manages database connections and asynchronous writes.
type Store struct {
	db *sql.DB
	wg sync.WaitGroup
}

// NewStore initializes the SQLite database, provisions the file, and runs migrations.
// It uses modernc.org/sqlite driver.
func NewStore(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// For SQLite, it's generally safe to limit open connections to avoid "database is locked"
	db.SetMaxOpenConns(1)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping sqlite database: %w", err)
	}

	store := &Store{db: db}

	if err := store.migrate(); err != nil {
		store.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return store, nil
}

// migrate creates the required tables if they do not exist.
func (s *Store) migrate() error {
	query := `
	CREATE TABLE IF NOT EXISTS trades (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME NOT NULL,
		symbol TEXT NOT NULL,
		side TEXT NOT NULL,
		quantity REAL NOT NULL,
		execution_price REAL NOT NULL,
		realized_pnl REAL NOT NULL,
		active_plan TEXT NOT NULL,
		macro_regime TEXT NOT NULL
	);

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

	CREATE TABLE IF NOT EXISTS dynamic_strategies (
		id TEXT PRIMARY KEY,
		definition JSON,
		created_at DATETIME
	);
	`
	_, err := s.db.Exec(query)
	return err
}

// DB exposes the underlying database connection for caching and direct queries.
func (s *Store) DB() *sql.DB {
	return s.db
}

// InsertTrade asynchronously logs a completed trade into the database.
// It is thread-safe.
func (s *Store) InsertTrade(trade TradeRecord) {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		query := `
		INSERT INTO trades (
			timestamp, symbol, side, quantity, execution_price,
			realized_pnl, active_plan, macro_regime
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
		`
		_, err := s.db.Exec(
			query,
			trade.Timestamp,
			trade.Symbol,
			trade.Side,
			trade.Quantity,
			trade.ExecutionPrice,
			trade.RealizedPnL,
			trade.ActivePlan,
			trade.MacroRegime,
		)
		if err != nil {
			log.Printf("failed to insert trade: %v", err)
		}
	}()
}

// Close waits for all pending asynchronous writes to complete and closes the database connection.
func (s *Store) Close() error {
	s.wg.Wait()
	return s.db.Close()
}

// InsertDynamicStrategy stores a new dynamic strategy definition.
func (s *Store) InsertDynamicStrategy(id string, definition []byte) error {
	query := `INSERT INTO dynamic_strategies (id, definition, created_at) VALUES (?, ?, ?)`
	_, err := s.db.Exec(query, id, string(definition), time.Now().UTC().Format(time.RFC3339))
	return err
}

// GetDynamicStrategies retrieves all dynamic strategies.
func (s *Store) GetDynamicStrategies() (map[string][]byte, error) {
	query := `SELECT id, definition FROM dynamic_strategies`
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	strategies := make(map[string][]byte)
	for rows.Next() {
		var id, definition string
		if err := rows.Scan(&id, &definition); err != nil {
			return nil, err
		}
		strategies[id] = []byte(definition)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return strategies, nil
}

// DeleteDynamicStrategy removes a dynamic strategy by ID.
func (s *Store) DeleteDynamicStrategy(id string) error {
	query := `DELETE FROM dynamic_strategies WHERE id = ?`
	_, err := s.db.Exec(query, id)
	return err
}
