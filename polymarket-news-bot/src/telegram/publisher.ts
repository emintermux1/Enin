import axios from 'axios'
import { Markup, Telegraf } from 'telegraf'
import { config } from '../config'
import { NewsDatabase } from '../db/database'
import { InlineButton, QueuedPost } from '../types'
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
    logger.info(`Queued ${post.type} [${post.sourceId}] (queue: ${this.postQueue.length}, dual: ${Boolean(post.secondaryImageUrl)})`)
    return true
  }

  async editPinnedDigest(
    messageId: number,
    caption: string,
    buttons: InlineButton[]
  ): Promise<boolean> {
    if (config.runtime.dryRun) {
      logger.info(`[DRY RUN] edit pinned digest #${messageId}`)
      return true
    }
    try {
      const keyboard = this.buildKeyboard(buttons)
      await this.bot.telegram.editMessageText(
        this.telegramConfig.channelId,
        messageId,
        undefined,
        trimCaptionForMessage(caption),
        {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup as any,
          link_preview_options: { is_disabled: true },
        }
      )
      return true
    } catch (error) {
      logger.warn(`Failed to edit pinned digest #${messageId}`, error)
      return false
    }
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
      const messageId = await this.sendPost(nextPost)
      logger.info(`Sent ${nextPost.type} [${nextPost.sourceId}] msgId=${messageId} (remaining: ${this.postQueue.length})`)
      if (nextPost.type === 'trending_digest' && messageId) {
        await this.pinTrendingDigest(messageId)
        this.db.setPinnedDigestMessageId(messageId)
        this.db.setPinnedDigestDate(new Date().toISOString().slice(0, 10))
      }
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

  private buildKeyboard(buttons: InlineButton[]) {
    const buttonWidgets = buttons.map((button) =>
      Markup.button.url(button.text, button.url)
    )
    const rows: Array<Array<(typeof buttonWidgets)[number]>> = []
    for (let i = 0; i < buttonWidgets.length; i += 2) {
      rows.push(buttonWidgets.slice(i, i + 2))
    }
    return Markup.inlineKeyboard(rows)
  }

  private async sendPost(post: QueuedPost): Promise<number | undefined> {
    if (config.runtime.dryRun) {
      logger.info(`[DRY RUN] ${post.type}: ${post.caption}`)
      return undefined
    }

    if (
      (post.secondaryImageUrl || post.secondaryImageBuffer) &&
      (post.imageUrl || post.imageBuffer)
    ) {
      return this.sendMediaGroup(post)
    }

    if (post.imageBuffer || post.imageUrl) {
      return this.sendSinglePhoto(post)
    }

    const keyboard = this.buildKeyboard(post.buttons)
    const sentMessage = await this.bot.telegram.sendMessage(
      this.telegramConfig.channelId,
      trimCaptionForMessage(post.caption),
      {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      }
    )
    return sentMessage.message_id
  }

  private async sendSinglePhoto(post: QueuedPost): Promise<number | undefined> {
    const keyboard = this.buildKeyboard(post.buttons)

    if (post.imageBuffer) {
      const sentMessage = await this.bot.telegram.sendPhoto(
        this.telegramConfig.channelId,
        { source: post.imageBuffer },
        {
          caption: trimCaptionForPhoto(post.caption),
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup,
        }
      )
      return sentMessage.message_id
    }

    if (post.imageUrl) {
      const imageBuffer = await this.downloadImage(post.imageUrl)
      if (imageBuffer) {
        const sentMessage = await this.bot.telegram.sendPhoto(
          this.telegramConfig.channelId,
          { source: imageBuffer },
          {
            caption: trimCaptionForPhoto(post.caption),
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup,
          }
        )
        return sentMessage.message_id
      }
      logger.warn(`Image download failed for ${post.imageUrl}, sending text-only`)
    }

    const sentMessage = await this.bot.telegram.sendMessage(
      this.telegramConfig.channelId,
      trimCaptionForMessage(post.caption),
      {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      }
    )
    return sentMessage.message_id
  }

  private async sendMediaGroup(post: QueuedPost): Promise<number | undefined> {
    try {
      const primaryBuffer =
        post.imageBuffer ||
        (post.imageUrl ? await this.downloadImage(post.imageUrl) : null)
      const secondaryBuffer =
        post.secondaryImageBuffer ||
        (post.secondaryImageUrl
          ? await this.downloadImage(post.secondaryImageUrl)
          : null)

      if (!primaryBuffer || !secondaryBuffer) {
        return this.sendSinglePhoto(post)
      }

      const messages = await this.bot.telegram.sendMediaGroup(
        this.telegramConfig.channelId,
        [
          {
            type: 'photo',
            media: { source: primaryBuffer },
            caption: trimCaptionForPhoto(post.caption),
            parse_mode: 'HTML',
          },
          {
            type: 'photo',
            media: { source: secondaryBuffer },
          },
        ]
      )
      return messages[0]?.message_id
    } catch (error) {
      logger.warn('sendMediaGroup failed, falling back to single photo', error)
      return this.sendSinglePhoto(post)
    }
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 15_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        },
      })
      return Buffer.from(response.data)
    } catch {
      return null
    }
  }

  private async pinTrendingDigest(messageId: number): Promise<void> {
    try {
      await this.bot.telegram.unpinAllChatMessages(
        this.telegramConfig.channelId
      )
    } catch (error) {
      logger.warn('Failed to unpin previous trending digest', error)
    }

    try {
      await this.bot.telegram.pinChatMessage(
        this.telegramConfig.channelId,
        messageId,
        {
          disable_notification: true,
        }
      )
    } catch (error) {
      logger.warn('Failed to pin trending digest', error)
    }
  }
}
