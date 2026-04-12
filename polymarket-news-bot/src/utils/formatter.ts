export function formatUsd(value: number): string {
  const absolute = Math.abs(value)
  const digits = absolute >= 100 ? 0 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatCompactUsd(value: number): string {
  const absolute = Math.abs(value)
  if (absolute < 1_000) {
    return formatUsd(value)
  }
  if (absolute < 1_000_000) {
    return `$${(value / 1_000).toFixed(absolute >= 100_000 ? 0 : 1)}K`
  }
  return `$${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${value.toFixed(fractionDigits)}%`
}

export function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatTimestamp(input: number): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date)
}

export function formatDate(input: string): string {
  if (!input) {
    return 'Unknown'
  }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return input
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date)
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
