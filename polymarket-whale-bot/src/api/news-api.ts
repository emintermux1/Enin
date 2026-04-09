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
  private readonly additionalFeeds = [
    { name: 'ZeroHedge', url: 'https://feeds.feedburner.com/zerohedge/feed' },
    { name: 'WalterBloomberg', url: 'https://rsshub.app/telegram/channel/WalterBloomberg' },
  ];

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

  async searchNewsExpanded(query: string, limit = 5): Promise<NewsArticle[]> {
    const [googleResults, ...feedResults] = await Promise.all([
      this.searchNews(query, limit),
      ...this.additionalFeeds.map((feed) => this.fetchFeed(feed.url, feed.name, query, 3)),
    ]);

    const allArticles = [...googleResults, ...feedResults.flat()];
    const seen = new Set<string>();
    const deduped = allArticles.filter((article) => {
      const key = article.title.toLowerCase().slice(0, 30);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    return deduped
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, limit);
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

  private async fetchFeed(
    feedUrl: string,
    sourceName: string,
    query: string,
    limit: number,
  ): Promise<NewsArticle[]> {
    try {
      const response = await axios.get(feedUrl, {
        timeout: 8000,
        headers: { 'User-Agent': this.userAgent },
        responseType: 'text',
      });

      const articles = this.parseRss(response.data, 20);
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3);
      const filtered = articles.filter((article) => {
        const text = `${article.title} ${article.snippet}`.toLowerCase();
        return keywords.some((keyword) => text.includes(keyword));
      });

      return filtered.slice(0, limit).map((article) => ({
        ...article,
        source: sourceName,
      }));
    } catch (error) {
      logger.warn(`Additional RSS fetch failed for "${sourceName}" and "${query}": ${error}`);
      return [];
    }
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
