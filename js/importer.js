// importer.js — JSON import, validation, and merge logic

import { createCard } from './card.js';
import * as storage from './storage.js';

/**
 * Validate a parsed JSON object against the deck schema.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateDeckJSON(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Nieprawidłowy format JSON.'] };
  }

  // Validate deck metadata
  if (!data.deck || typeof data.deck !== 'object') {
    errors.push('Brak sekcji "deck" z metadanymi talii.');
  } else {
    if (!data.deck.id || typeof data.deck.id !== 'string') {
      errors.push('Brak lub nieprawidłowe "deck.id".');
    } else if (!/^[a-z0-9_-]+$/i.test(data.deck.id)) {
      errors.push('"deck.id" może zawierać tylko litery, cyfry, myślniki i podkreślenia.');
    }
    if (!data.deck.name || typeof data.deck.name !== 'string') {
      errors.push('Brak lub nieprawidłowe "deck.name".');
    }
  }

  // Validate questions
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    errors.push('Brak pytań lub "questions" nie jest tablicą.');
  } else {
    const seenIds = new Set();
    data.questions.forEach((q, i) => {
      const prefix = `Pytanie #${i + 1}`;
      if (!q.id || typeof q.id !== 'string') {
        errors.push(`${prefix}: brak "id".`);
      } else if (seenIds.has(q.id)) {
        errors.push(`${prefix}: zduplikowane id "${q.id}".`);
      } else {
        seenIds.add(q.id);
      }

      if (!q.text || typeof q.text !== 'string') {
        errors.push(`${prefix}: brak treści pytania ("text").`);
      }

      // Validate optional randomize field
      if (q.randomize !== undefined) {
        if (!q.randomize || typeof q.randomize !== 'object' || Array.isArray(q.randomize)) {
          errors.push(`${prefix}: "randomize" musi być obiektem.`);
        } else {
          for (const [varName, varSpec] of Object.entries(q.randomize)) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
              errors.push(`${prefix}: nazwa zmiennej "${varName}" jest niepoprawna.`);
            }
            if (!Array.isArray(varSpec) || varSpec.length < 2 || varSpec.some(v => typeof v !== 'number')) {
              errors.push(`${prefix}: wartości zmiennej "${varName}" muszą być tablicą co najmniej 2 liczb.`);
            }
          }
        }
      }

      if (!Array.isArray(q.answers) || q.answers.length < 2) {
        errors.push(`${prefix}: musi mieć co najmniej 2 odpowiedzi.`);
      } else {
        let hasCorrect = false;
        q.answers.forEach((a, j) => {
          if (!a.id || typeof a.id !== 'string') {
            errors.push(`${prefix}, odpowiedź #${j + 1}: brak "id".`);
          }
          if (!a.text || typeof a.text !== 'string') {
            errors.push(`${prefix}, odpowiedź #${j + 1}: brak "text".`);
          }
          if (typeof a.correct !== 'boolean') {
            errors.push(`${prefix}, odpowiedź #${j + 1}: "correct" musi być true/false.`);
          }
          if (a.correct) hasCorrect = true;
        });
        if (!hasCorrect) {
          errors.push(`${prefix}: brak poprawnej odpowiedzi.`);
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Import a deck from a File object (from <input type="file">).
 * Returns a Promise resolving to { deck, questions, errors } or { valid: false, errors }.
 */
export function importFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const validation = validateDeckJSON(data);
        if (!validation.valid) {
          resolve({ valid: false, errors: validation.errors });
          return;
        }
        const result = registerImport(data);
        resolve({ valid: true, ...result });
      } catch (e) {
        resolve({ valid: false, errors: [`Błąd parsowania JSON: ${e.message}`] });
      }
    };
    reader.onerror = () => {
      resolve({ valid: false, errors: ['Błąd odczytu pliku.'] });
    };
    reader.readAsText(file);
  });
}

/**
 * Import a built-in deck from a URL (fetch).
 */
export async function importBuiltIn(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const validation = validateDeckJSON(data);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors };
    }
    return { valid: true, ...registerImport(data) };
  } catch (e) {
    return { valid: false, errors: [`Błąd ładowania: ${e.message}`] };
  }
}

/**
 * Register an imported deck: save metadata, questions, and create/merge cards.
 * Returns { deck, added, updated, total }
 */
function registerImport(data) {
  const deckMeta = {
    id: data.deck.id,
    name: data.deck.name,
    description: data.deck.description || '',
    questionCount: data.questions.length,
    importedAt: Date.now(),
    version: data.deck.version || 1,
  };

  // Preserve categories if present
  if (data.deck.categories) {
    deckMeta.categories = data.deck.categories;
  }

  // Save/update deck in registry
  const decks = storage.getDecks();
  const existingIndex = decks.findIndex(d => d.id === deckMeta.id);
  if (existingIndex >= 0) {
    decks[existingIndex] = deckMeta;
  } else {
    decks.push(deckMeta);
  }
  storage.saveDecks(decks);

  // Save questions
  storage.saveQuestions(deckMeta.id, data.questions);

  // Merge cards
  const mergeResult = mergeCards(deckMeta.id, data.questions);

  return {
    deck: deckMeta,
    ...mergeResult,
  };
}

/**
 * Merge new questions with existing card states.
 * New questions get new cards, existing questions keep their SRS state.
 */
function mergeCards(deckId, questions) {
  const existingCards = storage.getCards(deckId);
  const cardMap = new Map(existingCards.map(c => [c.questionId, c]));

  let added = 0;
  let updated = 0;

  const newCards = questions.map(q => {
    if (cardMap.has(q.id)) {
      updated++;
      return cardMap.get(q.id);
    } else {
      added++;
      return createCard(q.id, deckId);
    }
  });

  storage.saveCards(deckId, newCards);

  return { added, updated, total: newCards.length };
}
