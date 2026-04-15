const STOP_WORDS = new Set([
  'will',
  'with',
  'from',
  'that',
  'have',
  'this',
  'just',
  'into',
  'about',
  'after',
  'before',
  'the',
  'and',
  'for',
  'has',
  'its',
  'new',
  'been',
  'are',
  'was',
  'were',
  'but',
  'not',
  'they',
  'says',
  'said',
  'market',
  'polymarket',
  'what',
  'price',
  'chance',
])

export function buildTwitterSearchUrl(text: string): string {
  const keywords = text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 4)
    .join(' ')

  if (!keywords) {
    return 'https://x.com/search?q=polymarket&f=live'
  }

  return `https://x.com/search?q=${encodeURIComponent(keywords)}&f=live`
}
