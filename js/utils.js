// utils.js — Shared utility functions

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Fisher-Yates shuffle. Returns a NEW array (does not mutate input).
 */
export function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Returns the start of the day (midnight local time) for a given timestamp.
 */
export function startOfDay(timestamp = Date.now()) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Returns the number of whole days between two timestamps.
 */
export function daysBetween(ts1, ts2) {
  return Math.floor(Math.abs(ts2 - ts1) / DAY_MS);
}

/**
 * Formats a timestamp as YYYY-MM-DD.
 */
export function formatDate(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats an interval (in minutes) to a human-readable string.
 * Examples: "1m", "10m", "1d", "3d", "1.5mo", "1y"
 */
export function formatInterval(totalMinutes) {
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}m`;
  if (totalMinutes < 60 * 24) {
    const hours = totalMinutes / 60;
    return hours === Math.floor(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  const days = totalMinutes / (60 * 24);
  if (days < 31) {
    return days === Math.floor(days) ? `${days}d` : `${days.toFixed(1)}d`;
  }
  const months = days / 30;
  if (months < 12) {
    return months === Math.floor(months) ? `${months}mo` : `${months.toFixed(1)}mo`;
  }
  const years = days / 365;
  return years === Math.floor(years) ? `${years}y` : `${years.toFixed(1)}y`;
}

/**
 * Generate a unique ID.
 */
export function generateId() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/**
 * Random integer in [min, max] inclusive.
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Replace $$ ... $$ in already-escaped HTML with rendered KaTeX.
 * Falls back to raw text if KaTeX is not loaded.
 */
export function renderLatex(html) {
  if (typeof katex === 'undefined') return html;
  return html.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
    try {
      // Unescape HTML entities that escapeHtml may have introduced inside $$
      const unescaped = tex
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      return katex.renderToString(unescaped, { throwOnError: false, displayMode: false });
    } catch {
      return match;
    }
  });
}

/**
 * Returns true if the question is a flashcard (no ABCD answers).
 */
export function isFlashcard(question) {
  return !question.answers || question.answers.length === 0;
}

export { DAY_MS, MINUTE_MS };
