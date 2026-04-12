const COUNTRY_MAP: [RegExp, string][] = [
  [/\b(?:iran|iranian|tehran|hormuz)\b/i, '🇮🇷'],
  [
    /\b(?:united states|u\.?s\.?|america|trump|biden|congress|senate|white house|pentagon)\b/i,
    '🇺🇸',
  ],
  [/\b(?:ukraine|ukrainian|kyiv|zelenskyy|zelensky)\b/i, '🇺🇦'],
  [/\b(?:russia|russian|moscow|putin|kremlin)\b/i, '🇷🇺'],
  [/\b(?:china|chinese|beijing|xi jinping)\b/i, '🇨🇳'],
  [/\b(?:india|indian|modi|delhi)\b/i, '🇮🇳'],
  [/\b(?:israel|israeli|netanyahu|gaza|hamas)\b/i, '🇮🇱'],
  [/\b(?:palestine|palestinian|west bank)\b/i, '🇵🇸'],
  [/\b(?:hungary|hungarian|orb[aá]n|magyar)\b/i, '🇭🇺'],
  [/\b(?:uk |britain|british|starmer|london)\b/i, '🇬🇧'],
  [/\b(?:france|french|macron|paris)\b/i, '🇫🇷'],
  [/\b(?:germany|german|scholz|berlin)\b/i, '🇩🇪'],
  [/\b(?:japan|japanese|tokyo)\b/i, '🇯🇵'],
  [/\b(?:korea|korean|seoul|pyongyang)\b/i, '🇰🇷'],
  [/\b(?:canada|canadian|trudeau|ottawa)\b/i, '🇨🇦'],
  [/\b(?:brazil|brazilian|lula|brasilia)\b/i, '🇧🇷'],
  [/\b(?:australia|australian|canberra)\b/i, '🇦🇺'],
  [/\b(?:turkey|turkish|erdogan|ankara)\b/i, '🇹🇷'],
  [/\b(?:nato)\b/i, '🏛️'],
  [/\b(?:eu |european union)\b/i, '🇪🇺'],
]

const TOPIC_MAP: [RegExp, string][] = [
  [/\b(?:bitcoin|btc|ethereum|eth|crypto|solana|sol)\b/i, '₿'],
  [/\b(?:oil|crude|wti|brent|energy|opec)\b/i, '🛢️'],
  [/\b(?:election|vote|voting|ballot|poll)\b/i, '🗳️'],
  [/\b(?:ai |artificial intelligence|openai|gpt|chatgpt)\b/i, '🤖'],
  [/\b(?:space|nasa|spacex|rocket|mars|moon)\b/i, '🚀'],
  [/\b(?:climate|warming|carbon|emissions)\b/i, '🌍'],
  [/\b(?:nuclear|nuke|atomic)\b/i, '☢️'],
  [/\b(?:ceasefire|peace|treaty|deal|negotiation)\b/i, '🕊️'],
  [/\b(?:war |military|troops|army|navy|attack|strike|missile)\b/i, '⚔️'],
  [/\b(?:fed |interest rate|inflation|recession)\b/i, '📉'],
  [/\b(?:stock|s&p|nasdaq|dow jones|market cap)\b/i, '📈'],
  [/\b(?:football|soccer|premier league|champions league|world cup)\b/i, '⚽'],
  [/\b(?:nba|basketball)\b/i, '🏀'],
  [/\b(?:super bowl|nfl)\b/i, '🏈'],
  [/\b(?:gta|game|gaming|esport)\b/i, '🎮'],
  [/\b(?:taylor swift|celebrity|hollywood|movie|oscar)\b/i, '🌟'],
  [/\b(?:earthquake|hurricane|tornado|flood|disaster)\b/i, '🌊'],
  [/\b(?:covid|pandemic|virus|vaccine|health)\b/i, '🏥'],
]

export interface MarketEmoji {
  countryFlags: string[]
  topicEmoji: string | null
}

export function detectMarketEmoji(market: {
  question: string
  tags?: string[]
  description?: string
}): MarketEmoji {
  const searchText = [
    market.question,
    ...(market.tags || []),
    market.description || '',
  ].join(' ')

  const countryFlags: string[] = []
  for (const [pattern, emoji] of COUNTRY_MAP) {
    if (pattern.test(searchText) && !countryFlags.includes(emoji)) {
      countryFlags.push(emoji)
      if (countryFlags.length >= 2) {
        break
      }
    }
  }

  let topicEmoji: string | null = null
  for (const [pattern, emoji] of TOPIC_MAP) {
    if (pattern.test(searchText)) {
      topicEmoji = emoji
      break
    }
  }

  return { countryFlags, topicEmoji }
}

export function formatEmojiPrefix(market: {
  question: string
  tags?: string[]
  description?: string
}): string {
  const { countryFlags, topicEmoji } = detectMarketEmoji(market)
  const parts = [...countryFlags]
  if (topicEmoji) {
    parts.push(topicEmoji)
  }
  const limitedParts = parts.slice(0, 2)
  return limitedParts.length > 0 ? `${limitedParts.join(' ')} ` : ''
}
