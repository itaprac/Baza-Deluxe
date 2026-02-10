// app.js — Application entry point, router, study session loop

import { DEFAULT_SETTINGS, processRating, getButtonIntervals } from './sm2.js';
import { RATINGS, isNew as isNewCard, isReview as isReviewCard, isLearning as isLearningCard, isRelearning as isRelearningCard, isFlagged, createCard } from './card.js';
import * as deck from './deck.js';
import * as storage from './storage.js';
import { importFromFile, importBuiltIn } from './importer.js';
import {
  renderDeckList,
  renderSharedDeckCatalog,
  renderQuestion,
  renderAnswerFeedback,
  renderSessionComplete,
  renderCategorySelect,
  renderModeSelect,
  renderSettings,
  renderTestConfig,
  renderTestQuestion,
  renderTestResult,
  renderBrowse,
  renderBrowseCreateEditor,
  renderBrowseEditor,
  renderFlaggedBrowse,
  renderAppSettings,
  renderQuestionEditor,
  renderUserProfile,
  renderAdminPanel,
  formatKeyName,
  updateStudyCounts,
  updateProgress,
  showView,
  showNotification,
  showConfirm,
  showConfirmWithOptions,
  showPrompt,
} from './ui.js';
import {
  shuffle,
  isFlashcard,
  generateId,
  normalizeSelectionMode,
  getDeckDefaultSelectionMode as resolveDeckDefaultSelectionMode,
  getEffectiveQuestionSelectionMode as resolveEffectiveQuestionSelectionMode,
} from './utils.js';
import { initTooltips } from './tooltip.js';
import { hasRandomizer, hasTemplate, randomize } from './randomizers.js';
import { initDocsNavigation } from './docs-navigation.js';
import {
  isSupabaseConfigured,
  getCurrentSession,
  onAuthStateChange,
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signOutUser,
  sendPasswordResetEmail,
  fetchCurrentUserRole,
  fetchAdminUsers,
  setUserRole,
  fetchPublicDecks,
  fetchPublicDeckVisibility,
  setPublicDeckVisibility,
  fetchMyProfile,
  updateMyUsername,
  searchSharedDecks,
  publishSharedDeck,
  unpublishSharedDeck,
  fetchMySubscriptions,
  subscribeToSharedDeck,
  unsubscribeFromSharedDeck,
  fetchAnswerVoteSummary,
  setAnswerVote,
  isAnswerVoteRpcReady,
} from './supabase.js';
import { PUBLIC_DECK_PROVIDER } from './supabase-config.js';

// --- App State ---

const FONT_SCALE_STEP = 0.1;
const DEFAULT_FONT_SCALE = 1.0;
const AUTH_VIEW_CONFIG = {
  login: {
    title: 'Zaloguj się',
    subtitle: 'Logowanie jest opcjonalne. Możesz też kontynuować jako gość.',
    submitLabel: 'Zaloguj',
    resetLinkLabel: 'Nie pamiętam hasła',
  },
  signup: {
    title: 'Załóż konto',
    subtitle: 'Utwórz konto, aby zapisywać własne talie i postęp nauki.',
    submitLabel: 'Załóż konto',
    resetLinkLabel: '',
  },
  reset: {
    title: 'Reset hasła',
    subtitle: 'Podaj e-mail, a wyślemy link do ustawienia nowego hasła.',
    submitLabel: 'Wyślij link resetu',
    resetLinkLabel: 'Wróć do logowania',
  },
};

const DEFAULT_APP_SETTINGS = {
  theme: 'auto',
  colorTheme: 'academic-noir',
  layoutWidth: '65%',
  deckListMode: 'compact', // 'compact' or 'classic'
  shuffleAnswers: true,
  questionOrder: 'shuffled', // 'shuffled' or 'ordered'
  flaggedInAnki: true, // include flagged cards in normal Anki mode
  keybindings: {
    showAnswer: [' ', 'Enter'],
    again: ['1'],
    hard: ['2'],
    good: ['3'],
    easy: ['4'],
  }
};

const BUILT_IN_DECK_SOURCES = [
  { id: 'io-egzamin', file: '/data/io-egzamin.json' },
  { id: 'zi-egzamin', file: '/data/zi-egzamin.json' },
  { id: 'gk-egzamin', file: '/data/gk-egzamin.json' },
  { id: 'gk2-egzamin', file: '/data/gk2-egzamin.json' },
  { id: 'td-egzamin', file: '/data/td-egzamin.json' },
  { id: 'td2-egzamin', file: '/data/td2-egzamin.json' },
  { id: 'poi-egzamin', file: '/data/poi-egzamin.json' },
  { id: 'zi2-egzamin', file: '/data/zi2-egzamin.json' },
  { id: 'kcm-egzamin', file: '/data/kcm-egzamin.json' },
  { id: 'si-egzamin', file: '/data/si-egzamin.json' },
  { id: 'gry-egzamin', file: '/data/gry-egzamin.json' },
  { id: 'ipz-egzamin', file: '/data/ipz-egzamin.json' },
  { id: 'ai-egzamin', file: '/data/ai-egzamin.json' },
  { id: 'ii-egzamin', file: '/data/ii-egzamin.json' },
  { id: 'infrastruktura-informatyczna', file: '/data/infrastruktura_informatyczna.json' },
];
const PUBLIC_DECK_MANIFEST_URL = '/data/public-decks-manifest.json';
const FALLBACK_PUBLIC_DECK_IDS = BUILT_IN_DECK_SOURCES.map((item) => item.id);
const DECK_ID_RE = /^[a-z0-9_-]+$/i;
const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/;
const ADMIN_USERS_PAGE_SIZE = 12;
const ADMIN_HIDDEN_DECKS_PAGE_SIZE = 8;
const SHARED_CATALOG_PAGE_SIZE = 20;
const MAX_PRIVATE_DECKS_PER_USER = 15;
const VOTE_FETCH_CHUNK_SIZE = 100;

let appSettings = { ...DEFAULT_APP_SETTINGS, keybindings: { ...DEFAULT_APP_SETTINGS.keybindings } };
let fontScale = DEFAULT_FONT_SCALE;
let currentDeckId = null;
let currentCategory = null; // null = all, or category id
let currentSessionCategory = null; // category snapshot used for active queues/session resume
let activeDeckScope = 'public'; // 'public' | 'shared' | 'private'
let showPrivateArchived = false;
let settingsReturnTo = null; // 'mode-select' or 'deck-list'
let appSettingsReturnView = null; // view id to return to from app settings
let docsReturnView = null;
let docsLoaded = false;
let docsLoadingPromise = null;
let currentDeckSettings = null; // per-deck SM-2 settings for active session
let studyPhase = null; // 'question' | 'feedback' | null
let currentCardFlagged = false;
let studyingFlagged = false;
let queues = null;
let currentCard = null;
let currentSource = null;
let currentQuestion = null;
let currentShuffledAnswers = null;
let selectedAnswerIds = new Set();
let studiedCount = 0;
let sessionTotal = 0;
let waitTimer = null;
let currentUser = null;
let currentUserProfile = null;
let currentUserRole = 'user'; // 'user' | 'admin' | 'dev'
let sessionMode = null; // 'user' | 'guest' | null
let authSubscription = null;
let authEventsBound = false;
let authMode = 'login'; // 'login' | 'signup' | 'reset'
let userMenuOpen = false;
let publicDeckManifest = [];
let publicDeckManifestById = new Map();
let knownPublicDeckIdSet = new Set(FALLBACK_PUBLIC_DECK_IDS);
let adminPanelState = {
  users: [],
  hiddenDecks: [],
  userQuery: '',
  usersPage: 1,
  hiddenDeckQuery: '',
  hiddenPage: 1,
};
let sharedCatalogState = {
  query: '',
  page: 1,
  pageSize: SHARED_CATALOG_PAGE_SIZE,
  total: 0,
  items: [],
};
let sharedSearchRequestSeq = 0;
let mySubscriptionDeckIds = new Set();
let publicDeckVisibilityErrorNotified = false;
let publicDeckLoadStateById = new Map();

// Test mode state
let testQuestions = [];
let testCurrentIndex = 0;
let testAnswers = new Map(); // questionId → Set of selected answer ids
let testShuffledAnswers = null;
let testSelectedIds = new Set();
let testShuffledMap = new Map(); // index → shuffled answers array
let testResultAnswers = [];
let voteRpcUnavailableNotified = false;

// Community vote cache:
// key = `${targetScope}|${targetDeckId}|${questionId}`
// value = { loaded: boolean, answers: Map(answerId -> { plusCount, minusCount, userVote }) }
let voteSummaryCache = new Map();

function normalizeLayoutWidth(value) {
  return String(value || '').trim() === '50%' ? '50%' : '65%';
}

function slugifyDeckId(value) {
  const input = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
  return input
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeDeckGroup(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function getAvailableDeckGroups(scope = 'private') {
  const targetScope = scope === 'public' ? 'public' : 'private';
  const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });
  const groups = new Set();
  for (const deckMeta of storage.getDecks()) {
    const deckScope = getDeckScope(deckMeta);
    if (deckScope !== targetScope) continue;
    if (targetScope === 'private' && deckMeta.isArchived === true) continue;
    const groupName = normalizeDeckGroup(deckMeta.group);
    if (groupName) groups.add(groupName);
  }
  return Array.from(groups).sort((a, b) => collator.compare(a, b));
}

function getPublicDeckIds() {
  return [...knownPublicDeckIdSet];
}

function refreshKnownPublicDeckIds(manifestDecks = []) {
  const ids = Array.isArray(manifestDecks)
    ? manifestDecks
      .map((deckRow) => String(deckRow?.id || '').trim())
      .filter((id) => id.length > 0)
    : [];
  knownPublicDeckIdSet = new Set(ids.length > 0 ? ids : FALLBACK_PUBLIC_DECK_IDS);
}

function getUniqueDeckId(base) {
  const candidateBase = slugifyDeckId(base) || `talia-${Date.now().toString(36)}`;
  const allDecks = storage.getDecks();
  const taken = new Set(allDecks.map((d) => String(d.id || '').toLowerCase()));
  for (const builtInId of getPublicDeckIds()) {
    taken.add(String(builtInId).toLowerCase());
  }

  if (!taken.has(candidateBase.toLowerCase())) return candidateBase;

  let idx = 2;
  while (taken.has(`${candidateBase}-${idx}`.toLowerCase())) {
    idx++;
  }
  return `${candidateBase}-${idx}`;
}

function isDeckIdTaken(deckId) {
  const normalized = String(deckId || '').toLowerCase();
  if (!normalized) return false;
  if (getPublicDeckIds().some((id) => id.toLowerCase() === normalized)) return true;
  return storage.getDecks().some((d) => String(d.id || '').toLowerCase() === normalized);
}

function isBuiltInDeckId(deckId) {
  return typeof deckId === 'string' && knownPublicDeckIdSet.has(deckId);
}

function getDeckScope(deckMeta) {
  if (!deckMeta || typeof deckMeta !== 'object') return 'private';
  if (deckMeta.scope === 'public' || deckMeta.scope === 'private' || deckMeta.scope === 'subscribed') {
    return deckMeta.scope;
  }
  if (deckMeta.source === 'shared-subscription') {
    return 'subscribed';
  }
  return isBuiltInDeckId(deckMeta.id) ? 'public' : 'private';
}

function isDeckReadOnlyContent(deckMeta) {
  if (!deckMeta || typeof deckMeta !== 'object') return false;
  const scope = getDeckScope(deckMeta);
  if (scope === 'public') {
    return true;
  }
  if (scope === 'subscribed') {
    return true;
  }
  if (typeof deckMeta.readOnlyContent === 'boolean') {
    return deckMeta.readOnlyContent;
  }
  return false;
}

function getDeckMeta(deckId) {
  return storage.getDecks().find((d) => d.id === deckId) || null;
}

function getDeckDefaultSelectionModeForDeckId(deckId) {
  const deckMeta = getDeckMeta(deckId);
  return resolveDeckDefaultSelectionMode(deckMeta, 'multiple');
}

function getEffectiveSelectionModeForDeck(question, deckId = currentDeckId) {
  return resolveEffectiveQuestionSelectionMode(
    question,
    getDeckDefaultSelectionModeForDeckId(deckId)
  );
}

function getVoteTargetForDeck(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) return null;
  const scope = getDeckScope(deckMeta);

  if (scope === 'public') {
    return {
      targetScope: 'public',
      targetDeckId: deckMeta.id,
    };
  }

  if (scope === 'subscribed' && typeof deckMeta.sharedDeckId === 'string' && deckMeta.sharedDeckId.length > 0) {
    return {
      targetScope: 'shared',
      targetDeckId: deckMeta.sharedDeckId,
    };
  }

  return null;
}

function resetVoteSummaryCache() {
  voteSummaryCache = new Map();
  voteRpcUnavailableNotified = false;
}

function notifyVoteRpcUnavailable() {
  if (voteRpcUnavailableNotified) return;
  voteRpcUnavailableNotified = true;
  showNotification(
    'Głosowanie wyłączone: brakuje funkcji RPC w Supabase. Uruchom migrację z pliku supabase/schema.sql.',
    'error'
  );
}

function disableVoteControlsInCurrentView() {
  document.querySelectorAll('.answer-votes').forEach((wrapper) => {
    wrapper.classList.add('disabled');
  });
  document.querySelectorAll('.vote-pill').forEach((button) => {
    button.disabled = true;
  });
}

function normalizeVoteEntry(entry = null) {
  return {
    plusCount: Math.max(0, Number(entry?.plusCount ?? entry?.plus_count ?? 0) || 0),
    minusCount: Math.max(0, Number(entry?.minusCount ?? entry?.minus_count ?? 0) || 0),
    userVote: Number(entry?.userVote ?? entry?.user_vote ?? 0) || 0,
  };
}

function makeVoteCacheKey(voteTarget, questionId) {
  if (!voteTarget || !questionId) return '';
  return `${voteTarget.targetScope}|${voteTarget.targetDeckId}|${questionId}`;
}

function getVoteCacheEntry(voteTarget, questionId, create = false) {
  const key = makeVoteCacheKey(voteTarget, questionId);
  if (!key) return null;
  let entry = voteSummaryCache.get(key) || null;
  if (!entry && create) {
    entry = {
      loaded: false,
      answers: new Map(),
    };
    voteSummaryCache.set(key, entry);
  }
  return entry;
}

function getVoteEntryForAnswer(voteTarget, questionId, answerId) {
  const entry = getVoteCacheEntry(voteTarget, questionId, false);
  if (!entry) return normalizeVoteEntry(null);
  return normalizeVoteEntry(entry.answers.get(answerId));
}

function setVoteEntryForAnswer(voteTarget, questionId, answerId, voteEntry) {
  const entry = getVoteCacheEntry(voteTarget, questionId, true);
  if (!entry) return;
  entry.loaded = true;
  entry.answers.set(answerId, normalizeVoteEntry(voteEntry));
}

function chunkArray(items, chunkSize) {
  const chunked = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunked.push(items.slice(i, i + chunkSize));
  }
  return chunked;
}

async function ensureVoteSummaryForQuestions(deckId, questionIds = [], options = {}) {
  if (!isSupabaseConfigured()) return null;

  const voteTarget = getVoteTargetForDeck(deckId);
  if (!voteTarget) return null;

  const forceRefresh = options.forceRefresh === true;
  const uniqueQuestionIds = [...new Set(
    (Array.isArray(questionIds) ? questionIds : [])
      .map((questionId) => String(questionId || '').trim())
      .filter((questionId) => questionId.length > 0)
  )];

  if (uniqueQuestionIds.length === 0) return voteTarget;

  const questionIdsToFetch = forceRefresh
    ? uniqueQuestionIds
    : uniqueQuestionIds.filter((questionId) => {
      const entry = getVoteCacheEntry(voteTarget, questionId, true);
      return !entry || entry.loaded !== true;
    });

  if (questionIdsToFetch.length === 0) return voteTarget;

  const rows = [];
  const chunks = chunkArray(questionIdsToFetch, VOTE_FETCH_CHUNK_SIZE);

  for (const questionChunk of chunks) {
    const partialRows = await fetchAnswerVoteSummary({
      targetScope: voteTarget.targetScope,
      targetDeckId: voteTarget.targetDeckId,
      questionIds: questionChunk,
    });
    if (Array.isArray(partialRows)) rows.push(...partialRows);
  }

  for (const questionId of questionIdsToFetch) {
    const entry = getVoteCacheEntry(voteTarget, questionId, true);
    entry.loaded = true;
    entry.answers = new Map();
  }

  for (const row of rows) {
    const questionId = String(row?.question_id || '').trim();
    const answerId = String(row?.answer_id || '').trim();
    if (!questionId || !answerId) continue;
    const entry = getVoteCacheEntry(voteTarget, questionId, true);
    entry.loaded = true;
    entry.answers.set(answerId, normalizeVoteEntry({
      plusCount: row.plus_count,
      minusCount: row.minus_count,
      userVote: row.user_vote,
    }));
  }

  return voteTarget;
}

function buildVoteSummaryByQuestion(voteTarget, questions = []) {
  const summary = {};
  if (!voteTarget) return summary;

  for (const question of questions) {
    if (!question || !Array.isArray(question.answers) || question.answers.length === 0) continue;
    const questionEntry = getVoteCacheEntry(voteTarget, question.id, false);
    const answerMap = {};
    for (const answer of question.answers) {
      const answerEntry = questionEntry ? questionEntry.answers.get(answer.id) : null;
      answerMap[answer.id] = normalizeVoteEntry(answerEntry);
    }
    summary[question.id] = answerMap;
  }

  return summary;
}

function getVoteConfigForDeck(deckId, options = {}) {
  const voteTarget = getVoteTargetForDeck(deckId);
  const enabled = isSupabaseConfigured() && !!voteTarget && isAnswerVoteRpcReady();
  return {
    enabled,
    canVote: enabled && sessionMode === 'user',
    showMinus: options.showMinus === true,
  };
}

function setVoteButtonsLoading(questionId, answerId, loading) {
  document.querySelectorAll('.vote-pill').forEach((button) => {
    if (button.dataset.questionId !== questionId) return;
    if (button.dataset.answerId !== answerId) return;
    button.classList.toggle('loading', loading);
    button.disabled = loading;
  });
}

function syncVoteButtonsForQuestion(deckId, question) {
  if (!question) return;
  const voteTarget = getVoteTargetForDeck(deckId);
  if (!voteTarget) return;
  const questionId = String(question.id || '');
  if (!questionId) return;
  const selectionMode = getEffectiveSelectionModeForDeck(question, deckId);
  const showMinus = selectionMode === 'multiple';
  const canVote = sessionMode === 'user';

  for (const answer of (Array.isArray(question.answers) ? question.answers : [])) {
    const answerId = String(answer.id || '');
    if (!answerId) continue;
    const voteEntry = getVoteEntryForAnswer(voteTarget, questionId, answerId);
    document.querySelectorAll('.vote-pill').forEach((button) => {
      if (button.dataset.questionId !== questionId) return;
      if (button.dataset.answerId !== answerId) return;
      const voteValue = Number(button.dataset.voteAction || 0);
      if (!showMinus && voteValue === -1) {
        button.style.display = 'none';
        return;
      }
      if (voteValue === -1) {
        button.style.display = '';
      }
      const count = voteValue === 1 ? voteEntry.plusCount : voteEntry.minusCount;
      button.textContent = `${voteValue === 1 ? '+' : '-'}${count}`;
      button.classList.toggle('active', voteEntry.userVote === voteValue);
      if (!button.classList.contains('loading')) {
        button.disabled = false;
      }
    });
  }

  document.querySelectorAll('.answer-votes[data-question-id]').forEach((wrapper) => {
    if (wrapper.dataset.questionId !== questionId) return;
    wrapper.classList.toggle('disabled', !canVote);
  });
}

async function handleVoteButtonClick(deckId, question, answerId, requestedVote) {
  const voteTarget = getVoteTargetForDeck(deckId);
  if (!voteTarget || !isSupabaseConfigured()) return;
  if (!isAnswerVoteRpcReady()) {
    notifyVoteRpcUnavailable();
    disableVoteControlsInCurrentView();
    return;
  }
  const questionId = String(question?.id || '');
  const normalizedAnswerId = String(answerId || '');
  if (!questionId || !normalizedAnswerId) return;

  if (sessionMode !== 'user') {
    showNotification('Zaloguj się, aby głosować nad poprawnością odpowiedzi.', 'info');
    return;
  }

  const previousEntry = getVoteEntryForAnswer(voteTarget, questionId, normalizedAnswerId);
  const nextVote = previousEntry.userVote === requestedVote ? 0 : requestedVote;
  const optimisticEntry = { ...previousEntry };

  if (previousEntry.userVote === 1) optimisticEntry.plusCount = Math.max(0, optimisticEntry.plusCount - 1);
  if (previousEntry.userVote === -1) optimisticEntry.minusCount = Math.max(0, optimisticEntry.minusCount - 1);
  if (nextVote === 1) optimisticEntry.plusCount += 1;
  if (nextVote === -1) optimisticEntry.minusCount += 1;
  optimisticEntry.userVote = nextVote;

  setVoteEntryForAnswer(voteTarget, questionId, normalizedAnswerId, optimisticEntry);
  syncVoteButtonsForQuestion(deckId, question);
  setVoteButtonsLoading(questionId, normalizedAnswerId, true);

  try {
    await setAnswerVote({
      targetScope: voteTarget.targetScope,
      targetDeckId: voteTarget.targetDeckId,
      questionId,
      answerId: normalizedAnswerId,
      vote: nextVote,
    });
    await ensureVoteSummaryForQuestions(deckId, [questionId], { forceRefresh: true });
  } catch (error) {
    setVoteEntryForAnswer(voteTarget, questionId, normalizedAnswerId, previousEntry);
    if (!isAnswerVoteRpcReady()) {
      notifyVoteRpcUnavailable();
      disableVoteControlsInCurrentView();
    } else {
      showNotification(`Nie udało się zapisać głosu: ${error.message}`, 'error');
    }
  } finally {
    syncVoteButtonsForQuestion(deckId, question);
    setVoteButtonsLoading(questionId, normalizedAnswerId, false);
  }
}

function bindVoteButtons(deckId, questions = []) {
  if (!isSupabaseConfigured()) return;
  const voteTarget = getVoteTargetForDeck(deckId);
  if (!voteTarget) return;

  const questionMap = new Map(
    (Array.isArray(questions) ? questions : [])
      .filter((question) => question && question.id != null)
      .map((question) => [String(question.id), question])
  );

  document.querySelectorAll('.vote-pill[data-vote-action][data-question-id][data-answer-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const questionId = String(button.dataset.questionId || '');
      const answerId = String(button.dataset.answerId || '');
      const requestedVote = Number(button.dataset.voteAction || 0);
      if (!questionId || !answerId || ![1, -1].includes(requestedVote)) return;
      const question = questionMap.get(questionId);
      if (!question) return;
      await handleVoteButtonClick(deckId, question, answerId, requestedVote);
    });
  });
}

function canEditDeckContent(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) return false;
  const scope = getDeckScope(deckMeta);
  if (scope === 'public') {
    return false;
  }
  if (scope === 'subscribed') {
    return false;
  }
  if (deckMeta.isArchived === true) {
    return false;
  }
  return !isDeckReadOnlyContent(deckMeta);
}

function isCurrentDeckReadOnlyContent() {
  if (!currentDeckId) return false;
  return !canEditDeckContent(currentDeckId);
}

function migrateDeckMetadata() {
  const decks = storage.getDecks();
  if (!Array.isArray(decks) || decks.length === 0) return;

  let changed = false;
  const migrated = decks.map((deckMeta) => {
    if (deckMeta.source === 'shared-subscription' || deckMeta.scope === 'subscribed') {
      const nextDeckMeta = {
        ...deckMeta,
        scope: 'subscribed',
        source: 'shared-subscription',
        readOnlyContent: true,
      };
      const changedSubscribed =
        deckMeta.scope !== nextDeckMeta.scope
        || deckMeta.source !== nextDeckMeta.source
        || deckMeta.readOnlyContent !== nextDeckMeta.readOnlyContent;
      if (!changedSubscribed) return deckMeta;
      changed = true;
      return nextDeckMeta;
    }

    const isBuiltIn = isBuiltInDeckId(deckMeta.id);
    const explicitlyPublic = deckMeta.scope === 'public' || deckMeta.source === 'public-db';
    const isPublicDeck = isBuiltIn || explicitlyPublic || deckMeta.source === 'builtin';
    const nextScope = isPublicDeck ? 'public' : 'private';
    const nextSource = isPublicDeck
      ? (deckMeta.source || (isBuiltIn ? 'builtin' : 'public-db'))
      : (deckMeta.source === 'user-manual' ? 'user-manual' : 'user-import');
    const nextReadOnly = isPublicDeck;

    const needsUpdate =
      deckMeta.scope !== nextScope ||
      deckMeta.source !== nextSource ||
      deckMeta.readOnlyContent !== nextReadOnly;

    if (!needsUpdate) return deckMeta;
    changed = true;
    return {
      ...deckMeta,
      scope: nextScope,
      source: nextSource,
      readOnlyContent: nextReadOnly,
    };
  });

  if (changed) {
    storage.saveDecks(migrated);
  }
}

function cloneJSON(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function makeSubscribedDeckId(sharedDeckId) {
  const sanitized = String(sharedDeckId || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const base = sanitized || generateId().replace(/[^a-z0-9_-]/gi, '').toLowerCase();
  return `sub_${base}`;
}

function normalizeAppRole(role) {
  if (role === 'admin' || role === 'dev') return role;
  return 'user';
}

function canManagePublicDecks() {
  return currentUserRole === 'admin' || currentUserRole === 'dev';
}

function getPrivateDeckCount() {
  return storage.getDecks().filter((deckMeta) => getDeckScope(deckMeta) === 'private').length;
}

function canCreateMorePrivateDecks(options = {}) {
  const count = getPrivateDeckCount();
  if (count < MAX_PRIVATE_DECKS_PER_USER) return true;
  if (options.notify !== false) {
    showNotification(`Limit prywatnych talii na użytkownika to ${MAX_PRIVATE_DECKS_PER_USER}.`, 'error');
  }
  return false;
}

function canAccessAdminPanel() {
  return canManagePublicDecks();
}

function getRoleLabel(role = currentUserRole) {
  const normalized = normalizeAppRole(role);
  if (normalized === 'dev') return 'dev';
  if (normalized === 'admin') return 'admin';
  return 'user';
}

// --- Per-deck settings ---

const DEFAULT_DECK_BEHAVIOR_SETTINGS = Object.freeze({
  builtInCalculationVariants: false,
});

function getSettingsForDeck(deckId) {
  const defaults = {
    ...DEFAULT_SETTINGS,
    ...DEFAULT_DECK_BEHAVIOR_SETTINGS,
  };
  const saved = storage.getDeckSettings(deckId);
  if (saved) {
    return { ...defaults, ...saved };
  }
  // Fallback: try legacy global settings (migration)
  const legacy = storage.getSettings();
  if (legacy) {
    return { ...defaults, ...legacy };
  }
  return { ...defaults };
}

function shouldRandomizeQuestion(question, deckSettings = currentDeckSettings) {
  if (!question) return false;
  if (hasTemplate(question)) return true;
  return !!(deckSettings?.builtInCalculationVariants && hasRandomizer(question.id));
}

// --- Initialization ---

async function init() {
  initTooltips({ defaultDelay: 450, defaultPlacement: 'top' });
  bindGlobalEvents();
  bindAuthEvents();

  // Browser back button support
  history.pushState(null, '', '');
  window.addEventListener('popstate', () => {
    const activeView = document.querySelector('.view.active');
    if (!activeView || activeView.id === 'view-deck-list' || activeView.id === 'view-auth') {
      return; // allow leaving the app from the main screen
    }
    // Maintain the history buffer so next back press also works
    history.pushState(null, '', '');
    // Trigger the in-app back button for the current view
    const backBtn = activeView.querySelector('.btn-back');
    if (backBtn) {
      backBtn.click();
    }
  });

  try {
    if (!isSupabaseConfigured()) {
      await bootstrapGuestSession();
      showNotification('Tryb gościa: logowanie wyłączone (brak konfiguracji Supabase).', 'info');
      handleStartupOpen();
    } else {
      const session = await getCurrentSession();
      if (session?.user) {
        await bootstrapUserSession(session.user);
      } else {
        await bootstrapGuestSession();
      }
      handleStartupOpen();
    }
  } catch (error) {
    await bootstrapGuestSession();
    showNotification(`Błąd inicjalizacji konta: ${error.message}`, 'error');
  }

  if (!authSubscription && isSupabaseConfigured()) {
    authSubscription = onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        if (currentUser?.id !== session.user.id) {
          try {
            await bootstrapUserSession(session.user);
            handleStartupOpen();
          } catch (error) {
            await bootstrapGuestSession();
            showNotification(`Błąd synchronizacji danych: ${error.message}`, 'error');
          }
        }
        return;
      }
      if (sessionMode === 'user') {
        await bootstrapGuestSession();
        showNotification('Wylogowano.', 'info');
      }
    });
  }
}

function handleStartupOpen() {
  const params = new URLSearchParams(window.location.search);
  const open = params.get('open');
  if (!open) return;

  if (open === 'app-settings') {
    navigateToAppSettings();
  } else if (open === 'docs') {
    navigateToDocs();
  } else if (open === 'import') {
    triggerPrivateImport();
  }

  const url = new URL(window.location.href);
  url.searchParams.delete('open');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function triggerPrivateImport() {
  if (!isSessionReady()) {
    showAuthPanel('Zaloguj się lub kontynuuj jako gość.', 'info');
    return;
  }
  if (sessionMode !== 'user') {
    showNotification('Import prywatnych talii wymaga zalogowania.', 'info');
    showAuthPanel('Aby importować własne talie, zaloguj się.', 'info');
    return;
  }
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.click();
}

function applyFontScale() {
  document.documentElement.style.setProperty('--font-scale', fontScale);
}

function loadUserPreferences() {
  const savedApp = storage.getAppSettings();
  if (savedApp) {
    appSettings = {
      ...DEFAULT_APP_SETTINGS,
      ...savedApp,
      keybindings: { ...DEFAULT_APP_SETTINGS.keybindings, ...(savedApp.keybindings || {}) },
    };
  } else {
    appSettings = {
      ...DEFAULT_APP_SETTINGS,
      keybindings: { ...DEFAULT_APP_SETTINGS.keybindings },
    };
  }
  const normalizedLayoutWidth = normalizeLayoutWidth(appSettings.layoutWidth);
  if (normalizedLayoutWidth !== appSettings.layoutWidth) {
    appSettings.layoutWidth = normalizedLayoutWidth;
    storage.saveAppSettings(appSettings);
  } else {
    appSettings.layoutWidth = normalizedLayoutWidth;
  }

  applyTheme(appSettings.theme);
  applyColorTheme(appSettings.colorTheme);
  applyLayoutWidth(appSettings.layoutWidth);

  const savedFont = storage.getFontScale();
  if (typeof savedFont === 'number' && savedFont > 0) {
    fontScale = savedFont;
  } else {
    fontScale = DEFAULT_FONT_SCALE;
  }
  applyFontScale();
}

function changeFontSize(delta) {
  const newScale = Math.round((fontScale + delta * FONT_SCALE_STEP) * 1000) / 1000;
  if (newScale <= 0) return;
  fontScale = newScale;
  applyFontScale();
  storage.saveFontScale(fontScale);
}

function isSessionReady() {
  return sessionMode === 'user' || sessionMode === 'guest';
}

function updateHeaderSessionState(mode, profile = {}) {
  const actions = document.getElementById('header-app-actions');
  const avatarEl = document.getElementById('auth-user-avatar');
  const menuEmailEl = document.getElementById('auth-menu-email');
  const menuRoleEl = document.getElementById('auth-menu-role');
  const authActionBtn = document.getElementById('btn-auth-logout');
  const openUserViewBtn = document.getElementById('btn-open-user-view');
  const openAdminViewBtn = document.getElementById('btn-open-admin-view');
  const userMenuBtn = document.getElementById('btn-user-menu');

  const email = String(profile.email || '');
  const username = String(profile.username || '');
  const displayName = username ? `@${username}` : (email || 'Zalogowany użytkownik');

  const avatarChar = (() => {
    if (mode === 'user' && username) return username[0].toUpperCase();
    if (mode === 'user' && email) return email[0].toUpperCase();
    if (mode === 'guest') return 'G';
    return '?';
  })();

  if (avatarEl) avatarEl.textContent = avatarChar;
  if (menuEmailEl) {
    menuEmailEl.textContent = mode === 'user'
      ? displayName
      : (mode === 'guest' ? 'Tryb gościa' : 'Niezalogowany');
  }
  if (menuRoleEl) {
    menuRoleEl.textContent = mode === 'user' ? getRoleLabel() : 'gość';
  }
  if (userMenuBtn) {
    userMenuBtn.style.display = '';
  }

  if (mode === 'user') {
    if (actions) actions.style.display = 'flex';
    if (authActionBtn) {
      authActionBtn.style.display = '';
      authActionBtn.textContent = 'Wyloguj';
    }
    if (openUserViewBtn) openUserViewBtn.style.display = '';
    if (openAdminViewBtn) openAdminViewBtn.style.display = canAccessAdminPanel() ? '' : 'none';
    return;
  }

  if (mode === 'guest') {
    if (actions) actions.style.display = 'flex';
    if (authActionBtn) {
      authActionBtn.style.display = '';
      authActionBtn.textContent = 'Zaloguj';
    }
    if (openUserViewBtn) openUserViewBtn.style.display = 'none';
    if (openAdminViewBtn) openAdminViewBtn.style.display = 'none';
    return;
  }

  if (actions) actions.style.display = 'none';
  if (authActionBtn) authActionBtn.style.display = 'none';
  if (openUserViewBtn) openUserViewBtn.style.display = 'none';
  if (openAdminViewBtn) openAdminViewBtn.style.display = 'none';
}

function openUserMenu() {
  const menu = document.getElementById('user-menu');
  const trigger = document.getElementById('btn-user-menu');
  if (!menu || !trigger) return;
  userMenuOpen = true;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  const trigger = document.getElementById('btn-user-menu');
  if (!menu || !trigger) return;
  userMenuOpen = false;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

function toggleUserMenu() {
  if (userMenuOpen) {
    closeUserMenu();
  } else {
    openUserMenu();
  }
}

function showAuthMessage(message = '', type = 'info') {
  const el = document.getElementById('auth-message');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`;
}

function setAuthMode(mode = 'login', options = {}) {
  const keepMessage = options.keepMessage === true;
  authMode = mode === 'signup' || mode === 'reset' ? mode : 'login';
  const config = AUTH_VIEW_CONFIG[authMode];

  const titleEl = document.getElementById('auth-title');
  const subtitleEl = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('btn-auth-submit');
  const loginModeBtn = document.getElementById('btn-auth-mode-login');
  const signupModeBtn = document.getElementById('btn-auth-mode-signup');
  const passwordField = document.getElementById('auth-password-field');
  const passwordInput = document.getElementById('auth-password');
  const passwordConfirmField = document.getElementById('auth-password-confirm-field');
  const passwordConfirmInput = document.getElementById('auth-password-confirm');
  const resetPasswordBtn = document.getElementById('btn-auth-reset-password');

  if (titleEl) titleEl.textContent = config.title;
  if (subtitleEl) subtitleEl.textContent = config.subtitle;
  if (submitBtn) submitBtn.textContent = config.submitLabel;

  if (loginModeBtn) {
    loginModeBtn.classList.toggle('active', authMode === 'login');
    loginModeBtn.setAttribute('aria-pressed', authMode === 'login' ? 'true' : 'false');
  }
  if (signupModeBtn) {
    signupModeBtn.classList.toggle('active', authMode === 'signup');
    signupModeBtn.setAttribute('aria-pressed', authMode === 'signup' ? 'true' : 'false');
  }

  if (passwordInput) {
    if (authMode === 'signup') {
      passwordInput.autocomplete = 'new-password';
    } else {
      passwordInput.autocomplete = 'current-password';
    }

    const isReset = authMode === 'reset';
    passwordInput.required = !isReset;
    passwordInput.disabled = isReset;
    if (isReset) passwordInput.value = '';
  }
  if (passwordField) {
    passwordField.hidden = authMode === 'reset';
  }
  if (passwordConfirmField) {
    passwordConfirmField.hidden = authMode !== 'signup';
  }
  if (passwordConfirmInput) {
    const isSignup = authMode === 'signup';
    passwordConfirmInput.required = isSignup;
    passwordConfirmInput.disabled = !isSignup;
    if (!isSignup) passwordConfirmInput.value = '';
  }
  if (resetPasswordBtn) {
    resetPasswordBtn.hidden = authMode === 'signup';
    resetPasswordBtn.textContent = config.resetLinkLabel || 'Nie pamiętam hasła';
  }

  if (!keepMessage) {
    showAuthMessage('', 'info');
  }
}

function showAuthPanel(message = '', type = 'info', mode = 'login') {
  closeUserMenu();
  showView('auth');
  setAuthMode(mode, { keepMessage: true });
  showAuthMessage(message, type);
}

function shouldSyncSharedDeck(deckId) {
  if (sessionMode !== 'user' || !currentUser) return false;
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) return false;
  return getDeckScope(deckMeta) === 'private' && deckMeta.isShared === true;
}

function buildSharedDeckPayload(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta || !currentUser) return null;
  if (getDeckScope(deckMeta) !== 'private') return null;
  const questions = storage.getQuestions(deckId);
  return {
    id: deckMeta.sharedDeckId || `shared_${generateId().replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`,
    owner_user_id: currentUser.id,
    owner_username: currentUserProfile?.username || 'unknown',
    source_deck_id: deckMeta.id,
    name: deckMeta.name || deckMeta.id,
    description: deckMeta.description || '',
    deck_group: normalizeDeckGroup(deckMeta.group) || null,
    categories: Array.isArray(deckMeta.categories) ? deckMeta.categories : null,
    questions,
    question_count: questions.length,
    is_published: true,
  };
}

async function pushSharedDeckToSupabase(deckId) {
  const payload = buildSharedDeckPayload(deckId);
  if (!payload) return;
  const row = await publishSharedDeck(payload);
  const decks = storage.getDecks();
  const idx = decks.findIndex((d) => d.id === deckId);
  if (idx < 0) return;
  decks[idx] = {
    ...decks[idx],
    isShared: true,
    sharedDeckId: row.id,
  };
  storage.saveDecks(decks);
}

function syncSharedDeckToSupabaseAsync(deckId) {
  if (!shouldSyncSharedDeck(deckId)) return;
  pushSharedDeckToSupabase(deckId).catch((error) => {
    showNotification(`Nie udało się zsynchronizować udostępnionej talii: ${error.message}`, 'error');
  });
}

function syncOwnedDeckToSupabaseAsync(deckId) {
  syncSharedDeckToSupabaseAsync(deckId);
}

function mergeCardsForQuestions(deckId, questions) {
  const existingCards = storage.getCards(deckId);
  const cardMap = new Map(existingCards.map((card) => [card.questionId, card]));
  const nextCards = questions.map((q) => {
    const existingCard = cardMap.get(q.id);
    if (!existingCard) return createCard(q.id, deckId);
    if (existingCard.deckId === deckId) return existingCard;
    return { ...existingCard, deckId };
  });
  storage.saveCards(deckId, nextCards);
}

function applyDeckDefaultSelectionModeToQuestions(questions = [], deckDefaultSelectionMode = null) {
  const normalizedDefaultMode = normalizeSelectionMode(deckDefaultSelectionMode, null);
  if (!normalizedDefaultMode || !Array.isArray(questions)) {
    return Array.isArray(questions) ? questions : [];
  }

  let changed = false;
  const normalizedQuestions = questions.map((question) => {
    if (!question || typeof question !== 'object') return question;
    const answers = Array.isArray(question.answers) ? question.answers : [];
    if (answers.length < 2) return question;

    const questionMode = normalizeSelectionMode(question.selectionMode, null);
    if (questionMode) return question;

    changed = true;
    return {
      ...question,
      selectionMode: normalizedDefaultMode,
    };
  });

  return changed ? normalizedQuestions : questions;
}

function inferDeckDefaultSelectionModeFromQuestions(questions = []) {
  if (!Array.isArray(questions)) return null;

  let inferredMode = null;
  for (const question of questions) {
    const answers = Array.isArray(question?.answers) ? question.answers : [];
    if (answers.length < 2) continue;

    const questionMode = normalizeSelectionMode(question?.selectionMode, null);
    if (!questionMode) return null;

    if (!inferredMode) {
      inferredMode = questionMode;
      continue;
    }

    if (inferredMode !== questionMode) {
      return null;
    }
  }

  return inferredMode;
}

function applyPublicDeckRowsToLocal(rows = [], options = {}) {
  const includeHidden = options.includeHidden === true;
  const activePublicRows = rows.filter((row) => row && (row.is_archived !== true || includeHidden));
  const currentDecks = storage.getDecks();
  const privateDecks = currentDecks.filter((d) => getDeckScope(d) !== 'public');
  const publicDecks = [];

  for (const row of activePublicRows) {
    const questions = Array.isArray(row.questions) ? row.questions : [];
    const categories = Array.isArray(row.categories) ? row.categories : null;
    const deckMeta = {
      id: row.id,
      name: row.name || row.id,
      description: row.description || '',
      questionCount: Number.isFinite(row.question_count) ? row.question_count : questions.length,
      importedAt: Date.now(),
      version: Number(row.version) || 1,
      scope: 'public',
      source: row.source || 'public-db',
      readOnlyContent: true,
      adminOnly: row.is_archived === true,
    };
    const deckGroup = normalizeDeckGroup(row.deck_group);
    if (deckGroup) deckMeta.group = deckGroup;
    if (categories) deckMeta.categories = categories;
    const inferredDefaultMode = inferDeckDefaultSelectionModeFromQuestions(questions);
    if (inferredDefaultMode) deckMeta.defaultSelectionMode = inferredDefaultMode;

    publicDecks.push(deckMeta);
    storage.saveQuestions(deckMeta.id, questions);
    mergeCardsForQuestions(deckMeta.id, questions);
  }

  storage.saveDecks([...publicDecks, ...privateDecks]);
}

function normalizeManifestDeckEntry(entry = null) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  const file = String(entry.file || '').trim();
  if (!id || !file) return null;

  const normalized = {
    id,
    file,
    name: String(entry.name || id),
    description: String(entry.description || ''),
    questionCount: Number.isFinite(entry.questionCount) ? Math.max(0, Math.floor(entry.questionCount)) : 0,
    version: Number(entry.version) || 1,
  };
  const group = normalizeDeckGroup(entry.group);
  if (group) normalized.group = group;
  if (Array.isArray(entry.categories)) normalized.categories = entry.categories;
  const defaultSelectionMode = normalizeSelectionMode(entry.defaultSelectionMode, null);
  if (defaultSelectionMode) normalized.defaultSelectionMode = defaultSelectionMode;
  return normalized;
}

async function loadPublicDeckManifest(options = {}) {
  const force = options.force === true;
  if (!force && publicDeckManifest.length > 0) return publicDeckManifest;

  const response = await fetch(PUBLIC_DECK_MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Manifest publicznych talii: HTTP ${response.status}`);
  }
  const raw = await response.json();
  const rawDecks = Array.isArray(raw?.decks) ? raw.decks : [];
  const nextManifest = rawDecks
    .map((entry) => normalizeManifestDeckEntry(entry))
    .filter((entry) => entry !== null);

  if (nextManifest.length === 0) {
    throw new Error('Manifest publicznych talii jest pusty lub nieprawidłowy.');
  }

  publicDeckManifest = nextManifest;
  publicDeckManifestById = new Map(nextManifest.map((entry) => [entry.id, entry]));
  refreshKnownPublicDeckIds(nextManifest);
  return publicDeckManifest;
}

function getPublicDeckManifestEntry(deckId) {
  const id = String(deckId || '').trim();
  if (!id) return null;
  return publicDeckManifestById.get(id) || null;
}

function setPublicDeckCardLoadingState(deckId, isLoading) {
  const id = String(deckId || '').trim();
  if (!id) return;
  document.querySelectorAll('.deck-card[data-deck-id]').forEach((cardEl) => {
    if (String(cardEl.dataset.deckId || '').trim() !== id) return;
    cardEl.classList.toggle('is-loading', isLoading);
    if (isLoading) {
      cardEl.setAttribute('aria-busy', 'true');
    } else {
      cardEl.removeAttribute('aria-busy');
    }
  });
}

function markPublicDeckLoadingStart(deckId) {
  const id = String(deckId || '').trim();
  if (!id) return;
  const nextCount = (publicDeckLoadStateById.get(id) || 0) + 1;
  publicDeckLoadStateById.set(id, nextCount);
  if (nextCount === 1) {
    setPublicDeckCardLoadingState(id, true);
  }
}

function markPublicDeckLoadingDone(deckId) {
  const id = String(deckId || '').trim();
  if (!id) return;
  const currentCount = publicDeckLoadStateById.get(id) || 0;
  const nextCount = currentCount - 1;
  if (nextCount > 0) {
    publicDeckLoadStateById.set(id, nextCount);
    return;
  }
  publicDeckLoadStateById.delete(id);
  setPublicDeckCardLoadingState(id, false);
}

async function fetchPublicDeckVisibilityMap() {
  if (!isSupabaseConfigured()) {
    return new Map();
  }
  const rows = await fetchPublicDeckVisibility();
  const map = new Map();
  for (const row of rows) {
    const deckId = String(row?.deck_id || '').trim();
    if (!deckId) continue;
    map.set(deckId, {
      isHidden: row.is_hidden === true,
      updatedAt: row.updated_at || null,
      updatedBy: row.updated_by || null,
    });
  }
  return map;
}

function applyPublicDeckManifestToLocal(manifestDecks = [], visibilityMap = new Map(), options = {}) {
  const includeHidden = options.includeHidden === true;
  const currentDecks = storage.getDecks();
  const privateDecks = currentDecks.filter((deckMeta) => getDeckScope(deckMeta) !== 'public');
  const currentPublicDecks = currentDecks.filter((deckMeta) => getDeckScope(deckMeta) === 'public');
  const existingPublicById = new Map(currentPublicDecks.map((deckMeta) => [deckMeta.id, deckMeta]));

  const nextPublicDecks = [];
  const manifestIdSet = new Set();
  for (const entry of manifestDecks) {
    manifestIdSet.add(entry.id);
    const visibility = visibilityMap.get(entry.id);
    const hidden = visibility?.isHidden === true;
    if (hidden && !includeHidden) continue;

    const existing = existingPublicById.get(entry.id);
    const deckMeta = {
      id: entry.id,
      name: entry.name || entry.id,
      description: entry.description || '',
      questionCount: Number.isFinite(entry.questionCount) ? entry.questionCount : 0,
      importedAt: existing?.importedAt || Date.now(),
      version: Number(entry.version) || 1,
      scope: 'public',
      source: 'builtin-manifest',
      readOnlyContent: true,
      adminOnly: hidden,
    };
    if (entry.group) deckMeta.group = entry.group;
    if (Array.isArray(entry.categories)) deckMeta.categories = entry.categories;
    if (entry.defaultSelectionMode) deckMeta.defaultSelectionMode = entry.defaultSelectionMode;
    nextPublicDecks.push(deckMeta);
  }

  for (const deckMeta of currentPublicDecks) {
    if (!manifestIdSet.has(deckMeta.id)) {
      storage.clearDeckData(deckMeta.id);
    }
  }

  storage.saveDecks([...nextPublicDecks, ...privateDecks]);
}

async function ensurePublicDeckLoaded(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta || getDeckScope(deckMeta) !== 'public') return true;
  markPublicDeckLoadingStart(deckId);
  try {
    const existingQuestions = storage.peekQuestions(deckId);
    let manifestEntry = getPublicDeckManifestEntry(deckId);
    if (existingQuestions.length > 0) {
      if (!manifestEntry) {
        try {
          if (publicDeckManifestById.size === 0) {
            await loadPublicDeckManifest();
          }
          manifestEntry = getPublicDeckManifestEntry(deckId);
        } catch {
          // Manifest może być chwilowo niedostępny. Jeśli dane są już lokalnie, pozwalamy wejść do talii.
        }
      }
      const defaultMode = normalizeSelectionMode(
        deckMeta.defaultSelectionMode,
        manifestEntry?.defaultSelectionMode || null
      );
      const normalizedExistingQuestions = applyDeckDefaultSelectionModeToQuestions(existingQuestions, defaultMode);
      if (normalizedExistingQuestions !== existingQuestions) {
        storage.saveQuestions(deckId, normalizedExistingQuestions);
        mergeCardsForQuestions(deckId, normalizedExistingQuestions);
      } else if (storage.peekCards(deckId).length === 0) {
        mergeCardsForQuestions(deckId, existingQuestions);
      }
      return true;
    }

    if (!manifestEntry) {
      if (publicDeckManifestById.size === 0) {
        await loadPublicDeckManifest();
      }
      manifestEntry = getPublicDeckManifestEntry(deckId);
    }
    if (!manifestEntry) {
      throw new Error(`Brak talii "${deckId}" w manifeście.`);
    }

    const response = await fetch(manifestEntry.file, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Nie udało się pobrać talii ${deckId} (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) {
      throw new Error(`Nieprawidłowy format danych talii ${deckId}.`);
    }
    const deckDefaultSelectionMode = normalizeSelectionMode(
      data.deck?.defaultSelectionMode,
      manifestEntry.defaultSelectionMode || null
    );
    const normalizedQuestions = applyDeckDefaultSelectionModeToQuestions(
      data.questions,
      deckDefaultSelectionMode
    );
    storage.saveQuestions(deckId, normalizedQuestions);
    mergeCardsForQuestions(deckId, normalizedQuestions);

    const decks = storage.getDecks();
    const idx = decks.findIndex((d) => d.id === deckId);
    if (idx >= 0) {
      const nextMeta = {
        ...decks[idx],
        questionCount: normalizedQuestions.length,
        version: Number(data.deck?.version) || Number(manifestEntry.version) || 1,
      };
      if (deckDefaultSelectionMode) {
        nextMeta.defaultSelectionMode = deckDefaultSelectionMode;
      }
      decks[idx] = nextMeta;
      storage.saveDecks(decks);
    }
    return true;
  } finally {
    markPublicDeckLoadingDone(deckId);
  }
}

function filterBuiltInPublicRows(rows = []) {
  return rows.filter((row) => row && isBuiltInDeckId(row.id));
}

async function syncPublicDecksFromSupabaseLegacy(options = {}) {
  if (!isSupabaseConfigured()) {
    await loadBuiltInDecks();
    return;
  }
  const fallbackToBuiltInsOnError = options.fallbackToBuiltInsOnError !== false;
  try {
    const includeHidden = canManagePublicDecks();
    const rows = filterBuiltInPublicRows(await fetchPublicDecks({ includeArchived: includeHidden }));
    if (rows.length === 0) {
      await loadBuiltInDecks();
      return;
    }
    applyPublicDeckRowsToLocal(rows, { includeHidden });
    migrateDeckMetadata();
  } catch (error) {
    showNotification(`Nie udało się wczytać talii ogólnych z Supabase: ${error.message}`, 'error');
    if (fallbackToBuiltInsOnError) {
      await loadBuiltInDecks();
    }
  }
}

async function syncPublicDecksFromManifest(options = {}) {
  const includeHidden = canManagePublicDecks();
  const forceManifestReload = options.forceManifestReload === true;
  const manifestDecks = await loadPublicDeckManifest({ force: forceManifestReload });
  let visibilityMap = new Map();
  try {
    visibilityMap = await fetchPublicDeckVisibilityMap();
    publicDeckVisibilityErrorNotified = false;
  } catch (error) {
    if (!publicDeckVisibilityErrorNotified) {
      showNotification(`Nie udało się pobrać widoczności talii ogólnych: ${error.message}`, 'error');
      publicDeckVisibilityErrorNotified = true;
    }
  }
  applyPublicDeckManifestToLocal(manifestDecks, visibilityMap, { includeHidden });
  migrateDeckMetadata();
}

async function syncPublicDecksForCurrentUser(options = {}) {
  const provider = options.providerOverride === 'supabase' || options.providerOverride === 'static'
    ? options.providerOverride
    : PUBLIC_DECK_PROVIDER;
  const allowFallback = options.allowFallback !== false;

  if (provider === 'supabase') {
    await syncPublicDecksFromSupabaseLegacy({
      ...options,
      fallbackToBuiltInsOnError: allowFallback,
    });
    return;
  }

  try {
    await syncPublicDecksFromManifest(options);
  } catch (error) {
    showNotification(`Nie udało się wczytać manifestu talii ogólnych: ${error.message}`, 'error');
    if (allowFallback) {
      await syncPublicDecksFromSupabaseLegacy({ ...options, fallbackToBuiltInsOnError: true });
    }
  }
}

function getUniqueSubscribedDeckId(sharedDeckId, takenIds) {
  const taken = takenIds || new Set(storage.getDecks().map((d) => String(d.id || '').toLowerCase()));
  const base = makeSubscribedDeckId(sharedDeckId);
  if (!taken.has(base.toLowerCase())) {
    taken.add(base.toLowerCase());
    return base;
  }
  let index = 2;
  while (taken.has(`${base}-${index}`.toLowerCase())) {
    index++;
  }
  const candidate = `${base}-${index}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function updateLocalDeckMeta(deckId, updater) {
  const decks = storage.getDecks();
  const idx = decks.findIndex((d) => d.id === deckId);
  if (idx < 0) return false;
  decks[idx] = updater(decks[idx]);
  storage.saveDecks(decks);
  return true;
}

async function deletePrivateDeck(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) return false;
  if (getDeckScope(deckMeta) !== 'private') return false;

  const isShared = deckMeta.isShared === true;
  const sharedDeckId = String(deckMeta.sharedDeckId || '').trim();
  if (isShared && sharedDeckId) {
    await unpublishSharedDeck(sharedDeckId);
  }

  const decks = storage.getDecks();
  const idx = decks.findIndex((d) => d.id === deckId);
  if (idx < 0) return false;
  decks.splice(idx, 1);
  storage.saveDecks(decks);
  storage.clearDeckData(deckId);

  if (currentDeckId === deckId) {
    currentDeckId = null;
    currentCategory = null;
    currentSessionCategory = null;
  }

  return true;
}

function getSharedRowFromSubscription(subRow) {
  if (!subRow || typeof subRow !== 'object') return null;
  if (subRow.shared_decks && typeof subRow.shared_decks === 'object' && !Array.isArray(subRow.shared_decks)) {
    return subRow.shared_decks;
  }
  if (Array.isArray(subRow.shared_decks)) {
    return subRow.shared_decks[0] || null;
  }
  return null;
}

async function syncSubscribedDecksForCurrentUser() {
  if (!isSupabaseConfigured() || sessionMode !== 'user') return;
  let subscriptions = [];
  try {
    subscriptions = await fetchMySubscriptions();
  } catch (error) {
    showNotification(`Nie udało się zsynchronizować subskrypcji: ${error.message}`, 'error');
    return;
  }

  const decks = storage.getDecks();
  const subscribedDecks = decks.filter((deckMeta) => getDeckScope(deckMeta) === 'subscribed');
  const nonSubscribedDecks = decks.filter((deckMeta) => getDeckScope(deckMeta) !== 'subscribed');
  const existingBySharedDeckId = new Map(
    subscribedDecks
      .filter((deckMeta) => typeof deckMeta.sharedDeckId === 'string' && deckMeta.sharedDeckId.length > 0)
      .map((deckMeta) => [deckMeta.sharedDeckId, deckMeta])
  );
  const takenIds = new Set(decks.map((deckMeta) => String(deckMeta.id || '').toLowerCase()));
  const nextSubscribedDecks = [];
  const subscriptionIds = new Set();

  for (const subRow of subscriptions) {
    const sharedDeckId = String(subRow?.shared_deck_id || '').trim();
    if (!sharedDeckId) continue;
    subscriptionIds.add(sharedDeckId);
    const sharedRow = getSharedRowFromSubscription(subRow);
    const existingMeta = existingBySharedDeckId.get(sharedDeckId) || null;
    const localDeckId = existingMeta?.id || getUniqueSubscribedDeckId(sharedDeckId, takenIds);

    if (sharedRow && sharedRow.is_published !== false) {
      const questions = Array.isArray(sharedRow.questions) ? sharedRow.questions : [];
      const categories = Array.isArray(sharedRow.categories) ? sharedRow.categories : null;
      storage.saveQuestions(localDeckId, questions);
      mergeCardsForQuestions(localDeckId, questions);
      const nextMeta = {
        ...(existingMeta || {}),
        id: localDeckId,
        name: sharedRow.name || existingMeta?.name || sharedDeckId,
        description: sharedRow.description || '',
        questionCount: Number.isFinite(sharedRow.question_count) ? sharedRow.question_count : questions.length,
        importedAt: Date.now(),
        scope: 'subscribed',
        source: 'shared-subscription',
        readOnlyContent: true,
        sharedDeckId,
        ownerUserId: sharedRow.owner_user_id || existingMeta?.ownerUserId || null,
        ownerUsername: sharedRow.owner_username || existingMeta?.ownerUsername || '',
        subscriptionStatus: 'active',
      };
      const deckGroup = normalizeDeckGroup(sharedRow.deck_group);
      if (deckGroup) {
        nextMeta.group = deckGroup;
      } else {
        delete nextMeta.group;
      }
      if (categories) {
        nextMeta.categories = categories;
      } else {
        delete nextMeta.categories;
      }
      nextSubscribedDecks.push(nextMeta);
      continue;
    }

    const localQuestionCount = storage.getQuestions(localDeckId).length;
    const unavailableMeta = {
      ...(existingMeta || {}),
      id: localDeckId,
      name: existingMeta?.name || `Subskrybowana talia (${sharedDeckId})`,
      description: existingMeta?.description || '',
      questionCount: localQuestionCount,
      importedAt: existingMeta?.importedAt || Date.now(),
      scope: 'subscribed',
      source: 'shared-subscription',
      readOnlyContent: true,
      sharedDeckId,
      ownerUserId: existingMeta?.ownerUserId || null,
      ownerUsername: existingMeta?.ownerUsername || '',
      subscriptionStatus: 'unavailable',
    };
    nextSubscribedDecks.push(unavailableMeta);
  }

  for (const existingDeck of subscribedDecks) {
    const sharedDeckId = String(existingDeck.sharedDeckId || '');
    if (!sharedDeckId || subscriptionIds.has(sharedDeckId)) continue;
    storage.clearDeckData(existingDeck.id);
  }

  mySubscriptionDeckIds = subscriptionIds;
  storage.saveDecks([...nonSubscribedDecks, ...nextSubscribedDecks]);
  migrateDeckMetadata();
}

async function refreshSharedCatalog() {
  if (!isSupabaseConfigured()) {
    sharedCatalogState = {
      ...sharedCatalogState,
      total: 0,
      items: [],
    };
    return;
  }
  const page = Math.max(1, Number(sharedCatalogState.page) || 1);
  try {
    const result = await searchSharedDecks({
      query: sharedCatalogState.query,
      page,
      pageSize: sharedCatalogState.pageSize,
    });
    sharedCatalogState = {
      ...sharedCatalogState,
      page: result.page || page,
      total: Number.isFinite(result.total) ? result.total : 0,
      items: Array.isArray(result.items) ? result.items : [],
    };
  } catch (error) {
    showNotification(`Nie udało się wczytać katalogu udostępnionych talii: ${error.message}`, 'error');
    sharedCatalogState = {
      ...sharedCatalogState,
      total: 0,
      items: [],
    };
  }
}

async function bootstrapGuestSession() {
  clearWaitTimer();
  resetVoteSummaryCache();
  sessionMode = 'guest';
  currentUser = null;
  currentUserProfile = null;
  currentUserRole = 'user';
  mySubscriptionDeckIds = new Set();
  activeDeckScope = 'public';
  await storage.initGuest();
  migrateDeckMetadata();
  loadUserPreferences();
  updateHeaderSessionState('guest');
  closeUserMenu();
  navigateToDeckList();
}

async function bootstrapUserSession(user) {
  resetVoteSummaryCache();
  sessionMode = 'user';
  currentUser = user;
  currentUserProfile = null;
  currentUserRole = 'user';
  activeDeckScope = 'public';
  await storage.initForUser(user.id);
  try {
    const [role, profile] = await Promise.all([
      fetchCurrentUserRole(),
      fetchMyProfile(),
    ]);
    currentUserRole = normalizeAppRole(role);
    currentUserProfile = profile || null;
  } catch (error) {
    currentUserRole = 'user';
    showNotification(`Nie udało się pobrać danych konta: ${error.message}`, 'error');
  }
  migrateDeckMetadata();
  loadUserPreferences();
  updateHeaderSessionState('user', {
    email: user.email || '',
    username: currentUserProfile?.username || '',
  });
  closeUserMenu();
  navigateToDeckList();
  syncSubscribedDecksForCurrentUser().catch(() => {});
}

let mediaQueryCleanup = null;

function applyTheme(theme) {
  // Clean up previous media query listener
  if (mediaQueryCleanup) {
    mediaQueryCleanup();
    mediaQueryCleanup = null;
  }

  if (theme === 'auto') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    };
    apply();
    mq.addEventListener('change', apply);
    mediaQueryCleanup = () => mq.removeEventListener('change', apply);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function applyColorTheme(colorTheme) {
  document.documentElement.setAttribute('data-color-theme', colorTheme || 'academic-noir');
}

function applyLayoutWidth(width) {
  document.documentElement.style.setProperty('--app-max-width', width || '65%');
}

function handleKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const activeView = document.querySelector('.view.active');
  if (!activeView) return;

  // Study mode shortcuts
  if (activeView.id === 'view-study' && studyPhase) {
    // Flag shortcut works in both question and feedback phases
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      handleFlagToggle();
      return;
    }
    const kb = appSettings.keybindings;
    if (studyPhase === 'question') {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const options = document.querySelectorAll('#answers-list .answer-option');
        if (num <= options.length) options[num - 1].click();
        return;
      }
      if (kb.showAnswer.includes(e.key)) {
        e.preventDefault();
        showFeedback();
        return;
      }
    } else if (studyPhase === 'feedback') {
      if (kb.again.includes(e.key)) { e.preventDefault(); handleRating(1); return; }
      if (kb.hard.includes(e.key)) { e.preventDefault(); handleRating(2); return; }
      if (kb.good.includes(e.key)) { e.preventDefault(); handleRating(3); return; }
      if (kb.easy.includes(e.key)) { e.preventDefault(); handleRating(4); return; }
      if (kb.showAnswer.includes(e.key)) { e.preventDefault(); handleRating(3); return; }
    }
  }

  // Test mode shortcuts
  if (activeView.id === 'view-test') {
    const nextBtn = document.getElementById('btn-test-next');
    if (nextBtn) {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const options = document.querySelectorAll('#test-answers-list .answer-option');
        if (num <= options.length) options[num - 1].click();
        return;
      }
      if ((e.key === ' ' || e.key === 'Enter') && !nextBtn.disabled) {
        e.preventDefault();
        nextBtn.click();
        return;
      }
    }
  }
}

async function loadBuiltInDecks() {
  if (!isSessionReady()) return;
  pruneNonBuiltInPublicDecks();
  for (const builtIn of BUILT_IN_DECK_SOURCES) {
    try {
      await importBuiltIn(builtIn.file, {
        scope: 'public',
        source: 'builtin',
        readOnlyContent: true,
      });
    } catch {
      // Built-in file not available — that's ok
    }
  }
  migrateDeckMetadata();
}

function pruneNonBuiltInPublicDecks() {
  const decks = storage.getDecks();
  if (!Array.isArray(decks) || decks.length === 0) return;

  let changed = false;
  const nextDecks = [];

  for (const deckMeta of decks) {
    if (getDeckScope(deckMeta) !== 'public') {
      nextDecks.push(deckMeta);
      continue;
    }
    if (isBuiltInDeckId(deckMeta.id)) {
      nextDecks.push(deckMeta);
      continue;
    }

    // Remove stale public decks that are no longer part of built-in sources.
    changed = true;
    storage.clearDeckData(deckMeta.id);
  }

  if (changed) {
    storage.saveDecks(nextDecks);
  }
}

// --- Navigation ---

function navigateToDeckList(scope = activeDeckScope, options = {}) {
  const skipSubscribedSync = options.skipSubscribedSync === true;
  const skipSharedRefresh = options.skipSharedRefresh === true;
  const skipPublicSync = options.skipPublicSync === true;

  if (scope === 'public' || scope === 'private' || scope === 'shared') {
    if (scope !== activeDeckScope && scope === 'private') {
      showPrivateArchived = false;
    }
    activeDeckScope = scope;
  }

  if (!isSessionReady()) {
    showView('auth');
    return;
  }
  clearWaitTimer();
  studyPhase = null;
  studyingFlagged = false;
  currentDeckId = null;
  currentCategory = null;
  currentSessionCategory = null;
  queues = null;
  currentCard = null;
  closeUserMenu();
  showView('deck-list');

  if (activeDeckScope === 'shared') {
    if (!skipSharedRefresh) {
      refreshSharedCatalog().then(() => {
        const deckListView = document.getElementById('view-deck-list');
        if (activeDeckScope === 'shared' && deckListView?.classList.contains('active')) {
          navigateToDeckList('shared', { skipSharedRefresh: true });
        }
      });
    }
    renderSharedDeckCatalog(sharedCatalogState, {
      sessionMode,
      deckListMode: appSettings.deckListMode,
      subscribedDeckIds: [...mySubscriptionDeckIds],
      currentUserId: currentUser?.id || '',
    });
    bindDeckListEvents();
    return;
  }

  if (activeDeckScope === 'public' && !skipPublicSync) {
    syncPublicDecksForCurrentUser({ allowFallback: true })
      .catch(() => {})
      .finally(() => {
        const deckListView = document.getElementById('view-deck-list');
        if (activeDeckScope === 'public' && deckListView?.classList.contains('active')) {
          navigateToDeckList('public', { skipPublicSync: true });
        }
      });
  }

  if (activeDeckScope === 'private' && sessionMode === 'user' && !skipSubscribedSync) {
    syncSubscribedDecksForCurrentUser().then(() => {
      const deckListView = document.getElementById('view-deck-list');
      if (activeDeckScope === 'private' && deckListView?.classList.contains('active')) {
        navigateToDeckList('private', { skipSubscribedSync: true });
      }
    });
  }

  const allDecks = storage.getDecks();
  const allPrivateDecks = allDecks.filter((d) => getDeckScope(d) === 'private');
  const hasArchivedPrivate = allPrivateDecks.some((d) => d.isArchived === true);
  const decks = allDecks.filter((d) => {
    const scopeValue = getDeckScope(d);
    if (activeDeckScope === 'private') {
      if (scopeValue === 'subscribed') return true;
      if (scopeValue !== 'private') return false;
      return showPrivateArchived ? d.isArchived === true : d.isArchived !== true;
    }
    return scopeValue === activeDeckScope;
  });
  const showPrivateLocked = activeDeckScope === 'private' && sessionMode === 'guest';
  const visibleDecks = showPrivateLocked ? [] : decks;
  const statsMap = {};
  for (const d of visibleDecks) {
    statsMap[d.id] = deck.getDeckStats(d.id, getSettingsForDeck(d.id), appSettings.flaggedInAnki);
  }
  renderDeckList(visibleDecks, statsMap, {
    activeScope: activeDeckScope,
    sessionMode,
    showPrivateLocked,
    deckListMode: appSettings.deckListMode,
    canTogglePublicDeckVisibility: canManagePublicDecks(),
    showPrivateArchived,
    hasArchivedPrivate,
    isLoading: activeDeckScope === 'public' && !skipPublicSync,
    loadingText: 'Ładowanie talii ogólnych...',
  });
  bindDeckListEvents();
}

// --- Category Select ---

function getFilteredQuestionIds(deckId) {
  if (!currentCategory) return null; // null means all questions
  const questions = storage.getQuestions(deckId);
  return questions.filter(q => q.category === currentCategory).map(q => q.id);
}

function getFilteredQuestions(deckId) {
  const questions = storage.getQuestions(deckId);
  if (!currentCategory) return questions;
  return questions.filter(q => q.category === currentCategory);
}

function navigateToCategorySelect(deckId) {
  currentDeckId = deckId;
  currentCategory = null;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;

  if (!deckMeta || !deckMeta.categories) {
    navigateToModeSelect(deckId);
    return;
  }

  showView('category-select');
  const statsMap = deck.getDeckCategoryStats(deckId, deckMeta.categories, appSettings.flaggedInAnki);
  renderCategorySelect(deckName, deckMeta.categories, statsMap);
  bindCategorySelectEvents(deckId, deckMeta.categories);
}

function bindCategorySelectEvents(deckId, categories) {
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      const catId = card.dataset.category;
      currentCategory = catId === 'all' ? null : catId;
      navigateToModeSelect(deckId);
    });
  });
}

function navigateToStudy(deckId, flaggedOnly = false) {
  // Resume existing session if returning to the same deck
  if (
    currentDeckId === deckId
    && queues
    && studyingFlagged === flaggedOnly
    && currentSessionCategory === currentCategory
  ) {
    currentDeckSettings = getSettingsForDeck(deckId);
    const deckMeta = storage.getDecks().find(d => d.id === deckId);
    document.getElementById('study-deck-name').textContent = deckMeta ? deckMeta.name : deckId;
    showView('study');
    updateProgress(studiedCount, sessionTotal);
    if (currentCard) {
      showQuestionForCard(currentCard);
    } else {
      showNextCard();
    }
    return;
  }

  currentDeckId = deckId;
  currentDeckSettings = getSettingsForDeck(deckId);
  studiedCount = 0;
  studyingFlagged = flaggedOnly;
  currentSessionCategory = currentCategory;

  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  document.getElementById('study-deck-name').textContent = deckMeta ? deckMeta.name : deckId;

  showView('study');
  startStudySession();
}

function navigateToComplete(deckId) {
  clearWaitTimer();
  studyPhase = null;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const todayStats = deck.getTodayStats(deckId);
  showView('complete');
  renderSessionComplete(todayStats, deckMeta ? deckMeta.name : deckId);
  bindCompleteEvents();
}

// --- Mode Select ---

function navigateToModeSelect(deckId) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;

  // Build stats for filtered questions if category is selected
  const deckSettings = getSettingsForDeck(deckId);
  let stats;
  if (currentCategory) {
    const allCards = storage.getCards(deckId);
    const filteredIds = getFilteredQuestionIds(deckId);
    const filteredSet = new Set(filteredIds);
    const catCards = allCards.filter(c => filteredSet.has(c.questionId));
    const flaggedCount = catCards.filter(c => isFlagged(c)).length;
    const cards = appSettings.flaggedInAnki ? catCards : catCards.filter(c => !isFlagged(c));
    const now = Date.now();
    const today = new Date(now); today.setHours(0,0,0,0); const todayMs = today.getTime();
    const dueReview = cards.filter(c => isReviewCard(c) && c.dueDate <= now).length;
    const dueLearning = cards.filter(c => (isLearningCard(c) || isRelearningCard(c)) && c.dueDate <= now).length;
    const learningTotal = cards.filter(c => isLearningCard(c) || isRelearningCard(c)).length;
    const totalNew = cards.filter(c => isNewCard(c)).length;
    const newCardsToday = allCards.filter(c => {
      if (c.firstStudiedDate == null) return false;
      const d = new Date(c.firstStudiedDate); d.setHours(0,0,0,0);
      return d.getTime() === todayMs;
    }).length;
    const newAvailable = Math.min(totalNew, Math.max(0, deckSettings.newCardsPerDay - newCardsToday));
    stats = {
      dueToday: dueReview + dueLearning,
      dueReview,
      dueLearning,
      learningTotal,
      newAvailable,
      totalCards: cards.length,
      flagged: flaggedCount,
    };
  } else {
    stats = deck.getDeckStats(deckId, deckSettings, appSettings.flaggedInAnki);
  }

  showView('mode-select');
  renderModeSelect(deckName, stats, { canEdit: canEditDeckContent(deckId) });
  bindModeSelectEvents(deckId, stats);
}

function bindModeSelectEvents(deckId, stats) {
  document.querySelectorAll('.mode-card:not(.disabled)').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      if (mode === 'anki') {
        navigateToStudy(deckId);
      } else if (mode === 'test') {
        navigateToTestConfig(deckId);
      } else if (mode === 'browse') {
        navigateToBrowse(deckId);
      } else if (mode === 'flagged') {
        navigateToFlaggedBrowse(deckId);
      }
    });
  });
}

// --- Test Mode ---

function navigateToTestConfig(deckId) {
  currentDeckId = deckId;
  currentDeckSettings = getSettingsForDeck(deckId);
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const questions = getFilteredQuestions(deckId).filter(q => !isFlashcard(q));

  document.getElementById('test-deck-name').textContent = deckName;
  document.getElementById('test-counter').textContent = '';
  document.getElementById('test-progress').style.width = '0%';

  showView('test');
  renderTestConfig(questions.length);
  bindTestConfigEvents(deckId, questions.length);
}

function bindTestConfigEvents(deckId, totalQuestions) {
  const slider = document.getElementById('test-count-slider');
  const display = document.getElementById('test-count-display');
  const startBtn = document.getElementById('btn-start-test');

  slider.addEventListener('input', () => {
    display.textContent = slider.value;
  });

  startBtn.addEventListener('click', () => {
    const count = parseInt(slider.value);
    startTest(deckId, count);
  });
}

function startTest(deckId, questionCount) {
  currentDeckId = deckId;
  currentDeckSettings = getSettingsForDeck(deckId);
  const allQuestions = getFilteredQuestions(deckId).filter(q => !isFlashcard(q));
  if (appSettings.questionOrder === 'ordered') {
    // Sort by originalIndex (if present) for ordered mode
    const sorted = [...allQuestions].sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
    testQuestions = sorted.slice(0, questionCount);
  } else {
    testQuestions = shuffle(allQuestions).slice(0, questionCount);
  }
  testCurrentIndex = 0;
  testAnswers = new Map();
  testShuffledMap = new Map();
  testResultAnswers = [];

  showTestQuestion();
}

function showTestQuestion() {
  let question = testQuestions[testCurrentIndex];

  // Apply randomization (only on first visit, not when going back)
  // Template questions always randomize; hardcoded only when setting is on
  const shouldRandomize = shouldRandomizeQuestion(question, currentDeckSettings);
  if (shouldRandomize && !testShuffledMap.has(testCurrentIndex)) {
    const variant = randomize(question.id, question);
    if (variant) {
      question = { ...question, text: variant.text, answers: variant.answers };
      if (variant.explanation !== undefined) question.explanation = variant.explanation;
      testQuestions[testCurrentIndex] = question;
    }
  }

  const selectionMode = getEffectiveSelectionModeForDeck(question, currentDeckId);
  const isMulti = selectionMode === 'multiple';

  // Reuse previously stored shuffle order if going back
  const storedShuffle = testShuffledMap.get(testCurrentIndex) || null;
  // Restore previous selection if any
  const previousSelection = testAnswers.get(question.id) || null;

  testShuffledAnswers = renderTestQuestion(
    question,
    testCurrentIndex + 1,
    testQuestions.length,
    selectionMode,
    appSettings.shuffleAnswers,
    storedShuffle,
    previousSelection
  );

  // Store shuffle order for this index
  if (!storedShuffle) {
    testShuffledMap.set(testCurrentIndex, testShuffledAnswers);
  }

  testSelectedIds = previousSelection ? new Set(previousSelection) : new Set();

  bindTestQuestionEvents(isMulti);
}

function bindTestQuestionEvents(isMulti) {
  const answersList = document.getElementById('test-answers-list');
  const nextBtn = document.getElementById('btn-test-next');

  answersList.addEventListener('click', (e) => {
    const option = e.target.closest('.answer-option');
    if (!option) return;

    const answerId = option.dataset.answerId;

    if (isMulti) {
      if (testSelectedIds.has(answerId)) {
        testSelectedIds.delete(answerId);
        option.classList.remove('selected');
      } else {
        testSelectedIds.add(answerId);
        option.classList.add('selected');
      }
    } else {
      testSelectedIds.clear();
      answersList.querySelectorAll('.answer-option').forEach(o => o.classList.remove('selected'));
      testSelectedIds.add(answerId);
      option.classList.add('selected');
    }

    nextBtn.disabled = testSelectedIds.size === 0;
  });

  nextBtn.addEventListener('click', async () => {
    // Save answer
    const question = testQuestions[testCurrentIndex];
    testAnswers.set(question.id, new Set(testSelectedIds));

    testCurrentIndex++;
    if (testCurrentIndex < testQuestions.length) {
      showTestQuestion();
    } else {
      await finishTest();
    }
  });

  const prevBtn = document.getElementById('btn-test-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      // Save current answer before going back
      const question = testQuestions[testCurrentIndex];
      if (testSelectedIds.size > 0) {
        testAnswers.set(question.id, new Set(testSelectedIds));
      }

      testCurrentIndex--;
      showTestQuestion();
    });
  }
}

async function finishTest() {
  let score = 0;
  const answers = testQuestions.map(q => {
    const selectedIds = testAnswers.get(q.id) || new Set();
    const correctIds = new Set(q.answers.filter(a => a.correct).map(a => a.id));

    // Correct if selected exactly matches correct
    const isCorrect =
      selectedIds.size === correctIds.size &&
      [...selectedIds].every(id => correctIds.has(id));

    if (isCorrect) score++;

    return {
      question: q,
      selectedIds,
      correctIds,
      correct: isCorrect,
    };
  });

  const deckMeta = storage.getDecks().find(d => d.id === currentDeckId);
  const deckName = deckMeta ? deckMeta.name : currentDeckId;
  let voteConfig = getVoteConfigForDeck(currentDeckId);
  let voteSummaryByQuestion = {};

  if (voteConfig.enabled && testQuestions.length > 0) {
    try {
      const voteTarget = await ensureVoteSummaryForQuestions(
        currentDeckId,
        testQuestions.map((question) => question.id)
      );
      if (voteTarget) {
        voteSummaryByQuestion = buildVoteSummaryByQuestion(voteTarget, testQuestions);
      }
    } catch (error) {
      if (!isAnswerVoteRpcReady()) {
        notifyVoteRpcUnavailable();
      } else {
        showNotification(`Nie udało się pobrać głosów społeczności: ${error.message}`, 'error');
      }
      voteConfig = { ...voteConfig, enabled: false, canVote: false };
    }
  }

  testResultAnswers = answers;

  showView('test-result');
  renderTestResult(deckName, {
    score,
    total: testQuestions.length,
    answers,
    voteSummaryByQuestion,
    voteConfig,
    deckDefaultSelectionMode: getDeckDefaultSelectionModeForDeckId(currentDeckId),
  });
  bindTestResultEvents();
}

function bindTestResultEvents() {
  // Toggle expand for review items
  document.querySelectorAll('.test-review-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.test-review-item').classList.toggle('expanded');
    });
  });

  const retryBtn = document.getElementById('btn-test-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      navigateToTestConfig(currentDeckId);
    });
  }

  const backBtn = document.getElementById('btn-test-back-to-decks');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      navigateToDeckList();
    });
  }

  bindVoteButtons(
    currentDeckId,
    testResultAnswers.map((entry) => entry.question)
  );
}

// --- Browse Mode ---

async function navigateToBrowse(deckId, options = {}) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const questions = getFilteredQuestions(deckId);
  let voteConfig = getVoteConfigForDeck(deckId);
  let voteSummaryByQuestion = {};

  if (voteConfig.enabled && questions.length > 0) {
    try {
      const voteTarget = await ensureVoteSummaryForQuestions(
        deckId,
        questions.map((question) => question.id)
      );
      if (voteTarget) {
        voteSummaryByQuestion = buildVoteSummaryByQuestion(voteTarget, questions);
      }
    } catch (error) {
      if (!isAnswerVoteRpcReady()) {
        notifyVoteRpcUnavailable();
      } else {
        showNotification(`Nie udało się pobrać głosów społeczności: ${error.message}`, 'error');
      }
      voteConfig = { ...voteConfig, enabled: false, canVote: false };
    }
  }

  showView('browse');
  renderBrowse(deckName, questions, {
    canEdit: canEditDeckContent(deckId),
    voteSummaryByQuestion,
    voteConfig,
    deckDefaultSelectionMode: getDeckDefaultSelectionModeForDeckId(deckId),
  });
  bindBrowseEvents();
  bindVoteButtons(deckId, questions);

  if (typeof options.searchQuery === 'string') {
    applyBrowseSearchQuery(options.searchQuery);
  }

  if (options.openCreateEditor && canEditDeckContent(deckId)) {
    openBrowseCreateEditor();
  }
}

function bindBrowseEvents() {
  const searchInput = document.getElementById('browse-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      document.querySelectorAll('.browse-item').forEach(item => {
        const text = item.dataset.searchText || '';
        item.style.display = text.includes(query) ? '' : 'none';
      });

      // Show "no results" message
      const visibleCount = document.querySelectorAll('.browse-item[style=""]').length +
        document.querySelectorAll('.browse-item:not([style])').length;
      const browseList = document.getElementById('browse-list');
      const existingEmpty = browseList.querySelector('.browse-empty');
      if (existingEmpty) existingEmpty.remove();

      const allHidden = [...document.querySelectorAll('.browse-item')].every(
        item => item.style.display === 'none'
      );
      if (allHidden && query) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'browse-empty';
        emptyEl.textContent = 'Brak wyników dla podanego zapytania.';
        browseList.appendChild(emptyEl);
      }
    });
  }

  const addQuestionBtn = document.getElementById('btn-browse-add-question');
  if (addQuestionBtn) {
    addQuestionBtn.addEventListener('click', () => {
      openBrowseCreateEditor();
    });
  }

  // Edit buttons in browse items
  document.querySelectorAll('.browse-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.questionIndex);
      openBrowseEditor(index);
    });
  });
}

function openBrowseEditor(index) {
  if (isCurrentDeckReadOnlyContent()) {
    showNotification('Talia ogólna jest tylko do nauki. Edycja jest zablokowana.', 'info');
    return;
  }

  const questions = getFilteredQuestions(currentDeckId);
  const question = questions[index];
  if (!question) return;

  const browseItem = document.querySelector(`.browse-item[data-question-index="${index}"]`);
  if (!browseItem) return;

  browseItem.innerHTML = renderBrowseEditor(
    question,
    index,
    getDeckDefaultSelectionModeForDeckId(currentDeckId)
  );

  // Bind randomize toggle
  const editor = browseItem.querySelector('.browse-editor');
  const toggle = editor.querySelector('.editor-randomize-toggle');
  const body = editor.querySelector('.editor-randomize-body');
  if (toggle && body) {
    toggle.addEventListener('change', () => {
      body.style.display = toggle.checked ? '' : 'none';
    });
  }

  // Bind add variable/derived/constraint buttons
  bindBrowseEditorAddButtons(editor);
  bindBrowseEditorRemoveButtons(editor);

  // Cancel
  editor.querySelector('.btn-browse-editor-cancel').addEventListener('click', () => {
    navigateToBrowse(currentDeckId, { searchQuery: getBrowseSearchQuery() });
  });

  // Save
  editor.querySelector('.btn-browse-editor-save').addEventListener('click', () => {
    saveBrowseEdit(index, editor);
  });
}

function openBrowseCreateEditor() {
  if (isCurrentDeckReadOnlyContent()) {
    showNotification('Talia ogólna jest tylko do nauki. Edycja jest zablokowana.', 'info');
    return;
  }

  const browseList = document.getElementById('browse-list');
  if (!browseList) return;

  const existing = browseList.querySelector('.browse-create-editor');
  if (existing) {
    existing.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const deckMeta = getDeckMeta(currentDeckId);
  const categories = Array.isArray(deckMeta?.categories) ? deckMeta.categories : [];
  const selectedCategory = currentCategory && categories.some((cat) => cat.id === currentCategory)
    ? currentCategory
    : '';

  const wrapper = document.createElement('div');
  wrapper.className = 'browse-item';
  wrapper.innerHTML = renderBrowseCreateEditor({
    categories,
    selectedCategory,
    isFlashcard: false,
    selectionMode: getDeckDefaultSelectionModeForDeckId(currentDeckId),
  });
  browseList.prepend(wrapper);

  const editor = wrapper.querySelector('.browse-create-editor');
  if (!editor) return;

  bindCreateQuestionEditorEvents(editor, wrapper);
  bindBrowseEditorAddButtons(editor);
  bindBrowseEditorRemoveButtons(editor);

  const textInput = editor.querySelector('#create-question-text');
  if (textInput) textInput.focus();
}

function bindCreateQuestionEditorEvents(editor, wrapper) {
  const flashcardToggle = editor.querySelector('#create-question-is-flashcard');
  const answersSection = editor.querySelector('#create-editor-answers-section');
  if (flashcardToggle && answersSection) {
    flashcardToggle.addEventListener('change', () => {
      answersSection.style.display = flashcardToggle.checked ? 'none' : '';
    });
  }

  const addAnswerBtn = editor.querySelector('#btn-create-add-answer');
  if (addAnswerBtn) {
    addAnswerBtn.addEventListener('click', () => {
      addCreateAnswerRow(editor, { text: '', correct: false });
    });
  }

  bindCreateAnswerRemoveButtons(editor);
  updateCreateAnswerRemoveState(editor);

  const cancelBtn = editor.querySelector('#btn-create-question-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      wrapper.remove();
    });
  }

  const saveBtn = editor.querySelector('#btn-create-question-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveCreatedQuestion(editor, wrapper);
    });
  }
}

function addCreateAnswerRow(editor, answer = { text: '', correct: false }) {
  const list = editor.querySelector('#create-editor-answers-list');
  if (!list) return;
  const safeValue = String(answer.text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const row = document.createElement('div');
  row.className = 'editor-answer-row create-answer-row';
  row.innerHTML = `
    <label class="toggle-switch toggle-switch-sm">
      <input type="checkbox" class="create-answer-correct" ${answer.correct ? 'checked' : ''}>
      <span class="toggle-slider"></span>
    </label>
    <input type="text" class="editor-answer-text create-answer-text" value="${safeValue}">
    <button class="btn-remove-create-answer" data-tooltip="Usuń odpowiedź" aria-label="Usuń odpowiedź">&times;</button>
  `;
  list.appendChild(row);
  bindCreateAnswerRemoveButtons(editor);
  updateCreateAnswerRemoveState(editor);
}

function bindCreateAnswerRemoveButtons(editor) {
  editor.querySelectorAll('.btn-remove-create-answer').forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true));
  });

  editor.querySelectorAll('.btn-remove-create-answer').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.create-answer-row')?.remove();
      updateCreateAnswerRemoveState(editor);
    });
  });
}

function updateCreateAnswerRemoveState(editor) {
  const rows = editor.querySelectorAll('.create-answer-row');
  const disableRemove = rows.length <= 2;
  rows.forEach((row) => {
    const btn = row.querySelector('.btn-remove-create-answer');
    if (btn) btn.disabled = disableRemove;
  });
}

function collectRandomizeFromEditor(editor) {
  const randomizeToggle = editor.querySelector('.editor-randomize-toggle');
  let newRandomize = undefined;
  if (randomizeToggle && randomizeToggle.checked) {
    newRandomize = {};

    const varRows = editor.querySelectorAll('.editor-var-row');
    for (const row of varRows) {
      const varName = row.querySelector('.editor-var-name').value.trim();
      const varValues = row.querySelector('.editor-var-values').value.trim();
      if (!varName || !varValues) continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) continue;
      const parts = varValues.split(',').map(s => s.trim());
      const nums = parts.map(s => parseFloat(s)).filter(n => !isNaN(n));
      if (nums.length === parts.length && nums.length >= 2) {
        newRandomize[varName] = nums;
      } else if (parts.length >= 2) {
        newRandomize[varName] = parts;
      }
    }

    const derivedRows = editor.querySelectorAll('.editor-derived-row');
    if (derivedRows.length > 0) {
      const derived = {};
      for (const row of derivedRows) {
        const name = row.querySelector('.editor-derived-name').value.trim();
        const expr = row.querySelector('.editor-derived-expr').value.trim();
        if (!name || !expr) continue;
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          derived[name] = expr;
        }
      }
      if (Object.keys(derived).length > 0) newRandomize.$derived = derived;
    }

    const constraintRows = editor.querySelectorAll('.editor-constraint-row');
    if (constraintRows.length > 0) {
      const constraints = [];
      for (const row of constraintRows) {
        const expr = row.querySelector('.editor-constraint-expr').value.trim();
        if (expr) constraints.push(expr);
      }
      if (constraints.length > 0) newRandomize.$constraints = constraints;
    }

    const hasVars = Object.keys(newRandomize).some(k => !k.startsWith('$'));
    if (!hasVars && !newRandomize.$derived) newRandomize = undefined;
  }
  return newRandomize;
}

function saveCreatedQuestion(editor, wrapper) {
  if (isCurrentDeckReadOnlyContent()) {
    showNotification('Talia ogólna jest tylko do nauki. Edycja jest zablokowana.', 'info');
    return;
  }

  const text = (editor.querySelector('#create-question-text')?.value || '').trim();
  if (!text) {
    showNotification('Treść pytania nie może być pusta.', 'error');
    return;
  }

  const isFlashcardQuestion = !!editor.querySelector('#create-question-is-flashcard')?.checked;
  const explanation = (editor.querySelector('#create-question-explanation')?.value || '').trim();
  const selectionMode = normalizeSelectionMode(
    editor.querySelector('#create-question-selection-mode')?.value,
    getDeckDefaultSelectionModeForDeckId(currentDeckId)
  );

  const answers = [];
  if (!isFlashcardQuestion) {
    const rows = editor.querySelectorAll('.create-answer-row');
    if (rows.length < 2) {
      showNotification('Pytanie testowe musi mieć co najmniej 2 odpowiedzi.', 'error');
      return;
    }

    let correctCount = 0;
    rows.forEach((row, idx) => {
      const answerText = (row.querySelector('.create-answer-text')?.value || '').trim();
      const isCorrect = !!row.querySelector('.create-answer-correct')?.checked;
      if (!answerText) return;
      answers.push({ id: `a${idx + 1}`, text: answerText, correct: isCorrect });
      if (isCorrect) correctCount++;
    });

    if (answers.length < 2) {
      showNotification('Każda odpowiedź musi mieć treść.', 'error');
      return;
    }

    if (selectionMode === 'single' && correctCount !== 1) {
      showNotification('Pytanie jednokrotnego wyboru musi mieć dokładnie jedną poprawną odpowiedź.', 'error');
      return;
    }

    if (selectionMode !== 'single' && correctCount === 0) {
      showNotification('Co najmniej jedna odpowiedź musi być poprawna.', 'error');
      return;
    }
  }

  const randomize = collectRandomizeFromEditor(editor);

  const allQuestions = storage.getQuestions(currentDeckId);
  const existingIds = new Set(allQuestions.map((q) => q.id));
  let questionId = generateId();
  while (existingIds.has(questionId)) {
    questionId = generateId();
  }

  const newQuestion = {
    id: questionId,
    text,
    answers: isFlashcardQuestion ? [] : answers,
  };
  if (!isFlashcardQuestion) {
    newQuestion.selectionMode = selectionMode;
  }

  const categorySelect = editor.querySelector('#create-question-category');
  const selectedCategory = categorySelect ? categorySelect.value.trim() : '';
  if (selectedCategory) {
    newQuestion.category = selectedCategory;
  }
  if (explanation) {
    newQuestion.explanation = explanation;
  }
  if (randomize) {
    newQuestion.randomize = randomize;
  }

  allQuestions.push(newQuestion);
  storage.saveQuestions(currentDeckId, allQuestions);

  const cards = storage.getCards(currentDeckId);
  cards.push(createCard(questionId, currentDeckId));
  storage.saveCards(currentDeckId, cards);

  const decks = storage.getDecks();
  const deckIndex = decks.findIndex((d) => d.id === currentDeckId);
  if (deckIndex >= 0) {
    const nextDeck = { ...decks[deckIndex], questionCount: allQuestions.length };
    if (selectedCategory && Array.isArray(nextDeck.categories)) {
      nextDeck.categories = nextDeck.categories.map((cat) => {
        if (cat.id !== selectedCategory) return cat;
        return {
          ...cat,
          questionCount: (Number(cat.questionCount) || 0) + 1,
        };
      });
    }
    decks[deckIndex] = nextDeck;
    storage.saveDecks(decks);
  }

  syncOwnedDeckToSupabaseAsync(currentDeckId);

  const activeSearch = getBrowseSearchQuery();
  wrapper.remove();
  showNotification('Pytanie zostało dodane.', 'success');
  navigateToBrowse(currentDeckId, { searchQuery: activeSearch });
}

function getBrowseSearchQuery() {
  const input = document.getElementById('browse-search-input');
  return input ? input.value : '';
}

function applyBrowseSearchQuery(query) {
  const input = document.getElementById('browse-search-input');
  if (!input) return;
  input.value = query;
  input.dispatchEvent(new Event('input'));
}

function bindBrowseEditorAddButtons(editor) {
  const addVarBtn = editor.querySelector('.btn-add-var');
  if (addVarBtn) {
    addVarBtn.addEventListener('click', () => {
      const list = editor.querySelector('.editor-vars-list');
      const row = document.createElement('div');
      row.className = 'editor-var-row';
      row.innerHTML = `
        <input type="text" class="editor-var-name" value="" placeholder="nazwa">
        <input type="text" class="editor-var-values" value="" placeholder="min, max lub v1, v2, v3...">
        <button class="btn-remove-var" data-tooltip="Usuń zmienną" aria-label="Usuń zmienną">&times;</button>
      `;
      list.appendChild(row);
      bindBrowseEditorRemoveButtons(editor);
    });
  }

  const addDerivedBtn = editor.querySelector('.btn-add-derived');
  if (addDerivedBtn) {
    addDerivedBtn.addEventListener('click', () => {
      const list = editor.querySelector('.editor-derived-list');
      const row = document.createElement('div');
      row.className = 'editor-derived-row';
      row.innerHTML = `
        <input type="text" class="editor-derived-name" value="" placeholder="nazwa">
        <input type="text" class="editor-derived-expr" value="" placeholder="wyrażenie, np. a + b">
        <button class="btn-remove-derived" data-tooltip="Usuń pochodną" aria-label="Usuń pochodną">&times;</button>
      `;
      list.appendChild(row);
      bindBrowseEditorRemoveButtons(editor);
    });
  }

  const addConstraintBtn = editor.querySelector('.btn-add-constraint');
  if (addConstraintBtn) {
    addConstraintBtn.addEventListener('click', () => {
      const list = editor.querySelector('.editor-constraints-list');
      const row = document.createElement('div');
      row.className = 'editor-constraint-row';
      row.innerHTML = `
        <input type="text" class="editor-constraint-expr" value="" placeholder="warunek, np. a != b">
        <button class="btn-remove-constraint" data-tooltip="Usuń ograniczenie" aria-label="Usuń ograniczenie">&times;</button>
      `;
      list.appendChild(row);
      bindBrowseEditorRemoveButtons(editor);
    });
  }
}

function bindBrowseEditorRemoveButtons(editor) {
  const selector = '.btn-remove-var, .btn-remove-derived, .btn-remove-constraint';
  editor.querySelectorAll(selector).forEach(btn => {
    btn.replaceWith(btn.cloneNode(true));
  });
  editor.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.remove();
    });
  });
}

function saveBrowseEdit(index, editor) {
  if (isCurrentDeckReadOnlyContent()) {
    showNotification('Talia ogólna jest tylko do nauki. Edycja jest zablokowana.', 'info');
    return;
  }

  const newText = editor.querySelector('.editor-question-text').value.trim();
  if (!newText) {
    showNotification('Treść pytania nie może być pusta.', 'error');
    return;
  }

  const newExplanation = editor.querySelector('.editor-explanation').value.trim();
  const selectionMode = normalizeSelectionMode(
    editor.querySelector('.editor-selection-mode')?.value,
    getDeckDefaultSelectionModeForDeckId(currentDeckId)
  );

  const answerRows = editor.querySelectorAll('.editor-answer-row');
  const updatedAnswers = [];
  let correctCount = 0;

  if (answerRows.length > 0) {
    for (const row of answerRows) {
      const id = row.dataset.answerId;
      const text = row.querySelector('.editor-answer-text').value.trim();
      const correct = row.querySelector('.editor-answer-correct').checked;

      if (!text) {
        showNotification('Odpowiedź nie może być pusta.', 'error');
        return;
      }

      if (correct) correctCount++;
      updatedAnswers.push({ id, text, correct });
    }

    if (selectionMode === 'single' && correctCount !== 1) {
      showNotification('Pytanie jednokrotnego wyboru musi mieć dokładnie jedną poprawną odpowiedź.', 'error');
      return;
    }

    if (selectionMode !== 'single' && correctCount === 0) {
      showNotification('Co najmniej jedna odpowiedź musi być poprawna.', 'error');
      return;
    }
  }

  const newRandomize = collectRandomizeFromEditor(editor);

  // Save to storage
  const questions = getFilteredQuestions(currentDeckId);
  const question = questions[index];
  const allQuestions = storage.getQuestions(currentDeckId);
  const qIndex = allQuestions.findIndex(q => q.id === question.id);

  if (qIndex !== -1) {
    allQuestions[qIndex].text = newText;
    if (updatedAnswers.length > 0) {
      allQuestions[qIndex].answers = updatedAnswers;
      allQuestions[qIndex].selectionMode = selectionMode;
    } else {
      delete allQuestions[qIndex].selectionMode;
    }
    allQuestions[qIndex].explanation = newExplanation || undefined;
    if (newRandomize) {
      allQuestions[qIndex].randomize = newRandomize;
    } else {
      delete allQuestions[qIndex].randomize;
    }
    storage.saveQuestions(currentDeckId, allQuestions);
  }

  syncOwnedDeckToSupabaseAsync(currentDeckId);

  showNotification('Pytanie zostało zaktualizowane.', 'success');
  navigateToBrowse(currentDeckId, { searchQuery: getBrowseSearchQuery() });
}

// --- Settings ---

function navigateToSettings(deckId, returnTo = 'mode-select') {
  currentDeckId = deckId;
  settingsReturnTo = returnTo;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckScope = getDeckScope(deckMeta);
  const groupScope = deckScope === 'public' ? 'public' : 'private';
  document.getElementById('settings-deck-name').textContent = deckMeta ? deckMeta.name : deckId;

  showView('settings');
  const deckSettings = getSettingsForDeck(deckId);
  renderSettings(deckSettings, DEFAULT_SETTINGS, {
    deckMeta,
    canEditMeta: canEditDeckContent(deckId),
    groupOptions: getAvailableDeckGroups(groupScope),
  });
  bindSettingsEvents(deckId);
}

function returnFromSettings() {
  if (settingsReturnTo === 'deck-list') {
    navigateToDeckList();
  } else {
    navigateToModeSelect(currentDeckId);
  }
}

// --- App Settings ---

function navigateToAppSettings() {
  // Remember current view to return to it later
  const currentView = document.querySelector('.view.active');
  appSettingsReturnView = currentView ? currentView.id.replace('view-', '') : 'deck-list';
  showView('app-settings');
  renderAppSettings(appSettings, DEFAULT_APP_SETTINGS);
  bindAppSettingsEvents();
}

function returnFromAppSettings() {
  const returnTo = appSettingsReturnView || 'deck-list';
  appSettingsReturnView = null;
  // For simple views, just show them back. For deck-list, re-render.
  if (returnTo === 'deck-list') {
    navigateToDeckList();
  } else {
    showView(returnTo);
  }
}

async function navigateToUserProfile() {
  if (sessionMode !== 'user' || !currentUser) {
    showAuthPanel('Zaloguj się, aby zobaczyć profil.', 'info');
    return;
  }
  if (!currentUserProfile && isSupabaseConfigured()) {
    try {
      currentUserProfile = await fetchMyProfile();
    } catch (error) {
      showNotification(`Nie udało się pobrać profilu: ${error.message}`, 'error');
    }
  }
  closeUserMenu();
  showView('user');
  renderUserProfile({
    username: currentUserProfile?.username || '',
    email: currentUser.email || '',
    userId: currentUser.id || '',
    role: currentUserRole,
    createdAt: currentUser.created_at || null,
    lastSignInAt: currentUser.last_sign_in_at || null,
  });
  bindUserProfileEvents();
}

function bindUserProfileEvents() {
  const editBtn = document.getElementById('btn-edit-username');
  const cancelBtn = document.getElementById('btn-cancel-username-edit');
  const saveBtn = document.getElementById('btn-save-username');
  const input = document.getElementById('profile-username-input');
  const errorEl = document.getElementById('profile-username-error');
  const displayRow = document.getElementById('profile-username-display-row');
  const editRow = document.getElementById('profile-username-edit-row');
  const usernameValueEl = document.getElementById('profile-username-value');
  if (!saveBtn || !input || !errorEl || !displayRow || !editRow || !editBtn || !cancelBtn || !usernameValueEl) return;

  const setEditing = (editing) => {
    displayRow.hidden = editing;
    editRow.hidden = !editing;
    if (editing) {
      input.focus();
      input.select();
    }
  };

  const clearError = () => { errorEl.textContent = ''; };
  input.addEventListener('input', clearError);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveBtn.click();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelBtn.click();
    }
  });

  editBtn.addEventListener('click', () => {
    input.value = currentUserProfile?.username || '';
    clearError();
    setEditing(true);
  });

  cancelBtn.addEventListener('click', () => {
    input.value = currentUserProfile?.username || '';
    clearError();
    setEditing(false);
  });

  saveBtn.addEventListener('click', async () => {
    if (sessionMode !== 'user' || !currentUser) return;
    const nextUsername = normalizeUsername(input.value);
    if (!USERNAME_RE.test(nextUsername)) {
      errorEl.textContent = 'Nieprawidłowy format username.';
      return;
    }

    saveBtn.disabled = true;
    try {
      const updatedProfile = await updateMyUsername(nextUsername);
      currentUserProfile = updatedProfile;
      input.value = updatedProfile.username;
      updateHeaderSessionState('user', {
        email: currentUser.email || '',
        username: updatedProfile.username || '',
      });
      showNotification('Username został zapisany.', 'success');
      usernameValueEl.textContent = updatedProfile.username || 'brak danych';
      setEditing(false);
    } catch (error) {
      if (error?.code === '23505') {
        errorEl.textContent = 'Ten username jest już zajęty.';
      } else {
        errorEl.textContent = `Nie udało się zapisać username: ${error.message}`;
      }
    } finally {
      saveBtn.disabled = false;
    }
  });
}

async function navigateToAdminPanel() {
  if (!canAccessAdminPanel() || sessionMode !== 'user') {
    showNotification('Panel admina jest dostępny tylko dla ról admin/dev.', 'info');
    return;
  }

  closeUserMenu();
  showView('admin');

  const container = document.getElementById('admin-panel-content');
  if (container) {
    container.innerHTML = `
      <div class="admin-panel">
        <div class="admin-empty">Ładowanie danych panelu admina...</div>
      </div>
    `;
  }

  try {
    const [users, manifestDecks, visibilityMap] = await Promise.all([
      fetchAdminUsers(),
      loadPublicDeckManifest({ force: true }),
      fetchPublicDeckVisibilityMap(),
    ]);
    adminPanelState.users = users;
    adminPanelState.hiddenDecks = manifestDecks
      .filter((deckRow) => visibilityMap.get(deckRow.id)?.isHidden === true)
      .map((deckRow) => ({
        id: deckRow.id,
        name: deckRow.name || deckRow.id,
        updated_at: visibilityMap.get(deckRow.id)?.updatedAt || null,
      }));
    adminPanelState.usersPage = 1;
    adminPanelState.hiddenPage = 1;
    renderAdminPanelFromState();
  } catch (error) {
    showNotification(`Nie udało się wczytać panelu admina: ${error.message}`, 'error');
  }
}

function paginate(items, page, pageSize) {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    pageItems: items.slice(start, start + safePageSize),
    totalPages,
    page: safePage,
    totalItems: items.length,
  };
}

function renderAdminPanelFromState(options = {}) {
  const userNeedle = adminPanelState.userQuery.trim().toLowerCase();
  const hiddenNeedle = adminPanelState.hiddenDeckQuery.trim().toLowerCase();

  const filteredUsers = adminPanelState.users.filter((u) => {
    if (!userNeedle) return true;
    const hay = `${u.email || ''} ${u.user_id || ''} ${u.role || ''}`.toLowerCase();
    return hay.includes(userNeedle);
  });
  const filteredHiddenDecks = adminPanelState.hiddenDecks.filter((d) => {
    if (!hiddenNeedle) return true;
    const hay = `${d.name || ''} ${d.id || ''}`.toLowerCase();
    return hay.includes(hiddenNeedle);
  });

  const userPaging = paginate(filteredUsers, adminPanelState.usersPage, ADMIN_USERS_PAGE_SIZE);
  const hiddenPaging = paginate(filteredHiddenDecks, adminPanelState.hiddenPage, ADMIN_HIDDEN_DECKS_PAGE_SIZE);
  adminPanelState.usersPage = userPaging.page;
  adminPanelState.hiddenPage = hiddenPaging.page;

  renderAdminPanel({
    users: userPaging.pageItems,
    hiddenDecks: hiddenPaging.pageItems,
    usersPage: userPaging.page,
    usersPages: userPaging.totalPages,
    usersTotal: userPaging.totalItems,
    hiddenPage: hiddenPaging.page,
    hiddenPages: hiddenPaging.totalPages,
    hiddenTotal: hiddenPaging.totalItems,
    userQuery: adminPanelState.userQuery,
    hiddenDeckQuery: adminPanelState.hiddenDeckQuery,
    currentUserRole,
  });
  bindAdminPanelEvents();

  if (options.focusFieldId) {
    const focusEl = document.getElementById(options.focusFieldId);
    if (focusEl) {
      focusEl.focus();
      const cursorPos = Number.isFinite(options.cursorPos) ? options.cursorPos : focusEl.value.length;
      focusEl.setSelectionRange(cursorPos, cursorPos);
    }
  }
}

function bindAdminPanelEvents() {
  const userSearchInput = document.getElementById('admin-user-search');
  if (userSearchInput) {
    userSearchInput.addEventListener('input', () => {
      adminPanelState.userQuery = userSearchInput.value || '';
      adminPanelState.usersPage = 1;
      renderAdminPanelFromState({
        focusFieldId: 'admin-user-search',
        cursorPos: userSearchInput.selectionStart,
      });
    });
  }

  const hiddenSearchInput = document.getElementById('admin-hidden-search');
  if (hiddenSearchInput) {
    hiddenSearchInput.addEventListener('input', () => {
      adminPanelState.hiddenDeckQuery = hiddenSearchInput.value || '';
      adminPanelState.hiddenPage = 1;
      renderAdminPanelFromState({
        focusFieldId: 'admin-hidden-search',
        cursorPos: hiddenSearchInput.selectionStart,
      });
    });
  }

  document.querySelectorAll('.admin-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const dir = parseInt(btn.dataset.dir, 10);
      if (!Number.isFinite(dir)) return;
      if (target === 'users') {
        adminPanelState.usersPage = Math.max(1, adminPanelState.usersPage + dir);
      } else if (target === 'hidden') {
        adminPanelState.hiddenPage = Math.max(1, adminPanelState.hiddenPage + dir);
      }
      renderAdminPanelFromState();
    });
  });

  document.querySelectorAll('.admin-user-action').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetUserId = btn.dataset.userId;
      const nextRole = btn.dataset.nextRole;
      if (!targetUserId || !nextRole) return;

      const targetUser = adminPanelState.users.find((u) => u.user_id === targetUserId);
      const targetLabel = targetUser?.email || targetUserId;
      const isPromote = nextRole === 'admin';
      const confirmTitle = isPromote ? 'Ustaw rolę admina' : 'Zdejmij rolę admina';
      const confirmText = isPromote
        ? `Czy na pewno chcesz nadać rolę admina dla: ${targetLabel}?`
        : `Czy na pewno chcesz zdjąć rolę admina dla: ${targetLabel}?`;
      const confirmed = await showConfirmWithOptions(confirmTitle, confirmText, {
        confirmLabel: isPromote ? 'Ustaw admina' : 'Zdejmij admina',
      });
      if (!confirmed) return;

      btn.disabled = true;
      try {
        await setUserRole(targetUserId, nextRole);
        const targetIdx = adminPanelState.users.findIndex((u) => u.user_id === targetUserId);
        if (targetIdx >= 0) {
          adminPanelState.users[targetIdx] = {
            ...adminPanelState.users[targetIdx],
            role: nextRole,
          };
        }
        if (currentUser && targetUserId === currentUser.id) {
          currentUserRole = normalizeAppRole(nextRole);
          updateHeaderSessionState('user', {
            email: currentUser.email || '',
            username: currentUserProfile?.username || '',
          });
          if (!canAccessAdminPanel()) {
            showNotification('Twoja rola została zmieniona. Dostęp do panelu admina został odebrany.', 'info');
            await syncPublicDecksForCurrentUser({ allowFallback: true });
            navigateToDeckList('public');
            return;
          }
        }
        showNotification('Rola użytkownika została zaktualizowana.', 'success');
        renderAdminPanelFromState();
      } catch (error) {
        btn.disabled = false;
        showNotification(`Nie udało się zmienić roli: ${error.message}`, 'error');
      }
    });
  });

  document.querySelectorAll('.admin-unhide-deck').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deckId = btn.dataset.deckId;
      if (!deckId) return;
      btn.disabled = true;
      try {
        await setPublicDeckVisibility(deckId, false);
        await syncPublicDecksForCurrentUser({ allowFallback: false });
        showNotification('Talia została ponownie pokazana wszystkim użytkownikom.', 'success');
        adminPanelState.hiddenDecks = adminPanelState.hiddenDecks.filter((d) => d.id !== deckId);
        renderAdminPanelFromState();
      } catch (error) {
        btn.disabled = false;
        showNotification(`Nie udało się pokazać talii: ${error.message}`, 'error');
      }
    });
  });
}

async function ensureDocsLoaded() {
  if (docsLoaded) return;
  if (docsLoadingPromise) return docsLoadingPromise;

  const container = document.getElementById('docs-content-container');
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-title">Ładowanie dokumentacji...</div>
    </div>
  `;

  docsLoadingPromise = fetch('docs.html', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const docsContent = parsed.querySelector('.docs-content');
      if (!docsContent) {
        throw new Error('Brak sekcji .docs-content w docs.html');
      }
      container.innerHTML = docsContent.innerHTML;
      initDocsNavigation(container);
      docsLoaded = true;
    })
    .catch((error) => {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Nie udało się wczytać dokumentacji</div>
          <div class="empty-state-text" id="docs-load-error-message"></div>
        </div>
      `;
      const docsLoadErrorMessage = document.getElementById('docs-load-error-message');
      if (docsLoadErrorMessage) {
        docsLoadErrorMessage.textContent = error.message || 'Nieznany błąd.';
      }
      showNotification(`Błąd ładowania dokumentacji: ${error.message}`, 'error');
    })
    .finally(() => {
      docsLoadingPromise = null;
    });

  return docsLoadingPromise;
}

async function navigateToDocs() {
  const currentView = document.querySelector('.view.active');
  const viewId = currentView ? currentView.id.replace('view-', '') : 'deck-list';
  docsReturnView = viewId === 'docs' ? 'deck-list' : viewId;
  showView('docs');
  await ensureDocsLoaded();
  initDocsNavigation(document.getElementById('docs-content-container'));
}

function returnFromDocs() {
  const returnTo = docsReturnView || 'deck-list';
  docsReturnView = null;

  if (returnTo === 'deck-list') {
    navigateToDeckList();
    return;
  }

  showView(returnTo);
}

function bindAppSettingsEvents() {
  // Display mode options (light/dark/auto)
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appSettings.theme = btn.dataset.theme;
      applyTheme(appSettings.theme);
      storage.saveAppSettings(appSettings);
    });
  });

  // Color theme options
  document.querySelectorAll('.color-theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appSettings.colorTheme = btn.dataset.colorTheme;
      applyColorTheme(appSettings.colorTheme);
      storage.saveAppSettings(appSettings);
    });
  });

  // Layout width options
  document.querySelectorAll('.layout-width-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-width-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appSettings.layoutWidth = normalizeLayoutWidth(btn.dataset.width);
      applyLayoutWidth(appSettings.layoutWidth);
      storage.saveAppSettings(appSettings);
    });
  });

  // Deck list layout options
  document.querySelectorAll('.deck-layout-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.deck-layout-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      appSettings.deckListMode = btn.dataset.deckLayout === 'classic' ? 'classic' : 'compact';
      storage.saveAppSettings(appSettings);
    });
  });

  // Shuffle toggle
  const shuffleToggle = document.getElementById('toggle-shuffle');
  if (shuffleToggle) {
    shuffleToggle.addEventListener('change', () => {
      appSettings.shuffleAnswers = shuffleToggle.checked;
      storage.saveAppSettings(appSettings);
    });
  }

  // Question order toggle
  const orderToggle = document.getElementById('toggle-question-order');
  if (orderToggle) {
    orderToggle.addEventListener('change', () => {
      appSettings.questionOrder = orderToggle.checked ? 'ordered' : 'shuffled';
      storage.saveAppSettings(appSettings);
    });
  }

  const flaggedAnkiToggle = document.getElementById('toggle-flagged-anki');
  if (flaggedAnkiToggle) {
    flaggedAnkiToggle.addEventListener('change', () => {
      appSettings.flaggedInAnki = flaggedAnkiToggle.checked;
      storage.saveAppSettings(appSettings);
    });
  }

  // Keybinding record buttons
  document.querySelectorAll('.keybinding-record').forEach(btn => {
    btn.addEventListener('click', () => {
      startKeyRecording(btn.dataset.binding, btn);
    });
  });

  // Restore default keybindings
  const restoreBtn = document.getElementById('btn-restore-keybindings');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      appSettings.keybindings = { ...DEFAULT_APP_SETTINGS.keybindings };
      storage.saveAppSettings(appSettings);
      renderAppSettings(appSettings, DEFAULT_APP_SETTINGS);
      bindAppSettingsEvents();
      showNotification('Przywrócono domyślne skróty klawiszowe.', 'info');
    });
  }

  const docsBtn = document.getElementById('btn-open-docs');
  if (docsBtn) {
    docsBtn.addEventListener('click', () => {
      navigateToDocs();
    });
  }
}

let activeRecordingCleanup = null;

function startKeyRecording(bindingKey, buttonEl) {
  // Cancel any previous recording
  if (activeRecordingCleanup) activeRecordingCleanup();

  buttonEl.textContent = 'Naciśnij klawisz...';
  buttonEl.classList.add('recording');

  function onKey(e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      // Cancel
      cleanup();
      return;
    }

    // Set new keybinding (single key)
    appSettings.keybindings[bindingKey] = [e.key];
    storage.saveAppSettings(appSettings);

    cleanup();
    // Re-render
    renderAppSettings(appSettings, DEFAULT_APP_SETTINGS);
    bindAppSettingsEvents();
  }

  function cleanup() {
    document.removeEventListener('keydown', onKey, true);
    activeRecordingCleanup = null;
    buttonEl.textContent = 'Zmień';
    buttonEl.classList.remove('recording');
  }

  activeRecordingCleanup = cleanup;
  document.addEventListener('keydown', onKey, true);
}

// --- Deck Settings ---

function bindGroupSelectControl(selectEl, options = {}) {
  if (!selectEl) return;

  const promptTitle = options.promptTitle || 'Nowa grupa';
  const promptText = options.promptText || 'Podaj nazwę nowej grupy:';
  const onInvalid = typeof options.onInvalid === 'function'
    ? options.onInvalid
    : (message) => showNotification(message, 'error');
  let previousValue = selectEl.value || '';

  const addOrSelectGroup = (rawValue) => {
    const groupName = normalizeDeckGroup(rawValue);
    if (!groupName) {
      onInvalid('Nazwa nowej grupy nie może być pusta.');
      selectEl.value = previousValue;
      return;
    }

    const normalizedTarget = groupName.toLocaleLowerCase('pl');
    const existingOption = Array.from(selectEl.options).find((opt) => {
      const value = normalizeDeckGroup(opt.value);
      if (!value || value === '__new__') return false;
      return value.toLocaleLowerCase('pl') === normalizedTarget;
    });

    if (existingOption) {
      selectEl.value = existingOption.value;
      previousValue = existingOption.value;
      return;
    }

    const option = document.createElement('option');
    option.value = groupName;
    option.textContent = groupName;
    const newOption = selectEl.querySelector('option[value="__new__"]');
    selectEl.insertBefore(option, newOption || null);
    selectEl.value = groupName;
    previousValue = groupName;
  };

  selectEl.addEventListener('focus', () => {
    previousValue = selectEl.value || '';
  });

  selectEl.addEventListener('change', async () => {
    if (selectEl.value !== '__new__') {
      previousValue = selectEl.value || '';
      return;
    }

    const entered = await showPrompt({
      title: promptTitle,
      text: promptText,
      label: 'Nazwa grupy',
      placeholder: 'np. semestr5',
      confirmLabel: 'Utwórz',
      cancelLabel: 'Anuluj',
      validator: (value) => {
        if (!normalizeDeckGroup(value)) {
          return 'Nazwa grupy nie może być pusta.';
        }
        return true;
      },
    });
    if (entered === null) {
      selectEl.value = previousValue;
      return;
    }

    addOrSelectGroup(entered);
  });
}

function bindSettingsEvents(deckId) {
  const groupSelect = document.getElementById('set-deck-group-select');
  bindGroupSelectControl(groupSelect, {
    promptTitle: 'Nowa grupa talii',
    promptText: 'Podaj nazwę nowej grupy dla talii:',
  });

  const saveDeckMetaBtn = document.getElementById('btn-save-deck-meta');
  if (saveDeckMetaBtn) {
    saveDeckMetaBtn.addEventListener('click', () => {
      saveDeckMetadata(deckId);
    });
  }

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveDeckSettings(deckId);
  });

  document.getElementById('btn-restore-defaults').addEventListener('click', () => {
    storage.saveDeckSettings(deckId, {
      ...DEFAULT_SETTINGS,
      ...DEFAULT_DECK_BEHAVIOR_SETTINGS,
    });
    renderSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS, {
      deckMeta: getDeckMeta(deckId),
      canEditMeta: canEditDeckContent(deckId),
      groupOptions: getAvailableDeckGroups(getDeckScope(getDeckMeta(deckId)) === 'public' ? 'public' : 'private'),
    });
    bindSettingsEvents(deckId);
    showNotification('Przywrócono ustawienia domyślne.', 'info');
  });

  document.getElementById('btn-reset-progress').addEventListener('click', async () => {
    const confirmed = await showConfirm(
      'Resetuj postęp',
      'Czy na pewno chcesz zresetować postęp nauki? Wszystkie karty wrócą do stanu "nowe", a statystyki zostaną usunięte.'
    );
    if (confirmed) {
      deck.resetProgress(deckId);
      showNotification('Postęp talii został zresetowany.', 'info');
      returnFromSettings();
    }
  });
}

function saveDeckMetadata(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) {
    showNotification('Nie znaleziono talii.', 'error');
    return;
  }
  if (isDeckReadOnlyContent(deckMeta)) {
    showNotification('Talia ogólna jest tylko do odczytu.', 'info');
    return;
  }

  const nameInput = document.getElementById('set-deck-name');
  const descInput = document.getElementById('set-deck-description');
  const groupSelect = document.getElementById('set-deck-group-select');
  const groupInput = document.getElementById('set-deck-group');
  const nextName = (nameInput?.value || '').trim();
  const nextDescription = (descInput?.value || '').trim();
  const nextGroup = groupSelect
    ? normalizeDeckGroup(groupSelect.value || '')
    : normalizeDeckGroup(groupInput?.value || '');

  if (groupSelect && groupSelect.value === '__new__') {
    showNotification('Najpierw podaj nazwę nowej grupy w popupie.', 'error');
    return;
  }

  if (!nextName) {
    showNotification('Nazwa talii nie może być pusta.', 'error');
    return;
  }

  const decks = storage.getDecks();
  const idx = decks.findIndex((d) => d.id === deckId);
  if (idx < 0) {
    showNotification('Nie znaleziono talii.', 'error');
    return;
  }

  const nextDeckMeta = {
    ...decks[idx],
    name: nextName,
    description: nextDescription,
  };
  if (nextGroup) {
    nextDeckMeta.group = nextGroup;
  } else {
    delete nextDeckMeta.group;
  }
  decks[idx] = nextDeckMeta;
  storage.saveDecks(decks);
  syncOwnedDeckToSupabaseAsync(deckId);

  const settingsDeckName = document.getElementById('settings-deck-name');
  if (settingsDeckName) settingsDeckName.textContent = nextName;

  showNotification('Nazwa, opis i grupa talii zostały zapisane.', 'success');
}

function parseSteps(value) {
  return value.split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n) && n > 0);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function saveDeckSettings(deckId) {
  const builtInCalculationVariants = document.getElementById('set-builtInCalculationVariants')?.checked === true;
  const newCardsPerDay = clamp(parseInt(document.getElementById('set-newCardsPerDay').value) || 20, 1, 9999);
  const maxReviewsPerDay = clamp(parseInt(document.getElementById('set-maxReviewsPerDay').value) || 200, 1, 9999);
  const learningSteps = parseSteps(document.getElementById('set-learningSteps').value);
  const relearningSteps = parseSteps(document.getElementById('set-relearningSteps').value);
  const graduatingInterval = clamp(parseInt(document.getElementById('set-graduatingInterval').value) || 1, 1, 30);
  const easyInterval = clamp(parseInt(document.getElementById('set-easyInterval').value) || 4, 1, 60);
  const maximumInterval = clamp(parseInt(document.getElementById('set-maximumInterval').value) || 365, 1, 36500);

  if (learningSteps.length === 0) {
    showNotification('Kroki nauki muszą zawierać co najmniej jedną wartość.', 'error');
    return;
  }
  if (relearningSteps.length === 0) {
    showNotification('Kroki ponownej nauki muszą zawierać co najmniej jedną wartość.', 'error');
    return;
  }

  const deckSettings = {
    ...getSettingsForDeck(deckId),
    builtInCalculationVariants,
    newCardsPerDay,
    maxReviewsPerDay,
    learningSteps,
    relearningSteps,
    graduatingInterval,
    easyInterval,
    maximumInterval,
  };

  storage.saveDeckSettings(deckId, deckSettings);
  showNotification('Ustawienia zostały zapisane.', 'success');
  returnFromSettings();
}

// --- Study Session ---

function startStudySession() {
  let filterIds = getFilteredQuestionIds(currentDeckId);
  if (studyingFlagged) {
    // Study only flagged cards
    filterIds = deck.getFlaggedQuestionIds(currentDeckId, filterIds);
    queues = deck.buildQueues(currentDeckId, currentDeckSettings, filterIds, true);
  } else {
    queues = deck.buildQueues(currentDeckId, currentDeckSettings, filterIds, appSettings.flaggedInAnki);
  }
  sessionTotal = queues.counts.learningDue + queues.counts.reviewDue + queues.counts.newAvailable;
  studiedCount = 0;
  updateProgress(0, sessionTotal);
  showNextCard();
}

function showNextCard() {
  clearWaitTimer();
  studyPhase = null;
  const result = deck.getNextCard(queues, currentDeckSettings);

  if (!result) {
    navigateToComplete(currentDeckId);
    return;
  }

  if (result.source === 'learning_wait') {
    // Card is due soon but not yet — wait for it
    const delay = result.waitUntil - Date.now();
    if (delay <= 0) {
      // Actually due now
      currentCard = queues.learning.shift();
      currentSource = 'learning';
      showQuestionForCard(currentCard);
    } else {
      // Check if there are other cards we can show in the meantime
      // If not, either wait or end session
      if (queues.review.length > 0 || queues.newCards.length > 0) {
        // Skip the waiting card for now, try other queues
        const otherResult = tryOtherQueues();
        if (otherResult) {
          currentCard = otherResult.card;
          currentSource = otherResult.source;
          showQuestionForCard(currentCard);
          return;
        }
      }

      // Nothing else to do — wait for the learning card (like Anki)
      showLearningWaitScreen(delay);
      waitTimer = setTimeout(() => showNextCard(), delay + 100);
    }
    return;
  }

  currentCard = result.card;
  currentSource = result.source;
  showQuestionForCard(currentCard);
}

function tryOtherQueues() {
  // Try review
  if (queues.review.length > 0 && queues.counts.reviewsToday < currentDeckSettings.maxReviewsPerDay) {
    return { card: queues.review.shift(), source: 'review' };
  }
  // Try new
  if (queues.newCards.length > 0) {
    const card = queues.newCards.shift();
    card.state = 'learning';
    card.stepIndex = 0;
    card.firstStudiedDate = card.firstStudiedDate || Date.now();
    card.dueDate = Date.now();
    // Save immediately so NEW→LEARNING transition persists if user exits before rating
    deck.saveCardState(card, currentDeckId);
    return { card, source: 'new' };
  }
  return null;
}

function showQuestionForCard(card) {
  const questions = storage.getQuestions(currentDeckId);
  currentQuestion = questions.find(q => q.id === card.questionId);

  if (!currentQuestion) {
    // Question missing from data — skip this card
    showNextCard();
    return;
  }

  // Apply randomization: template questions always, hardcoded only when setting is on
  const shouldRandomize = shouldRandomizeQuestion(currentQuestion, currentDeckSettings);
  if (shouldRandomize) {
    const variant = randomize(currentQuestion.id, currentQuestion);
    if (variant) {
      currentQuestion = { ...currentQuestion, text: variant.text, answers: variant.answers };
      if (variant.explanation !== undefined) currentQuestion.explanation = variant.explanation;
    }
  }

  const selectionMode = getEffectiveSelectionModeForDeck(currentQuestion, currentDeckId);
  const isMultiSelect = selectionMode === 'multiple';
  const showReroll = shouldRandomize;

  currentCardFlagged = !!currentCard.flagged;
  currentShuffledAnswers = renderQuestion(
    currentQuestion,
    null,
    sessionTotal,
    selectionMode,
    appSettings.shuffleAnswers,
    showReroll,
    currentCardFlagged,
    canEditDeckContent(currentDeckId)
  );
  selectedAnswerIds = new Set();

  updateStudyCounts(
    queues.learning.length + (currentSource === 'learning' ? 1 : 0),
    queues.review.length + (currentSource === 'review' ? 1 : 0),
    queues.newCards.length + (currentSource === 'new' ? 1 : 0),
    currentSource
  );

  studyPhase = 'question';
  bindQuestionEvents(isMultiSelect);
  bindRerollButton();
  bindFlagButton();
}

// --- Event Binding ---

function getAuthFormValues() {
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const passwordConfirmInput = document.getElementById('auth-password-confirm');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const password = passwordInput ? passwordInput.value : '';
  const passwordConfirm = passwordConfirmInput ? passwordConfirmInput.value : '';
  return { email, password, passwordConfirm };
}

function setAuthFormBusy(isBusy) {
  const submitBtn = document.getElementById('btn-auth-submit');
  const loginModeBtn = document.getElementById('btn-auth-mode-login');
  const signupModeBtn = document.getElementById('btn-auth-mode-signup');
  const resetPasswordBtn = document.getElementById('btn-auth-reset-password');
  const googleBtn = document.getElementById('btn-auth-google');
  const guestBtn = document.getElementById('btn-auth-guest');
  if (submitBtn) submitBtn.disabled = isBusy;
  if (loginModeBtn) loginModeBtn.disabled = isBusy;
  if (signupModeBtn) signupModeBtn.disabled = isBusy;
  if (resetPasswordBtn) resetPasswordBtn.disabled = isBusy;
  if (googleBtn) googleBtn.disabled = isBusy;
  if (guestBtn) guestBtn.disabled = isBusy;
}

function validateLoginInputs(email, password) {
  if (!email || !password) {
    showAuthMessage('Podaj e-mail i hasło.', 'error');
    return false;
  }
  return true;
}

function validateSignupInputs(email, password, passwordConfirm) {
  if (!email || !password || !passwordConfirm) {
    showAuthMessage('Podaj e-mail, hasło i potwierdzenie hasła.', 'error');
    return false;
  }
  if (password.length < 6) {
    showAuthMessage('Hasło musi mieć co najmniej 6 znaków.', 'error');
    return false;
  }
  if (password !== passwordConfirm) {
    showAuthMessage('Hasła nie są takie same.', 'error');
    return false;
  }
  return true;
}

function validatePasswordResetInput(email) {
  if (!email) {
    showAuthMessage('Podaj e-mail, aby wysłać link resetu hasła.', 'error');
    return false;
  }
  return true;
}

async function handleAuthSubmit() {
  if (authMode === 'signup') {
    await handleAuthSignup();
    return;
  }
  if (authMode === 'reset') {
    await handleAuthPasswordReset();
    return;
  }
  await handleAuthLogin();
}

async function handleAuthLogin() {
  const { email, password } = getAuthFormValues();
  if (!isSupabaseConfigured()) {
    showAuthMessage('Logowanie niedostępne: brak konfiguracji Supabase.', 'error');
    return;
  }
  if (!validateLoginInputs(email, password)) return;

  setAuthFormBusy(true);
  showAuthMessage('Logowanie...', 'info');

  try {
    const { data, error } = await signInWithPassword(email, password);
    if (error) throw error;
    if (!data?.user) {
      throw new Error('Nie udało się pobrać danych użytkownika po logowaniu.');
    }

    await bootstrapUserSession(data.user);
    handleStartupOpen();
  } catch (error) {
    showAuthMessage(error.message || 'Błąd logowania.', 'error');
  } finally {
    setAuthFormBusy(false);
  }
}

async function handleAuthSignup() {
  const { email, password, passwordConfirm } = getAuthFormValues();
  if (!isSupabaseConfigured()) {
    showAuthMessage('Rejestracja niedostępna: brak konfiguracji Supabase.', 'error');
    return;
  }
  if (!validateSignupInputs(email, password, passwordConfirm)) return;

  setAuthFormBusy(true);
  showAuthMessage('Tworzenie konta...', 'info');

  try {
    const { data, error } = await signUpWithPassword(email, password);
    if (error) throw error;

    if (data?.session?.user) {
      await bootstrapUserSession(data.session.user);
      handleStartupOpen();
      return;
    }

    setAuthMode('login', { keepMessage: true });
    showAuthMessage('Konto utworzone. Potwierdź rejestrację w e-mailu i zaloguj się.', 'info');
  } catch (error) {
    showAuthMessage(error.message || 'Błąd rejestracji.', 'error');
  } finally {
    setAuthFormBusy(false);
  }
}

async function handleAuthPasswordReset() {
  const { email } = getAuthFormValues();
  if (!isSupabaseConfigured()) {
    showAuthMessage('Reset hasła niedostępny: brak konfiguracji Supabase.', 'error');
    return;
  }
  if (!validatePasswordResetInput(email)) return;

  setAuthFormBusy(true);
  showAuthMessage('Wysyłanie maila resetującego hasło...', 'info');

  try {
    const { error } = await sendPasswordResetEmail(email);
    if (error) throw error;
    showAuthMessage('Wysłano link resetu hasła. Sprawdź skrzynkę e-mail (oraz spam).', 'info');
  } catch (error) {
    showAuthMessage(error.message || 'Nie udało się wysłać maila resetu hasła.', 'error');
  } finally {
    setAuthFormBusy(false);
  }
}

async function handleAuthGoogle() {
  if (!isSupabaseConfigured()) {
    showAuthMessage('Google OAuth niedostępne: brak konfiguracji Supabase.', 'error');
    return;
  }

  setAuthFormBusy(true);
  showAuthMessage('Przekierowanie do Google...', 'info');

  try {
    const { data, error } = await signInWithGoogle();
    if (error) throw error;
    if (!data?.url) {
      setAuthFormBusy(false);
      showAuthMessage('Nie udało się rozpocząć logowania Google.', 'error');
    }
  } catch (error) {
    showAuthMessage(error.message || 'Błąd logowania Google.', 'error');
    setAuthFormBusy(false);
  }
}

async function handleContinueAsGuest() {
  await bootstrapGuestSession();
}

function bindAuthEvents() {
  if (authEventsBound) return;
  authEventsBound = true;

  const authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleAuthSubmit();
    });
  }

  const loginModeBtn = document.getElementById('btn-auth-mode-login');
  if (loginModeBtn) {
    loginModeBtn.addEventListener('click', () => {
      setAuthMode('login');
    });
  }

  const signupModeBtn = document.getElementById('btn-auth-mode-signup');
  if (signupModeBtn) {
    signupModeBtn.addEventListener('click', () => {
      setAuthMode('signup');
    });
  }

  const resetPasswordBtn = document.getElementById('btn-auth-reset-password');
  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener('click', async () => {
      if (authMode === 'reset') {
        setAuthMode('login');
        return;
      }
      setAuthMode('reset');
    });
  }

  const googleBtn = document.getElementById('btn-auth-google');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      await handleAuthGoogle();
    });
  }

  const guestBtn = document.getElementById('btn-auth-guest');
  if (guestBtn) {
    guestBtn.addEventListener('click', async () => {
      await handleContinueAsGuest();
    });
  }

  const authActionBtn = document.getElementById('btn-auth-logout');
  if (authActionBtn) {
    authActionBtn.addEventListener('click', async () => {
      closeUserMenu();
      if (sessionMode === 'user') {
        try {
          const { error } = await signOutUser();
          if (error) throw error;
          await bootstrapGuestSession();
          showNotification('Wylogowano. Kontynuujesz w trybie gościa.', 'info');
        } catch (error) {
          showNotification(`Błąd wylogowania: ${error.message}`, 'error');
        }
        return;
      }

      showAuthPanel('Zaloguj się lub kontynuuj jako gość.', 'info');
    });
  }

  setAuthMode('login', { keepMessage: true });
}

function bindGlobalEvents() {
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  const userMenuBtn = document.getElementById('btn-user-menu');
  const userMenu = document.getElementById('user-menu');
  if (userMenuBtn && userMenu) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUserMenu();
    });
    userMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    document.addEventListener('click', () => {
      if (userMenuOpen) closeUserMenu();
    });
  }

  const openUserBtn = document.getElementById('btn-open-user-view');
  if (openUserBtn) {
    openUserBtn.addEventListener('click', () => {
      navigateToUserProfile();
    });
  }

  const openAdminBtn = document.getElementById('btn-open-admin-view');
  if (openAdminBtn) {
    openAdminBtn.addEventListener('click', async () => {
      await navigateToAdminPanel();
    });
  }

  // Font size controls
  document.getElementById('btn-font-decrease').addEventListener('click', () => changeFontSize(-1));
  document.getElementById('btn-font-increase').addEventListener('click', () => changeFontSize(1));

  // Home button (title)
  document.getElementById('btn-go-home').addEventListener('click', () => {
    if (!isSessionReady()) {
      showAuthPanel('Zaloguj się lub kontynuuj jako gość.', 'info');
      return;
    }
    navigateToDeckList();
  });

  // App settings button
  document.getElementById('btn-app-settings').addEventListener('click', () => {
    if (!isSessionReady()) {
      showAuthPanel('Zaloguj się lub kontynuuj jako gość.', 'info');
      return;
    }
    navigateToAppSettings();
  });

  // Docs button
  document.getElementById('btn-docs').addEventListener('click', () => {
    navigateToDocs();
  });

  // File input
  document.getElementById('file-input').addEventListener('change', async (e) => {
    if (!isSessionReady()) return;
    if (sessionMode !== 'user') {
      e.target.value = '';
      showNotification('Import prywatnych talii wymaga zalogowania.', 'info');
      showAuthPanel('Aby importować własne talie, zaloguj się.', 'info');
      return;
    }
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset

    const result = await importFromFile(file, {
      scope: 'private',
      source: 'user-import',
      readOnlyContent: false,
      privateDeckLimit: MAX_PRIVATE_DECKS_PER_USER,
      reservedDeckIds: [...new Set([
        ...getPublicDeckIds(),
        ...storage.getDecks()
          .filter((d) => getDeckScope(d) !== 'private')
          .map((d) => d.id),
      ])],
    });
    if (result.valid) {
      showNotification(
        `Zaimportowano "${result.deck.name}": ${result.added} nowych, ${result.updated} istniejących, ${result.total} łącznie.`,
        'success'
      );
      navigateToDeckList('private');
    } else {
      showNotification(`Błąd importu: ${result.errors[0]}`, 'error');
    }
  });

  // Back buttons
  document.getElementById('btn-back-to-decks').addEventListener('click', () => {
    clearWaitTimer();
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-complete').addEventListener('click', () => {
    const deckMeta = currentDeckId ? storage.getDecks().find(d => d.id === currentDeckId) : null;
    if (deckMeta && deckMeta.categories) {
      navigateToCategorySelect(currentDeckId);
    } else {
      navigateToDeckList();
    }
  });
  document.getElementById('btn-back-from-categories').addEventListener('click', () => {
    navigateToDeckList();
  });
  document.getElementById('btn-back-from-mode-select').addEventListener('click', () => {
    const deckMeta = currentDeckId ? storage.getDecks().find(d => d.id === currentDeckId) : null;
    if (deckMeta && deckMeta.categories) {
      navigateToCategorySelect(currentDeckId);
    } else {
      navigateToDeckList();
    }
  });
  document.getElementById('btn-back-from-test').addEventListener('click', () => {
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-test-result').addEventListener('click', () => {
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-browse').addEventListener('click', () => {
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-app-settings').addEventListener('click', () => {
    returnFromAppSettings();
  });
  document.getElementById('btn-back-from-docs').addEventListener('click', () => {
    returnFromDocs();
  });
  document.getElementById('btn-back-from-settings').addEventListener('click', () => {
    returnFromSettings();
  });
  document.getElementById('btn-back-from-user').addEventListener('click', () => {
    navigateToDeckList();
  });
  document.getElementById('btn-back-from-admin').addEventListener('click', () => {
    navigateToDeckList();
  });
}

function getSharedCatalogDeckById(sharedDeckId) {
  return sharedCatalogState.items.find((item) => item.id === sharedDeckId) || null;
}

function showCopyDeckModeModal(deckName) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">Kopiowanie talii</div>
        <div class="modal-text" id="copy-mode-text"></div>
        <div class="modal-actions" style="display:grid; gap:8px;">
          <button class="btn btn-primary" type="button" data-copy-mode="reset">Start od zera</button>
          <button class="btn btn-secondary" type="button" data-copy-mode="with-progress">Kopiuj postęp</button>
          <button class="btn btn-secondary" type="button" data-copy-mode="cancel">Anuluj</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const textEl = overlay.querySelector('#copy-mode-text');
    if (textEl) {
      textEl.textContent = `Wybierz tryb kopiowania dla "${deckName}".`;
    }

    const finalize = (mode) => {
      overlay.remove();
      resolve(mode);
    };

    overlay.querySelectorAll('[data-copy-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.copyMode;
        if (mode === 'cancel') {
          finalize(null);
          return;
        }
        finalize(mode);
      });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finalize(null);
    });
  });
}

function downloadJSONFile(filename, data) {
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function exportDeckToJSON(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) {
    showNotification('Nie znaleziono talii do eksportu.', 'error');
    return;
  }
  if (getDeckScope(deckMeta) === 'public') {
    try {
      await ensurePublicDeckLoaded(deckId);
    } catch (error) {
      showNotification(`Nie udało się załadować talii do eksportu: ${error.message}`, 'error');
      return;
    }
  }

  const questions = storage.getQuestions(deckId);
  if (!Array.isArray(questions) || questions.length === 0) {
    showNotification('Ta talia nie ma pytań do eksportu.', 'info');
    return;
  }

  const deckPayload = {
    id: deckMeta.id,
    name: deckMeta.name || deckMeta.id,
    description: deckMeta.description || '',
    version: Number(deckMeta.version) || 1,
  };
  const defaultSelectionMode = normalizeSelectionMode(deckMeta.defaultSelectionMode, null);
  if (defaultSelectionMode) {
    deckPayload.defaultSelectionMode = defaultSelectionMode;
  }

  const group = normalizeDeckGroup(deckMeta.group);
  if (group) {
    deckPayload.group = group;
  }
  if (Array.isArray(deckMeta.categories) && deckMeta.categories.length > 0) {
    deckPayload.categories = cloneJSON(deckMeta.categories, []);
  }

  const exportPayload = {
    deck: deckPayload,
    questions: cloneJSON(questions, []),
  };

  try {
    const fileBase = slugifyDeckId(deckMeta.name || deckMeta.id) || slugifyDeckId(deckMeta.id) || `talia-${Date.now().toString(36)}`;
    downloadJSONFile(`${fileBase}.json`, JSON.stringify(exportPayload, null, 2));
    showNotification(`Wyeksportowano talię "${deckPayload.name}".`, 'success');
  } catch (error) {
    showNotification(`Nie udało się wyeksportować talii: ${error.message}`, 'error');
  }
}

async function copyDeckToPrivate(options = {}) {
  if (sessionMode !== 'user') {
    showNotification('Kopiowanie talii wymaga zalogowania.', 'info');
    showAuthPanel('Aby kopiować talie, zaloguj się.', 'info');
    return;
  }
  if (!canCreateMorePrivateDecks()) {
    return;
  }

  const sourceName = String(options.name || '').trim() || 'Talia';
  const sourceDescription = String(options.description || '').trim();
  const sourceGroup = normalizeDeckGroup(options.group || '');
  const sourceDefaultSelectionMode = normalizeSelectionMode(options.defaultSelectionMode, null);
  const sourceCategories = Array.isArray(options.categories) ? cloneJSON(options.categories, null) : null;
  const sourceQuestions = Array.isArray(options.questions) ? cloneJSON(options.questions, []) : [];
  const sourceCards = Array.isArray(options.cards) ? cloneJSON(options.cards, []) : [];
  const sourceStats = cloneJSON(options.stats, {});

  if (sourceQuestions.length === 0) {
    showNotification('Nie można skopiować pustej talii.', 'info');
    return;
  }

  const mode = await showCopyDeckModeModal(sourceName);
  if (!mode) return;
  const copyProgress = mode === 'with-progress';
  const nextDeckId = getUniqueDeckId(`${sourceName}-kopia`);
  const nextName = `${sourceName} (kopia)`;

  const decks = storage.getDecks();
  const nextDeckMeta = {
    id: nextDeckId,
    name: nextName,
    description: sourceDescription,
    questionCount: sourceQuestions.length,
    importedAt: Date.now(),
    version: 1,
    scope: 'private',
    source: 'user-copy',
    readOnlyContent: false,
    isArchived: false,
    isShared: false,
  };
  if (sourceDefaultSelectionMode) {
    nextDeckMeta.defaultSelectionMode = sourceDefaultSelectionMode;
  }
  if (sourceGroup) nextDeckMeta.group = sourceGroup;
  if (sourceCategories) nextDeckMeta.categories = sourceCategories;
  decks.push(nextDeckMeta);
  storage.saveDecks(decks);
  storage.saveQuestions(nextDeckId, sourceQuestions);

  const cardMap = new Map(sourceCards.map((card) => [card.questionId, card]));
  const nextCards = sourceQuestions.map((question) => {
    if (!copyProgress) return createCard(question.id, nextDeckId);
    const sourceCard = cardMap.get(question.id);
    if (!sourceCard) return createCard(question.id, nextDeckId);
    return {
      ...sourceCard,
      questionId: question.id,
      deckId: nextDeckId,
    };
  });
  storage.saveCards(nextDeckId, nextCards);
  storage.saveStats(nextDeckId, copyProgress ? sourceStats : {});

  showPrivateArchived = false;
  activeDeckScope = 'private';
  showNotification(`Skopiowano talię jako "${nextName}".`, 'success');
  navigateToDeckList('private');
}

async function copyDeckFromLocal(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) return;
  if (getDeckScope(deckMeta) === 'public') {
    try {
      await ensurePublicDeckLoaded(deckId);
    } catch (error) {
      showNotification(`Nie udało się załadować talii do kopiowania: ${error.message}`, 'error');
      return;
    }
  }
  await copyDeckToPrivate({
    name: deckMeta.name || deckMeta.id,
    description: deckMeta.description || '',
    group: deckMeta.group || '',
    defaultSelectionMode: deckMeta.defaultSelectionMode || null,
    categories: deckMeta.categories || null,
    questions: storage.getQuestions(deckId),
    cards: storage.getCards(deckId),
    stats: storage.getStats(deckId),
  });
}

async function copyDeckFromSharedCatalog(sharedDeckId) {
  const sharedDeck = getSharedCatalogDeckById(sharedDeckId);
  if (!sharedDeck) {
    showNotification('Nie znaleziono wybranej talii w katalogu.', 'error');
    return;
  }
  await copyDeckToPrivate({
    name: sharedDeck.name || sharedDeck.id,
    description: sharedDeck.description || '',
    group: sharedDeck.deck_group || '',
    defaultSelectionMode: sharedDeck.defaultSelectionMode || sharedDeck.default_selection_mode || null,
    categories: sharedDeck.categories || null,
    questions: sharedDeck.questions || [],
  });
}

async function handleShareToggle(deckId) {
  const deckMeta = getDeckMeta(deckId);
  if (!deckMeta) return;
  if (getDeckScope(deckMeta) !== 'private') return;
  if (sessionMode !== 'user') {
    showAuthPanel('Aby udostępniać talie, zaloguj się.', 'info');
    return;
  }

  if (deckMeta.isShared === true) {
    const sharedDeckId = String(deckMeta.sharedDeckId || '').trim();
    if (!sharedDeckId) {
      showNotification('Brak identyfikatora udostępnionej talii.', 'error');
      return;
    }
    const confirmed = await showConfirmWithOptions(
      'Wyłącz udostępnianie',
      `Czy wyłączyć udostępnianie talii "${deckMeta.name}"?`,
      { confirmLabel: 'Wyłącz' }
    );
    if (!confirmed) return;
    try {
      await unpublishSharedDeck(sharedDeckId);
      updateLocalDeckMeta(deckId, (currentMeta) => ({
        ...currentMeta,
        isShared: false,
      }));
      showNotification('Udostępnianie talii zostało wyłączone.', 'info');
      if (activeDeckScope === 'shared') {
        await refreshSharedCatalog();
      }
      navigateToDeckList('private');
    } catch (error) {
      showNotification(`Nie udało się wyłączyć udostępniania: ${error.message}`, 'error');
    }
    return;
  }

  try {
    if (!currentUserProfile) {
      currentUserProfile = await fetchMyProfile();
    }
    await pushSharedDeckToSupabase(deckId);
    showNotification('Talia została udostępniona.', 'success');
    if (activeDeckScope === 'shared') {
      await refreshSharedCatalog();
    }
    navigateToDeckList('private');
  } catch (error) {
    showNotification(`Nie udało się udostępnić talii: ${error.message}`, 'error');
  }
}

async function handleUnsubscribeFromDeck(deckId, sharedDeckIdFromUI = '') {
  const deckMeta = getDeckMeta(deckId);
  const sharedDeckId = String(sharedDeckIdFromUI || deckMeta?.sharedDeckId || '').trim();
  if (!sharedDeckId) return;
  const confirmed = await showConfirmWithOptions(
    'Odsubskrybuj talię',
    'Czy na pewno chcesz usunąć subskrypcję tej talii?',
    { confirmLabel: 'Odsubskrybuj' }
  );
  if (!confirmed) return;

  try {
    await unsubscribeFromSharedDeck(sharedDeckId);
    await syncSubscribedDecksForCurrentUser();
    showNotification('Subskrypcja została usunięta.', 'success');
    navigateToDeckList('private', { skipSubscribedSync: true });
  } catch (error) {
    showNotification(`Nie udało się odsubskrybować talii: ${error.message}`, 'error');
  }
}

async function handleSubscribeFromCatalog(sharedDeckId) {
  if (sessionMode !== 'user') {
    showNotification('Subskrypcja wymaga zalogowania.', 'info');
    showAuthPanel('Aby subskrybować talie, zaloguj się.', 'info');
    return;
  }
  const sharedDeck = getSharedCatalogDeckById(sharedDeckId);
  if (sharedDeck && currentUser && String(sharedDeck.owner_user_id || '') === String(currentUser.id)) {
    showNotification('Nie możesz subskrybować własnej talii.', 'info');
    return;
  }
  try {
    await subscribeToSharedDeck(sharedDeckId);
    await syncSubscribedDecksForCurrentUser();
    await refreshSharedCatalog();
    showNotification('Talia została zasubskrybowana.', 'success');
    if (activeDeckScope === 'shared') {
      navigateToDeckList('shared', { skipSharedRefresh: true });
    }
  } catch (error) {
    showNotification(`Nie udało się zasubskrybować talii: ${error.message}`, 'error');
  }
}

async function handleUnsubscribeFromCatalog(sharedDeckId) {
  if (sessionMode !== 'user') return;
  try {
    await unsubscribeFromSharedDeck(sharedDeckId);
    await syncSubscribedDecksForCurrentUser();
    await refreshSharedCatalog();
    showNotification('Subskrypcja została usunięta.', 'success');
    if (activeDeckScope === 'shared') {
      navigateToDeckList('shared', { skipSharedRefresh: true });
    }
  } catch (error) {
    showNotification(`Nie udało się odsubskrybować talii: ${error.message}`, 'error');
  }
}

function bindDeckListEvents() {
  const closeAllDeckMenus = () => {
    document.querySelectorAll('.deck-card-menu.open').forEach((menu) => {
      menu.classList.remove('open');
    });
    document.querySelectorAll('.deck-card.menu-open').forEach((card) => {
      card.classList.remove('menu-open');
    });
  };

  document.querySelectorAll('.deck-scope-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.dataset.scope;
      if (scope === 'public' || scope === 'private' || scope === 'shared') {
        navigateToDeckList(scope);
      }
    });
  });

  const privateLoginBtn = document.getElementById('btn-login-private-view');
  if (privateLoginBtn) {
    privateLoginBtn.addEventListener('click', () => {
      showAuthPanel('Aby zobaczyć i importować własne talie, zaloguj się.', 'info');
    });
  }

  const privateArchivedToggleBtn = document.getElementById('btn-toggle-private-archived');
  if (privateArchivedToggleBtn) {
    privateArchivedToggleBtn.addEventListener('click', () => {
      showPrivateArchived = !showPrivateArchived;
      navigateToDeckList('private');
    });
  }

  const deckListContainer = document.getElementById('deck-list-container');
  if (deckListContainer && deckListContainer.dataset.menuCloseBound !== '1') {
    deckListContainer.addEventListener('click', () => {
      closeAllDeckMenus();
    });
    deckListContainer.dataset.menuCloseBound = '1';
  }

  document.querySelectorAll('.deck-card-menu-trigger').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = btn.closest('.deck-card-menu');
      if (!menu) return;
      const card = btn.closest('.deck-card');
      const wasOpen = menu.classList.contains('open');
      closeAllDeckMenus();
      if (!wasOpen) {
        menu.classList.add('open');
        if (card) {
          card.classList.add('menu-open');
        }
      }
    });
  });

  document.querySelectorAll('.deck-card-menu-dropdown').forEach((dropdown) => {
    dropdown.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });

  document.querySelectorAll('.deck-card-menu-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      closeAllDeckMenus();
    });
  });

  document.querySelectorAll('.deck-card[data-openable="1"]').forEach((cardEl) => {
    cardEl.addEventListener('click', async () => {
      const deckId = cardEl.dataset.deckId;
      if (!deckId) return;
      const deckMeta = storage.getDecks().find(d => d.id === deckId);
      if (deckMeta && getDeckScope(deckMeta) === 'public') {
        try {
          await ensurePublicDeckLoaded(deckId);
        } catch (error) {
          showNotification(`Nie udało się załadować talii: ${error.message}`, 'error');
          return;
        }
      }
      if (deckMeta && deckMeta.categories) {
        navigateToCategorySelect(deckId);
      } else {
        navigateToModeSelect(deckId);
      }
    });
  });

  // Settings buttons on deck cards
  document.querySelectorAll('.btn-deck-settings').forEach(btn => {
    btn.addEventListener('click', async () => {
      const deckId = String(btn.dataset.deckId || '').trim();
      if (!deckId) return;
      const deckMeta = getDeckMeta(deckId);
      if (deckMeta && getDeckScope(deckMeta) === 'public') {
        try {
          await ensurePublicDeckLoaded(deckId);
        } catch (error) {
          showNotification(`Nie udało się załadować talii: ${error.message}`, 'error');
          return;
        }
      }
      navigateToSettings(deckId, 'deck-list');
    });
  });

  document.querySelectorAll('.btn-copy-deck').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deckId = btn.dataset.deckId;
      if (!deckId) return;
      await copyDeckFromLocal(deckId);
    });
  });

  document.querySelectorAll('.btn-export-deck').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deckId = btn.dataset.deckId;
      if (!deckId) return;
      await exportDeckToJSON(deckId);
    });
  });

  document.querySelectorAll('.btn-share-deck').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deckId = btn.dataset.deckId;
      if (!deckId) return;
      await handleShareToggle(deckId);
    });
  });

  document.querySelectorAll('.btn-unsubscribe-deck').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deckId = btn.dataset.deckId;
      if (!deckId) return;
      await handleUnsubscribeFromDeck(deckId, btn.dataset.sharedDeckId || '');
    });
  });

  // Delete buttons
  document.querySelectorAll('.btn-delete-deck').forEach(btn => {
    btn.addEventListener('click', async () => {
      const deckId = btn.dataset.deckId;
      const deckName = btn.dataset.deckName;
      const deckMeta = getDeckMeta(deckId);
      if (!deckMeta) return;
      const isPublicDeck = getDeckScope(deckMeta) === 'public';
      const isHiddenPublicDeck = btn.dataset.publicHidden === '1' || deckMeta.adminOnly === true;
      const isArchivedPrivateDeck = btn.dataset.privateArchived === '1' || deckMeta.isArchived === true;

      if (isPublicDeck && !canManagePublicDecks()) {
        showNotification('Talii ogólnej nie można ukrywać.', 'info');
        return;
      }

      if (isPublicDeck) {
        const dialogTitle = isHiddenPublicDeck ? 'Pokaż talię ogólną' : 'Ukryj talię ogólną';
        const dialogText = isHiddenPublicDeck
          ? `Czy pokazać "${deckName}" ponownie wszystkim użytkownikom?`
          : `Czy ukryć "${deckName}" dla zwykłych użytkowników? Admin/dev nadal będą ją widzieć i edytować.`;
        const confirmed = await showConfirmWithOptions(dialogTitle, dialogText, {
          confirmLabel: isHiddenPublicDeck ? 'Pokaż' : 'Ukryj',
        });
        if (!confirmed) return;

        try {
          if (isHiddenPublicDeck) {
            await setPublicDeckVisibility(deckId, false);
            showNotification('Talia ogólna została ponownie pokazana.', 'success');
          } else {
            await setPublicDeckVisibility(deckId, true);
            showNotification('Talia ogólna została ukryta dla zwykłych użytkowników.', 'info');
          }
          await syncPublicDecksForCurrentUser({ allowFallback: false });
          navigateToDeckList('public');
        } catch (error) {
          showNotification(`Nie udało się zmienić widoczności talii: ${error.message}`, 'error');
        }
        return;
      }

      if (isArchivedPrivateDeck) {
        const decks = storage.getDecks();
        const idx = decks.findIndex((d) => d.id === deckId);
        if (idx < 0) return;
        decks[idx] = { ...decks[idx], isArchived: false };
        storage.saveDecks(decks);
        showNotification('Talia prywatna została przywrócona z archiwum.', 'success');
        navigateToDeckList('private');
        return;
      }

      const confirmed = await showConfirm(
        'Archiwizuj talię',
        `Czy chcesz zarchiwizować "${deckName}"? Nie zostanie usunięta, ale zniknie z aktywnej listy talii.`,
        { confirmLabel: 'Archiwizuj' }
      );
      if (confirmed) {
        const decks = storage.getDecks();
        const idx = decks.findIndex((d) => d.id === deckId);
        if (idx < 0) return;
        decks[idx] = { ...decks[idx], isArchived: true };
        storage.saveDecks(decks);
        showNotification('Talia została przeniesiona do archiwum prywatnego.', 'info');
        showPrivateArchived = false;
        navigateToDeckList('private');
      }
    });
  });

  document.querySelectorAll('.btn-remove-private-deck').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const deckId = String(btn.dataset.deckId || '').trim();
      const deckMeta = getDeckMeta(deckId);
      if (!deckMeta) return;
      if (getDeckScope(deckMeta) !== 'private') return;

      const deckName = deckMeta.name || deckId;
      const sharedWarning = deckMeta.isShared === true
        ? ' Udostępnianie tej talii zostanie też wyłączone.'
        : '';
      const confirmed = await showConfirmWithOptions(
        'Usuń talię',
        `Czy na pewno chcesz trwale usunąć "${deckName}"? Ta operacja usunie pytania, postęp i ustawienia.${sharedWarning}`,
        { confirmLabel: 'Usuń' }
      );
      if (!confirmed) return;

      try {
        await deletePrivateDeck(deckId);
        showNotification('Talia została usunięta.', 'success');
        navigateToDeckList('private');
      } catch (error) {
        showNotification(`Nie udało się usunąć talii: ${error.message}`, 'error');
      }
    });
  });

  const privateImportBtn = document.getElementById('btn-import-private');
  if (privateImportBtn) {
    privateImportBtn.addEventListener('click', () => {
      triggerPrivateImport();
    });
  }

  const createDeckBtn = document.getElementById('btn-create-deck');
  if (createDeckBtn) {
    createDeckBtn.addEventListener('click', () => {
      openCreateDeckModal();
    });
  }

  const sharedSearchInput = document.getElementById('shared-search-input');
  if (sharedSearchInput) {
    sharedSearchInput.addEventListener('input', async () => {
      const queryValue = sharedSearchInput.value || '';
      const selectionStart = sharedSearchInput.selectionStart;
      const selectionEnd = sharedSearchInput.selectionEnd;
      sharedCatalogState.query = queryValue;
      sharedCatalogState.page = 1;
      const requestSeq = ++sharedSearchRequestSeq;
      await refreshSharedCatalog();
      if (requestSeq !== sharedSearchRequestSeq) return;
      navigateToDeckList('shared', { skipSharedRefresh: true });

      const nextInput = document.getElementById('shared-search-input');
      if (!nextInput) return;
      const fallbackPos = nextInput.value.length;
      const nextSelectionStart = Number.isFinite(selectionStart)
        ? Math.min(selectionStart, fallbackPos)
        : fallbackPos;
      const nextSelectionEnd = Number.isFinite(selectionEnd)
        ? Math.min(selectionEnd, fallbackPos)
        : nextSelectionStart;
      nextInput.focus({ preventScroll: true });
      try {
        nextInput.setSelectionRange(nextSelectionStart, nextSelectionEnd);
      } catch {
        // setSelectionRange may fail in some browsers/input states
      }
    });
  }

  document.querySelectorAll('.btn-shared-page').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const dir = parseInt(btn.dataset.dir, 10);
      if (!Number.isFinite(dir)) return;
      const nextPage = Math.max(1, sharedCatalogState.page + dir);
      sharedCatalogState.page = nextPage;
      await refreshSharedCatalog();
      navigateToDeckList('shared', { skipSharedRefresh: true });
    });
  });

  document.querySelectorAll('.btn-shared-subscribe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sharedDeckId = btn.dataset.sharedDeckId;
      if (!sharedDeckId) return;
      await handleSubscribeFromCatalog(sharedDeckId);
    });
  });

  document.querySelectorAll('.btn-shared-unsubscribe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sharedDeckId = btn.dataset.sharedDeckId;
      if (!sharedDeckId) return;
      await handleUnsubscribeFromCatalog(sharedDeckId);
    });
  });

  document.querySelectorAll('.btn-shared-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sharedDeckId = btn.dataset.sharedDeckId;
      if (!sharedDeckId) return;
      await copyDeckFromSharedCatalog(sharedDeckId);
    });
  });
}

function openCreateDeckModal() {
  if (sessionMode !== 'user') {
    showNotification('Tworzenie własnych talii wymaga zalogowania.', 'info');
    showAuthPanel('Aby tworzyć własne talie, zaloguj się.', 'info');
    return;
  }
  if (!canCreateMorePrivateDecks()) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box deck-create-modal">
      <div class="modal-title">Nowa talia</div>
      <div class="modal-text">Utwórz prywatną talię i dodawaj pytania ręcznie w dowolnym momencie.</div>
      <form class="modal-form" id="create-deck-form">
        <div class="modal-form-group">
          <label class="modal-form-label" for="create-deck-name">Nazwa talii</label>
          <input class="modal-form-input" id="create-deck-name" type="text" required>
        </div>
        <div class="modal-form-group">
          <label class="modal-form-label" for="create-deck-group-select">Grupa (opcjonalnie)</label>
          <select class="modal-form-input" id="create-deck-group-select"></select>
          <div class="modal-form-hint">Wybierz istniejącą grupę albo utwórz nową.</div>
        </div>
        <div class="modal-form-group">
          <label class="modal-form-label" for="create-deck-id">ID talii</label>
          <input class="modal-form-input" id="create-deck-id" type="text" required>
          <div class="modal-form-hint">Dozwolone: litery, cyfry, myślnik i podkreślenie.</div>
        </div>
        <div class="modal-form-group">
          <label class="modal-form-label" for="create-deck-description">Opis (opcjonalnie)</label>
          <textarea class="modal-form-textarea" id="create-deck-description"></textarea>
        </div>
        <div class="modal-form-error" id="create-deck-error"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="btn-create-deck-cancel">Anuluj</button>
          <button class="btn btn-primary" type="submit">Utwórz talię</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#create-deck-form');
  const nameInput = overlay.querySelector('#create-deck-name');
  const groupSelect = overlay.querySelector('#create-deck-group-select');
  const idInput = overlay.querySelector('#create-deck-id');
  const descInput = overlay.querySelector('#create-deck-description');
  const errorEl = overlay.querySelector('#create-deck-error');
  const cancelBtn = overlay.querySelector('#btn-create-deck-cancel');

  const addGroupOption = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    groupSelect.appendChild(option);
  };
  addGroupOption('', 'Bez grupy');
  for (const groupName of getAvailableDeckGroups('private')) {
    addGroupOption(groupName, groupName);
  }
  addGroupOption('__new__', '+ Nowa grupa');
  bindGroupSelectControl(groupSelect, {
    promptTitle: 'Nowa grupa talii',
    promptText: 'Podaj nazwę nowej grupy:',
    onInvalid: (message) => { errorEl.textContent = message; },
  });

  let idEditedManually = false;
  const updateId = () => {
    if (idEditedManually) return;
    const sourceName = nameInput.value.trim() || 'moja-talia';
    idInput.value = getUniqueDeckId(sourceName);
  };

  updateId();
  nameInput.focus();

  nameInput.addEventListener('input', updateId);
  nameInput.addEventListener('input', () => { errorEl.textContent = ''; });
  groupSelect.addEventListener('change', () => { errorEl.textContent = ''; });
  idInput.addEventListener('input', () => {
    idEditedManually = true;
    errorEl.textContent = '';
  });
  descInput.addEventListener('input', () => { errorEl.textContent = ''; });

  const closeModal = () => overlay.remove();

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!canCreateMorePrivateDecks()) {
      return;
    }
    const name = nameInput.value.trim();
    const group = normalizeDeckGroup(groupSelect.value);
    const deckId = idInput.value.trim();
    const description = descInput.value.trim();

    if (!name) {
      errorEl.textContent = 'Nazwa talii jest wymagana.';
      return;
    }
    if (groupSelect.value === '__new__') {
      errorEl.textContent = 'Najpierw podaj nazwę nowej grupy w popupie.';
      return;
    }
    if (!DECK_ID_RE.test(deckId)) {
      errorEl.textContent = 'ID talii ma nieprawidłowy format.';
      return;
    }
    if (isDeckIdTaken(deckId)) {
      errorEl.textContent = 'To ID talii jest już zajęte.';
      return;
    }

    const decks = storage.getDecks();
    const deckMeta = {
      id: deckId,
      name,
      description,
      questionCount: 0,
      importedAt: Date.now(),
      version: 1,
      scope: 'private',
      source: 'user-manual',
      readOnlyContent: false,
      isArchived: false,
      isShared: false,
      defaultSelectionMode: 'multiple',
    };
    if (group) {
      deckMeta.group = group;
    }

    decks.push(deckMeta);
    storage.saveDecks(decks);
    storage.saveQuestions(deckId, []);
    storage.saveCards(deckId, []);

    currentCategory = null;
    activeDeckScope = 'private';
    closeModal();
    showNotification(`Utworzono talię "${name}".`, 'success');
    navigateToBrowse(deckId, { openCreateEditor: true });
  });
}

function bindQuestionEvents(isMultiSelect) {
  const answersList = document.getElementById('answers-list');
  const checkBtn = document.getElementById('btn-check-answer');

  if (answersList) {
    answersList.addEventListener('click', (e) => {
      const option = e.target.closest('.answer-option');
      if (!option) return;

      const answerId = option.dataset.answerId;

      if (isMultiSelect) {
        if (selectedAnswerIds.has(answerId)) {
          selectedAnswerIds.delete(answerId);
          option.classList.remove('selected');
        } else {
          selectedAnswerIds.add(answerId);
          option.classList.add('selected');
        }
      } else {
        selectedAnswerIds.clear();
        answersList.querySelectorAll('.answer-option').forEach(o => o.classList.remove('selected'));
        selectedAnswerIds.add(answerId);
        option.classList.add('selected');
      }

      checkBtn.textContent = selectedAnswerIds.size > 0 ? 'Sprawdź odpowiedź' : 'Pokaż odpowiedź';
    });
  }

  checkBtn.addEventListener('click', () => {
    showFeedback();
  });

  bindEditButton();
}

async function showFeedback() {
  studyPhase = 'feedback';
  const intervals = getButtonIntervals(currentCard, currentDeckSettings);
  const selectionMode = getEffectiveSelectionModeForDeck(currentQuestion, currentDeckId);
  let voteConfig = getVoteConfigForDeck(currentDeckId, { showMinus: selectionMode === 'multiple' });
  let voteSummaryByAnswer = null;

  if (voteConfig.enabled && !isFlashcard(currentQuestion)) {
    try {
      const voteTarget = await ensureVoteSummaryForQuestions(currentDeckId, [currentQuestion.id]);
      if (voteTarget) {
        const summaryByQuestion = buildVoteSummaryByQuestion(voteTarget, [currentQuestion]);
        voteSummaryByAnswer = summaryByQuestion[currentQuestion.id] || null;
      }
    } catch (error) {
      if (!isAnswerVoteRpcReady()) {
        notifyVoteRpcUnavailable();
      } else {
        showNotification(`Nie udało się pobrać głosów społeczności: ${error.message}`, 'error');
      }
      voteConfig = { ...voteConfig, enabled: false, canVote: false };
    }
  }

  renderAnswerFeedback(
    currentQuestion,
    currentShuffledAnswers,
    selectedAnswerIds,
    selectionMode,
    currentQuestion.explanation || null,
    intervals,
    appSettings.keybindings,
    currentCardFlagged,
    canEditDeckContent(currentDeckId),
    voteSummaryByAnswer,
    voteConfig
  );

  // Bind rating buttons
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.rating);
      handleRating(rating);
    });
  });

  bindVoteButtons(currentDeckId, [currentQuestion]);
  bindEditButton();
  bindFlagButton();
}

// --- Question Editor ---

let editReturnPhase = null; // 'question' | 'feedback'

function bindEditButton() {
  const editBtn = document.getElementById('btn-edit-question');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      enterEditMode();
    });
  }
}

function bindRerollButton() {
  const rerollBtn = document.getElementById('btn-reroll-question');
  if (rerollBtn) {
    rerollBtn.addEventListener('click', () => {
      handleReroll();
    });
  }
}

function handleReroll() {
  // Re-fetch the original question from storage to get the raw template
  const questions = storage.getQuestions(currentDeckId);
  const original = questions.find(q => q.id === currentQuestion.id);
  if (!original) return;

  // For hardcoded randomizers, use registry; for templates, use original from storage
  const variant = randomize(original.id, original);
  if (variant) {
    // Build fresh question from original + new randomized values
    currentQuestion = {
      ...original,
      text: variant.text,
      answers: variant.answers,
    };
    if (variant.explanation !== undefined) {
      currentQuestion.explanation = variant.explanation;
    }
  } else {
    // Fallback: show original unchanged
    currentQuestion = { ...original };
  }

  const selectionMode = getEffectiveSelectionModeForDeck(currentQuestion, currentDeckId);
  const isMultiSelect = selectionMode === 'multiple';
  const showReroll = shouldRandomizeQuestion(original, currentDeckSettings);

  // Flash animation to confirm re-roll happened
  const container = document.getElementById('study-content');
  container.style.opacity = '0.3';
  currentShuffledAnswers = renderQuestion(
    currentQuestion,
    null,
    sessionTotal,
    selectionMode,
    appSettings.shuffleAnswers,
    showReroll,
    currentCardFlagged,
    canEditDeckContent(currentDeckId)
  );
  requestAnimationFrame(() => {
    container.style.transition = 'opacity 0.2s ease';
    container.style.opacity = '1';
    setTimeout(() => { container.style.transition = ''; }, 200);
  });

  selectedAnswerIds = new Set();
  studyPhase = 'question';
  bindQuestionEvents(isMultiSelect);
  bindRerollButton();
  bindFlagButton();
}

function enterEditMode() {
  if (isCurrentDeckReadOnlyContent()) {
    showNotification('Talia ogólna jest tylko do nauki. Edycja jest zablokowana.', 'info');
    return;
  }

  editReturnPhase = studyPhase;
  studyPhase = null; // disable keyboard shortcuts while editing

  // For template questions, show raw template text in editor (not substituted values)
  let editorQuestion = currentQuestion;
  if (hasTemplate(currentQuestion)) {
    const questions = storage.getQuestions(currentDeckId);
    const original = questions.find(q => q.id === currentQuestion.id);
    if (original) editorQuestion = original;
  }

  renderQuestionEditor(editorQuestion, getDeckDefaultSelectionModeForDeckId(currentDeckId));

  // Cancel
  document.getElementById('btn-editor-cancel').addEventListener('click', () => {
    exitEditMode();
  });

  // Save
  document.getElementById('btn-editor-save').addEventListener('click', () => {
    saveQuestionEdit();
  });
}

function exitEditMode() {
  if (editReturnPhase === 'feedback') {
    showFeedback();
  } else {
    // Re-render question phase
    const selectionMode = getEffectiveSelectionModeForDeck(currentQuestion, currentDeckId);
    const isMultiSelect = selectionMode === 'multiple';
    const showReroll = shouldRandomizeQuestion(currentQuestion, currentDeckSettings);
    currentShuffledAnswers = renderQuestion(
      currentQuestion,
      null,
      sessionTotal,
      selectionMode,
      appSettings.shuffleAnswers,
      showReroll,
      currentCardFlagged,
      canEditDeckContent(currentDeckId)
    );
    selectedAnswerIds = new Set();
    studyPhase = 'question';
    bindQuestionEvents(isMultiSelect);
    bindRerollButton();
    bindFlagButton();
  }
  editReturnPhase = null;
}

function saveQuestionEdit() {
  if (isCurrentDeckReadOnlyContent()) {
    showNotification('Talia ogólna jest tylko do nauki. Edycja jest zablokowana.', 'info');
    return;
  }

  const newText = document.getElementById('editor-question-text').value.trim();
  if (!newText) {
    showNotification('Treść pytania nie może być pusta.', 'error');
    return;
  }

  const newExplanation = document.getElementById('editor-explanation').value.trim();
  const selectionMode = normalizeSelectionMode(
    document.getElementById('editor-selection-mode')?.value,
    getDeckDefaultSelectionModeForDeckId(currentDeckId)
  );

  // Read answers (flashcards have no answer rows)
  const answerRows = document.querySelectorAll('.editor-answer-row');
  const updatedAnswers = [];
  let correctCount = 0;

  if (answerRows.length > 0) {
    for (const row of answerRows) {
      const id = row.dataset.answerId;
      const text = row.querySelector('.editor-answer-text').value.trim();
      const correct = row.querySelector('.editor-answer-correct').checked;

      if (!text) {
        showNotification('Odpowiedź nie może być pusta.', 'error');
        return;
      }

      if (correct) correctCount++;
      updatedAnswers.push({ id, text, correct });
    }

    if (selectionMode === 'single' && correctCount !== 1) {
      showNotification('Pytanie jednokrotnego wyboru musi mieć dokładnie jedną poprawną odpowiedź.', 'error');
      return;
    }

    if (selectionMode !== 'single' && correctCount === 0) {
      showNotification('Co najmniej jedna odpowiedź musi być poprawna.', 'error');
      return;
    }
  }

  // Read randomize data from editor
  const randomizeToggle = document.getElementById('editor-randomize-toggle');
  let newRandomize = undefined;
  if (randomizeToggle && randomizeToggle.checked) {
    newRandomize = {};

    // Read variables
    const varRows = document.querySelectorAll('.editor-var-row');
    for (const row of varRows) {
      const varName = row.querySelector('.editor-var-name').value.trim();
      const varValues = row.querySelector('.editor-var-values').value.trim();
      if (!varName || !varValues) continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) continue;
      // Try parsing as numbers first
      const parts = varValues.split(',').map(s => s.trim());
      const nums = parts.map(s => parseFloat(s)).filter(n => !isNaN(n));
      if (nums.length === parts.length && nums.length >= 2) {
        newRandomize[varName] = nums;
      } else if (parts.length >= 2) {
        // Treat as text variable (string array)
        newRandomize[varName] = parts;
      }
    }

    // Read derived variables
    const derivedRows = document.querySelectorAll('.editor-derived-row');
    if (derivedRows.length > 0) {
      const derived = {};
      for (const row of derivedRows) {
        const name = row.querySelector('.editor-derived-name').value.trim();
        const expr = row.querySelector('.editor-derived-expr').value.trim();
        if (!name || !expr) continue;
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          derived[name] = expr;
        }
      }
      if (Object.keys(derived).length > 0) newRandomize.$derived = derived;
    }

    // Read constraints
    const constraintRows = document.querySelectorAll('.editor-constraint-row');
    if (constraintRows.length > 0) {
      const constraints = [];
      for (const row of constraintRows) {
        const expr = row.querySelector('.editor-constraint-expr').value.trim();
        if (expr) constraints.push(expr);
      }
      if (constraints.length > 0) newRandomize.$constraints = constraints;
    }

    // Check if randomize has any actual content
    const hasVars = Object.keys(newRandomize).some(k => !k.startsWith('$'));
    if (!hasVars && !newRandomize.$derived) newRandomize = undefined;
  }

  // Update question in storage
  const questions = storage.getQuestions(currentDeckId);
  const qIndex = questions.findIndex(q => q.id === currentQuestion.id);
  if (qIndex !== -1) {
    questions[qIndex].text = newText;
    if (updatedAnswers.length > 0) {
      questions[qIndex].answers = updatedAnswers;
      questions[qIndex].selectionMode = selectionMode;
    } else {
      delete questions[qIndex].selectionMode;
    }
    questions[qIndex].explanation = newExplanation || undefined;
    if (newRandomize) {
      questions[qIndex].randomize = newRandomize;
    } else {
      delete questions[qIndex].randomize;
    }
    storage.saveQuestions(currentDeckId, questions);

    // Update in-memory reference
    currentQuestion = questions[qIndex];
    // Update shuffled answers to reflect any text/correct changes
    if (updatedAnswers.length > 0) {
      currentShuffledAnswers = currentShuffledAnswers.map(sa => {
        const updated = updatedAnswers.find(a => a.id === sa.id);
        return updated || sa;
      });
    }
  }

  syncOwnedDeckToSupabaseAsync(currentDeckId);

  showNotification('Pytanie zostało zaktualizowane.', 'success');
  exitEditMode();
}

// --- Flag Button ---

function bindFlagButton() {
  const flagBtn = document.getElementById('btn-flag-question');
  if (flagBtn) {
    flagBtn.addEventListener('click', () => {
      handleFlagToggle();
    });
  }
}

function handleFlagToggle() {
  if (!currentCard || !currentDeckId) return;
  currentCardFlagged = !currentCardFlagged;
  currentCard.flagged = currentCardFlagged;
  deck.setCardFlagged(currentDeckId, currentCard.questionId, currentCardFlagged);

  // Update button visually
  const flagBtn = document.getElementById('btn-flag-question');
  if (flagBtn) {
    flagBtn.classList.toggle('flagged', currentCardFlagged);
    flagBtn.innerHTML = currentCardFlagged ? '&#x1F6A9;' : '&#x2691;';
    const tooltipText = currentCardFlagged
      ? 'Usuń oznaczenie pytania (skrót: F)'
      : 'Oznacz pytanie flagą (skrót: F)';
    const ariaLabel = currentCardFlagged
      ? 'Usuń oznaczenie pytania'
      : 'Oznacz pytanie flagą';
    flagBtn.setAttribute('data-tooltip', tooltipText);
    flagBtn.setAttribute('aria-label', ariaLabel);
  }

  showNotification(
    currentCardFlagged ? 'Pytanie oznaczone.' : 'Oznaczenie usunięte.',
    'info'
  );
}

// --- Flagged Browse ---

function navigateToFlaggedBrowse(deckId) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const flaggedIds = deck.getFlaggedQuestionIds(deckId, getFilteredQuestionIds(deckId));
  const allQuestions = storage.getQuestions(deckId);
  const flaggedSet = new Set(flaggedIds);
  const flaggedQuestions = allQuestions.filter(q => flaggedSet.has(q.id));

  showView('browse');
  renderFlaggedBrowse(deckName, flaggedQuestions);
  bindFlaggedBrowseEvents(deckId);
}

function bindFlaggedBrowseEvents(deckId) {
  const studyBtn = document.getElementById('btn-study-flagged');
  if (studyBtn) {
    studyBtn.addEventListener('click', () => {
      navigateToStudy(deckId, true);
    });
  }

  document.querySelectorAll('.btn-unflag').forEach(btn => {
    btn.addEventListener('click', () => {
      const questionId = btn.dataset.questionId;
      deck.setCardFlagged(deckId, questionId, false);
      showNotification('Oznaczenie usunięte.', 'info');
      // Re-render the flagged browse view
      navigateToFlaggedBrowse(deckId);
    });
  });
}

function handleRating(rating) {
  // Process the SM-2 algorithm
  const updatedCard = processRating(currentCard, rating, currentDeckSettings);

  // Save card state
  deck.saveCardState(updatedCard, currentDeckId);

  // Record stats
  deck.recordStat(currentDeckId, rating, currentSource);

  // Re-queue if still in learning
  deck.requeueCard(updatedCard, queues);

  // Update counts
  if (currentSource === 'review') {
    queues.counts.reviewsToday++;
  }

  studiedCount++;
  updateProgress(studiedCount, sessionTotal);

  // Next card
  showNextCard();
}

function bindCompleteEvents() {
  const btn = document.getElementById('btn-back-to-decks-complete');
  if (btn) {
    btn.addEventListener('click', () => {
      const deckMeta = currentDeckId ? storage.getDecks().find(d => d.id === currentDeckId) : null;
      if (deckMeta && deckMeta.categories) {
        navigateToCategorySelect(currentDeckId);
      } else {
        navigateToDeckList();
      }
    });
  }
}

let waitCountdownTimer = null;

function showLearningWaitScreen(delayMs) {
  const endTime = Date.now() + delayMs;

  function updateCountdown() {
    const remaining = Math.max(0, endTime - Date.now());
    if (remaining <= 0) return;

    const totalSec = Math.ceil(remaining / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const timeStr = min > 0
      ? `${min}:${String(sec).padStart(2, '0')}`
      : `${sec}s`;

    const countdownEl = document.getElementById('wait-countdown');
    if (countdownEl) countdownEl.textContent = timeStr;
  }

  document.getElementById('study-content').innerHTML = `
    <div class="question-card" style="text-align: center; padding: 40px;">
      <div style="font-size: 1.1rem; color: var(--color-text-secondary); margin-bottom: 12px;">
        Następna karta za chwilę...
      </div>
      <div id="wait-countdown" style="font-size: 2rem; font-weight: 600; color: var(--color-text-primary); margin-bottom: 16px;">
      </div>
      <button id="btn-end-session-early" class="btn btn-secondary" style="margin-top: 8px;">
        Zakończ sesję
      </button>
    </div>
  `;

  updateCountdown();
  clearInterval(waitCountdownTimer);
  waitCountdownTimer = setInterval(updateCountdown, 1000);

  document.getElementById('btn-end-session-early').addEventListener('click', () => {
    clearWaitTimer();
    navigateToComplete(currentDeckId);
  });
}

function clearWaitTimer() {
  if (waitTimer) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
  if (waitCountdownTimer) {
    clearInterval(waitCountdownTimer);
    waitCountdownTimer = null;
  }
}

// --- Start ---

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error('Initialization failed:', error);
    showNotification(`Błąd startu aplikacji: ${error.message}`, 'error');
    showAuthPanel('Nie udało się uruchomić aplikacji.', 'error');
  });
});
