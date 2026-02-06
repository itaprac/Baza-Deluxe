// card.js — Card data model, states, and predicates

export const CARD_STATES = Object.freeze({
  NEW: 'new',
  LEARNING: 'learning',
  REVIEW: 'review',
  RELEARNING: 'relearning',
});

export const RATINGS = Object.freeze({
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
});

/**
 * Creates a new card object linked to a question.
 */
export function createCard(questionId, deckId) {
  return {
    questionId,
    deckId,
    state: CARD_STATES.NEW,
    easeFactor: 2.5,
    interval: 0,
    stepIndex: 0,
    dueDate: 0,
    lapses: 0,
    reviewCount: 0,
    lastReviewDate: null,
    firstStudiedDate: null,
    flagged: false,
  };
}

export function isNew(card) {
  return card.state === CARD_STATES.NEW;
}

export function isLearning(card) {
  return card.state === CARD_STATES.LEARNING;
}

export function isRelearning(card) {
  return card.state === CARD_STATES.RELEARNING;
}

export function isReview(card) {
  return card.state === CARD_STATES.REVIEW;
}

export function isInLearningPhase(card) {
  return card.state === CARD_STATES.LEARNING || card.state === CARD_STATES.RELEARNING;
}

export function isFlagged(card) {
  return !!card.flagged;
}

export function isDue(card, now = Date.now()) {
  if (card.state === CARD_STATES.NEW) return false;
  return card.dueDate <= now;
}
