import Database from 'better-sqlite3'
import { logger } from '../utils/logger'

export interface InsiderEvidence {
  wallet: string
  signalType: 'pre_news_trade' | 'extreme_price_win' | 'fresh_wallet_big_win' | 'repeated_pattern'
  conditionId: string
  evidence: string
  scoreContribution: number
  timestamp: number
}

export interface CumulativeInsiderProfile {
  wallet: string
  totalScore: number
  evidenceCount: number
  preNewsCount: number
  latestEvidence: string
  isSuspectedInsider: boolean
}

export class InsiderTracker {
  private readonly insertStmt: Database.Statement
  private readonly getProfileStmt: Database.Statement
  private readonly getPreNewsCountStmt: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO insider_evidence (wallet, signal_type, condition_id, evidence, score_contribution, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    this.getProfileStmt = db.prepare(`
      SELECT
        wallet,
        SUM(score_contribution) as totalScore,
        COUNT(*) as evidenceCount,
        MAX(evidence) as latestEvidence
      FROM insider_evidence
      WHERE wallet = ? AND timestamp > ?
      GROUP BY wallet
    `)

    this.getPreNewsCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM insider_evidence
      WHERE wallet = ? AND signal_type = 'pre_news_trade' AND timestamp > ?
    `)
  }

  recordEvidence(evidence: InsiderEvidence): void {
    try {
      this.insertStmt.run(
        evidence.wallet.toLowerCase(),
        evidence.signalType,
        evidence.conditionId,
        evidence.evidence,
        evidence.scoreContribution,
        evidence.timestamp,
      )
    } catch (error) {
      logger.warn(`Failed to record insider evidence for ${evidence.wallet}`, error)
    }
  }

  getProfile(wallet: string, lookbackDays = 90): CumulativeInsiderProfile {
    const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400
    const row = this.getProfileStmt.get(wallet.toLowerCase(), cutoff) as {
      wallet: string
      totalScore: number
      evidenceCount: number
      latestEvidence: string
    } | undefined

    const preNewsRow = this.getPreNewsCountStmt.get(wallet.toLowerCase(), cutoff) as { count: number }

    if (!row) {
      return {
        wallet: wallet.toLowerCase(),
        totalScore: 0,
        evidenceCount: 0,
        preNewsCount: 0,
        latestEvidence: '',
        isSuspectedInsider: false,
      }
    }

    return {
      wallet: row.wallet,
      totalScore: row.totalScore,
      evidenceCount: row.evidenceCount,
      preNewsCount: preNewsRow?.count || 0,
      latestEvidence: row.latestEvidence,
      isSuspectedInsider: row.totalScore >= 50,
    }
  }
}
