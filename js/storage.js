// storage.js — in-memory cache with Supabase persistence

import { fetchAllUserStorage, upsertUserStorage, deleteUserStorageKeys } from './supabase.js';

const LEGACY_PREFIX = 'baza_';
const LEGACY_MIGRATION_KEY = '__legacyLocalMigratedV1';

const cache = new Map();

let activeUserId = null;
let initialized = false;
let syncQueue = Promise.resolve();
let lastSyncError = null;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
  if (!initialized || !activeUserId) {
    throw new Error('Brak aktywnej sesji użytkownika. Zaloguj się ponownie.');
  }

  const safeValue = cloneValue(value);
  cache.set(key, safeValue);
  enqueueSync(() => upsertUserStorage(activeUserId, key, safeValue));
}

async function migrateLegacyLocalStorage() {
  if (cache.get(LEGACY_MIGRATION_KEY)) return;

  const entriesToMigrate = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LEGACY_PREFIX)) continue;

    const storageKey = key.slice(LEGACY_PREFIX.length);
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      entriesToMigrate.push([storageKey, parsed]);
    } catch {
      // Ignore malformed legacy entries
    }
  }

  if (entriesToMigrate.length === 0) {
    cache.set(LEGACY_MIGRATION_KEY, true);
    await upsertUserStorage(activeUserId, LEGACY_MIGRATION_KEY, true);
    return;
  }

  for (const [key, value] of entriesToMigrate) {
    cache.set(key, value);
    await upsertUserStorage(activeUserId, key, value);
  }

  // Migrate old standalone font key if present
  const legacyFont = localStorage.getItem('baza_fontScale');
  if (legacyFont) {
    const parsedFont = parseFloat(legacyFont);
    if (!Number.isNaN(parsedFont) && parsedFont > 0) {
      cache.set('fontScale', parsedFont);
      await upsertUserStorage(activeUserId, 'fontScale', parsedFont);
    }
  }

  cache.set(LEGACY_MIGRATION_KEY, true);
  await upsertUserStorage(activeUserId, LEGACY_MIGRATION_KEY, true);

  // Cleanup old browser-only data after successful migration
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LEGACY_PREFIX)) keysToRemove.push(key);
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
  localStorage.removeItem('baza_fontScale');
}

export async function initForUser(userId) {
  if (!userId) {
    throw new Error('Brak identyfikatora użytkownika.');
  }

  activeUserId = userId;
  initialized = false;
  cache.clear();
  lastSyncError = null;
  syncQueue = Promise.resolve();

  const rows = await fetchAllUserStorage(userId);
  for (const row of rows) {
    cache.set(row.key, row.value);
  }

  await migrateLegacyLocalStorage();
  initialized = true;
}

export function clearSession() {
  activeUserId = null;
  initialized = false;
  cache.clear();
  lastSyncError = null;
  syncQueue = Promise.resolve();
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
  if (!initialized || !activeUserId) return;

  const keys = [
    `cards_${deckId}`,
    `questions_${deckId}`,
    `stats_${deckId}`,
    `deckSettings_${deckId}`,
  ];

  for (const key of keys) {
    cache.delete(key);
  }

  enqueueSync(() => deleteUserStorageKeys(activeUserId, keys));
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
