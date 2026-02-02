// storage.js — localStorage abstraction with baza_ prefix

const PREFIX = 'baza_';

function getJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error('Storage write failed:', e);
    throw new Error('Brak miejsca w localStorage. Usuń nieużywane talie.');
  }
}

// --- Decks ---

export function getDecks() {
  return getJSON('decks', []);
}

export function saveDecks(decks) {
  setJSON('decks', decks);
}

// --- Cards ---

export function getCards(deckId) {
  return getJSON(`cards_${deckId}`, []);
}

export function saveCards(deckId, cards) {
  setJSON(`cards_${deckId}`, cards);
}

// --- Questions (stored separately from card state) ---

export function getQuestions(deckId) {
  return getJSON(`questions_${deckId}`, []);
}

export function saveQuestions(deckId, questions) {
  setJSON(`questions_${deckId}`, questions);
}

// --- Stats ---

export function getStats(deckId) {
  return getJSON(`stats_${deckId}`, {});
}

export function saveStats(deckId, stats) {
  setJSON(`stats_${deckId}`, stats);
}

// --- Settings (per-deck) ---

export function getDeckSettings(deckId) {
  return getJSON(`deckSettings_${deckId}`, null);
}

export function saveDeckSettings(deckId, settings) {
  setJSON(`deckSettings_${deckId}`, settings);
}

// Legacy global settings (for migration)
export function getSettings() {
  return getJSON('settings', null);
}

export function saveSettings(settings) {
  setJSON('settings', settings);
}

// --- App Settings ---

export function getAppSettings() {
  return getJSON('appSettings', null);
}

export function saveAppSettings(appSettings) {
  setJSON('appSettings', appSettings);
}

// --- Cleanup ---

export function clearDeckData(deckId) {
  localStorage.removeItem(PREFIX + `cards_${deckId}`);
  localStorage.removeItem(PREFIX + `questions_${deckId}`);
  localStorage.removeItem(PREFIX + `stats_${deckId}`);
  localStorage.removeItem(PREFIX + `deckSettings_${deckId}`);
}

// --- Storage usage ---

export function getStorageUsage() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(PREFIX)) {
      total += localStorage.getItem(key).length * 2; // UTF-16 ~2 bytes per char
    }
  }
  return {
    usedBytes: total,
    usedKB: Math.round(total / 1024),
    usedMB: (total / (1024 * 1024)).toFixed(2),
  };
}
