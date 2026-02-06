// storage.js — cache + persistence layer (Supabase for users, localStorage for guest mode)

import { fetchAllUserStorage, upsertUserStorage, deleteUserStorageKeys } from './supabase.js';

const PREFIX = 'bazunia_';
const LEGACY_PREFIX = 'baza_';
const PREFIXES = [PREFIX, LEGACY_PREFIX];
const LEGACY_MIGRATION_KEY = '__legacyLocalMigratedV1';

const cache = new Map();

let persistenceMode = 'none'; // 'none' | 'guest' | 'user'
let activeUserId = null;
let initialized = false;
let syncQueue = Promise.resolve();
let lastSyncError = null;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function prefixedKey(key) {
  return `${PREFIX}${key}`;
}

function loadLocalEntries() {
  const entries = new Map();

  for (let i = 0; i < localStorage.length; i++) {
    const fullKey = localStorage.key(i);
    if (!fullKey) continue;
    const matchedPrefix = PREFIXES.find((prefix) => fullKey.startsWith(prefix));
    if (!matchedPrefix) continue;

    const key = fullKey.slice(matchedPrefix.length);
    const raw = localStorage.getItem(fullKey);
    if (!raw) continue;

    try {
      const value = JSON.parse(raw);
      const nextRank = matchedPrefix === PREFIX ? 0 : 1;
      const current = entries.get(key);
      if (!current || current.rank > nextRank) {
        entries.set(key, { value, rank: nextRank });
      }
    } catch {
      // Ignore malformed local values
    }
  }

  return Array.from(entries.entries()).map(([key, data]) => [key, data.value]);
}

function writeLocalJSON(key, value) {
  try {
    localStorage.setItem(prefixedKey(key), JSON.stringify(value));
  } catch (error) {
    console.error('Local storage write failed:', error);
    throw new Error('Brak miejsca w localStorage. Usuń nieużywane talie.');
  }
}

function removeLocalKey(key) {
  PREFIXES.forEach((prefix) => {
    localStorage.removeItem(`${prefix}${key}`);
  });
}

function resetRuntimeState(mode = 'none', userId = null) {
  persistenceMode = mode;
  activeUserId = userId;
  initialized = false;
  cache.clear();
  lastSyncError = null;
  syncQueue = Promise.resolve();
}

function getJSON(key, fallback = null) {
  if (!initialized) return fallback;
  if (!cache.has(key)) return fallback;
  return cloneValue(cache.get(key));
}

function enqueueSync(task) {
  syncQueue = syncQueue
    .then(async () => {
      await task();
      lastSyncError = null;
    })
    .catch((error) => {
      lastSyncError = error;
      console.error('Supabase sync error:', error);
    });
}

function setJSON(key, value) {
  if (!initialized) {
    throw new Error('Storage nie jest gotowy.');
  }

  const safeValue = cloneValue(value);
  cache.set(key, safeValue);

  if (persistenceMode === 'user') {
    if (!activeUserId) {
      throw new Error('Brak aktywnej sesji użytkownika. Zaloguj się ponownie.');
    }
    enqueueSync(() => upsertUserStorage(activeUserId, key, safeValue));
    return;
  }

  if (persistenceMode === 'guest') {
    writeLocalJSON(key, safeValue);
    return;
  }

  throw new Error('Brak aktywnej sesji.');
}

async function migrateLocalToUserStorage() {
  if (cache.get(LEGACY_MIGRATION_KEY)) return;

  const localEntries = loadLocalEntries();

  if (localEntries.length === 0) {
    cache.set(LEGACY_MIGRATION_KEY, true);
    await upsertUserStorage(activeUserId, LEGACY_MIGRATION_KEY, true);
    return;
  }

  for (const [key, value] of localEntries) {
    cache.set(key, value);
    await upsertUserStorage(activeUserId, key, value);
  }

  cache.set(LEGACY_MIGRATION_KEY, true);
  await upsertUserStorage(activeUserId, LEGACY_MIGRATION_KEY, true);

  // Data has been migrated to user storage, clear guest local keys
  for (const [key] of localEntries) {
    removeLocalKey(key);
  }
}

export async function initForUser(userId) {
  if (!userId) {
    throw new Error('Brak identyfikatora użytkownika.');
  }

  resetRuntimeState('user', userId);

  const rows = await fetchAllUserStorage(userId);
  for (const row of rows) {
    cache.set(row.key, row.value);
  }

  await migrateLocalToUserStorage();
  initialized = true;
}

export async function initGuest() {
  resetRuntimeState('guest', null);

  const localEntries = loadLocalEntries();
  for (const [key, value] of localEntries) {
    cache.set(key, value);
  }

  initialized = true;
}

export function clearSession() {
  resetRuntimeState('none', null);
}

export function getPersistenceMode() {
  return persistenceMode;
}

export async function flushPendingWrites() {
  await syncQueue;
  if (lastSyncError) throw lastSyncError;
}

export function getLastSyncError() {
  return lastSyncError;
}

export function isReady() {
  return initialized;
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

export function getFontScale() {
  return getJSON('fontScale', null);
}

export function saveFontScale(fontScale) {
  setJSON('fontScale', fontScale);
}

// --- Cleanup ---

export function clearDeckData(deckId) {
  if (!initialized) return;

  const keys = [
    `cards_${deckId}`,
    `questions_${deckId}`,
    `stats_${deckId}`,
    `deckSettings_${deckId}`,
  ];

  for (const key of keys) {
    cache.delete(key);
  }

  if (persistenceMode === 'user' && activeUserId) {
    enqueueSync(() => deleteUserStorageKeys(activeUserId, keys));
    return;
  }

  if (persistenceMode === 'guest') {
    for (const key of keys) {
      removeLocalKey(key);
    }
  }
}

// --- Storage usage ---

export function getStorageUsage() {
  let total = 0;
  for (const [key, value] of cache.entries()) {
    if (key === LEGACY_MIGRATION_KEY) continue;
    total += (key.length + JSON.stringify(value).length) * 2; // UTF-16 ~= 2 bytes/char
  }

  return {
    usedBytes: total,
    usedKB: Math.round(total / 1024),
    usedMB: (total / (1024 * 1024)).toFixed(2),
  };
}
