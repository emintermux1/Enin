export interface PremiumEmoji {
  char: string
  id: string
}

export const EMOJI_BREAKING: PremiumEmoji = {
  char: '🚨',
  id: '5210952531676504517',
}
export const EMOJI_TRENDING: PremiumEmoji = {
  char: '📊',
  id: '6030861234432121355',
}
export const EMOJI_NEW: PremiumEmoji = { char: '🆕', id: '5224642798514988501' }
export const EMOJI_RESOLVED: PremiumEmoji = {
  char: '✅',
  id: '5852745384434077722',
}
export const EMOJI_COMMUNITY: PremiumEmoji = {
  char: '👥',
  id: '5337197721457388125',
}
export const EMOJI_MARKET: PremiumEmoji = {
  char: '🔮',
  id: '5391089937709934643',
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function trimCaptionForPhoto(html: string): string {
  return html.length <= 1024 ? html : `${html.slice(0, 1021).trimEnd()}...`
}

export function trimCaptionForMessage(html: string): string {
  return html.length <= 4096 ? html : `${html.slice(0, 4093).trimEnd()}...`
}
