// deck.js — Deck management, queue building, session orchestration

import { CARD_STATES, isNew, isDue, isLearning, isRelearning, isReview, isFlagged, createCard } from './card.js';
import { startOfDay, formatDate, DAY_MS, MINUTE_MS } from './utils.js';
import { DEFAULT_SETTINGS } from './sm2.js';
import * as storage from './storage.js';

/**
 * Build study queues for a deck. Returns { learning, review, newCards, counts }.
 */
export function buildQueues(deckId, settings = DEFAULT_SETTINGS, questionIdFilter = null, includeFlagged = false) {
  const now = Date.now();
  const today = startOfDay(now);
  let cards = storage.getCards(deckId);

  if (questionIdFilter) {
    const filterSet = new Set(questionIdFilter);
    cards = cards.filter(c => filterSet.has(c.questionId));
  }

  // Exclude flagged cards from study queues (unless explicitly studying flagged)
  if (!includeFlagged) {
    cards = cards.filter(c => !isFlagged(c));
  }

  // Learning/Relearning cards (all — including not-yet-due so sessions resume properly)
  const learning = cards
    .filter(c => isLearning(c) || isRelearning(c))
    .sort((a, b) => a.dueDate - b.dueDate);

  // Review cards due today or earlier
  const review = cards
    .filter(c => isReview(c) && c.dueDate <= now)
    .sort((a, b) => a.dueDate - b.dueDate);

  // Count new cards already introduced today
  const newCardsToday = cards.filter(c =>
    c.firstStudiedDate != null && startOfDay(c.firstStudiedDate) === today
  ).length;

  const newCardsRemaining = Math.max(0, settings.newCardsPerDay - newCardsToday);

  // New cards (not yet studied)
  const newCards = cards
    .filter(c => isNew(c))
    .slice(0, newCardsRemaining);

  // Count reviews done today
  const reviewsToday = cards.filter(c =>
    c.lastReviewDate != null &&
    startOfDay(c.lastReviewDate) === today &&
    isReview(c)
  ).length;

  return {
    learning,
    review,
    newCards,
    counts: {
      learningDue: learning.filter(c => c.dueDate <= now).length,
      learningTotal: learning.length,
      reviewDue: review.length,
      newAvailable: newCards.length,
      newCardsToday,
      reviewsToday,
      totalCards: cards.length,
      totalNew: cards.filter(c => isNew(c)).length,
    },
  };
}

/**
 * Get the next card to study from the queues.
 * Priority: learning > review > new.
 * Returns { card, source } or null if session complete.
 */
export function getNextCard(queues, settings = DEFAULT_SETTINGS) {
  const now = Date.now();

  // 1. Learning/Relearning cards take priority
  if (queues.learning.length > 0 && queues.learning[0].dueDate <= now) {
    return { card: queues.learning.shift(), source: 'learning' };
  }

  // 2. Review cards
  if (queues.review.length > 0 && queues.counts.reviewsToday < settings.maxReviewsPerDay) {
    return { card: queues.review.shift(), source: 'review' };
  }

  // 3. New cards
  if (queues.newCards.length > 0) {
    const card = queues.newCards.shift();
    card.state = CARD_STATES.LEARNING;
    card.stepIndex = 0;
    card.firstStudiedDate = card.firstStudiedDate || now;
    card.dueDate = now; // due immediately
    // Save immediately so NEW→LEARNING transition persists if user exits before rating
    saveCardState(card);
    return { card, source: 'new' };
  }

  // 4. Check if there are learning cards due soon (within session)
  if (queues.learning.length > 0) {
    const timeUntilDue = queues.learning[0].dueDate - now;
    const learnAheadMs = (settings.learnAheadLimit || 20) * MINUTE_MS;

    // Learn ahead: show the card early if within the limit (like Anki)
    if (timeUntilDue <= learnAheadMs) {
      return { card: queues.learning.shift(), source: 'learning' };
    }

    // Beyond learn-ahead limit — wait
    return { card: queues.learning[0], source: 'learning_wait', waitUntil: queues.learning[0].dueDate };
  }

  return null;
}

/**
 * After processing a rating, put the card back into the appropriate queue if still due.
 */
export function requeueCard(card, queues) {
  if (isFlagged(card)) return;
  const now = Date.now();

  if (card.state === CARD_STATES.LEARNING || card.state === CARD_STATES.RELEARNING) {
    // Insert into learning queue sorted by dueDate
    const idx = queues.learning.findIndex(c => c.dueDate > card.dueDate);
    if (idx === -1) {
      queues.learning.push(card);
    } else {
      queues.learning.splice(idx, 0, card);
    }
  }
  // Review and graduated cards don't go back into session queues
}

/**
 * Save card state back to storage after rating.
 */
export function saveCardState(card) {
  const cards = storage.getCards(card.deckId);
  const idx = cards.findIndex(c => c.questionId === card.questionId);
  if (idx >= 0) {
    cards[idx] = card;
  }
  storage.saveCards(card.deckId, cards);
}

/**
 * Record a rating in daily stats.
 */
export function recordStat(deckId, rating, cardSource) {
  const stats = storage.getStats(deckId);
  const today = formatDate(Date.now());

  if (!stats[today]) {
    stats[today] = {
      newStudied: 0,
      reviewsDone: 0,
      learningSteps: 0,
      againCount: 0,
      hardCount: 0,
      goodCount: 0,
      easyCount: 0,
    };
  }

  const s = stats[today];
  if (cardSource === 'new') s.newStudied++;
  if (cardSource === 'review') s.reviewsDone++;
  if (cardSource === 'learning' || cardSource === 'learning_wait') s.learningSteps++;

  if (rating === 1) s.againCount++;
  if (rating === 2) s.hardCount++;
  if (rating === 3) s.goodCount++;
  if (rating === 4) s.easyCount++;

  storage.saveStats(deckId, stats);
}

/**
 * Get summary stats for a deck (for the deck list screen).
 */
export function getDeckStats(deckId, settings = DEFAULT_SETTINGS, includeFlagged = false) {
  const now = Date.now();
  const today = startOfDay(now);
  const allCards = storage.getCards(deckId);
  const flaggedCount = allCards.filter(c => isFlagged(c)).length;
  const cards = includeFlagged ? allCards : allCards.filter(c => !isFlagged(c));

  const dueReview = cards.filter(c => isReview(c) && c.dueDate <= now).length;
  const dueLearning = cards.filter(c => (isLearning(c) || isRelearning(c)) && c.dueDate <= now).length;
  const totalNew = cards.filter(c => isNew(c)).length;
  const learningTotal = cards.filter(c => isLearning(c) || isRelearning(c)).length;
  const newCardsToday = cards.filter(c =>
    c.firstStudiedDate != null && startOfDay(c.firstStudiedDate) === today
  ).length;
  const newAvailable = Math.min(totalNew, Math.max(0, settings.newCardsPerDay - newCardsToday));

  return {
    dueToday: dueReview + dueLearning,
    dueReview,
    dueLearning,
    learningTotal,
    newAvailable,
    totalNew,
    totalCards: cards.length,
    learned: cards.filter(c => isReview(c)).length,
    flagged: flaggedCount,
  };
}

/**
 * Get today's session stats for end-of-session screen.
 */
export function getTodayStats(deckId) {
  const stats = storage.getStats(deckId);
  const today = formatDate(Date.now());
  return stats[today] || {
    newStudied: 0,
    reviewsDone: 0,
    learningSteps: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
}

/**
 * Get per-category stats for decks with categories.
 */
export function getDeckCategoryStats(deckId, categories, includeFlagged = false) {
  const now = Date.now();
  const cards = storage.getCards(deckId);
  const questions = storage.getQuestions(deckId);

  // Build questionId → category map
  const qCatMap = new Map();
  for (const q of questions) {
    if (q.category) qCatMap.set(q.id, q.category);
  }

  const statsMap = {};
  for (const cat of categories) {
    statsMap[cat.id] = { due: 0, newCount: 0, learning: 0 };
  }

  for (const card of cards) {
    if (!includeFlagged && isFlagged(card)) continue;
    const catId = qCatMap.get(card.questionId);
    if (!catId || !statsMap[catId]) continue;

    if (isNew(card)) {
      statsMap[catId].newCount++;
    } else if (isLearning(card) || isRelearning(card)) {
      if (card.dueDate <= now) {
        statsMap[catId].due++;
      } else {
        statsMap[catId].learning++;
      }
    } else if (isReview(card) && card.dueDate <= now) {
      statsMap[catId].due++;
    }
  }

  return statsMap;
}

/**
 * Remove a deck and all its data.
 */
export function removeDeck(deckId) {
  const decks = storage.getDecks().filter(d => d.id !== deckId);
  storage.saveDecks(decks);
  storage.clearDeckData(deckId);
}

/**
 * Reset all cards in a deck to "new" state, clearing SRS progress and stats.
 */
export function resetProgress(deckId) {
  const cards = storage.getCards(deckId);
  const resetCards = cards.map(c => {
    const fresh = createCard(c.questionId, c.deckId);
    fresh.flagged = !!c.flagged; // preserve flagged status
    return fresh;
  });
  storage.saveCards(deckId, resetCards);
  storage.saveStats(deckId, {});
}

/**
 * Set or clear the flagged status on a card.
 */
export function setCardFlagged(deckId, questionId, flagged) {
  const cards = storage.getCards(deckId);
  const idx = cards.findIndex(c => c.questionId === questionId);
  if (idx >= 0) {
    cards[idx].flagged = flagged;
    storage.saveCards(deckId, cards);
    return cards[idx];
  }
  return null;
}

/**
 * Get count of flagged cards in a deck (optionally filtered by question IDs).
 */
export function getFlaggedCount(deckId, questionIdFilter = null) {
  let cards = storage.getCards(deckId);
  if (questionIdFilter) {
    const filterSet = new Set(questionIdFilter);
    cards = cards.filter(c => filterSet.has(c.questionId));
  }
  return cards.filter(c => isFlagged(c)).length;
}

/**
 * Get question IDs of all flagged cards in a deck.
 */
export function getFlaggedQuestionIds(deckId, questionIdFilter = null) {
  let cards = storage.getCards(deckId);
  if (questionIdFilter) {
    const filterSet = new Set(questionIdFilter);
    cards = cards.filter(c => filterSet.has(c.questionId));
  }
  return cards.filter(c => isFlagged(c)).map(c => c.questionId);
}
