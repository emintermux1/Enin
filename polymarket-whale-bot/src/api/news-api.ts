import axios from 'axios';
import { logger } from '../utils/logger';

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: number;
  snippet: string;
}

export class NewsApi {
  private readonly userAgent = 'Mozilla/5.0 (compatible; PolyBot/1.0)';

  async searchNews(query: string, limit = 5): Promise<NewsArticle[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`;

      const response = await axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': this.userAgent },
        responseType: 'text',
      });

      return this.parseRss(response.data, limit);
    } catch (error) {
      logger.warn(`Google News RSS fetch failed for "${query}": ${error}`);
      return [];
    }
  }

  private parseRss(xml: string, limit: number): NewsArticle[] {
    const articles: NewsArticle[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null && articles.length < limit) {
      const itemXml = match[1] ?? '';
      const title = this.extractTag(itemXml, 'title') || '';
      const link = this.extractTag(itemXml, 'link') || '';
      const pubDate = this.extractTag(itemXml, 'pubDate') || '';
      const description = this.extractTag(itemXml, 'description') || '';
      const source = this.extractTag(itemXml, 'source') || this.extractSourceFromTitle(title);
      const publishedAt = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;

      if (!publishedAt || !title) {
        continue;
      }

      const cleanTitle = title.replace(/\s*-\s*[^-]+$/, '').trim();
      const cleanSnippet = description.replace(/<[^>]*>/g, '').trim().slice(0, 200);

      articles.push({
        title: cleanTitle,
        source,
        url: link,
        publishedAt,
        snippet: cleanSnippet,
      });
    }

    return articles.sort((a, b) => b.publishedAt - a.publishedAt);
  }

  private extractTag(xml: string, tag: string): string {
    const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
    const cdataMatch = cdataRegex.exec(xml);
    if (cdataMatch) {
      return (cdataMatch[1] ?? '').trim();
    }

    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = regex.exec(xml);
    return match ? (match[1] ?? '').trim() : '';
  }

  private extractSourceFromTitle(title: string): string {
    const match = /\s-\s([^-]+)$/.exec(title);
    return match ? (match[1] ?? '').trim() || 'Unknown' : 'Unknown';
  }
}
