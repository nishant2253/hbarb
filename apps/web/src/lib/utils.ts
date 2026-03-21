import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a Hedera account/topic/file ID as a clickable HashScan URL */
export function hashscanUrl(
  entity: string,
  type: 'account' | 'topic' | 'transaction' | 'token' | 'contract' | 'file' = 'topic',
  network = 'testnet'
) {
  return `https://hashscan.io/${network}/${type}/${entity}`;
}

/** Shorten a Hedera ID for display */
export function shortId(id: string) {
  if (!id) return '—';
  return id.length > 14 ? `${id.slice(0, 7)}...${id.slice(-4)}` : id;
}

/** Format a number as currency */
export function fmtCurrency(value: number, symbol = '$') {
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)     return `${symbol}${(value / 1_000).toFixed(2)}K`;
  return `${symbol}${value.toFixed(2)}`;
}

/** Format a HCS timestamp (seconds) to locale time */
export function fmtTimestamp(ts: string | number) {
  const ms = typeof ts === 'string' ? parseFloat(ts) * 1000 : ts * 1000;
  return new Date(ms).toLocaleString();
}
