import { config } from './src/config';
import { PolymarketApi } from './src/sources/polymarket-api';
import { MarketCardGenerator } from './src/content/market-card';
import { PostComposer } from './src/content/post-composer';
import { Telegraf, Markup } from 'telegraf';

async function main() {
  console.log('Fetching trending markets from Polymarket...');
  const api = new PolymarketApi();
  const markets = await api.getTopEvents(10, 0);
  const active = markets.filter(m => m.active && !m.closed && m.volume24hr > 0)
    .sort((a, b) => b.volume24hr - a.volume24hr)
    .slice(0, 10);

  console.log(`Got ${active.length} trending markets`);

  // Build trending digest text
  const formatUsd = (v: number) => {
    if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v/1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  };

  let caption = '🔥 <b>Trending Markets — Last 24h</b>\n\n';
  active.forEach((market, i) => {
    const topIdx = market.outcomePrices.indexOf(Math.max(...market.outcomePrices));
    const topOutcome = market.outcomes[topIdx] || '—';
    const topProb = Math.round((market.outcomePrices[topIdx] || 0) * 100);
    const vol = formatUsd(market.volume24hr || market.volume);
    const slug = market.eventSlug || market.slug;
    const url = slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com';
    caption += `${i+1}. <a href="${url}">${market.question}</a>\n`;
    caption += `    ${topOutcome}: <b>${topProb}%</b> · ${vol}\n\n`;
  });
  caption += `📊 <a href="https://polymarket.com/markets?_s=volume24hr&_od=desc">View all on Polymarket</a>`;

  // Also generate a card for the top market
  console.log('Generating market card for top market...');
  const cardGen = new MarketCardGenerator();
  let cardBuffer: Buffer | undefined;
  try {
    cardBuffer = await cardGen.generateMarketCard(active[0]);
    console.log(`Card generated: ${cardBuffer.length} bytes`);
  } catch (e) {
    console.log('Card generation failed (canvas not available), sending text only');
  }

  // Send to channel
  const bot = new Telegraf(config.telegram.botToken);
  const channelId = config.telegram.channelId;

  console.log(`Sending trending digest to channel ${channelId}...`);
  const digestMsg = await bot.telegram.sendMessage(channelId, caption, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [
        Markup.button.url('🔮 Explore Markets', 'https://polymarket.com/markets?_s=volume24hr&_od=desc'),
        Markup.button.url('👥 Traders Community', config.telegram.communityUrl),
      ],
    ]).reply_markup,
    link_preview_options: { is_disabled: true },
  });
  console.log(`Digest sent! Message ID: ${digestMsg.message_id}`);

  // Pin it
  try {
    await bot.telegram.pinChatMessage(channelId, digestMsg.message_id, { disable_notification: true });
    console.log('Pinned!');
  } catch (e: any) {
    console.log('Pin failed:', e.message);
  }

  // If we have a card, send it too as a separate post
  if (cardBuffer) {
    console.log('Sending market spotlight card...');
    const top = active[0];
    const slug = top.eventSlug || top.slug;
    const spotlightCaption = `📊 <b>Market Spotlight</b>\n\n<b>${top.question}</b>\n\n${top.outcomes.slice(0,4).map((o, i) => `• ${o}: <b>${Math.round((top.outcomePrices[i]||0)*100)}%</b>`).join('\n')}\n\n💰 24h Volume: ${formatUsd(top.volume24hr)}`;
    await bot.telegram.sendPhoto(channelId,
      { source: cardBuffer },
      {
        caption: spotlightCaption,
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.url('🔮 Trade on Polymarket', `https://polymarket.com/event/${slug}`),
            Markup.button.url('👥 Traders Community', config.telegram.communityUrl),
          ],
        ]).reply_markup,
      }
    );
    console.log('Spotlight card sent!');
  }

  console.log('Done!');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
