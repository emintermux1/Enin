import axios from 'axios'
import { Markup, Telegraf } from 'telegraf'
import { config } from '../config'
import { NewsDatabase } from '../db/database'
import { QueuedPost } from '../types'
import { logger } from '../utils/logger'
import { trimCaptionForMessage, trimCaptionForPhoto } from './formatters'

export class TelegramPublisher {
  private readonly bot: Telegraf
  private readonly postQueue: QueuedPost[] = []
  private postTimestamps: number[] = []
  private lastPostAt = 0
  private launched = false
  private processing = false

  constructor(
    private readonly telegramConfig: { botToken: string; channelId: string },
    private readonly db: NewsDatabase
  ) {
    this.bot = new Telegraf(telegramConfig.botToken)
  }

  async launch(): Promise<void> {
    if (this.launched) {
      return
    }
    await this.bot.telegram.getMe()
    this.launched = true
    logger.info('Telegram publisher ready')
  }

  async stop(): Promise<void> {
    if (!this.launched) {
      return
    }
    this.launched = false
  }

  queuePost(post: QueuedPost): boolean {
    if (
      this.db.hasPosted(post.sourceId) ||
      this.postQueue.some((item) => item.sourceId === post.sourceId)
    ) {
      return false
    }
    this.postQueue.push(post)
    this.postQueue.sort(
      (a, b) => b.priority - a.priority || a.createdAt - b.createdAt
    )
    return true
  }

  async processQueue(): Promise<void> {
    if (this.processing || this.postQueue.length === 0) {
      return
    }
    if (!this.canPostNow()) {
      return
    }

    const nextPost = this.postQueue.shift()
    if (!nextPost) {
      return
    }

    this.processing = true
    try {
      await this.sendPost(nextPost)
      this.lastPostAt = Date.now()
      this.postTimestamps.push(this.lastPostAt)
      this.postTimestamps = this.postTimestamps.filter(
        (timestamp) => timestamp >= Date.now() - 60 * 60 * 1000
      )
      this.db.recordPosted(
        nextPost.sourceId,
        nextPost.type,
        nextPost.caption,
        nextPost.market?.slug
      )
    } catch (error) {
      logger.error(`Failed to send post ${nextPost.sourceId}`, error)
    } finally {
      this.processing = false
    }
  }

  private canPostNow(): boolean {
    const now = Date.now()
    if (
      this.lastPostAt &&
      now - this.lastPostAt < config.posting.minIntervalMs
    ) {
      return false
    }

    const currentHour = new Date(now).getUTCHours()
    const inQuietHours =
      currentHour >= config.posting.quietHoursStart &&
      currentHour < config.posting.quietHoursEnd
    const maxPostsPerHour = inQuietHours ? 3 : config.posting.maxPostsPerHour
    this.postTimestamps = this.postTimestamps.filter(
      (timestamp) => timestamp >= now - 60 * 60 * 1000
    )
    return this.postTimestamps.length < maxPostsPerHour
  }

  private async sendPost(post: QueuedPost): Promise<void> {
    const keyboard = Markup.inlineKeyboard([
      post.buttons.map((button) => Markup.button.url(button.text, button.url)),
    ])

    if (config.runtime.dryRun) {
      logger.info(`[DRY RUN] ${post.type}: ${post.caption}`)
      return
    }

    if (post.imageBuffer) {
      await this.bot.telegram.sendPhoto(
        this.telegramConfig.channelId,
        { source: post.imageBuffer },
        {
          caption: trimCaptionForPhoto(post.caption),
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup,
        }
      )
      return
    }

    if (post.imageUrl) {
      const response = await axios.get<ArrayBuffer>(post.imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15_000,
      })
      await this.bot.telegram.sendPhoto(
        this.telegramConfig.channelId,
        { source: Buffer.from(response.data) },
        {
          caption: trimCaptionForPhoto(post.caption),
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup,
        }
      )
      return
    }

    await this.bot.telegram.sendMessage(
      this.telegramConfig.channelId,
      trimCaptionForMessage(post.caption),
      {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      }
    )
  }
}
