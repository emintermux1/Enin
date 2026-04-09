export function formatUsd(value: number): string {
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatSignedUsd(value: number): string {
  const formatted = formatUsd(Math.abs(value));
  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

export function formatCompactUsd(value: number): string {
  if (Math.abs(value) < 1_000_000) {
    return formatUsd(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatSignedCompactUsd(value: number): string {
  const absolute = Math.abs(value);
  let formatted: string;
  if (absolute >= 1_000_000) {
    formatted = `$${(absolute / 1_000_000).toFixed(1)}M`;
  } else if (absolute >= 1_000) {
    formatted = `$${Math.round(absolute / 1_000)}K`;
  } else {
    formatted = `$${Math.round(absolute)}`;
  }
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

export function formatPriceCents(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(1)}x`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatResolveDate(input: string): string {
  if (!input) {
    return 'Unknown';
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const parts = formatter.formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value?.toUpperCase() ?? '';
  return `${month} ${day} ${hour}:${minute} ${dayPeriod} ET`.trim();
}

export function formatResolveDay(input: string): string {
  if (!input) {
    return 'Unknown';
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatTimestamp(input: number): string {
  const date = new Date(input * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function formatMonthYear(input: string | null): string | null {
  if (!input) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatWallet(wallet: string): string {
  if (!wallet) {
    return 'Unknown wallet';
  }
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
