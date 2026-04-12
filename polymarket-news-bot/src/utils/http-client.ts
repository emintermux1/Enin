import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import { logger } from './logger'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class HttpClient {
  private readonly instance: AxiosInstance
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0

  constructor(
    baseURL: string,
    private readonly options: {
      timeoutMs: number
      retries: number
      minSpacingMs: number
    }
  ) {
    this.instance = axios.create({
      baseURL,
      timeout: options.timeoutMs,
      headers: {
        'User-Agent': 'polymarket-whale-bot/1.0',
      },
    })
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.schedule(async () => {
      let lastError: unknown
      for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
        try {
          const response = await this.instance.get<T>(url, config)
          return response.data
        } catch (error) {
          lastError = error
          const axiosError = error as AxiosError
          const status = axiosError.response?.status
          const retryable = !status || status === 429 || status >= 500
          if (!retryable || attempt === this.options.retries) {
            break
          }
          const backoff = 250 * 2 ** attempt + Math.round(Math.random() * 100)
          logger.warn(
            `HTTP retry ${attempt + 1}/${this.options.retries} for ${url}`,
            status ?? axiosError.message
          )
          await delay(backoff)
        }
      }
      throw lastError
    })
  }

  private async schedule<T>(task: () => Promise<T>): Promise<T> {
    const scheduled = this.queue.then(async () => {
      const waitMs = Math.max(
        0,
        this.options.minSpacingMs - (Date.now() - this.lastRequestAt)
      )
      if (waitMs > 0) {
        await delay(waitMs)
      }
      this.lastRequestAt = Date.now()
      return task()
    })
    this.queue = scheduled.then(
      () => undefined,
      () => undefined
    )
    return scheduled
  }
}
