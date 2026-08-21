import { Telegraf } from 'telegraf';
import { config } from '../config';
import { DetectedTrade, QualifiedTrader } from '../types';

const bot = config.telegram.enabled ? new Telegraf(config.telegram.botToken) : null;

function solscanWallet(wallet: string): string {
  return `https://solscan.io/account/${wallet}`;
}

function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

function usd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

async function send(text: string): Promise<void> {
  if (!bot) {
    console.log(`[alert:dry-run] ${text.replace(/\n/g, ' | ')}`);
    return;
  }
  try {
    await bot.telegram.sendMessage(config.telegram.chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.warn('[alert] send failed:', err instanceof Error ? err.message : String(err));
  }
}

export async function alertNewTrader(trader: QualifiedTrader): Promise<void> {
  const lines = [
    `<b>New fomo trader matched</b>`,
    ``,
    `Wallet: <code>${trader.wallet}</code>`,
    `Portfolio: <b>${usd(trader.portfolioUsd)}</b> (cash ${usd(trader.cashUsd)})`,
    `Memecoins: <b>${trader.memecoinCount}</b> worth ${usd(trader.memecoinUsd)}`,
    `Trades in window: <b>${trader.tradeCount}</b>`,
    `Score: ${trader.score}`,
    ``,
    `<a href="${solscanWallet(trader.wallet)}">View on Solscan</a>`,
  ];
  await send(lines.join('\n'));
}

export async function alertTrade(trade: DetectedTrade): Promise<void> {
  const action = trade.side === 'buy' ? 'BUY' : 'SELL';
  const lines = [
    `<b>${action}</b> ${usd(trade.usdValue)}`,
    ``,
    `Trader: <code>${trade.wallet}</code>`,
    `Token: <code>${trade.mint}</code>`,
    `Amount: ${trade.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    ``,
    `<a href="${solscanTx(trade.signature)}">Transaction</a> · <a href="${solscanWallet(trade.wallet)}">Trader</a>`,
  ];
  await send(lines.join('\n'));
}

export async function alertCycleSummary(summary: {
  checked: number;
  qualified: number;
  watchlistSize: number;
  candidates: number;
}): Promise<void> {
  const lines = [
    `<b>Scan cycle complete</b>`,
    ``,
    `Checked: ${summary.checked}`,
    `Newly qualified: ${summary.qualified}`,
    `Watchlist: ${summary.watchlistSize}`,
    `Known candidates: ${summary.candidates}`,
  ];
  await send(lines.join('\n'));
}
