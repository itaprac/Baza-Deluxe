// app.js — Application entry point, router, study session loop

import { DEFAULT_SETTINGS, processRating, getButtonIntervals } from './sm2.js';
import { RATINGS, isNew as isNewCard, isReview as isReviewCard, isLearning as isLearningCard, isRelearning as isRelearningCard, isFlagged } from './card.js';
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
import { shuffle, isFlashcard } from './utils.js';
import { hasRandomizer, hasTemplate, randomize } from './randomizers.js';

// --- App State ---

const FONT_SCALE_STEP = 0.1;
const DEFAULT_FONT_SCALE = 1.0;

const DEFAULT_APP_SETTINGS = {
  theme: 'auto',
  colorTheme: 'academic-noir',
  layoutWidth: '65%',
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

let appSettings = { ...DEFAULT_APP_SETTINGS, keybindings: { ...DEFAULT_APP_SETTINGS.keybindings } };
let fontScale = DEFAULT_FONT_SCALE;
let currentDeckId = null;
let currentCategory = null; // null = all, or category id
let settingsReturnTo = null; // 'mode-select' or 'deck-list'
let appSettingsReturnView = null; // view id to return to from app settings
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

// Test mode state
let testQuestions = [];
let testCurrentIndex = 0;
let testAnswers = new Map(); // questionId → Set of selected answer ids
let testShuffledAnswers = null;
let testSelectedIds = new Set();
let testShuffledMap = new Map(); // index → shuffled answers array

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

function init() {
  // Load app settings
  const savedApp = storage.getAppSettings();
  if (savedApp) {
    appSettings = {
      ...DEFAULT_APP_SETTINGS,
      ...savedApp,
      keybindings: { ...DEFAULT_APP_SETTINGS.keybindings, ...(savedApp.keybindings || {}) },
    };
  }

  // Apply theme, color theme, and layout width
  applyTheme(appSettings.theme);
  applyColorTheme(appSettings.colorTheme);
  applyLayoutWidth(appSettings.layoutWidth);

  // Load font scale
  const savedFont = localStorage.getItem('baza_fontScale');
  if (savedFont !== null) {
    const parsed = parseFloat(savedFont);
    if (!isNaN(parsed) && parsed > 0) fontScale = parsed;
  }
  applyFontScale();

  // Bind events
  bindGlobalEvents();

  // Browser back button support
  history.pushState(null, '', '');
  window.addEventListener('popstate', () => {
    const activeView = document.querySelector('.view.active');
    if (!activeView || activeView.id === 'view-deck-list') {
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

  // Try loading built-in decks
  loadBuiltInDecks();

  // Show deck list
  navigateToDeckList();
}

function applyFontScale() {
  document.documentElement.style.setProperty('--font-scale', fontScale);
}

function changeFontSize(delta) {
  const newScale = Math.round((fontScale + delta * FONT_SCALE_STEP) * 1000) / 1000;
  if (newScale <= 0) return;
  fontScale = newScale;
  applyFontScale();
  localStorage.setItem('baza_fontScale', fontScale);
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
  const decks = storage.getDecks();
  const builtInFiles = ['data/poi-egzamin.json', 'data/sample-exam.json', 'data/si-egzamin.json', 'data/randomize-demo.json', 'data/ii-egzamin.json', 'data/ii-egzamin-fiszki.json', 'data/zi2-egzamin.json'];

  for (const file of builtInFiles) {
    try {
      const result = await importBuiltIn(file);
      if (result.valid && !decks.some(d => d.id === result.deck.id)) {
        navigateToDeckList(); // refresh
      }
    } catch {
      // Built-in file not available — that's ok
    }
  }
}

// --- Navigation ---

function navigateToDeckList() {
  clearWaitTimer();
  studyPhase = null;
  studyingFlagged = false;
  currentDeckId = null;
  currentCategory = null;
  queues = null;
  currentCard = null;
  showView('deck-list');

  const decks = storage.getDecks();
  const statsMap = {};
  for (const d of decks) {
    statsMap[d.id] = deck.getDeckStats(d.id, getSettingsForDeck(d.id), appSettings.flaggedInAnki);
  }
  renderDeckList(decks, statsMap);
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
  renderModeSelect(deckName, stats);
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

function navigateToBrowse(deckId) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const questions = getFilteredQuestions(deckId);

  showView('browse');
  renderBrowse(deckName, questions);
  bindBrowseEvents();
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
    navigateToBrowse(currentDeckId);
  });

  // Save
  editor.querySelector('.btn-browse-editor-save').addEventListener('click', () => {
    saveBrowseEdit(index, editor);
  });
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

  // Read randomize data
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
  navigateToBrowse(currentDeckId);
}

// --- Settings ---

function navigateToSettings(deckId, returnTo = 'mode-select') {
  currentDeckId = deckId;
  settingsReturnTo = returnTo;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  document.getElementById('settings-deck-name').textContent = deckMeta ? deckMeta.name : deckId;

  showView('settings');
  const deckSettings = getSettingsForDeck(deckId);
  renderSettings(deckSettings, DEFAULT_SETTINGS);
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
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveDeckSettings(deckId);
  });

  document.getElementById('btn-restore-defaults').addEventListener('click', () => {
    storage.saveDeckSettings(deckId, { ...DEFAULT_SETTINGS });
    renderSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS);
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
    deck.saveCardState(card);
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
  currentShuffledAnswers = renderQuestion(currentQuestion, null, sessionTotal, isMultiSelect, appSettings.shuffleAnswers, showReroll, currentCardFlagged);
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

function bindGlobalEvents() {
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  // Font size controls
  document.getElementById('btn-font-decrease').addEventListener('click', () => changeFontSize(-1));
  document.getElementById('btn-font-increase').addEventListener('click', () => changeFontSize(1));

  // Home button (title)
  document.getElementById('btn-go-home').addEventListener('click', () => {
    navigateToDeckList();
  });

  // App settings button
  document.getElementById('btn-app-settings').addEventListener('click', () => {
    navigateToAppSettings();
  });

  // Import button
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // File input
  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset

    const result = await importFromFile(file);
    if (result.valid) {
      showNotification(
        `Zaimportowano "${result.deck.name}": ${result.added} nowych, ${result.updated} istniejących, ${result.total} łącznie.`,
        'success'
      );
      navigateToDeckList();
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
  document.getElementById('btn-back-from-settings').addEventListener('click', () => {
    returnFromSettings();
  });
}

function bindDeckListEvents() {
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

  // Empty state import button
  const emptyImportBtn = document.getElementById('btn-import-empty');
  if (emptyImportBtn) {
    emptyImportBtn.addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
  }
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
    currentCardFlagged
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
  currentShuffledAnswers = renderQuestion(currentQuestion, null, sessionTotal, isMultiSelect, appSettings.shuffleAnswers, showReroll, currentCardFlagged);
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
    currentShuffledAnswers = renderQuestion(currentQuestion, null, sessionTotal, isMultiSelect, appSettings.shuffleAnswers, showReroll, currentCardFlagged);
    selectedAnswerIds = new Set();
    studyPhase = 'question';
    bindQuestionEvents(isMultiSelect);
    bindRerollButton();
    bindFlagButton();
  }
  editReturnPhase = null;
}

function saveQuestionEdit() {
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
  deck.saveCardState(updatedCard);

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

document.addEventListener('DOMContentLoaded', init);
