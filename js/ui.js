// ui.js — DOM rendering and event handling

import { shuffle, renderLatex, isFlashcard } from './utils.js';

// --- Deck List View ---

export function renderDeckList(decks, statsMap) {
  const container = document.getElementById('deck-list-container');

  if (decks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128218;</div>
        <div class="empty-state-title">Brak talii</div>
        <div class="empty-state-text">
          Importuj plik JSON z pytaniami, aby rozpocząć naukę.
        </div>
        <button class="btn btn-primary" id="btn-import-empty">Importuj talię</button>
      </div>
    `;
    return;
  }

  container.innerHTML = decks.map(deck => {
    const stats = statsMap[deck.id] || { dueReview: 0, dueLearning: 0, newAvailable: 0, totalCards: 0 };
    const hasDue = stats.dueReview > 0 || stats.dueLearning > 0 || stats.newAvailable > 0;
    return `
      <div class="deck-card" data-deck-id="${deck.id}">
        <div class="deck-card-header">
          <div class="deck-card-title">${escapeHtml(deck.name)}</div>
        </div>
        ${deck.description ? `<div class="deck-card-description">${escapeHtml(deck.description)}</div>` : ''}
        <div class="deck-card-stats">
          <div class="deck-stat new">
            <span class="stat-value">${stats.newAvailable}</span>
            <span>nowych</span>
          </div>
          <div class="deck-stat learning">
            <span class="stat-value">${stats.dueLearning}</span>
            <span>w nauce</span>
          </div>
          <div class="deck-stat review">
            <span class="stat-value">${stats.dueReview}</span>
            <span>do powtórki</span>
          </div>
        </div>
        <div class="deck-card-actions">
          <button class="btn btn-primary btn-study" data-deck-id="${deck.id}">
            Otwórz
          </button>
          <button class="btn btn-secondary btn-sm btn-deck-settings" data-deck-id="${deck.id}">
            Ustawienia
          </button>
          <button class="btn btn-secondary btn-sm btn-delete-deck" data-deck-id="${deck.id}" data-deck-name="${escapeHtml(deck.name)}">
            Usuń
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// --- Question Rendering ---

export function renderQuestion(question, cardNumber, totalForSession, isMultiSelect, shouldShuffle = true, showReroll = false, flagged = false) {
  const flashcard = isFlashcard(question);
  const shuffledAnswers = flashcard ? [] : (shouldShuffle ? shuffle(question.answers) : [...question.answers]);
  const hint = flashcard
    ? '(Fiszka — kliknij aby zobaczyć odpowiedź)'
    : (isMultiSelect ? '(Zaznacz wszystkie poprawne)' : '(Wybierz jedną odpowiedź)');
  const indicatorType = isMultiSelect ? 'checkbox' : '';

  const rerollBtn = showReroll
    ? '<button class="btn-reroll" id="btn-reroll-question" title="Wylosuj ponownie">&#x1F3B2;</button>'
    : '';

  const flagBtn = `<button class="btn-flag-question${flagged ? ' flagged' : ''}" id="btn-flag-question" title="Oznacz pytanie (F)">${flagged ? '&#x1F6A9;' : '&#x2691;'}</button>`;

  const answersHtml = flashcard ? '' : `
      <div class="answers-list" id="answers-list">
        ${shuffledAnswers.map((a, i) => `
          <div class="answer-option" data-answer-id="${a.id}" data-index="${i}">
            <div class="answer-indicator ${indicatorType}">${i + 1}</div>
            <div class="answer-text">${renderLatex(escapeHtml(a.text))}</div>
          </div>
        `).join('')}
      </div>`;

  const html = `
    <div class="question-card${flashcard ? ' flashcard' : ''}">
      <div class="question-card-topbar">
        ${cardNumber ? `<div class="question-number">Pytanie ${cardNumber}</div>` : '<div></div>'}
        <div class="question-card-topbar-actions">
          ${flagBtn}
          ${rerollBtn}
          <button class="btn-edit-question" id="btn-edit-question" title="Edytuj pytanie">&#9998;</button>
        </div>
      </div>
      <div class="question-text">${renderLatex(escapeHtml(question.text))}</div>
      <div class="question-hint">${hint}</div>
      ${answersHtml}
      <div class="check-answer-container">
        <button class="btn btn-primary" id="btn-check-answer">Pokaż odpowiedź</button>
      </div>
    </div>
  `;

  document.getElementById('study-content').innerHTML = html;

  return shuffledAnswers;
}

// --- Answer Feedback Rendering ---

export function renderAnswerFeedback(question, shuffledAnswers, selectedIds, explanation, intervals, keybindings = null, flagged = false) {
  const flashcard = isFlashcard(question);

  let answersHtml = '';
  if (!flashcard) {
    const correctIds = new Set(question.answers.filter(a => a.correct).map(a => a.id));
    const noSelection = selectedIds.size === 0;

    answersHtml = shuffledAnswers.map(a => {
      const isCorrect = correctIds.has(a.id);
      const isSelected = selectedIds.has(a.id);

      let stateClass = 'disabled';
      let icon = '';

      if (noSelection) {
        if (isCorrect) {
          stateClass += ' correct-selected';
          icon = '<span class="answer-feedback-icon" style="color: var(--color-success)">&#10003;</span>';
        }
      } else if (isSelected && isCorrect) {
        stateClass += ' correct-selected';
        icon = '<span class="answer-feedback-icon" style="color: var(--color-success)">&#10003;</span>';
      } else if (isSelected && !isCorrect) {
        stateClass += ' incorrect-selected';
        icon = '<span class="answer-feedback-icon" style="color: var(--color-danger)">&#10007;</span>';
      } else if (!isSelected && isCorrect) {
        stateClass += ' correct-missed';
        icon = '<span class="answer-feedback-icon" style="color: var(--color-warning)">&#10003;</span>';
      }

      return `
        <div class="answer-option ${stateClass}" data-answer-id="${a.id}">
          <div class="answer-indicator ${correctIds.size > 1 ? 'checkbox' : ''}"></div>
          <div class="answer-text">${renderLatex(escapeHtml(a.text))}</div>
          ${icon}
        </div>
      `;
    }).join('');
  }

  const explanationHtml = explanation ? `
    <div class="explanation-box">
      <div class="explanation-label">Wyjaśnienie</div>
      <div>${renderLatex(escapeHtml(explanation))}</div>
    </div>
  ` : '';

  const kb = keybindings;
  const keyLabel = (keys) => keys ? keys.map(k => formatKeyName(k)).join(' / ') : '';

  const ratingHtml = `
    <div class="rating-buttons">
      <button class="rating-btn again" data-rating="1">
        <span class="rating-label">Powtórz</span>
        <span class="rating-interval">${intervals.again}</span>
        <span class="rating-key">${kb ? keyLabel(kb.again) : '1'}</span>
      </button>
      <button class="rating-btn hard" data-rating="2">
        <span class="rating-label">Trudne</span>
        <span class="rating-interval">${intervals.hard}</span>
        <span class="rating-key">${kb ? keyLabel(kb.hard) : '2'}</span>
      </button>
      <button class="rating-btn good" data-rating="3">
        <span class="rating-label">Dobrze</span>
        <span class="rating-interval">${intervals.good}</span>
        <span class="rating-key">${kb ? keyLabel(kb.good) : '3'}</span>
      </button>
      <button class="rating-btn easy" data-rating="4">
        <span class="rating-label">Łatwe</span>
        <span class="rating-interval">${intervals.easy}</span>
        <span class="rating-key">${kb ? keyLabel(kb.easy) : '4'}</span>
      </button>
    </div>
    <div class="rating-shortcut-hint">${kb ? keyLabel(kb.showAnswer) + ' = Dobrze' : 'Spacja / Enter = Dobrze'}</div>
  `;

  const feedbackFlagBtn = `<button class="btn-flag-question${flagged ? ' flagged' : ''}" id="btn-flag-question" title="Oznacz pytanie (F)">${flagged ? '&#x1F6A9;' : '&#x2691;'}</button>`;

  document.getElementById('study-content').innerHTML = `
    <div class="question-card${flashcard ? ' flashcard' : ''}">
      <div class="question-card-topbar">
        <div></div>
        <div class="question-card-topbar-actions">
          ${feedbackFlagBtn}
          <button class="btn-edit-question" id="btn-edit-question" title="Edytuj pytanie">&#9998;</button>
        </div>
      </div>
      <div class="question-text">${renderLatex(escapeHtml(question.text))}</div>
      ${answersHtml ? `<div class="answers-list">${answersHtml}</div>` : ''}
      ${explanationHtml}
      ${ratingHtml}
    </div>
  `;
}

// --- Session Complete ---

export function renderSessionComplete(todayStats, deckName) {
  document.getElementById('complete-deck-name').textContent = deckName;
  const total = todayStats.againCount + todayStats.hardCount + todayStats.goodCount + todayStats.easyCount;
  const maxCount = Math.max(todayStats.againCount, todayStats.hardCount, todayStats.goodCount, todayStats.easyCount, 1);

  document.getElementById('complete-content').innerHTML = `
    <div class="session-complete">
      <div class="session-complete-title">Sesja zakończona!</div>
      <div class="session-stats-grid">
        <div class="session-stat">
          <div class="stat-number">${total}</div>
          <div class="stat-label">Kart przeglądanych</div>
        </div>
        <div class="session-stat">
          <div class="stat-number">${todayStats.newStudied}</div>
          <div class="stat-label">Nowych kart</div>
        </div>
        <div class="session-stat">
          <div class="stat-number">${todayStats.reviewsDone}</div>
          <div class="stat-label">Powtórek</div>
        </div>
      </div>
      <div class="rating-breakdown">
        <h3>Rozkład ocen</h3>
        ${ratingBarRow('Powtórz', todayStats.againCount, maxCount, 'var(--color-again)')}
        ${ratingBarRow('Trudne', todayStats.hardCount, maxCount, 'var(--color-hard)')}
        ${ratingBarRow('Dobrze', todayStats.goodCount, maxCount, 'var(--color-good)')}
        ${ratingBarRow('Łatwe', todayStats.easyCount, maxCount, 'var(--color-easy)')}
      </div>
      <button class="btn btn-primary" id="btn-back-to-decks-complete">Powrót do listy talii</button>
    </div>
  `;
}

function ratingBarRow(label, count, max, color) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return `
    <div class="rating-bar-row">
      <span class="rating-bar-label">${label}</span>
      <div class="rating-bar-container">
        <div class="rating-bar-fill" style="width: ${pct}%; background: ${color}"></div>
      </div>
      <span class="rating-bar-count">${count}</span>
    </div>
  `;
}

// --- Study Header Counts ---

export function updateStudyCounts(learningCount, reviewCount, newCount, activeSource) {
  const elLearning = document.getElementById('count-learning');
  const elReview = document.getElementById('count-review');
  const elNew = document.getElementById('count-new');
  elLearning.textContent = learningCount;
  elReview.textContent = reviewCount;
  elNew.textContent = newCount;
  elLearning.classList.toggle('active', activeSource === 'learning' || activeSource === 'learning_wait');
  elReview.classList.toggle('active', activeSource === 'review');
  elNew.classList.toggle('active', activeSource === 'new');
}

export function updateProgress(studied, total) {
  const pct = total > 0 ? Math.round((studied / total) * 100) : 0;
  document.getElementById('study-progress').style.width = `${pct}%`;
}

// --- View Switching ---

const FONT_SCALE_VIEWS = new Set(['study', 'test', 'test-result', 'browse']);

export function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');

  const fontControl = document.querySelector('.font-size-control');
  if (fontControl) {
    fontControl.style.display = FONT_SCALE_VIEWS.has(viewId) ? '' : 'none';
  }
}

// --- Notification Toast ---

export function showNotification(message, type = 'info') {
  // Remove any existing notification
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// --- Confirm Modal ---

export function showConfirm(title, text) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-text">${escapeHtml(text)}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary modal-cancel">Anuluj</button>
          <button class="btn btn-danger modal-confirm">Usuń</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector('.modal-confirm').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

// --- Category Select ---

export function renderCategorySelect(deckName, categories, statsMap) {
  document.getElementById('category-select-deck-name').textContent = deckName;

  const totalQuestions = categories.reduce((sum, c) => sum + c.questionCount, 0);
  const totalDue = Object.values(statsMap).reduce((sum, s) => sum + s.due, 0);
  const totalNew = Object.values(statsMap).reduce((sum, s) => sum + s.newCount, 0);

  const allCardHtml = `
    <div class="category-card category-card-all" data-category="all">
      <div class="category-card-name">Wszystkie pytania</div>
      <div class="category-card-count">${totalQuestions} pytań</div>
      <div class="category-card-stats">
        ${totalDue > 0 ? `<span class="cat-stat due">${totalDue} do powtórki</span>` : ''}
        ${totalNew > 0 ? `<span class="cat-stat new">${totalNew} nowych</span>` : ''}
      </div>
    </div>
  `;

  const cardsHtml = categories.map(cat => {
    const stats = statsMap[cat.id] || { due: 0, newCount: 0 };
    return `
      <div class="category-card" data-category="${cat.id}">
        <div class="category-card-num">${escapeHtml(cat.name.split('.')[0] || '')}</div>
        <div class="category-card-name">${escapeHtml(cat.name.replace(/^\d+\.\s*/, ''))}</div>
        <div class="category-card-count">${cat.questionCount} pytań</div>
        <div class="category-card-stats">
          ${stats.due > 0 ? `<span class="cat-stat due">${stats.due} do powtórki</span>` : ''}
          ${stats.newCount > 0 ? `<span class="cat-stat new">${stats.newCount} nowych</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('category-select-content').innerHTML = allCardHtml + `<div class="category-grid">${cardsHtml}</div>`;
}

// --- Mode Select ---

export function renderModeSelect(deckName, deckStats) {
  document.getElementById('mode-select-deck-name').textContent = deckName;

  const hasDue = deckStats.dueToday > 0 || deckStats.newAvailable > 0 || (deckStats.learningTotal || 0) > 0;
  const flaggedCount = deckStats.flagged || 0;

  const flaggedCard = flaggedCount > 0 ? `
      <div class="mode-card" data-mode="flagged">
        <div class="mode-card-icon">&#x1F6A9;</div>
        <div class="mode-card-name">Oznaczone</div>
        <div class="mode-card-desc">Przeglądaj oflagowane pytania (${flaggedCount})</div>
      </div>` : '';

  document.getElementById('mode-select-content').innerHTML = `
    <div class="mode-select-grid">
      <div class="mode-card ${!hasDue ? 'disabled' : ''}" data-mode="anki">
        <div class="mode-card-icon">&#x1F4DA;</div>
        <div class="mode-card-name">Anki</div>
        <div class="mode-card-desc">Nauka z powtarzaniem rozłożonym (SM-2)</div>
        <div class="mode-card-stats anki-counts">
          ${(deckStats.learningTotal || 0) > 0 ? `<span class="anki-count learning">${deckStats.learningTotal}</span>` : ''}
          ${(deckStats.dueReview || 0) > 0 ? `<span class="anki-count review">${deckStats.dueReview}</span>` : ''}
          ${(deckStats.newAvailable || 0) > 0 ? `<span class="anki-count new">${deckStats.newAvailable}</span>` : ''}
        </div>
      </div>
      <div class="mode-card ${deckStats.totalCards === 0 ? 'disabled' : ''}" data-mode="test">
        <div class="mode-card-icon">&#x1F4DD;</div>
        <div class="mode-card-name">Test</div>
        <div class="mode-card-desc">Losowy test z wybraną liczbą pytań</div>
      </div>
      <div class="mode-card ${deckStats.totalCards === 0 ? 'disabled' : ''}" data-mode="browse">
        <div class="mode-card-icon">&#x1F50D;</div>
        <div class="mode-card-name">Przeglądanie</div>
        <div class="mode-card-desc">Lista wszystkich pytań z odpowiedziami</div>
      </div>
      ${flaggedCard}
    </div>
  `;
}

// --- Test Config ---

export function renderTestConfig(totalQuestions) {
  const defaultCount = Math.min(10, totalQuestions);

  document.getElementById('test-content').innerHTML = `
    <div class="test-config">
      <div class="test-config-title">Konfiguracja testu</div>
      <div class="test-config-slider-row">
        <input type="range" id="test-count-slider" min="1" max="${totalQuestions}" value="${defaultCount}">
        <span class="test-config-count" id="test-count-display">${defaultCount}</span>
      </div>
      <div class="test-config-label">Liczba pytań (max ${totalQuestions})</div>
      <button class="btn btn-primary" id="btn-start-test">Rozpocznij test</button>
    </div>
  `;
}

// --- Test Question ---

export function renderTestQuestion(question, num, total, isMulti, shouldShuffle = true, preShuffledAnswers = null, previousSelection = null) {
  const shuffledAnswers = preShuffledAnswers || (shouldShuffle ? shuffle(question.answers) : [...question.answers]);
  const hint = isMulti ? '(Zaznacz wszystkie poprawne)' : '(Wybierz jedną odpowiedź)';
  const indicatorType = isMulti ? 'checkbox' : '';

  document.getElementById('test-counter').textContent = `${num} / ${total}`;
  const pct = total > 0 ? Math.round((num / total) * 100) : 0;
  document.getElementById('test-progress').style.width = `${pct}%`;

  const isLast = num === total;
  const isFirst = num === 1;
  const hasSelection = previousSelection && previousSelection.size > 0;

  document.getElementById('test-content').innerHTML = `
    <div class="question-card">
      <div class="question-number">Pytanie ${num} z ${total}</div>
      <div class="question-text">${renderLatex(escapeHtml(question.text))}</div>
      <div class="question-hint">${hint}</div>
      <div class="answers-list" id="test-answers-list">
        ${shuffledAnswers.map((a, i) => `
          <div class="answer-option ${previousSelection && previousSelection.has(a.id) ? 'selected' : ''}" data-answer-id="${a.id}" data-index="${i}">
            <div class="answer-indicator ${indicatorType}">${i + 1}</div>
            <div class="answer-text">${renderLatex(escapeHtml(a.text))}</div>
          </div>
        `).join('')}
      </div>
      <div class="check-answer-container">
        ${!isFirst ? '<button class="btn btn-secondary" id="btn-test-prev">Wstecz</button>' : ''}
        <button class="btn btn-primary" id="btn-test-next" ${hasSelection ? '' : 'disabled'}>
          ${isLast ? 'Zakończ test' : 'Następne pytanie'}
        </button>
      </div>
    </div>
  `;

  return shuffledAnswers;
}

// --- Test Result ---

export function renderTestResult(deckName, results) {
  document.getElementById('test-result-deck-name').textContent = deckName;

  const { score, total, answers } = results;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  let scoreClass = 'score-low';
  if (pct >= 75) scoreClass = 'score-high';
  else if (pct >= 50) scoreClass = 'score-mid';

  let barColor = 'var(--color-danger)';
  if (pct >= 75) barColor = 'var(--color-success)';
  else if (pct >= 50) barColor = 'var(--color-warning)';

  const reviewHtml = answers.map((a, i) => {
    const isCorrect = a.correct;
    const iconClass = isCorrect ? 'correct' : 'incorrect';
    const iconChar = isCorrect ? '&#10003;' : '&#10007;';

    const detailHtml = a.question.answers.map(ans => {
      const wasSelected = a.selectedIds.has(ans.id);
      const isRight = ans.correct;

      let cssClass = '';
      let icon = '';
      if (wasSelected && isRight) {
        cssClass = 'is-correct';
        icon = '<span class="test-review-answer-icon" style="color: var(--color-success)">&#10003;</span>';
      } else if (wasSelected && !isRight) {
        cssClass = 'is-incorrect-selected';
        icon = '<span class="test-review-answer-icon" style="color: var(--color-danger)">&#10007;</span>';
      } else if (!wasSelected && isRight) {
        cssClass = 'is-correct';
        icon = '<span class="test-review-answer-icon" style="color: var(--color-warning)">&#10003;</span>';
      } else {
        icon = '<span class="test-review-answer-icon" style="color: transparent">&#8226;</span>';
      }

      return `<div class="test-review-answer ${cssClass}">${icon}<span>${renderLatex(escapeHtml(ans.text))}</span></div>`;
    }).join('');

    return `
      <div class="test-review-item" data-index="${i}">
        <div class="test-review-header">
          <div class="test-review-icon ${iconClass}">${iconChar}</div>
          <div class="test-review-question">${renderLatex(escapeHtml(a.question.text))}</div>
          <div class="test-review-chevron">&#9654;</div>
        </div>
        <div class="test-review-detail">${detailHtml}</div>
      </div>
    `;
  }).join('');

  document.getElementById('test-result-content').innerHTML = `
    <div class="test-result">
      <div class="test-result-title">Wynik testu</div>
      <div class="test-result-score ${scoreClass}">${score} / ${total}</div>
      <div class="test-result-percent">${pct}%</div>
      <div class="test-result-bar">
        <div class="test-result-bar-fill" style="width: ${pct}%; background: ${barColor}"></div>
      </div>
      <div class="test-result-actions">
        <button class="btn btn-primary" id="btn-test-retry">Powtórz test</button>
        <button class="btn btn-secondary" id="btn-test-back-to-decks">Powrót do talii</button>
      </div>
      <div class="test-review-list">${reviewHtml}</div>
    </div>
  `;
}

// --- Browse ---

export function renderBrowse(deckName, questions) {
  document.getElementById('browse-deck-name').textContent = deckName;

  const searchHtml = `
    <div class="browse-search">
      <input type="text" id="browse-search-input" placeholder="Szukaj pytania...">
    </div>
  `;

  const listHtml = questions.map((q, i) => {
    const flashcard = isFlashcard(q);

    let answersHtml = '';
    if (!flashcard) {
      answersHtml = q.answers.map(a => {
        const isCorrect = a.correct;
        const cls = isCorrect ? 'correct' : '';
        const icon = isCorrect
          ? '<span class="browse-answer-icon" style="color: var(--color-success)">&#10003;</span>'
          : '<span class="browse-answer-icon" style="color: transparent">&#8226;</span>';
        return `<div class="browse-answer ${cls}">${icon}<span>${renderLatex(escapeHtml(a.text))}</span></div>`;
      }).join('');
    }

    const explanationHtml = q.explanation
      ? `<div class="browse-item-explanation"><strong>Wyjaśnienie:</strong> ${renderLatex(escapeHtml(q.explanation))}</div>`
      : '';

    return `
      <div class="browse-item" data-search-text="${escapeHtml(q.text.toLowerCase())}" data-question-index="${i}">
        <div class="browse-item-header">
          <div class="browse-item-number">${flashcard ? 'Fiszka' : 'Pytanie'} ${i + 1}</div>
          <button class="btn-edit-question browse-edit-btn" data-question-index="${i}" title="Edytuj pytanie">&#9998;</button>
        </div>
        <div class="browse-item-question">${renderLatex(escapeHtml(q.text))}</div>
        ${answersHtml ? `<div class="browse-item-answers">${answersHtml}</div>` : ''}
        ${explanationHtml}
      </div>
    `;
  }).join('');

  document.getElementById('browse-content').innerHTML = searchHtml + `<div class="browse-list" id="browse-list">${listHtml}</div>`;
}

// --- Browse Editor (inline) ---

export function renderBrowseEditor(question, index) {
  const flashcard = isFlashcard(question);

  const answersHtml = flashcard ? '' : question.answers.map((a) => `
    <div class="editor-answer-row" data-answer-id="${a.id}">
      <label class="toggle-switch toggle-switch-sm">
        <input type="checkbox" class="editor-answer-correct" data-answer-id="${a.id}" ${a.correct ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <input type="text" class="editor-answer-text" data-answer-id="${a.id}" value="${escapeAttr(a.text)}">
    </div>
  `).join('');

  const hasRandomize = question.randomize && typeof question.randomize === 'object';
  const vars = hasRandomize
    ? Object.entries(question.randomize).filter(([n]) => !n.startsWith('$'))
    : [];

  const varsHtml = vars.map(([name, values]) => `
    <div class="editor-var-row">
      <input type="text" class="editor-var-name" value="${escapeAttr(name)}" placeholder="nazwa">
      <input type="text" class="editor-var-values" value="${escapeAttr(values.join(', '))}" placeholder="min, max lub v1, v2, v3...">
      <button class="btn-remove-var" title="Usuń zmienną">&times;</button>
    </div>
  `).join('');

  const derivedEntries = hasRandomize && question.randomize.$derived
    ? Object.entries(question.randomize.$derived) : [];
  const derivedHtml = derivedEntries.map(([name, expr]) => `
    <div class="editor-derived-row">
      <input type="text" class="editor-derived-name" value="${escapeAttr(name)}" placeholder="nazwa">
      <input type="text" class="editor-derived-expr" value="${escapeAttr(expr)}" placeholder="wyrażenie, np. a + b">
      <button class="btn-remove-derived" title="Usuń">&times;</button>
    </div>
  `).join('');

  const constraintsList = hasRandomize && Array.isArray(question.randomize.$constraints)
    ? question.randomize.$constraints : [];
  const constraintsHtml = constraintsList.map(expr => `
    <div class="editor-constraint-row">
      <input type="text" class="editor-constraint-expr" value="${escapeAttr(expr)}" placeholder="warunek, np. a != b">
      <button class="btn-remove-constraint" title="Usuń">&times;</button>
    </div>
  `).join('');

  return `
    <div class="question-card question-editor browse-editor" data-question-index="${index}">
      <div class="editor-section">
        <label class="editor-label">Treść pytania</label>
        <textarea class="editor-textarea editor-question-text" rows="3">${escapeHtml(question.text)}</textarea>
      </div>
      ${flashcard ? `
      <div class="editor-section">
        <div class="editor-flashcard-note">Fiszka (brak odpowiedzi ABCD)</div>
      </div>` : `
      <div class="editor-section">
        <label class="editor-label">Odpowiedzi <span class="editor-label-hint">(przełącznik = poprawna)</span></label>
        <div class="editor-answers-list">
          ${answersHtml}
        </div>
      </div>`}
      <div class="editor-section">
        <label class="editor-label">Wyjaśnienie <span class="editor-label-hint">(opcjonalne)</span></label>
        <textarea class="editor-textarea editor-explanation" rows="2">${escapeHtml(question.explanation || '')}</textarea>
      </div>
      <div class="editor-section editor-randomize-section">
        <div class="editor-randomize-header">
          <label class="editor-label">Losowe wartości</label>
          <label class="toggle-switch toggle-switch-sm">
            <input type="checkbox" class="editor-randomize-toggle" ${hasRandomize ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="editor-randomize-body" style="${hasRandomize ? '' : 'display:none'}">
          <div class="editor-randomize-hint">
            Użyj <code>{nazwa}</code> w treści, <code>=&#123;wyrażenie&#125;</code> w odpowiedziach.
            Zakres: <code>min, max</code> (2 liczby) lub lista: <code>v1, v2, v3</code> (3+).
          </div>
          <div class="editor-vars-list">
            ${varsHtml}
          </div>
          <button class="btn btn-secondary btn-sm btn-add-var">+ Dodaj zmienną</button>
          <div class="editor-subsection">
            <label class="editor-label editor-sublabel">Zmienne pochodne ($derived)</label>
            <div class="editor-derived-list">
              ${derivedHtml}
            </div>
            <button class="btn btn-secondary btn-sm btn-add-derived">+ Dodaj pochodną</button>
          </div>
          <div class="editor-subsection">
            <label class="editor-label editor-sublabel">Ograniczenia ($constraints)</label>
            <div class="editor-constraints-list">
              ${constraintsHtml}
            </div>
            <button class="btn btn-secondary btn-sm btn-add-constraint">+ Dodaj ograniczenie</button>
          </div>
        </div>
      </div>
      <div class="editor-actions">
        <button class="btn btn-secondary btn-browse-editor-cancel" data-question-index="${index}">Anuluj</button>
        <button class="btn btn-primary btn-browse-editor-save" data-question-index="${index}">Zapisz zmiany</button>
      </div>
    </div>
  `;
}

// --- Flagged Browse ---

export function renderFlaggedBrowse(deckName, flaggedQuestions) {
  document.getElementById('browse-deck-name').textContent = deckName;

  const headerHtml = `
    <div class="flagged-header">
      <span class="flagged-count">${flaggedQuestions.length} oznaczonych pytań</span>
      ${flaggedQuestions.length > 0 ? '<button class="btn btn-primary btn-sm" id="btn-study-flagged">Ucz się (Anki)</button>' : ''}
    </div>
  `;

  if (flaggedQuestions.length === 0) {
    document.getElementById('browse-content').innerHTML = headerHtml + `
      <div class="browse-empty">Brak oznaczonych pytań.</div>
    `;
    return;
  }

  const listHtml = flaggedQuestions.map((q, i) => {
    const flashcard = isFlashcard(q);

    let answersHtml = '';
    if (!flashcard) {
      answersHtml = q.answers.map(a => {
        const isCorrect = a.correct;
        const cls = isCorrect ? 'correct' : '';
        const icon = isCorrect
          ? '<span class="browse-answer-icon" style="color: var(--color-success)">&#10003;</span>'
          : '<span class="browse-answer-icon" style="color: transparent">&#8226;</span>';
        return `<div class="browse-answer ${cls}">${icon}<span>${renderLatex(escapeHtml(a.text))}</span></div>`;
      }).join('');
    }

    return `
      <div class="browse-item flagged-item" data-question-id="${q.id}">
        <div class="browse-item-number">${flashcard ? 'Fiszka' : 'Pytanie'} ${i + 1}</div>
        <div class="browse-item-question">${renderLatex(escapeHtml(q.text))}</div>
        ${answersHtml ? `<div class="browse-item-answers">${answersHtml}</div>` : ''}
        <div class="flagged-item-actions">
          <button class="btn btn-secondary btn-sm btn-unflag" data-question-id="${q.id}">Odznacz</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('browse-content').innerHTML = headerHtml + `<div class="browse-list">${listHtml}</div>`;
}

// --- Settings ---

export function renderSettings(settings, defaults) {
  const stepsToStr = (arr) => Array.isArray(arr) ? arr.join(', ') : String(arr);

  document.getElementById('settings-content').innerHTML = `
    <div class="settings-form">
      <div class="settings-group">
        <label class="settings-label" for="set-newCardsPerDay">Nowe karty dziennie</label>
        <input class="settings-input" type="number" id="set-newCardsPerDay" min="1" max="9999" value="${settings.newCardsPerDay}">
        <div class="settings-hint">Ile nowych kart wprowadzić dziennie (1–9999)</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-maxReviewsPerDay">Maks. powtórek dziennie</label>
        <input class="settings-input" type="number" id="set-maxReviewsPerDay" min="1" max="9999" value="${settings.maxReviewsPerDay}">
        <div class="settings-hint">Limit powtórek na dzień (1–9999)</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-learningSteps">Kroki nauki (min)</label>
        <input class="settings-input" type="text" id="set-learningSteps" value="${stepsToStr(settings.learningSteps)}">
        <div class="settings-hint">Interwały w minutach dla nowych kart, oddzielone przecinkami (np. 1, 10)</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-relearningSteps">Kroki ponownej nauki (min)</label>
        <input class="settings-input" type="text" id="set-relearningSteps" value="${stepsToStr(settings.relearningSteps)}">
        <div class="settings-hint">Interwały dla kart z błędem, oddzielone przecinkami (np. 10)</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-graduatingInterval">Interwał początkowy (dni)</label>
        <input class="settings-input" type="number" id="set-graduatingInterval" min="1" max="30" value="${settings.graduatingInterval}">
        <div class="settings-hint">Po ukończeniu kroków nauki (1–30)</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-easyInterval">Łatwy interwał (dni)</label>
        <input class="settings-input" type="number" id="set-easyInterval" min="1" max="60" value="${settings.easyInterval}">
        <div class="settings-hint">Po kliknięciu "Łatwe" (1–60)</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-maximumInterval">Maks. interwał (dni)</label>
        <input class="settings-input" type="number" id="set-maximumInterval" min="1" max="36500" value="${settings.maximumInterval}">
        <div class="settings-hint">Maksymalny odstęp między powtórkami (1–36500)</div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">Zapisz</button>
        <button class="btn btn-secondary" id="btn-restore-defaults">Przywróć domyślne</button>
      </div>
    </div>
    <div class="settings-danger-zone">
      <div class="settings-danger-zone-title">Strefa zagrożenia</div>
      <div class="settings-danger-zone-text">Resetuj postęp talii — wszystkie karty wrócą do stanu "nowe", statystyki zostaną usunięte.</div>
      <button class="btn btn-danger" id="btn-reset-progress">Resetuj postęp talii</button>
    </div>
  `;
}

// --- Question Editor ---

export function renderQuestionEditor(question) {
  const flashcard = isFlashcard(question);

  const answersHtml = flashcard ? '' : question.answers.map((a, i) => `
    <div class="editor-answer-row" data-answer-id="${a.id}">
      <label class="toggle-switch toggle-switch-sm">
        <input type="checkbox" class="editor-answer-correct" data-answer-id="${a.id}" ${a.correct ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <input type="text" class="editor-answer-text" data-answer-id="${a.id}" value="${escapeAttr(a.text)}">
    </div>
  `).join('');

  const hasRandomize = question.randomize && typeof question.randomize === 'object';
  const vars = hasRandomize
    ? Object.entries(question.randomize).filter(([n]) => !n.startsWith('$'))
    : [];

  const varsHtml = vars.map(([name, values]) => `
    <div class="editor-var-row">
      <input type="text" class="editor-var-name" value="${escapeAttr(name)}" placeholder="nazwa">
      <input type="text" class="editor-var-values" value="${escapeAttr(values.join(', '))}" placeholder="min, max lub v1, v2, v3...">
      <button class="btn-remove-var" title="Usuń zmienną">&times;</button>
    </div>
  `).join('');

  const derivedEntries = hasRandomize && question.randomize.$derived
    ? Object.entries(question.randomize.$derived) : [];
  const derivedHtml = derivedEntries.map(([name, expr]) => `
    <div class="editor-derived-row">
      <input type="text" class="editor-derived-name" value="${escapeAttr(name)}" placeholder="nazwa">
      <input type="text" class="editor-derived-expr" value="${escapeAttr(expr)}" placeholder="wyrażenie, np. a + b">
      <button class="btn-remove-derived" title="Usuń">&times;</button>
    </div>
  `).join('');

  const constraintsList = hasRandomize && Array.isArray(question.randomize.$constraints)
    ? question.randomize.$constraints : [];
  const constraintsHtml = constraintsList.map(expr => `
    <div class="editor-constraint-row">
      <input type="text" class="editor-constraint-expr" value="${escapeAttr(expr)}" placeholder="warunek, np. a != b">
      <button class="btn-remove-constraint" title="Usuń">&times;</button>
    </div>
  `).join('');

  document.getElementById('study-content').innerHTML = `
    <div class="question-card question-editor">
      <div class="editor-section">
        <label class="editor-label">Treść pytania</label>
        <textarea class="editor-textarea" id="editor-question-text" rows="3">${escapeHtml(question.text)}</textarea>
      </div>
      ${flashcard ? `
      <div class="editor-section">
        <div class="editor-flashcard-note">Fiszka (brak odpowiedzi ABCD)</div>
      </div>` : `
      <div class="editor-section">
        <label class="editor-label">Odpowiedzi <span class="editor-label-hint">(przełącznik = poprawna)</span></label>
        <div class="editor-answers-list" id="editor-answers-list">
          ${answersHtml}
        </div>
      </div>`}
      <div class="editor-section">
        <label class="editor-label">Wyjaśnienie <span class="editor-label-hint">(opcjonalne)</span></label>
        <textarea class="editor-textarea" id="editor-explanation" rows="2">${escapeHtml(question.explanation || '')}</textarea>
      </div>
      <div class="editor-section editor-randomize-section">
        <div class="editor-randomize-header">
          <label class="editor-label">Losowe wartości</label>
          <label class="toggle-switch toggle-switch-sm">
            <input type="checkbox" id="editor-randomize-toggle" ${hasRandomize ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="editor-randomize-body" id="editor-randomize-body" style="${hasRandomize ? '' : 'display:none'}">
          <div class="editor-randomize-hint">
            Użyj <code>{nazwa}</code> w treści, <code>=&#123;wyrażenie&#125;</code> w odpowiedziach.
            Zakres: <code>min, max</code> (2 liczby) lub lista: <code>v1, v2, v3</code> (3+).
          </div>
          <div class="editor-vars-list" id="editor-vars-list">
            ${varsHtml}
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-add-var">+ Dodaj zmienną</button>
          <div class="editor-subsection">
            <label class="editor-label editor-sublabel">Zmienne pochodne ($derived)</label>
            <div class="editor-derived-list" id="editor-derived-list">
              ${derivedHtml}
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-add-derived">+ Dodaj pochodną</button>
          </div>
          <div class="editor-subsection">
            <label class="editor-label editor-sublabel">Ograniczenia ($constraints)</label>
            <div class="editor-constraints-list" id="editor-constraints-list">
              ${constraintsHtml}
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-add-constraint">+ Dodaj ograniczenie</button>
          </div>
        </div>
      </div>
      <div class="editor-actions">
        <button class="btn btn-secondary" id="btn-editor-cancel">Anuluj</button>
        <button class="btn btn-primary" id="btn-editor-save">Zapisz zmiany</button>
      </div>
    </div>
  `;

  // Bind randomize editor events
  bindRandomizeEditorEvents();
}

function bindRandomizeEditorEvents() {
  const toggle = document.getElementById('editor-randomize-toggle');
  const body = document.getElementById('editor-randomize-body');
  if (toggle && body) {
    toggle.addEventListener('change', () => {
      body.style.display = toggle.checked ? '' : 'none';
    });
  }

  const addBtn = document.getElementById('btn-add-var');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const list = document.getElementById('editor-vars-list');
      const row = document.createElement('div');
      row.className = 'editor-var-row';
      row.innerHTML = `
        <input type="text" class="editor-var-name" value="" placeholder="nazwa">
        <input type="text" class="editor-var-values" value="" placeholder="min, max lub v1, v2, v3...">
        <button class="btn-remove-var" title="Usuń zmienną">&times;</button>
      `;
      list.appendChild(row);
      bindRemoveButtons();
    });
  }

  const addDerivedBtn = document.getElementById('btn-add-derived');
  if (addDerivedBtn) {
    addDerivedBtn.addEventListener('click', () => {
      const list = document.getElementById('editor-derived-list');
      const row = document.createElement('div');
      row.className = 'editor-derived-row';
      row.innerHTML = `
        <input type="text" class="editor-derived-name" value="" placeholder="nazwa">
        <input type="text" class="editor-derived-expr" value="" placeholder="wyrażenie, np. a + b">
        <button class="btn-remove-derived" title="Usuń">&times;</button>
      `;
      list.appendChild(row);
      bindRemoveButtons();
    });
  }

  const addConstraintBtn = document.getElementById('btn-add-constraint');
  if (addConstraintBtn) {
    addConstraintBtn.addEventListener('click', () => {
      const list = document.getElementById('editor-constraints-list');
      const row = document.createElement('div');
      row.className = 'editor-constraint-row';
      row.innerHTML = `
        <input type="text" class="editor-constraint-expr" value="" placeholder="warunek, np. a != b">
        <button class="btn-remove-constraint" title="Usuń">&times;</button>
      `;
      list.appendChild(row);
      bindRemoveButtons();
    });
  }

  bindRemoveButtons();
}

function bindRemoveButtons() {
  const selector = '.btn-remove-var, .btn-remove-derived, .btn-remove-constraint';
  document.querySelectorAll(selector).forEach(btn => {
    btn.replaceWith(btn.cloneNode(true)); // Remove old listeners
  });
  document.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.remove();
    });
  });
}

// --- App Settings ---

export function renderAppSettings(appSettings, defaults) {
  const kb = appSettings.keybindings;

  const keybindingRows = [
    { action: 'Pokaż odpowiedź', key: 'showAnswer', keys: kb.showAnswer },
    { action: 'Powtórz (Again)', key: 'again', keys: kb.again },
    { action: 'Trudne (Hard)', key: 'hard', keys: kb.hard },
    { action: 'Dobrze (Good)', key: 'good', keys: kb.good },
    { action: 'Łatwe (Easy)', key: 'easy', keys: kb.easy },
  ];

  const keybindingsHtml = keybindingRows.map(row => `
    <div class="keybinding-row" data-binding="${row.key}">
      <span class="keybinding-action">${row.action}</span>
      <span class="keybinding-keys">
        ${row.keys.map(k => `<span class="keybinding-key">${escapeHtml(formatKeyName(k))}</span>`).join('')}
      </span>
      <button class="keybinding-record" data-binding="${row.key}">Zmień</button>
    </div>
  `).join('');

  const themeOptions = [
    { value: 'light', label: 'Jasny' },
    { value: 'dark', label: 'Ciemny' },
    { value: 'auto', label: 'Auto' },
  ];

  const themeHtml = themeOptions.map(opt => `
    <button class="theme-option ${appSettings.theme === opt.value ? 'active' : ''}" data-theme="${opt.value}">
      ${opt.label}
    </button>
  `).join('');

  const colorThemes = [
    { value: 'academic-noir', label: 'Academic Noir', colors: ['#c45d3e', '#c9a227', '#4a6fa5', '#3a8a5c'] },
    { value: 'ocean', label: 'Ocean', colors: ['#2b7a9e', '#3aa5a0', '#4a8cc4', '#2d9a6f'] },
    { value: 'forest', label: 'Forest', colors: ['#5a8a4a', '#8ab060', '#7a9968', '#c4a43a'] },
    { value: 'midnight', label: 'Midnight', colors: ['#5b5fc7', '#7b6fb0', '#4a6fa5', '#8b5fc7'] },
    { value: 'lavender', label: 'Lavender', colors: ['#9b6fa0', '#c47a9a', '#8a7ab5', '#b07aaa'] },
  ];

  const colorThemeHtml = colorThemes.map(ct => `
    <button class="color-theme-option ${appSettings.colorTheme === ct.value ? 'active' : ''}" data-color-theme="${ct.value}">
      <div class="color-theme-preview">
        ${ct.colors.map(c => `<span class="color-dot" style="background:${c}"></span>`).join('')}
      </div>
      <div class="color-theme-label">${ct.label}</div>
    </button>
  `).join('');

  const layoutWidths = [
    { value: '35%', label: 'Wąski', desc: '35%' },
    { value: '40%', label: 'Kompaktowy', desc: '40%' },
    { value: '50%', label: 'Normalny', desc: '50%' },
    { value: '65%', label: 'Szeroki', desc: '65%' },
  ];

  const currentWidthNum = parseInt(appSettings.layoutWidth);
  const isPreset = layoutWidths.some(lw => lw.value === appSettings.layoutWidth);

  const layoutHtml = layoutWidths.map(lw => `
    <button class="layout-width-option ${appSettings.layoutWidth === lw.value ? 'active' : ''}" data-width="${lw.value}">
      <div class="layout-width-label">${lw.label}</div>
      <div class="layout-width-desc">${lw.desc}</div>
    </button>
  `).join('');

  document.getElementById('app-settings-content').innerHTML = `
    <div class="app-settings-form">
      <div class="settings-section">
        <div class="settings-section-title">Skróty klawiszowe</div>
        <div class="keybinding-table">
          ${keybindingsHtml}
        </div>
        <div class="keybinding-defaults">
          <button class="btn btn-secondary btn-sm" id="btn-restore-keybindings">Przywróć domyślne skróty</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Motyw kolorystyczny</div>
        <div class="color-theme-options" id="color-theme-options">
          ${colorThemeHtml}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Tryb wyświetlania</div>
        <div class="theme-options" id="theme-options">
          ${themeHtml}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Szerokość układu</div>
        <div class="layout-width-options" id="layout-width-options">
          ${layoutHtml}
        </div>
        <div class="custom-width-row">
          <label for="custom-width-input">Własna szerokość:</label>
          <div class="custom-width-input-wrap">
            <input type="number" id="custom-width-input" min="20" max="100" step="5"
              value="${!isNaN(currentWidthNum) ? currentWidthNum : ''}"
              placeholder="np. 70">
            <span class="custom-width-unit">%</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Nauka</div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label-text">Mieszaj kolejność odpowiedzi</div>
            <div class="toggle-hint">Losowa kolejność odpowiedzi w sesjach nauki i testach</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-shuffle" ${appSettings.shuffleAnswers ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-row" style="margin-top: 12px;">
          <div>
            <div class="toggle-label-text">Kolejność pytań</div>
            <div class="toggle-hint">Po kolei (wg tematu) zamiast losowej</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-question-order" ${appSettings.questionOrder === 'ordered' ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-row" style="margin-top: 12px;">
          <div>
            <div class="toggle-label-text">Losowe wartości w pytaniach obliczeniowych</div>
            <div class="toggle-hint">Za każdym razem inne liczby w pytaniach z obliczeniami</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-randomize" ${appSettings.randomizeNumbers ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-row" style="margin-top: 12px;">
          <div>
            <div class="toggle-label-text">Oznaczone pytania w trybie Anki</div>
            <div class="toggle-hint">Oflagowane pytania będą pojawiać się w normalnych sesjach Anki</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-flagged-anki" ${appSettings.flaggedInAnki ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Informacje</div>
        <p style="font-size: 0.85rem; line-height: 1.6; color: var(--color-text-secondary); margin-bottom: 12px;">
          Baza Deluxe — aplikacja do nauki z powtarzaniem rozłożonym w czasie.
        </p>
        <a href="docs.html" class="btn btn-secondary btn-sm">Dokumentacja</a>
      </div>
    </div>
  `;
}

// --- Utilities ---

export function formatKeyName(key) {
  const names = {
    ' ': 'Spacja',
    'Enter': 'Enter',
    'Escape': 'Esc',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Backspace': '⌫',
    'Tab': 'Tab',
  };
  return names[key] || key;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
