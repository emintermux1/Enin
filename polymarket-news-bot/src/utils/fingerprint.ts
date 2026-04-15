import crypto from 'node:crypto'

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
  'market',
  'polymarket',
  'trade',
  'breaking',
  'news',
  'says',
  'said',
  'announces',
  'announced',
  'reports',
  'reported',
  'according',
  'the',
  'and',
  'for',
  'has',
  'new',
  'its',
  'been',
  'are',
  'was',
  'were',
  'but',
  'not',
  'they',
])

export function computeFingerprint(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))

  const unique = [...new Set(tokens)].sort().slice(0, 6)
  if (unique.length === 0) {
    return ''
  }

  const key = unique.join('|')
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)
}
