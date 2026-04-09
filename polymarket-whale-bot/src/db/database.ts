import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { logger } from '../utils/logger'

const DB_PATH = path.resolve(process.cwd(), 'data', 'whale-bot.db')

export function initDatabase(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      side TEXT NOT NULL,
      amount REAL NOT NULL,
      price REAL NOT NULL,
      outcome TEXT,
      market_question TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_trades_wallet ON wallet_trades(wallet);
    CREATE INDEX IF NOT EXISTS idx_wallet_trades_condition ON wallet_trades(condition_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_trades_timestamp ON wallet_trades(timestamp);

    CREATE TABLE IF NOT EXISTS capital_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      amount REAL NOT NULL,
      direction TEXT NOT NULL,
      tx_hash TEXT UNIQUE,
      from_address TEXT,
      to_address TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_capital_flows_wallet ON capital_flows(wallet);
    CREATE INDEX IF NOT EXISTS idx_capital_flows_timestamp ON capital_flows(timestamp);

    CREATE TABLE IF NOT EXISTS market_volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      condition_id TEXT NOT NULL,
      volume REAL NOT NULL,
      liquidity REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_market_volumes_condition ON market_volumes(condition_id);
    CREATE INDEX IF NOT EXISTS idx_market_volumes_timestamp ON market_volumes(timestamp);

    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `)

  const migrations = [
    `ALTER TABLE wallet_trades ADD COLUMN alerted INTEGER DEFAULT 0`,
    `ALTER TABLE wallet_trades ADD COLUMN trader_name TEXT DEFAULT ''`,
    `ALTER TABLE wallet_trades ADD COLUMN primary_type TEXT DEFAULT ''`,
    `ALTER TABLE wallet_trades ADD COLUMN potential_win REAL DEFAULT 0`,
    `ALTER TABLE wallet_trades ADD COLUMN multiplier REAL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS insider_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      condition_id TEXT,
      evidence TEXT,
      score_contribution INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS idx_insider_evidence_wallet ON insider_evidence(wallet)`,
    `CREATE INDEX IF NOT EXISTS idx_insider_evidence_timestamp ON insider_evidence(timestamp)`,
  ]

  for (const migration of migrations) {
    try {
      db.exec(migration)
    } catch {
      continue
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_wallet_trades_alerted ON wallet_trades(alerted);`)

  logger.info(`SQLite database initialized at ${DB_PATH}`)
  return db
}
