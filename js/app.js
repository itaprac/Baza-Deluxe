// app.js — Application entry point, router, study session loop

import { DEFAULT_SETTINGS, processRating, getButtonIntervals } from './sm2.js';
import { RATINGS, isNew as isNewCard, isReview as isReviewCard, isLearning as isLearningCard, isRelearning as isRelearningCard, isFlagged, createCard } from './card.js';
import * as deck from './deck.js';
import * as storage from './storage.js';
import { importFromFile, importBuiltIn } from './importer.js';
import {
  renderDeckList,
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
  formatKeyName,
  updateStudyCounts,
  updateProgress,
  showView,
  showNotification,
  showConfirm,
} from './ui.js';
import { shuffle, isFlashcard, generateId } from './utils.js';
import { hasRandomizer, hasTemplate, randomize } from './randomizers.js';
import {
  isSupabaseConfigured,
  getCurrentSession,
  onAuthStateChange,
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signOutUser,
} from './supabase.js';

// --- App State ---

const FONT_SCALE_STEP = 0.1;
const DEFAULT_FONT_SCALE = 1.0;

const DEFAULT_APP_SETTINGS = {
  theme: 'auto',
  colorTheme: 'academic-noir',
  layoutWidth: '65%',
  deckListMode: 'compact', // 'compact' or 'classic'
  shuffleAnswers: true,
  questionOrder: 'shuffled', // 'shuffled' or 'ordered'
  randomizeNumbers: false,
  flaggedInAnki: false, // include flagged cards in Anki study mode
  keybindings: {
    showAnswer: [' ', 'Enter'],
    again: ['1'],
    hard: ['2'],
    good: ['3'],
    easy: ['4'],
  }
};

const BUILT_IN_DECK_SOURCES = [
  { id: 'poi-egzamin', file: '/data/poi-egzamin.json' },
  { id: 'podstawy-it', file: '/data/sample-exam.json' },
  { id: 'si-egzamin', file: '/data/si-egzamin.json' },
  { id: 'randomize-demo', file: '/data/randomize-demo.json' },
  { id: 'ii-egzamin', file: '/data/ii-egzamin.json' },
  { id: 'ii-egzamin-fiszki', file: '/data/ii-egzamin-fiszki.json' },
  { id: 'zi2-egzamin', file: '/data/zi2-egzamin.json' },
];
const BUILT_IN_DECK_ID_SET = new Set(BUILT_IN_DECK_SOURCES.map((item) => item.id));
const BUILT_IN_DECK_IDS = [...BUILT_IN_DECK_ID_SET];
const DECK_ID_RE = /^[a-z0-9_-]+$/i;

let appSettings = { ...DEFAULT_APP_SETTINGS, keybindings: { ...DEFAULT_APP_SETTINGS.keybindings } };
let fontScale = DEFAULT_FONT_SCALE;
let currentDeckId = null;
let currentCategory = null; // null = all, or category id
let activeDeckScope = 'public'; // 'public' | 'private'
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
let sessionMode = null; // 'user' | 'guest' | null
let authSubscription = null;
let authEventsBound = false;

// Test mode state
let testQuestions = [];
let testCurrentIndex = 0;
let testAnswers = new Map(); // questionId → Set of selected answer ids
let testShuffledAnswers = null;
let testSelectedIds = new Set();
let testShuffledMap = new Map(); // index → shuffled answers array

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

function getUniqueDeckId(base) {
  const candidateBase = slugifyDeckId(base) || `talia-${Date.now().toString(36)}`;
  const allDecks = storage.getDecks();
  const taken = new Set(allDecks.map((d) => String(d.id || '').toLowerCase()));
  for (const builtInId of BUILT_IN_DECK_IDS) {
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
  if (BUILT_IN_DECK_IDS.some((id) => id.toLowerCase() === normalized)) return true;
  return storage.getDecks().some((d) => String(d.id || '').toLowerCase() === normalized);
}

function isBuiltInDeckId(deckId) {
  return typeof deckId === 'string' && BUILT_IN_DECK_ID_SET.has(deckId);
}

function getDeckScope(deckMeta) {
  if (!deckMeta || typeof deckMeta !== 'object') return 'private';
  if (deckMeta.scope === 'public' || deckMeta.scope === 'private') {
    return deckMeta.scope;
  }
  return isBuiltInDeckId(deckMeta.id) ? 'public' : 'private';
}

function isDeckReadOnlyContent(deckMeta) {
  if (!deckMeta || typeof deckMeta !== 'object') return false;
  if (typeof deckMeta.readOnlyContent === 'boolean') {
    return deckMeta.readOnlyContent;
  }
  return getDeckScope(deckMeta) === 'public';
}

function getDeckMeta(deckId) {
  return storage.getDecks().find((d) => d.id === deckId) || null;
}

function canEditDeckContent(deckId) {
  return !isDeckReadOnlyContent(getDeckMeta(deckId));
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
    const isBuiltIn = isBuiltInDeckId(deckMeta.id);
    const nextScope = isBuiltIn ? 'public' : 'private';
    const nextSource = isBuiltIn
      ? 'builtin'
      : (deckMeta.source === 'user-manual' ? 'user-manual' : 'user-import');
    const nextReadOnly = isBuiltIn;

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

// --- Per-deck settings ---

function getSettingsForDeck(deckId) {
  const saved = storage.getDeckSettings(deckId);
  if (saved) {
    return { ...DEFAULT_SETTINGS, ...saved };
  }
  // Fallback: try legacy global settings (migration)
  const legacy = storage.getSettings();
  if (legacy) {
    return { ...DEFAULT_SETTINGS, ...legacy };
  }
  return { ...DEFAULT_SETTINGS };
}

// --- Initialization ---

async function init() {
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

function updateHeaderSessionState(mode, email = '') {
  const actions = document.getElementById('header-app-actions');
  const emailEl = document.getElementById('auth-user-email');
  const authActionBtn = document.getElementById('btn-auth-logout');

  if (mode === 'user') {
    if (actions) actions.style.display = 'flex';
    if (emailEl) emailEl.textContent = email || 'Zalogowany użytkownik';
    if (authActionBtn) {
      authActionBtn.style.display = '';
      authActionBtn.textContent = 'Wyloguj';
    }
    return;
  }

  if (mode === 'guest') {
    if (actions) actions.style.display = 'flex';
    if (emailEl) emailEl.textContent = 'Tryb gościa';
    if (authActionBtn) {
      authActionBtn.style.display = '';
      authActionBtn.textContent = 'Zaloguj';
    }
    return;
  }

  if (actions) actions.style.display = 'none';
  if (emailEl) emailEl.textContent = 'Niezalogowany';
  if (authActionBtn) authActionBtn.style.display = 'none';
}

function showAuthMessage(message = '', type = 'info') {
  const el = document.getElementById('auth-message');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`;
}

function showAuthPanel(message = '', type = 'info') {
  showView('auth');
  showAuthMessage(message, type);
}

async function bootstrapGuestSession() {
  clearWaitTimer();
  sessionMode = 'guest';
  currentUser = null;
  activeDeckScope = 'public';
  await storage.initGuest();
  migrateDeckMetadata();
  loadUserPreferences();
  updateHeaderSessionState('guest');
  await loadBuiltInDecks();
  navigateToDeckList();
}

async function bootstrapUserSession(user) {
  sessionMode = 'user';
  currentUser = user;
  activeDeckScope = 'public';
  updateHeaderSessionState('user', user.email || 'Zalogowany użytkownik');
  await storage.initForUser(user.id);
  migrateDeckMetadata();
  loadUserPreferences();
  await loadBuiltInDecks();
  navigateToDeckList();
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

// --- Navigation ---

function navigateToDeckList(scope = activeDeckScope) {
  if (scope === 'public' || scope === 'private') {
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
  queues = null;
  currentCard = null;
  showView('deck-list');

  const allDecks = storage.getDecks();
  const decks = allDecks.filter((d) => getDeckScope(d) === activeDeckScope);
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
  if (currentDeckId === deckId && queues && studyingFlagged === flaggedOnly) {
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

  showTestQuestion();
}

function showTestQuestion() {
  let question = testQuestions[testCurrentIndex];

  // Apply randomization (only on first visit, not when going back)
  // Template questions always randomize; hardcoded only when setting is on
  const shouldRandomize = hasTemplate(question) || (appSettings.randomizeNumbers && hasRandomizer(question.id));
  if (shouldRandomize && !testShuffledMap.has(testCurrentIndex)) {
    const variant = randomize(question.id, question);
    if (variant) {
      question = { ...question, text: variant.text, answers: variant.answers };
      if (variant.explanation !== undefined) question.explanation = variant.explanation;
      testQuestions[testCurrentIndex] = question;
    }
  }

  const isMulti = true;

  // Reuse previously stored shuffle order if going back
  const storedShuffle = testShuffledMap.get(testCurrentIndex) || null;
  // Restore previous selection if any
  const previousSelection = testAnswers.get(question.id) || null;

  testShuffledAnswers = renderTestQuestion(
    question,
    testCurrentIndex + 1,
    testQuestions.length,
    isMulti,
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

  nextBtn.addEventListener('click', () => {
    // Save answer
    const question = testQuestions[testCurrentIndex];
    testAnswers.set(question.id, new Set(testSelectedIds));

    testCurrentIndex++;
    if (testCurrentIndex < testQuestions.length) {
      showTestQuestion();
    } else {
      finishTest();
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

function finishTest() {
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

  showView('test-result');
  renderTestResult(deckName, { score, total: testQuestions.length, answers });
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
}

// --- Browse Mode ---

function navigateToBrowse(deckId, options = {}) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const questions = getFilteredQuestions(deckId);

  showView('browse');
  renderBrowse(deckName, questions, { canEdit: canEditDeckContent(deckId) });
  bindBrowseEvents();

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

  browseItem.innerHTML = renderBrowseEditor(question, index);

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
    <button class="btn-remove-create-answer" title="Usuń odpowiedź">&times;</button>
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

  const answers = [];
  if (!isFlashcardQuestion) {
    const rows = editor.querySelectorAll('.create-answer-row');
    if (rows.length < 2) {
      showNotification('Pytanie testowe musi mieć co najmniej 2 odpowiedzi.', 'error');
      return;
    }

    let hasCorrect = false;
    rows.forEach((row, idx) => {
      const answerText = (row.querySelector('.create-answer-text')?.value || '').trim();
      const isCorrect = !!row.querySelector('.create-answer-correct')?.checked;
      if (!answerText) return;
      answers.push({ id: `a${idx + 1}`, text: answerText, correct: isCorrect });
      if (isCorrect) hasCorrect = true;
    });

    if (answers.length < 2) {
      showNotification('Każda odpowiedź musi mieć treść.', 'error');
      return;
    }

    if (!hasCorrect) {
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
        <button class="btn-remove-var" title="Usuń zmienną">&times;</button>
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
        <button class="btn-remove-derived" title="Usuń">&times;</button>
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
        <button class="btn-remove-constraint" title="Usuń">&times;</button>
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

  const answerRows = editor.querySelectorAll('.editor-answer-row');
  const updatedAnswers = [];
  let hasCorrect = false;

  if (answerRows.length > 0) {
    for (const row of answerRows) {
      const id = row.dataset.answerId;
      const text = row.querySelector('.editor-answer-text').value.trim();
      const correct = row.querySelector('.editor-answer-correct').checked;

      if (!text) {
        showNotification('Odpowiedź nie może być pusta.', 'error');
        return;
      }

      if (correct) hasCorrect = true;
      updatedAnswers.push({ id, text, correct });
    }

    if (!hasCorrect) {
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
    }
    allQuestions[qIndex].explanation = newExplanation || undefined;
    if (newRandomize) {
      allQuestions[qIndex].randomize = newRandomize;
    } else {
      delete allQuestions[qIndex].randomize;
    }
    storage.saveQuestions(currentDeckId, allQuestions);
  }

  showNotification('Pytanie zostało zaktualizowane.', 'success');
  navigateToBrowse(currentDeckId, { searchQuery: getBrowseSearchQuery() });
}

// --- Settings ---

function navigateToSettings(deckId, returnTo = 'mode-select') {
  currentDeckId = deckId;
  settingsReturnTo = returnTo;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  document.getElementById('settings-deck-name').textContent = deckMeta ? deckMeta.name : deckId;

  showView('settings');
  const deckSettings = getSettingsForDeck(deckId);
  renderSettings(deckSettings, DEFAULT_SETTINGS, {
    deckMeta,
    canEditMeta: canEditDeckContent(deckId),
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
      docsLoaded = true;
    })
    .catch((error) => {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Nie udało się wczytać dokumentacji</div>
          <div class="empty-state-text">${error.message}</div>
        </div>
      `;
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
      appSettings.layoutWidth = btn.dataset.width;
      applyLayoutWidth(appSettings.layoutWidth);
      storage.saveAppSettings(appSettings);
      // Sync custom input
      const customInput = document.getElementById('custom-width-input');
      if (customInput) {
        const numVal = parseInt(btn.dataset.width);
        customInput.value = isNaN(numVal) ? '' : numVal;
      }
    });
  });

  // Custom width input
  const customWidthInput = document.getElementById('custom-width-input');
  if (customWidthInput) {
    customWidthInput.addEventListener('change', () => {
      let val = parseInt(customWidthInput.value);
      if (isNaN(val) || val < 20) val = 20;
      if (val > 100) val = 100;
      customWidthInput.value = val;
      document.querySelectorAll('.layout-width-option').forEach(b => b.classList.remove('active'));
      // Check if matches a preset
      document.querySelectorAll('.layout-width-option').forEach(b => {
        if (b.dataset.width === val + '%') b.classList.add('active');
      });
      appSettings.layoutWidth = val + '%';
      applyLayoutWidth(appSettings.layoutWidth);
      storage.saveAppSettings(appSettings);
    });
  }

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

  // Randomize numbers toggle
  const randomizeToggle = document.getElementById('toggle-randomize');
  if (randomizeToggle) {
    randomizeToggle.addEventListener('change', () => {
      appSettings.randomizeNumbers = randomizeToggle.checked;
      storage.saveAppSettings(appSettings);
    });
  }

  // Flagged in Anki toggle
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

function bindSettingsEvents(deckId) {
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
    storage.saveDeckSettings(deckId, { ...DEFAULT_SETTINGS });
    renderSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS, {
      deckMeta: getDeckMeta(deckId),
      canEditMeta: canEditDeckContent(deckId),
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
  const nextName = (nameInput?.value || '').trim();
  const nextDescription = (descInput?.value || '').trim();

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

  decks[idx] = {
    ...decks[idx],
    name: nextName,
    description: nextDescription,
  };
  storage.saveDecks(decks);

  const settingsDeckName = document.getElementById('settings-deck-name');
  if (settingsDeckName) settingsDeckName.textContent = nextName;

  showNotification('Nazwa i opis talii zostały zapisane.', 'success');
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
  const shouldRandomize = hasTemplate(currentQuestion) || (appSettings.randomizeNumbers && hasRandomizer(currentQuestion.id));
  if (shouldRandomize) {
    const variant = randomize(currentQuestion.id, currentQuestion);
    if (variant) {
      currentQuestion = { ...currentQuestion, text: variant.text, answers: variant.answers };
      if (variant.explanation !== undefined) currentQuestion.explanation = variant.explanation;
    }
  }

  const isMultiSelect = true;
  const showReroll = shouldRandomize;

  currentCardFlagged = !!currentCard.flagged;
  currentShuffledAnswers = renderQuestion(
    currentQuestion,
    null,
    sessionTotal,
    isMultiSelect,
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
  const loginBtn = document.getElementById('btn-auth-login');
  const signupBtn = document.getElementById('btn-auth-signup');
  const googleBtn = document.getElementById('btn-auth-google');
  const guestBtn = document.getElementById('btn-auth-guest');
  if (loginBtn) loginBtn.disabled = isBusy;
  if (signupBtn) signupBtn.disabled = isBusy;
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

    showAuthMessage('Konto utworzone. Potwierdź rejestrację w e-mailu i zaloguj się.', 'info');
  } catch (error) {
    showAuthMessage(error.message || 'Błąd rejestracji.', 'error');
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
      await handleAuthLogin();
    });
  }

  const loginBtn = document.getElementById('btn-auth-login');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      await handleAuthLogin();
    });
  }

  const signupBtn = document.getElementById('btn-auth-signup');
  if (signupBtn) {
    signupBtn.addEventListener('click', async () => {
      await handleAuthSignup();
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
}

function bindGlobalEvents() {
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

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
      reservedDeckIds: BUILT_IN_DECK_IDS,
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
}

function bindDeckListEvents() {
  document.querySelectorAll('.deck-scope-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.dataset.scope;
      if (scope === 'public' || scope === 'private') {
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

  // Study buttons → go to category select (if categories) or mode select
  document.querySelectorAll('.btn-study').forEach(btn => {
    btn.addEventListener('click', () => {
      const deckId = btn.dataset.deckId;
      const deckMeta = storage.getDecks().find(d => d.id === deckId);
      if (deckMeta && deckMeta.categories) {
        navigateToCategorySelect(deckId);
      } else {
        navigateToModeSelect(deckId);
      }
    });
  });

  // Settings buttons on deck cards
  document.querySelectorAll('.btn-deck-settings').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToSettings(btn.dataset.deckId, 'deck-list');
    });
  });

  // Delete buttons
  document.querySelectorAll('.btn-delete-deck').forEach(btn => {
    btn.addEventListener('click', async () => {
      const deckMeta = getDeckMeta(btn.dataset.deckId);
      if (isDeckReadOnlyContent(deckMeta)) {
        showNotification('Talii ogólnej nie można usuwać.', 'info');
        return;
      }

      const confirmed = await showConfirm(
        'Usuń talię',
        `Czy na pewno chcesz usunąć "${btn.dataset.deckName}"? Cały postęp nauki zostanie utracony.`
      );
      if (confirmed) {
        deck.removeDeck(btn.dataset.deckId);
        showNotification('Talia została usunięta.', 'info');
        navigateToDeckList();
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
}

function openCreateDeckModal() {
  if (sessionMode !== 'user') {
    showNotification('Tworzenie własnych talii wymaga zalogowania.', 'info');
    showAuthPanel('Aby tworzyć własne talie, zaloguj się.', 'info');
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
  const idInput = overlay.querySelector('#create-deck-id');
  const descInput = overlay.querySelector('#create-deck-description');
  const errorEl = overlay.querySelector('#create-deck-error');
  const cancelBtn = overlay.querySelector('#btn-create-deck-cancel');

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
    const name = nameInput.value.trim();
    const deckId = idInput.value.trim();
    const description = descInput.value.trim();

    if (!name) {
      errorEl.textContent = 'Nazwa talii jest wymagana.';
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
    };

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

function showFeedback() {
  studyPhase = 'feedback';
  const intervals = getButtonIntervals(currentCard, currentDeckSettings);

  renderAnswerFeedback(
    currentQuestion,
    currentShuffledAnswers,
    selectedAnswerIds,
    currentQuestion.explanation || null,
    intervals,
    appSettings.keybindings,
    currentCardFlagged,
    canEditDeckContent(currentDeckId)
  );

  // Bind rating buttons
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.rating);
      handleRating(rating);
    });
  });

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

  const isMultiSelect = true;
  const showReroll = hasTemplate(original) || (appSettings.randomizeNumbers && hasRandomizer(original.id));

  // Flash animation to confirm re-roll happened
  const container = document.getElementById('study-content');
  container.style.opacity = '0.3';
  currentShuffledAnswers = renderQuestion(
    currentQuestion,
    null,
    sessionTotal,
    isMultiSelect,
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

  renderQuestionEditor(editorQuestion);

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
    const isMultiSelect = true;
    const showReroll = hasTemplate(currentQuestion) || (appSettings.randomizeNumbers && hasRandomizer(currentQuestion.id));
    currentShuffledAnswers = renderQuestion(
      currentQuestion,
      null,
      sessionTotal,
      isMultiSelect,
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

  // Read answers (flashcards have no answer rows)
  const answerRows = document.querySelectorAll('.editor-answer-row');
  const updatedAnswers = [];
  let hasCorrect = false;

  if (answerRows.length > 0) {
    for (const row of answerRows) {
      const id = row.dataset.answerId;
      const text = row.querySelector('.editor-answer-text').value.trim();
      const correct = row.querySelector('.editor-answer-correct').checked;

      if (!text) {
        showNotification('Odpowiedź nie może być pusta.', 'error');
        return;
      }

      if (correct) hasCorrect = true;
      updatedAnswers.push({ id, text, correct });
    }

    if (!hasCorrect) {
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
