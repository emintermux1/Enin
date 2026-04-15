import axios from 'axios'
import * as cheerio from 'cheerio'
import { config } from '../config'
import { ScrapedPost } from '../types'
import { logger } from '../utils/logger'

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36'
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function decodeHtml(value: string): string {
  return cheerio.load(`<div>${value}</div>`).text().trim()
}

function extractPolymarketSlug(
  links: { text: string; url: string }[]
): string | undefined {
  for (const link of links) {
    const match = link.url.match(
      /polymarket\.com\/(?:market|event)\/([a-z0-9-]+)/i
    )
    if (match) {
      return match[1]
    }
  }
  return undefined
}

function parseTweetId(url: string): string | undefined {
  const match = url.match(/\/status\/(\d+)/)
  return match?.[1]
}

function resolveUrl(url: string | undefined, baseUrl: string): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url, baseUrl).toString()
  } catch {
    return undefined
  }
}

function parseTimestamp(raw: string | undefined): number {
  if (!raw) {
    return Date.now()
  }
  const parsed = new Date(raw).getTime()
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function dedupePosts(posts: ScrapedPost[]): ScrapedPost[] {
  const seen = new Set<string>()
  return posts.filter((post) => {
    const key = `${post.source}:${post.messageId}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export class TwitterScraper {
  private readonly nitterInstances = config.scraping.nitterInstances

  async scrapePolymarketTweets(): Promise<ScrapedPost[]> {
    for (const instance of this.nitterInstances) {
      try {
        const posts = await this.scrapeFromNitter(instance)
        if (posts.length > 0) {
          return posts
        }
      } catch (error) {
        logger.warn(`Nitter scrape failed for ${instance}`, error)
      }
    }

    try {
      const posts = await this.scrapeFromRssHub()
      if (posts.length > 0) {
        return posts
      }
    } catch (error) {
      logger.warn('RSSHub scrape failed for @Polymarket', error)
    }

    try {
      const posts = await this.scrapeFromX()
      if (posts.length > 0) {
        return posts
      }
    } catch (error) {
      logger.warn('Direct X scrape failed for @Polymarket', error)
    }

    logger.warn('Twitter scraper unavailable for @Polymarket; continuing without tweets')
    return []
  }

  private async scrapeFromNitter(instance: string): Promise<ScrapedPost[]> {
    const baseUrl = `https://${instance}`
    const response = await axios.get<string>(`${baseUrl}/Polymarket`, {
      timeout: 15_000,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
      },
    })

    const $ = cheerio.load(response.data)
    const posts: ScrapedPost[] = []

    $('.timeline-item').each((_, element) => {
      const root = $(element)
      const tweetLink = root.find('.tweet-date a').first()
      const href = resolveUrl(tweetLink.attr('href'), baseUrl)
      const messageId = href ? parseTweetId(href) : undefined
      if (!href || !messageId) {
        return
      }

      const text = normalizeWhitespace(root.find('.tweet-content').first().text())
      if (!text) {
        return
      }

      const timestamp = parseTimestamp(
        tweetLink.attr('title') ||
          root.find('span.tweet-date a').attr('title') ||
          root.find('a.tweet-link').attr('title')
      )
      if (timestamp < Date.now() - MAX_POST_AGE_MS) {
        return
      }

      const links = root
        .find('.tweet-content a, .attachments a.still-image')
        .map((__, anchor) => {
          const anchorNode = $(anchor)
          const url = resolveUrl(anchorNode.attr('href'), baseUrl)
          return {
            text: normalizeWhitespace(anchorNode.text()) || 'link',
            url: url || '',
          }
        })
        .get()
        .filter((link) => link.url)

      const imageUrl =
        resolveUrl(
          root.find('.attachments img').first().attr('src') ||
            root.find('.gallery-row img').first().attr('src'),
          baseUrl
        ) || undefined

      posts.push({
        source: 'twitter_polymarket',
        messageId,
        text,
        imageUrl,
        timestamp,
        links,
        hasPhoto: Boolean(imageUrl),
        polymarketSlug: extractPolymarketSlug(links),
      })
    })

    return dedupePosts(posts).sort((a, b) => a.timestamp - b.timestamp).slice(-6)
  }

  private async scrapeFromRssHub(): Promise<ScrapedPost[]> {
    const response = await axios.get<string>(
      'https://rsshub.app/twitter/user/Polymarket',
      {
        timeout: 15_000,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
      }
    )

    const $ = cheerio.load(response.data, { xmlMode: true })
    const posts: ScrapedPost[] = []

    $('item').each((_, element) => {
      const item = $(element)
      const link = item.find('link').first().text().trim()
      const messageId = parseTweetId(link)
      if (!link || !messageId) {
        return
      }

      const title = decodeHtml(item.find('title').first().text())
      const description = item.find('description').first().text()
      const descriptionDoc = cheerio.load(description)
      const descriptionText = normalizeWhitespace(descriptionDoc.text())
      const text = descriptionText || title
      if (!text) {
        return
      }

      const timestamp = parseTimestamp(item.find('pubDate').first().text())
      if (timestamp < Date.now() - MAX_POST_AGE_MS) {
        return
      }

      const imageUrl =
        item.find('enclosure').attr('url') ||
        item.find('media\\:content, media|content').attr('url') ||
        descriptionDoc('img').first().attr('src') ||
        undefined
      const links = [
        {
          text: 'View on X',
          url: link,
        },
      ]

      posts.push({
        source: 'twitter_polymarket',
        messageId,
        text,
        imageUrl,
        timestamp,
        links,
        hasPhoto: Boolean(imageUrl),
        polymarketSlug: extractPolymarketSlug(links),
      })
    })

    return dedupePosts(posts).sort((a, b) => a.timestamp - b.timestamp).slice(-6)
  }

  private async scrapeFromX(): Promise<ScrapedPost[]> {
    const response = await axios.get<string>('https://x.com/Polymarket', {
      timeout: 15_000,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
      },
    })

    const $ = cheerio.load(response.data)
    const posts: ScrapedPost[] = []

    $('article[data-testid=\"tweet\"]').each((_, element) => {
      const root = $(element)
      const tweetLink = root.find('a[href*=\"/status/\"]').last()
      const href = resolveUrl(tweetLink.attr('href'), 'https://x.com')
      const messageId = href ? parseTweetId(href) : undefined
      if (!href || !messageId) {
        return
      }

      const text = normalizeWhitespace(root.find('[data-testid=\"tweetText\"]').text())
      if (!text) {
        return
      }

      const datetime = root.find('time').attr('datetime')
      const timestamp = parseTimestamp(datetime)
      if (timestamp < Date.now() - MAX_POST_AGE_MS) {
        return
      }

      const imageUrl =
        resolveUrl(
          root.find('img[src*=\"pbs.twimg.com\"]').first().attr('src'),
          'https://x.com'
        ) || undefined

      const links = [
        {
          text: 'View on X',
          url: href,
        },
      ]

      posts.push({
        source: 'twitter_polymarket',
        messageId,
        text,
        imageUrl,
        timestamp,
        links,
        hasPhoto: Boolean(imageUrl),
        polymarketSlug: extractPolymarketSlug(links),
      })
    })

    return dedupePosts(posts).sort((a, b) => a.timestamp - b.timestamp).slice(-6)
  }
}
