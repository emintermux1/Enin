/**
 * Telegram Premium custom emoji IDs.
 * Bot API 9.4+: bots owned by Premium users can send custom emoji.
 * Each entry maps a semantic role → { base emoji character, custom_emoji_id }.
 * The base emoji is placed in the text; the entity overrides its rendering.
 */

export interface PremiumEmoji {
  /** The regular emoji character to place in text */
  char: string;
  /** Telegram custom_emoji_id */
  id: string;
}

// Trader type header emojis
export const EMOJI_WHALE: PremiumEmoji = { char: '🐋', id: '5420534836798458790' };
export const EMOJI_INSIDER: PremiumEmoji = { char: '🔥', id: '4969918262650340505' };
export const EMOJI_TOP_HOLDER: PremiumEmoji = { char: '💰', id: '5897958754267174109' };
export const EMOJI_CONVICTION: PremiumEmoji = { char: '📈', id: '6030861234432121355' };

// Field emojis
export const EMOJI_CALENDAR: PremiumEmoji = { char: '📅', id: '5875291072225087249' };
export const EMOJI_TARGET: PremiumEmoji = { char: '⚡', id: '5355160022894539220' };
export const EMOJI_TRADER: PremiumEmoji = { char: '🧑‍💼', id: '5920344347152224466' };
export const EMOJI_PORTFOLIO: PremiumEmoji = { char: '💼', id: '5967389567781703494' };
export const EMOJI_CHART_UP: PremiumEmoji = { char: '📈', id: '5994378914636500516' };
export const EMOJI_MONEY: PremiumEmoji = { char: '💵', id: '5967390100357648692' };
export const EMOJI_CHECK: PremiumEmoji = { char: '✅', id: '5852745384434077722' };
export const EMOJI_CROSS: PremiumEmoji = { char: '❌', id: '5802986818215353221' };
export const EMOJI_LINK: PremiumEmoji = { char: '🔗', id: '5778168620278354602' };
export const EMOJI_FIRE: PremiumEmoji = { char: '🔥', id: '4969918262650340505' };
export const EMOJI_COIN: PremiumEmoji = { char: '🪙', id: '5992430854909989581' };
export const EMOJI_DOLLAR: PremiumEmoji = { char: '💲', id: '5837102533721460863' };
export const EMOJI_MONEYBAG: PremiumEmoji = { char: '💰', id: '5897958754267174109' };

// Map trader types to their premium emoji
import { TraderType } from '../types';

export const TRADER_TYPE_PREMIUM: Partial<Record<TraderType, PremiumEmoji>> = {
  WHALE: EMOJI_WHALE,
  INSIDER: EMOJI_INSIDER,
  TOP_HOLDER: EMOJI_TOP_HOLDER,
  CONVICTION_BUILD: EMOJI_CONVICTION,
};
