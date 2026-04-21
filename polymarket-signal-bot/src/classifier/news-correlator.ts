import { LRUCache } from 'lru-cache';
import { isSpamHeadline, NewsApi, NewsArticle } from '../api/news-api';

export interface NewsCorrelation {
  hasRecentNews: boolean;
  articles: Array<{
    title: string;
    source: string;
    minutesAgo: number;
    url: string;
  }>;
  strongestSignal: string;
}

export interface ForwardNewsCorrelation {
  hasPostTradeNews: boolean;
  articles: Array<{
    title: string;
    source: string;
    url: string;
    minutesAfter: number;
  }>;
  preNewsSignal: string;
}

const STOP_WORDS = new Set([
  'will', 'the', 'be', 'by', 'in', 'of', 'to', 'a', 'an', 'and', 'or', 'for',
  'on', 'at', 'is', 'it', 'this', 'that', 'with', 'from', 'before', 'after',
  'next', 'new', 'more', 'than', 'over', 'under', 'between', 'during',
  'what', 'who', 'how', 'when', 'where', 'which', 'do', 'does', 'did',
  'has', 'have', 'had', 'was', 'were', 'been', 'being', 'get', 'got',
  'can', 'could', 'would', 'should', 'may', 'might', 'must',
  'yes', 'no', 'not', 'any', 'all', 'each', 'every', 'both', 'few',
  'most', 'other', 'some', 'such', 'up', 'down', 'out', 'off',
]);

export class NewsCorrelator {
  private readonly cache = new LRUCache<string, NewsArticle[]>({
    max: 200,
    ttl: 1000 * 60 * 5,
  });

  constructor(private readonly newsApi: NewsApi) {}

  extractKeywords(marketQuestion: string): string {
    const words = marketQuestion
      .replace(/[?!.,;:'"()\[\]{}]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .filter((word) => !STOP_WORDS.has(word.toLowerCase()));

    const proper = words.filter((word) => {
      const initial = word.charAt(0);
      return Boolean(initial) && initial === initial.toUpperCase() && initial !== initial.toLowerCase();
    });
    const rest = words.filter((word) => !proper.includes(word));
    const selected = [...proper.slice(0, 4), ...rest.slice(0, 2)].slice(0, 6);

    return selected.join(' ');
  }

  async correlate(
    marketQuestion: string,
    tradeTimestamp: number,
    maxAgeMinutes = 60,
  ): Promise<NewsCorrelation> {
    const keywords = this.extractKeywords(marketQuestion);
    if (!keywords || keywords.split(' ').length < 2) {
      return { hasRecentNews: false, articles: [], strongestSignal: '' };
    }

    const cacheKey = keywords.toLowerCase();
    let articles = this.cache.get(cacheKey);

    if (!articles) {
      articles = (await this.newsApi.searchNewsExpanded(keywords, 5))
        .filter((article) => !isSpamHeadline(article.title))
        .slice(0, 3);
      this.cache.set(cacheKey, articles);
    }

    articles = articles.filter((article) => !isSpamHeadline(article.title));

    const referenceTimestamp = tradeTimestamp > 0 ? tradeTimestamp : Math.floor(Date.now() / 1000);
    const cutoff = referenceTimestamp - maxAgeMinutes * 60;

    const recentArticles = articles
      .filter((article) => article.publishedAt >= cutoff && article.publishedAt <= referenceTimestamp)
      .map((article) => ({
        title: article.title,
        source: article.source,
        minutesAgo: Math.max(0, Math.round((referenceTimestamp - article.publishedAt) / 60)),
        url: article.url,
      }))
      .slice(0, 3);

    let strongestSignal = '';
    if (recentArticles.length > 0) {
      const best = recentArticles[0];
      if (best) {
        strongestSignal = `${best.source} reported ${best.minutesAgo}min before trade`;
      }
    }

    return {
      hasRecentNews: recentArticles.length > 0,
      articles: recentArticles,
      strongestSignal,
    };
  }

  async correlateForward(
    marketQuestion: string,
    tradeTimestamp: number,
    forwardWindowMinutes = 120,
  ): Promise<ForwardNewsCorrelation> {
    const keywords = this.extractKeywords(marketQuestion);
    if (!keywords || keywords.split(' ').length < 2) {
      return { hasPostTradeNews: false, articles: [], preNewsSignal: '' };
    }

    const cacheKey = `fwd:${keywords.toLowerCase()}`;
    let articles = this.cache.get(cacheKey);

    if (!articles) {
      articles = (await this.newsApi.searchNewsExpanded(keywords, 10))
        .filter((article) => !isSpamHeadline(article.title))
        .slice(0, 5);
      this.cache.set(cacheKey, articles);
    }

    articles = articles.filter((article) => !isSpamHeadline(article.title));

    const referenceTimestamp = tradeTimestamp > 0 ? tradeTimestamp : Math.floor(Date.now() / 1000);
    const forwardCutoff = referenceTimestamp + forwardWindowMinutes * 60;

    const postTradeArticles = articles
      .filter((article) => article.publishedAt > referenceTimestamp && article.publishedAt <= forwardCutoff)
      .map((article) => ({
        title: article.title,
        source: article.source,
        url: article.url,
        minutesAfter: Math.round((article.publishedAt - referenceTimestamp) / 60),
      }))
      .sort((a, b) => a.minutesAfter - b.minutesAfter)
      .slice(0, 3);

    let preNewsSignal = '';
    if (postTradeArticles.length > 0) {
      const best = postTradeArticles[0];
      if (best) {
        preNewsSignal = `Traded ${best.minutesAfter}min before ${best.source} reported`;
      }
    }

    return {
      hasPostTradeNews: postTradeArticles.length > 0,
      articles: postTradeArticles,
      preNewsSignal,
    };
  }
}
