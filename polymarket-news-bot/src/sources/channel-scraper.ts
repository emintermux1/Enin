import axios from 'axios'
import * as cheerio from 'cheerio'
import { ScrapedPost } from '../types'
import { logger } from '../utils/logger'

function normalizeTextBlock(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n')
  const $ = cheerio.load(`<div>${withBreaks}</div>`)
  return $.root()
    .text()
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripTemplateFooter(text: string): string {
  return text
    .replace(
      /(?:\n|\s)*(Open on Twitter\s*[\|·•]\s*(?:Trade on|Open on|Open)\s*Polymarket\s*[\|·•]?\s*Discord?.*)$/is,
      ''
    )
    .replace(/(?:\n|\s)*(Trade on Polymarket\s*[\|·•]?\s*Discord?.*)$/is, '')
    .replace(/(?:\n|\s)*(Open on Polymarket\s*[\|·•]?\s*Discord?.*)$/is, '')
    .replace(/(?:\n|\s)*(Trade the News on PolyGun.*)$/is, '')
    .replace(/(?:\n|\s)*(Open on Twitter\s*[\|·•]\s*Open on Polymarket.*)$/is, '')
    .replace(/\s*[—–-]\s*@\w+\s*$/i, '')
    .replace(/\s*(?:via|from|by|source:?)\s*@\w+\s*$/i, '')
    .replace(
      /\s*@(?:Polymarketzone|polymarketg|predictiondesknews|polytwitter|FastNews_Ag)\s*$/i,
      ''
    )
    .trim()
}

function extractPhotoUrl(style: string | undefined): string | undefined {
  if (!style) {
    return undefined
  }
  const match = style.match(/url\('?(.*?)'?\)/i)
  return match?.[1]
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

export class ChannelScraper {
  async scrapeChannel(channelName: string): Promise<ScrapedPost[]> {
    const url = `https://t.me/s/${channelName}`
    try {
      const response = await axios.get<string>(url, {
        timeout: 20_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        },
      })
      const $ = cheerio.load(response.data)
      const posts: ScrapedPost[] = []

      $('.tgme_widget_message').each((_, element) => {
        const root = $(element)
        const dataPost = root.attr('data-post') || ''
        if (!dataPost.includes('/')) {
          return
        }
        const messageId = dataPost.split('/')[1] || dataPost
        const textNode = root.find('.tgme_widget_message_text').first()
        const textHtml = textNode.html() || ''
        const text = stripTemplateFooter(normalizeTextBlock(textHtml))
        const links = textNode
          .find('a')
          .map((__, anchor) => {
            const href = $(anchor).attr('href') || ''
            return {
              text: $(anchor).text().trim(),
              url: href ? new URL(href, 'https://t.me').toString() : '',
            }
          })
          .get()
          .filter((link) => link.url)
        const photoWrap = root.find('.tgme_widget_message_photo_wrap').first()
        const imageUrl = extractPhotoUrl(photoWrap.attr('style'))
        const polymarketSlug = extractPolymarketSlug(links)
        const datetime = root
          .find('.tgme_widget_message_date time')
          .attr('datetime')
        const timestamp = datetime ? new Date(datetime).getTime() : Date.now()
        if (!text && !imageUrl) {
          return
        }
        posts.push({
          source: channelName,
          messageId,
          text,
          imageUrl,
          timestamp,
          links,
          hasPhoto: Boolean(imageUrl),
          polymarketSlug,
        })
      })

      return posts.sort((a, b) => a.timestamp - b.timestamp)
    } catch (error) {
      logger.warn(`Failed to scrape channel ${channelName}`, error)
      return []
    }
  }
}
