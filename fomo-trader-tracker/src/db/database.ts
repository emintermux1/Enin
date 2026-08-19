import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';

export type Db = Database.Database;

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) {
    return instance;
  }

  const dbPath = config.db.path;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);

  instance = db;
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      wallet TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      discovered_at INTEGER NOT NULL,
      last_checked_at INTEGER,
      last_reject_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS traders (
      wallet TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      portfolio_usd REAL NOT NULL,
      cash_usd REAL NOT NULL,
      memecoin_usd REAL NOT NULL,
      memecoin_count INTEGER NOT NULL,
      trade_count INTEGER NOT NULL,
      last_trade_at INTEGER,
      score REAL NOT NULL,
      qualified_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_traders_score ON traders (active, score DESC);

    CREATE TABLE IF NOT EXISTS router_accounts (
      account TEXT PRIMARY KEY,
      seed_hit_count INTEGER NOT NULL,
      total_occurrences INTEGER NOT NULL,
      derived_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seen_signatures (
      signature TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      seen_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_seen_wallet ON seen_signatures (wallet, seen_at DESC);

    CREATE TABLE IF NOT EXISTS trades (
      signature TEXT NOT NULL,
      wallet TEXT NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      ui_amount REAL NOT NULL,
      usd_value REAL NOT NULL,
      block_time INTEGER NOT NULL,
      alerted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (signature, wallet, mint, side)
    );

    CREATE INDEX IF NOT EXISTS idx_trades_time ON trades (block_time DESC);

    CREATE TABLE IF NOT EXISTS mint_prices (
      mint TEXT PRIMARY KEY,
      usd_price REAL NOT NULL,
      decimals INTEGER NOT NULL,
      liquidity REAL NOT NULL,
      price_change_24h REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mint_unpriced (
      mint TEXT PRIMARY KEY,
      checked_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fomo_mints (
      mint TEXT PRIMARY KEY,
      discovered_at INTEGER NOT NULL,
      expanded_at INTEGER
    );
  `);
}
