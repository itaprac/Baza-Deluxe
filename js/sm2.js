// sm2.js — SM-2 spaced repetition algorithm (Anki-compatible)
// Pure logic, no DOM or storage dependencies.

import { CARD_STATES, RATINGS } from './card.js';
import { startOfDay, randomInt, DAY_MS, MINUTE_MS, formatInterval } from './utils.js';

export const DEFAULT_SETTINGS = Object.freeze({
  learningSteps: [1, 10],          // minutes
  relearningSteps: [10],           // minutes
  graduatingInterval: 1,           // days
  easyInterval: 4,                 // days
  startingEase: 2.5,
  minimumEase: 1.3,
  easyBonus: 1.3,
  hardIntervalMultiplier: 1.2,
  newIntervalMultiplier: 0.7,      // multiplier for lapsed card interval
  minimumInterval: 1,              // days
  maximumInterval: 36500,          // days (~100 years)
  newCardsPerDay: 20,
  maxReviewsPerDay: 200,
  learnAheadLimit: 20,             // minutes — show learning cards early if nothing else to study
});

/**
 * Process a rating for a card. Returns a new card object (does not mutate).
 */
export function processRating(card, rating, settings = DEFAULT_SETTINGS) {
  const now = Date.now();
  const previousLastReview = card.lastReviewDate;
  const updated = { ...card, lastReviewDate: now, reviewCount: card.reviewCount + 1 };

  if (card.state === CARD_STATES.LEARNING || card.state === CARD_STATES.RELEARNING) {
    return processLearningRating(updated, rating, settings, now);
  }

  if (card.state === CARD_STATES.REVIEW) {
    return processReviewRating(updated, rating, settings, now, previousLastReview);
  }

  // NEW cards should be transitioned to LEARNING before calling this,
  // but handle gracefully anyway
  updated.state = CARD_STATES.LEARNING;
  updated.firstStudiedDate = updated.firstStudiedDate || now;
  return processLearningRating(updated, rating, settings, now);
}

function processLearningRating(card, rating, settings, now) {
  const steps = card.state === CARD_STATES.LEARNING
    ? settings.learningSteps
    : settings.relearningSteps;

  switch (rating) {
    case RATINGS.AGAIN: {
      card.stepIndex = 0;
      card.dueDate = now + steps[0] * MINUTE_MS;
      break;
    }
    case RATINGS.HARD: {
      if (card.stepIndex === 0 && steps.length >= 2) {
        const delay = (steps[0] + steps[1]) / 2;
        card.dueDate = now + delay * MINUTE_MS;
      } else {
        const delay = steps[card.stepIndex] * 1.5;
        card.dueDate = now + delay * MINUTE_MS;
      }
      // stepIndex does NOT advance for Hard
      break;
    }
    case RATINGS.GOOD: {
      if (card.stepIndex >= steps.length - 1) {
        graduateCard(card, false, settings, now);
      } else {
        card.stepIndex += 1;
        card.dueDate = now + steps[card.stepIndex] * MINUTE_MS;
      }
      break;
    }
    case RATINGS.EASY: {
      graduateCard(card, true, settings, now);
      break;
    }
  }

  return card;
}

function graduateCard(card, isEasy, settings, now) {
  if (card.state === CARD_STATES.LEARNING) {
    card.interval = isEasy ? settings.easyInterval : settings.graduatingInterval;
  } else {
    // Relearning
    if (isEasy) {
      card.interval = Math.max(card.interval, settings.easyInterval);
    } else {
      card.interval = Math.max(card.interval, settings.minimumInterval);
    }
  }

  card.interval = applyFuzz(card.interval);
  card.interval = Math.min(card.interval, settings.maximumInterval);
  card.state = CARD_STATES.REVIEW;
  card.stepIndex = 0;
  card.dueDate = startOfDay(now) + card.interval * DAY_MS;
}

function processReviewRating(card, rating, settings, now, previousLastReview) {
  const daysLate = previousLastReview && card.interval > 0
    ? Math.max(0, (now - previousLastReview) / DAY_MS - card.interval)
    : 0;

  switch (rating) {
    case RATINGS.AGAIN: {
      card.easeFactor = Math.max(settings.minimumEase, card.easeFactor - 0.20);
      card.lapses += 1;
      card.interval = Math.max(
        settings.minimumInterval,
        Math.floor(card.interval * settings.newIntervalMultiplier)
      );
      card.state = CARD_STATES.RELEARNING;
      card.stepIndex = 0;
      card.dueDate = now + settings.relearningSteps[0] * MINUTE_MS;
      break;
    }
    case RATINGS.HARD: {
      card.easeFactor = Math.max(settings.minimumEase, card.easeFactor - 0.15);
      let newInterval = card.interval * settings.hardIntervalMultiplier;
      card.interval = Math.max(card.interval + 1, Math.floor(newInterval));
      card.interval = applyFuzz(card.interval);
      card.interval = Math.min(card.interval, settings.maximumInterval);
      card.dueDate = startOfDay(now) + card.interval * DAY_MS;
      break;
    }
    case RATINGS.GOOD: {
      let newInterval = (card.interval + daysLate / 2) * card.easeFactor;
      card.interval = Math.max(card.interval + 1, Math.floor(newInterval));
      card.interval = applyFuzz(card.interval);
      card.interval = Math.min(card.interval, settings.maximumInterval);
      card.dueDate = startOfDay(now) + card.interval * DAY_MS;
      break;
    }
    case RATINGS.EASY: {
      card.easeFactor += 0.15;
      let newInterval = (card.interval + daysLate) * card.easeFactor * settings.easyBonus;
      card.interval = Math.max(card.interval + 1, Math.floor(newInterval));
      card.interval = applyFuzz(card.interval);
      card.interval = Math.min(card.interval, settings.maximumInterval);
      card.dueDate = startOfDay(now) + card.interval * DAY_MS;
      break;
    }
  }

  return card;
}

/**
 * Apply fuzz factor to prevent cards from clustering on the same day.
 */
export function applyFuzz(interval) {
  if (interval < 2) return interval;
  if (interval === 2) return randomInt(2, 3);
  const fuzzRange = Math.max(1, Math.floor(interval * 0.05));
  return randomInt(interval - fuzzRange, interval + fuzzRange);
}

/**
 * Calculate what intervals each rating button would produce.
 * Returns an object with human-readable interval strings.
 */
export function getButtonIntervals(card, settings = DEFAULT_SETTINGS) {
  if (card.state === CARD_STATES.LEARNING || card.state === CARD_STATES.RELEARNING) {
    return getLearningButtonIntervals(card, settings);
  }
  if (card.state === CARD_STATES.REVIEW) {
    return getReviewButtonIntervals(card, settings);
  }
  // NEW — treat as learning
  return getLearningButtonIntervals(
    { ...card, state: CARD_STATES.LEARNING, stepIndex: 0 },
    settings
  );
}

function getLearningButtonIntervals(card, settings) {
  const steps = card.state === CARD_STATES.LEARNING
    ? settings.learningSteps
    : settings.relearningSteps;

  // Again: first step
  const againMinutes = steps[0];

  // Hard: average of first two or 1.5x current
  let hardMinutes;
  if (card.stepIndex === 0 && steps.length >= 2) {
    hardMinutes = (steps[0] + steps[1]) / 2;
  } else {
    hardMinutes = steps[card.stepIndex] * 1.5;
  }

  // Good: next step or graduating interval
  let goodLabel;
  if (card.stepIndex >= steps.length - 1) {
    const gradInterval = card.state === CARD_STATES.LEARNING
      ? settings.graduatingInterval
      : Math.max(card.interval, settings.minimumInterval);
    goodLabel = formatInterval(gradInterval * 24 * 60);
  } else {
    goodLabel = formatInterval(steps[card.stepIndex + 1]);
  }

  // Easy: easy interval
  const easyDays = card.state === CARD_STATES.LEARNING
    ? settings.easyInterval
    : Math.max(card.interval, settings.easyInterval);
  const easyLabel = formatInterval(easyDays * 24 * 60);

  return {
    again: formatInterval(againMinutes),
    hard: formatInterval(hardMinutes),
    good: goodLabel,
    easy: easyLabel,
  };
}

function getReviewButtonIntervals(card, settings) {
  // Again: first relearning step
  const againLabel = formatInterval(settings.relearningSteps[0]);

  // Hard
  const hardInterval = Math.max(card.interval + 1, Math.floor(card.interval * settings.hardIntervalMultiplier));
  const hardLabel = formatInterval(Math.min(hardInterval, settings.maximumInterval) * 24 * 60);

  // Good
  const goodInterval = Math.max(card.interval + 1, Math.floor(card.interval * card.easeFactor));
  const goodLabel = formatInterval(Math.min(goodInterval, settings.maximumInterval) * 24 * 60);

  // Easy
  const easyInterval = Math.max(card.interval + 1, Math.floor(card.interval * card.easeFactor * settings.easyBonus));
  const easyLabel = formatInterval(Math.min(easyInterval, settings.maximumInterval) * 24 * 60);

  return {
    again: againLabel,
    hard: hardLabel,
    good: goodLabel,
    easy: easyLabel,
  };
}
