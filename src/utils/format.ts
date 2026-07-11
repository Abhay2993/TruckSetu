/**
 * Formatting helpers. INR amounts use the Indian digit grouping system
 * (12,34,567) — implemented by hand because Hermes' Intl support for the
 * 'en-IN' locale varies across OS versions.
 */

export function formatINR(amount: number): string {
  const negative = amount < 0;
  const whole = Math.round(Math.abs(amount)).toString();

  // Indian grouping: last 3 digits, then groups of 2.
  const last3 = whole.slice(-3);
  const head = whole.slice(0, -3);
  const grouped = head
    ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
    : last3;

  return `${negative ? '-' : ''}₹${grouped}`;
}

export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function timeAgo(epochMs: number): string {
  const diffMin = Math.max(0, Math.round((Date.now() - epochMs) / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}
