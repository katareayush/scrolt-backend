/**
 * Pure duration formatting.
 *
 * Lives in its own module — same reason as `cardAlgorithm` — so unit
 * tests can import it without pulling in the route, and through it the
 * DB / Redis / env validators, which `process.exit(1)` when the
 * environment isn't configured.
 */

/**
 * Render a duration as the two or three units a human actually reads —
 * `3d 4h 12m`, `12m 30s`, `45s`. Trailing zero units are dropped, and
 * anything under a minute keeps seconds so a crash-looping container
 * doesn't just report `0m`.
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  // Seconds only matter when the total is small enough for them to read
  // as signal rather than noise.
  if (seconds && days === 0) parts.push(`${seconds}s`);

  return parts.length ? parts.join(' ') : '0s';
}
