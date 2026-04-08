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

export function formatPriceCents(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(multiplier >= 10 ? 1 : 1)}x`;
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
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
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

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
