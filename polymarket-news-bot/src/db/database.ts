import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '../config'
import { MarketData, PostType } from '../types'
import { logger } from '../utils/logger'

interface PostedMessageRow {
  count: number
}

interface SnapshotRow {
  outcome_prices: string
  volume: number
  captured_at: number
}

export interface MarketSnapshot {
  marketId: string
  slug: string
  outcomePrices: number[]
  volume: number
  capturedAt: number
}

export class NewsDatabase {
  readonly connection: Database.Database
  private readonly hasPostedStmt: Database.Statement
  private readonly insertPostedStmt: Database.Statement
  private readonly countPostedSinceStmt: Database.Statement
  private readonly hasPostedTypeSlugStmt: Database.Statement
  private readonly latestSnapshotStmt: Database.Statement
  private readonly insertSnapshotStmt: Database.Statement
  private readonly knownMarketStmt: Database.Statement
  private readonly insertKnownMarketStmt: Database.Statement
  private readonly getMetaStmt: Database.Statement
  private readonly setMetaStmt: Database.Statement

  constructor(dbPath = config.runtime.databasePath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.connection = new Database(dbPath)
    this.connection.pragma('journal_mode = WAL')
    this.connection.pragma('foreign_keys = ON')

    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS posted_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL UNIQUE,
        post_type TEXT NOT NULL,
        caption_preview TEXT,
        posted_at INTEGER NOT NULL,
        market_slug TEXT
      );

      CREATE TABLE IF NOT EXISTS market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        outcome_prices TEXT NOT NULL,
        volume REAL NOT NULL,
        captured_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS known_markets (
        market_id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL,
        slug TEXT NOT NULL,
        question TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_posted_source ON posted_messages(source_id);
      CREATE INDEX IF NOT EXISTS idx_posted_time ON posted_messages(posted_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_market ON market_snapshots(market_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_time ON market_snapshots(captured_at);
    `)

    this.hasPostedStmt = this.connection.prepare(
      'SELECT COUNT(*) as count FROM posted_messages WHERE source_id = ?'
    )
    this.insertPostedStmt = this.connection.prepare(`
      INSERT OR IGNORE INTO posted_messages (source_id, post_type, caption_preview, posted_at, market_slug)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.countPostedSinceStmt = this.connection.prepare(
      'SELECT COUNT(*) as count FROM posted_messages WHERE posted_at >= ?'
    )
    this.hasPostedTypeSlugStmt = this.connection.prepare(
      'SELECT COUNT(*) as count FROM posted_messages WHERE post_type = ? AND market_slug = ? AND posted_at >= ?'
    )
    this.latestSnapshotStmt = this.connection.prepare(`
      SELECT outcome_prices, volume, captured_at
      FROM market_snapshots
      WHERE market_id = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `)
    this.insertSnapshotStmt = this.connection.prepare(`
      INSERT INTO market_snapshots (market_id, slug, outcome_prices, volume, captured_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.knownMarketStmt = this.connection.prepare(
      'SELECT market_id FROM known_markets WHERE market_id = ?'
    )
    this.insertKnownMarketStmt = this.connection.prepare(`
      INSERT OR IGNORE INTO known_markets (market_id, first_seen_at, slug, question)
      VALUES (?, ?, ?, ?)
    `)
    this.getMetaStmt = this.connection.prepare(
      'SELECT value FROM bot_metadata WHERE key = ?'
    )
    this.setMetaStmt = this.connection.prepare(
      'INSERT OR REPLACE INTO bot_metadata (key, value, updated_at) VALUES (?, ?, ?)'
    )

    logger.info(`SQLite database initialized at ${dbPath}`)
  }

  hasPosted(sourceId: string): boolean {
    const row = this.hasPostedStmt.get(sourceId) as PostedMessageRow
    return (row?.count ?? 0) > 0
  }

  hasRecentMarketPost(
    postType: PostType,
    slug: string,
    lookbackMs: number
  ): boolean {
    const row = this.hasPostedTypeSlugStmt.get(
      postType,
      slug,
      Date.now() - lookbackMs
    ) as PostedMessageRow
    return (row?.count ?? 0) > 0
  }

  recordPosted(
    sourceId: string,
    postType: PostType,
    captionPreview: string,
    marketSlug?: string
  ): void {
    this.insertPostedStmt.run(
      sourceId,
      postType,
      captionPreview.slice(0, 240),
      Date.now(),
      marketSlug ?? null
    )
  }

  countPostsSince(timestamp: number): number {
    const row = this.countPostedSinceStmt.get(timestamp) as PostedMessageRow
    return row?.count ?? 0
  }

  getLatestSnapshot(marketId: string): MarketSnapshot | null {
    const row = this.latestSnapshotStmt.get(marketId) as SnapshotRow | undefined
    if (!row) {
      return null
    }
    try {
      const outcomePrices = JSON.parse(row.outcome_prices) as number[]
      return {
        marketId,
        slug: '',
        outcomePrices,
        volume: row.volume,
        capturedAt: row.captured_at,
      }
    } catch {
      return null
    }
  }

  saveMarketSnapshot(market: MarketData): void {
    this.insertSnapshotStmt.run(
      market.id,
      market.slug,
      JSON.stringify(market.outcomePrices),
      market.volume,
      Date.now()
    )
  }

  isKnownMarket(marketId: string): boolean {
    return Boolean(this.knownMarketStmt.get(marketId))
  }

  rememberMarket(market: MarketData): void {
    this.insertKnownMarketStmt.run(
      market.id,
      Date.now(),
      market.slug,
      market.question
    )
  }

  getMeta(key: string): string | null {
    const row = this.getMetaStmt.get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.setMetaStmt.run(key, value, Date.now())
  }

  getPinnedDigestMessageId(): number | null {
    const value = this.getMeta('pinned_digest_message_id')
    if (!value) {
      return null
    }
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? null : parsed
  }

  setPinnedDigestMessageId(messageId: number): void {
    this.setMeta('pinned_digest_message_id', String(messageId))
  }

  getPinnedDigestDate(): string | null {
    return this.getMeta('pinned_digest_date')
  }

  setPinnedDigestDate(date: string): void {
    this.setMeta('pinned_digest_date', date)
  }

  close(): void {
    this.connection.close()
  }
}

export function initDatabase(): NewsDatabase {
  return new NewsDatabase()
}
