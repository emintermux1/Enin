import { HttpClient } from './http-client'
import { logger } from '../utils/logger'

interface TokenTransfer {
  hash: string
  from: string
  to: string
  value: string
  tokenDecimal: string
  timeStamp: string
}

export interface CapitalFlow {
  txHash: string
  from: string
  to: string
  amountUsd: number
  timestamp: number
  direction: 'IN' | 'OUT'
}

const USDC_CONTRACT = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
const USDC_E_CONTRACT = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'

export class PolygonscanApi {
  private readonly client: HttpClient

  constructor(private readonly apiKey: string) {
    this.client = new HttpClient('https://api.polygonscan.com/api', {
      timeoutMs: 10_000,
      retries: 1,
      minSpacingMs: 250,
    })
  }

  async getRecentUsdcTransfers(wallet: string, limit = 10): Promise<CapitalFlow[]> {
    const walletLower = wallet.toLowerCase()
    const flows: CapitalFlow[] = []

    for (const contract of [USDC_CONTRACT, USDC_E_CONTRACT]) {
      try {
        const response = await this.client.get<{
          status: string
          result: TokenTransfer[] | string
        }>(
          `?module=account&action=tokentx&contractaddress=${contract}&address=${walletLower}&page=1&offset=${limit}&sort=desc&apikey=${this.apiKey}`,
        )

        if (response.status === '1' && Array.isArray(response.result)) {
          for (const tx of response.result) {
            const decimals = Number(tx.tokenDecimal) || 6
            const amount = Number(tx.value) / 10 ** decimals
            if (amount < 100) {
              continue
            }

            flows.push({
              txHash: tx.hash,
              from: tx.from.toLowerCase(),
              to: tx.to.toLowerCase(),
              amountUsd: amount,
              timestamp: Number(tx.timeStamp),
              direction: tx.to.toLowerCase() === walletLower ? 'IN' : 'OUT',
            })
          }
        }
      } catch (error) {
        logger.warn(`Polygonscan USDC transfer fetch failed for ${wallet}`, error)
      }
    }

    return flows.sort((left, right) => right.timestamp - left.timestamp)
  }

  async detectFreshInflow(wallet: string, hoursBack = 24, minAmount = 10_000): Promise<{
    hasRecentInflow: boolean
    totalInflow: number
    largestInflow: number
    inflowCount: number
    recentFlows: CapitalFlow[]
  }> {
    const transfers = await this.getRecentUsdcTransfers(wallet, 20)
    const cutoff = Math.floor(Date.now() / 1000) - hoursBack * 3600
    const recentInflows = transfers.filter(
      (flow) => flow.direction === 'IN' && flow.timestamp >= cutoff,
    )

    const totalInflow = recentInflows.reduce((sum, flow) => sum + flow.amountUsd, 0)
    const largestInflow = recentInflows.length > 0
      ? Math.max(...recentInflows.map((flow) => flow.amountUsd))
      : 0

    return {
      hasRecentInflow: totalInflow >= minAmount,
      totalInflow,
      largestInflow,
      inflowCount: recentInflows.length,
      recentFlows: recentInflows.slice(0, 5),
    }
  }
}
