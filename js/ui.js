// ui.js — DOM rendering and event handling

import {
  shuffle,
  renderLatex,
  isFlashcard,
  normalizeSelectionMode,
  getEffectiveQuestionSelectionMode,
} from './utils.js';

// --- Deck List View ---

function renderDeckScopeTabs(activeScope = 'public') {
  const normalized = activeScope === 'private' || activeScope === 'shared' ? activeScope : 'public';
  return `
    <div class="deck-scope-tabs">
      <button class="deck-scope-tab ${normalized === 'public' ? 'active' : ''}" data-scope="public">Ogólne</button>
      <button class="deck-scope-tab ${normalized === 'shared' ? 'active' : ''}" data-scope="shared">Udostępnione</button>
      <button class="deck-scope-tab ${normalized === 'private' ? 'active' : ''}" data-scope="private">Moje</button>
    </div>
  `;
}

function toVoteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeVoteEntry(entry = null) {
  return {
    plusCount: Math.max(0, toVoteNumber(entry?.plusCount ?? entry?.plus_count, 0)),
    minusCount: Math.max(0, toVoteNumber(entry?.minusCount ?? entry?.minus_count, 0)),
    userVote: toVoteNumber(entry?.userVote ?? entry?.user_vote, 0),
  };
}

function getVoteEntry(voteSummaryByAnswer, answerId) {
  if (!voteSummaryByAnswer) return normalizeVoteEntry(null);
  if (voteSummaryByAnswer instanceof Map) {
    return normalizeVoteEntry(voteSummaryByAnswer.get(answerId));
  }
  if (typeof voteSummaryByAnswer === 'object') {
    return normalizeVoteEntry(voteSummaryByAnswer[answerId]);
  }
  return normalizeVoteEntry(null);
}

function buildVoteTooltipText(voteAction, canVote) {
  const base = voteAction === -1
    ? '-1 = ta odpowiedź powinna być błędna. Kliknij ponownie, aby cofnąć głos.'
    : '+1 = ta odpowiedź powinna być poprawna. Kliknij ponownie, aby cofnąć głos.';
  return canVote ? base : `${base} Zaloguj się, aby głosować.`;
}

function tooltipAttrs(text, options = {}) {
  const safeText = escapeAttr(text || '');
  const safePlacement = options.placement ? ` data-tooltip-placement="${escapeAttr(options.placement)}"` : '';
  const safeDelay = Number.isFinite(options.delay) ? ` data-tooltip-delay="${Math.max(0, options.delay)}"` : '';
  return `data-tooltip="${safeText}"${safePlacement}${safeDelay}`;
}

function renderAnswerVoteControls(questionId, answerId, voteSummaryByAnswer, voteConfig = {}) {
  const enabled = voteConfig?.enabled === true;
  if (!enabled) return '';

  const canVote = voteConfig?.canVote === true;
  const showMinus = voteConfig?.showMinus === true;
  const voteEntry = getVoteEntry(voteSummaryByAnswer, answerId);
  const disabledAttr = canVote ? '' : ' aria-disabled="true"';
  const plusTooltip = buildVoteTooltipText(1, canVote);
  const plusAria = `${plusTooltip} Aktualna liczba głosów: ${voteEntry.plusCount}.`;

  const plusClass = voteEntry.userVote === 1 ? ' active' : '';
  const minusClass = voteEntry.userVote === -1 ? ' active' : '';
  const wrapperClass = canVote ? 'answer-votes' : 'answer-votes disabled';
  const minusHtml = showMinus
    ? `
      <button
        class="vote-pill minus${minusClass}"
        type="button"
        data-vote-action="-1"
        data-question-id="${escapeAttr(questionId)}"
        data-answer-id="${escapeAttr(answerId)}"
        ${tooltipAttrs(buildVoteTooltipText(-1, canVote))}
        aria-label="${escapeAttr(`${buildVoteTooltipText(-1, canVote)} Aktualna liczba głosów: ${voteEntry.minusCount}.`)}"${disabledAttr}
      >-${voteEntry.minusCount}</button>
    `
    : '';

  return `
    <div class="${wrapperClass}" data-question-id="${escapeAttr(questionId)}" data-answer-id="${escapeAttr(answerId)}">
      <button
        class="vote-pill plus${plusClass}"
        type="button"
        data-vote-action="1"
        data-question-id="${escapeAttr(questionId)}"
        data-answer-id="${escapeAttr(answerId)}"
        ${tooltipAttrs(plusTooltip)}
        aria-label="${escapeAttr(plusAria)}"${disabledAttr}
      >+${voteEntry.plusCount}</button>
      ${minusHtml}
    </div>
  `;
}

export function renderDeckList(decks, statsMap, options = {}) {
  const container = document.getElementById('deck-list-container');
  const activeScope = options.activeScope === 'private' || options.activeScope === 'shared'
    ? options.activeScope
    : 'public';
  const sessionMode = options.sessionMode === 'user' ? 'user' : 'guest';
  const showPrivateLocked = !!options.showPrivateLocked;
  const deckListMode = options.deckListMode === 'classic' ? 'classic' : 'compact';
  const canTogglePublicDeckVisibility = options.canTogglePublicDeckVisibility === true;
  const showPrivateArchived = options.showPrivateArchived === true;
  const hasArchivedPrivate = options.hasArchivedPrivate === true;
  const isLoading = options.isLoading === true;
  const loadingText = String(options.loadingText || 'Ładowanie...');
  const blockContentWhileLoading = options.blockContentWhileLoading === true;
  const tabsHtml = renderDeckScopeTabs(activeScope);
  const loadingBannerHtml = isLoading
    ? `
      <div class="deck-list-loading" role="status" aria-live="polite">
        <span class="deck-list-loading-spinner" aria-hidden="true"></span>
        <span class="deck-list-loading-text">${escapeHtml(loadingText)}</span>
      </div>
      <div class="deck-list-progress" aria-hidden="true">
        <span class="deck-list-progress-bar"></span>
      </div>
    `
    : '';
  const privateArchiveToggleHtml = activeScope === 'private' && sessionMode === 'user' && (hasArchivedPrivate || showPrivateArchived)
    ? `<button class="btn btn-secondary" id="btn-toggle-private-archived">${showPrivateArchived ? 'Pokaż aktywne' : 'Pokaż archiwalne'}</button>`
    : '';
  const privateActionsHtml = activeScope === 'private' && sessionMode === 'user'
    ? `
      <div class="private-deck-actions">
        ${showPrivateArchived ? '' : '<button class="btn btn-primary" id="btn-create-deck">Nowa talia</button>'}
        ${showPrivateArchived ? '' : '<button class="btn btn-secondary" id="btn-import-private">Importuj talię</button>'}
        ${privateArchiveToggleHtml}
      </div>
    `
    : '';

  if (isLoading && blockContentWhileLoading) {
    container.innerHTML = `
      ${tabsHtml}
      ${privateActionsHtml}
      ${loadingBannerHtml}
    `;
    return;
  }

  if (showPrivateLocked) {
    container.innerHTML = `
      ${tabsHtml}
      ${loadingBannerHtml}
      <div class="private-locked-panel">
        <div class="private-locked-title">Moje talie są dostępne po zalogowaniu</div>
        <div class="private-locked-text">
          Zaloguj się, aby importować i przeglądać własne talie.
        </div>
        <button class="btn btn-primary" id="btn-login-private-view">Zaloguj się</button>
      </div>
    `;
    return;
  }

  if (activeScope === 'public' && decks.length === 0) {
    const emptyTitle = activeScope === 'public'
      ? 'Brak talii ogólnych'
      : (showPrivateArchived ? 'Brak zarchiwizowanych talii' : 'Brak własnych talii');
    const emptyText = activeScope === 'public'
      ? 'Talie ogólne nie są jeszcze dostępne.'
      : (showPrivateArchived
        ? 'Archiwum prywatne jest puste.'
        : 'Utwórz własną talię ręcznie lub zaimportuj plik JSON z pytaniami.');

    container.innerHTML = `
      ${tabsHtml}
      ${privateActionsHtml}
      ${loadingBannerHtml}
      <div class="empty-state">
        <div class="empty-state-icon">&#128218;</div>
        <div class="empty-state-title">${emptyTitle}</div>
        <div class="empty-state-text">
          ${emptyText}
        </div>
      </div>
    `;
    return;
  }

  const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });
  const normalizeGroup = (value) => (
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  );
  const getDeckGroupLabel = (deckMeta) => normalizeGroup(deckMeta.group) || 'Bez grupy';

  const renderDeckCard = (deck) => {
    const stats = statsMap[deck.id] || { dueReview: 0, dueLearning: 0, newAvailable: 0, totalCards: 0 };
    const scope = deck.scope === 'public' || deck.scope === 'subscribed' ? deck.scope : 'private';
    const isPublicDeck = scope === 'public';
    const isSubscribedDeck = scope === 'subscribed';
    const isOwnPrivateDeck = scope === 'private';
    const isHiddenPublicDeck = isPublicDeck && deck.adminOnly === true;
    const isArchivedPrivateDeck = isOwnPrivateDeck && deck.isArchived === true;
    const isUnavailableSubscription = isSubscribedDeck && deck.subscriptionStatus === 'unavailable';
    const readOnlyContent = isPublicDeck
      ? true
      : (isSubscribedDeck || deck.readOnlyContent === true);

    const isSharedOwnDeck = isOwnPrivateDeck && deck.isShared === true && !isArchivedPrivateDeck;
    const statusBadges = [];
    if (isSharedOwnDeck) {
      statusBadges.push('<span class="deck-status-chip shared">Udostępniana</span>');
    }
    if (isUnavailableSubscription) {
      statusBadges.push('<span class="deck-status-chip warning">Niedostępna</span>');
    }
    if (isHiddenPublicDeck) {
      statusBadges.push('<span class="deck-status-chip muted">Ukryta</span>');
    }
    const statusBadgesHtml = statusBadges.join('');

    const readOnlyHint = readOnlyContent
      ? '<div class="deck-card-readonly-hint">Treść talii tylko do odczytu.</div>'
      : '';
    const hiddenHint = isHiddenPublicDeck
      ? '<div class="deck-card-readonly-hint">Ta talia jest ukryta dla zwykłych użytkowników.</div>'
      : '';
    const unavailableHint = isUnavailableSubscription
      ? '<div class="deck-card-readonly-hint">Autor wyłączył udostępnianie. Możesz dalej uczyć się na ostatniej zsynchronizowanej wersji.</div>'
      : '';
    const canOpenDeck = !isArchivedPrivateDeck;
    const canShowVisibilityToggle = isPublicDeck && canTogglePublicDeckVisibility;
    const canShowArchiveToggle = isOwnPrivateDeck;
    const canShowShareToggle = isOwnPrivateDeck && !isArchivedPrivateDeck;
    const ownerLine = isSubscribedDeck && deck.ownerUsername
      ? `<div class="deck-card-owner">Autor: @${escapeHtml(deck.ownerUsername)}</div>`
      : '';
    const sharedDeckIdAttr = deck.sharedDeckId ? ` data-shared-deck-id="${escapeAttr(deck.sharedDeckId)}"` : '';
    const menuItems = [];

    menuItems.push(`
      <button class="deck-card-menu-item btn-copy-deck" data-deck-id="${escapeAttr(deck.id)}" type="button">
        Kopiuj
      </button>
    `);
    menuItems.push(`
      <button class="deck-card-menu-item btn-export-deck" data-deck-id="${escapeAttr(deck.id)}" type="button">
        Eksportuj JSON
      </button>
    `);

    if (canOpenDeck) {
      menuItems.push(`
        <button class="deck-card-menu-item btn-deck-settings" data-deck-id="${escapeAttr(deck.id)}" type="button">
          Ustawienia
        </button>
      `);
    }
    if (canShowVisibilityToggle) {
      menuItems.push(`
        <button class="deck-card-menu-item btn-delete-deck" data-deck-id="${escapeAttr(deck.id)}" data-deck-name="${escapeAttr(deck.name || deck.id)}" data-public-hidden="${isHiddenPublicDeck ? '1' : '0'}" data-private-archived="${isArchivedPrivateDeck ? '1' : '0'}" type="button">
          ${isHiddenPublicDeck ? 'Pokaż' : 'Ukryj'}
        </button>
      `);
    }
    if (canShowArchiveToggle) {
      menuItems.push(`
        <button class="deck-card-menu-item btn-delete-deck" data-deck-id="${escapeAttr(deck.id)}" data-deck-name="${escapeAttr(deck.name || deck.id)}" data-public-hidden="0" data-private-archived="${isArchivedPrivateDeck ? '1' : '0'}" type="button">
          ${isArchivedPrivateDeck ? 'Przywróć' : 'Archiwizuj'}
        </button>
      `);
    }
    if (isOwnPrivateDeck) {
      menuItems.push(`
        <button class="deck-card-menu-item danger btn-remove-private-deck" data-deck-id="${escapeAttr(deck.id)}" data-deck-name="${escapeAttr(deck.name || deck.id)}" data-is-shared="${deck.isShared === true ? '1' : '0'}" data-shared-deck-id="${escapeAttr(deck.sharedDeckId || '')}" type="button">
          Usuń
        </button>
      `);
    }
    if (canShowShareToggle) {
      menuItems.push(`
        <button class="deck-card-menu-item btn-share-deck" data-deck-id="${escapeAttr(deck.id)}"${sharedDeckIdAttr} data-is-shared="${deck.isShared === true ? '1' : '0'}" type="button">
          ${deck.isShared === true ? 'Wyłącz udostępnianie' : 'Udostępnij'}
        </button>
      `);
    }
    if (isSubscribedDeck) {
      menuItems.push(`
        <button class="deck-card-menu-item btn-unsubscribe-deck" data-deck-id="${escapeAttr(deck.id)}"${sharedDeckIdAttr} type="button">
          Odsubskrybuj
        </button>
      `);
    }

    const menuHtml = menuItems.length > 0 ? `
      <div class="deck-card-menu">
        <button class="deck-card-menu-trigger" type="button" ${tooltipAttrs('Opcje talii')} aria-label="Opcje talii">&#8942;</button>
        <div class="deck-card-menu-dropdown">
          ${menuItems.join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="deck-card${isHiddenPublicDeck ? ' is-public-hidden' : ''}${canOpenDeck ? ' is-openable' : ''}${isSharedOwnDeck ? ' is-shared-own' : ''}" data-deck-id="${escapeAttr(deck.id)}" data-openable="${canOpenDeck ? '1' : '0'}" data-read-only="${readOnlyContent ? '1' : '0'}" data-public-hidden="${isHiddenPublicDeck ? '1' : '0'}" data-private-archived="${isArchivedPrivateDeck ? '1' : '0'}">
        <div class="deck-card-header">
          <div class="deck-card-title">${escapeHtml(deck.name)}</div>
          <div class="deck-card-header-right">
            ${statusBadgesHtml}
            ${menuHtml}
          </div>
        </div>
        <div class="deck-card-description${deck.description ? '' : ' is-empty'}">
          ${deck.description ? escapeHtml(deck.description) : '&nbsp;'}
        </div>
        ${ownerLine}
        ${readOnlyHint}
        ${hiddenHint}
        ${unavailableHint}
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
      </div>
    `;
  };

  const sortedDecks = [...decks].sort((a, b) => collator.compare(a.name || '', b.name || ''));
  const groupedDecks = new Map();

  for (const deckMeta of sortedDecks) {
    const groupLabel = getDeckGroupLabel(deckMeta);
    const groupKey = groupLabel.toLocaleLowerCase('pl');
    if (!groupedDecks.has(groupKey)) {
      groupedDecks.set(groupKey, { label: groupLabel, decks: [] });
    }
    groupedDecks.get(groupKey).decks.push(deckMeta);
  }

  const groupEntries = Array.from(groupedDecks.values()).sort((a, b) => {
    const groupA = a.label;
    const groupB = b.label;
    const aIsUngrouped = groupA === 'Bez grupy';
    const bIsUngrouped = groupB === 'Bez grupy';
    if (aIsUngrouped && !bIsUngrouped) return 1;
    if (!aIsUngrouped && bIsUngrouped) return -1;
    return collator.compare(groupA, groupB);
  });
  const showGroupHeaders = !(groupEntries.length === 1 && groupEntries[0].label === 'Bez grupy');

  const groupsHtml = groupEntries.map(({ label, decks: groupDecks }) => {
    const cardsHtml = groupDecks.map((deckMeta) => renderDeckCard(deckMeta)).join('');
    if (!showGroupHeaders) {
      return `
        <section class="deck-group-section">
          <div class="deck-list-grid ${deckListMode === 'compact' ? 'compact' : 'classic'}">
            ${cardsHtml}
          </div>
        </section>
      `;
    }

    return `
      <section class="deck-group-section">
        <div class="deck-group-header">
          <h3 class="deck-group-title">${escapeHtml(label)}</h3>
          <span class="deck-group-count">${groupDecks.length}</span>
        </div>
        <div class="deck-list-grid ${deckListMode === 'compact' ? 'compact' : 'classic'}">
          ${cardsHtml}
        </div>
      </section>
    `;
  }).join('');

  if (activeScope === 'private') {
    const ownDecks = decks.filter((deckMeta) => deckMeta.scope !== 'subscribed');
    const subscribedDecks = decks.filter((deckMeta) => deckMeta.scope === 'subscribed');

    const ownGroupsHtml = (() => {
      if (ownDecks.length === 0) {
        return `
          <div class="empty-state compact">
            <div class="empty-state-text">
              ${showPrivateArchived
                ? 'Brak zarchiwizowanych własnych talii.'
                : 'Brak własnych talii. Utwórz nową albo zaimportuj JSON.'}
            </div>
          </div>
        `;
      }
      const ownSorted = [...ownDecks].sort((a, b) => collator.compare(a.name || '', b.name || ''));
      const ownGroupedMap = new Map();
      for (const deckMeta of ownSorted) {
        const groupLabel = getDeckGroupLabel(deckMeta);
        const groupKey = groupLabel.toLocaleLowerCase('pl');
        if (!ownGroupedMap.has(groupKey)) {
          ownGroupedMap.set(groupKey, { label: groupLabel, decks: [] });
        }
        ownGroupedMap.get(groupKey).decks.push(deckMeta);
      }
      const ownEntries = Array.from(ownGroupedMap.values()).sort((a, b) => {
        const groupA = a.label;
        const groupB = b.label;
        const aIsUngrouped = groupA === 'Bez grupy';
        const bIsUngrouped = groupB === 'Bez grupy';
        if (aIsUngrouped && !bIsUngrouped) return 1;
        if (!aIsUngrouped && bIsUngrouped) return -1;
        return collator.compare(groupA, groupB);
      });
      const ownShowHeaders = !(ownEntries.length === 1 && ownEntries[0].label === 'Bez grupy');
      return ownEntries.map(({ label, decks: ownGroupDecks }) => {
        const cardsHtml = ownGroupDecks.map((deckMeta) => renderDeckCard(deckMeta)).join('');
        if (!ownShowHeaders) {
          return `
            <section class="deck-group-section">
              <div class="deck-list-grid ${deckListMode === 'compact' ? 'compact' : 'classic'}">
                ${cardsHtml}
              </div>
            </section>
          `;
        }
        return `
          <section class="deck-group-section">
            <div class="deck-group-header">
              <h3 class="deck-group-title">${escapeHtml(label)}</h3>
              <span class="deck-group-count">${ownGroupDecks.length}</span>
            </div>
            <div class="deck-list-grid ${deckListMode === 'compact' ? 'compact' : 'classic'}">
              ${cardsHtml}
            </div>
          </section>
        `;
      }).join('');
    })();

    const subscribedHtml = subscribedDecks.length > 0
      ? `
        <section class="deck-group-section">
          <div class="deck-list-grid ${deckListMode === 'compact' ? 'compact' : 'classic'}">
            ${subscribedDecks
              .slice()
              .sort((a, b) => collator.compare(a.name || '', b.name || ''))
              .map((deckMeta) => renderDeckCard(deckMeta))
              .join('')}
          </div>
        </section>
      `
      : `
        <div class="empty-state compact">
          <div class="empty-state-text">
            Nie masz jeszcze subskrybowanych talii. Przejdź do zakładki "Udostępnione".
          </div>
        </div>
      `;

    container.innerHTML = `
      ${tabsHtml}
      ${privateActionsHtml}
      ${loadingBannerHtml}
      <div class="deck-groups deck-private-sections">
        <section class="deck-subsection">
          <div class="deck-subsection-header">
            <h3 class="deck-subsection-title">Własne</h3>
          </div>
          ${ownGroupsHtml}
        </section>
        <section class="deck-subsection">
          <div class="deck-subsection-header">
            <h3 class="deck-subsection-title">Subskrybowane</h3>
          </div>
          ${subscribedHtml}
        </section>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${tabsHtml}
    ${privateActionsHtml}
    ${loadingBannerHtml}
    <div class="deck-groups">
      ${groupsHtml}
    </div>
  `;
}

export function renderSharedDeckCatalog(data = {}, options = {}) {
  const container = document.getElementById('deck-list-container');
  const sessionMode = options.sessionMode === 'user' ? 'user' : 'guest';
  const currentUserId = String(options.currentUserId || '');
  const subscribedSet = new Set(Array.isArray(options.subscribedDeckIds) ? options.subscribedDeckIds : []);
  const tabsHtml = renderDeckScopeTabs('shared');
  const query = String(data.query || '');
  const items = Array.isArray(data.items) ? data.items : [];
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.max(1, Number(data.pageSize) || 20);
  const total = Math.max(0, Number(data.total) || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasItems = items.length > 0;

  const cardsHtml = hasItems
    ? items.map((item) => {
      const isSubscribed = subscribedSet.has(item.id);
      const isOwnDeck = currentUserId.length > 0 && String(item.owner_user_id || '') === currentUserId;
      const canSubscribe = sessionMode === 'user' && !isSubscribed && !isOwnDeck;
      const canUnsubscribe = sessionMode === 'user' && isSubscribed;
      return `
        <article class="deck-card shared-deck-card" data-shared-deck-id="${escapeAttr(item.id)}">
          <div class="deck-card-header">
            <div class="deck-card-title">${escapeHtml(item.name || item.id)}</div>
            <span class="deck-scope-badge shared">Udostępniona</span>
          </div>
          <div class="deck-card-description${item.description ? '' : ' is-empty'}">
            ${item.description ? escapeHtml(item.description) : '&nbsp;'}
          </div>
          <div class="deck-card-owner">Autor: @${escapeHtml(item.owner_username || 'unknown')}</div>
          <div class="deck-card-stats">
            <div class="deck-stat review">
              <span class="stat-value">${Number(item.question_count) || 0}</span>
              <span>pytań</span>
            </div>
          </div>
          <div class="deck-card-actions">
            <button class="btn btn-secondary btn-sm btn-shared-copy" data-shared-deck-id="${escapeAttr(item.id)}">Kopiuj</button>
            ${canSubscribe ? `<button class="btn btn-primary btn-sm btn-shared-subscribe" data-shared-deck-id="${escapeAttr(item.id)}">Subskrybuj</button>` : ''}
            ${canUnsubscribe ? `<button class="btn btn-secondary btn-sm btn-shared-unsubscribe" data-shared-deck-id="${escapeAttr(item.id)}">Odsubskrybuj</button>` : ''}
            ${isOwnDeck ? '<button class="btn btn-secondary btn-sm" type="button" disabled>Twoja talia</button>' : ''}
          </div>
        </article>
      `;
    }).join('')
    : `
      <div class="shared-empty-state-wrap">
        <div class="empty-state shared-empty-state">
          <div class="empty-state-icon">&#128218;</div>
          <div class="empty-state-title">Brak wyników</div>
          <div class="empty-state-text">
            ${query ? 'Nie znaleziono talii dla podanego zapytania.' : 'Brak publicznie udostępnionych talii.'}
          </div>
        </div>
      </div>
    `;

  const guestHint = sessionMode !== 'user'
    ? `
      <div class="deck-card-readonly-hint shared-guest-hint">
        Subskrypcja wymaga zalogowania. Możesz jednak kopiować talie do swoich po zalogowaniu.
      </div>
    `
    : '';

  container.innerHTML = `
    ${tabsHtml}
    <section class="shared-catalog-toolbar">
      <input
        class="settings-input shared-catalog-search"
        id="shared-search-input"
        type="text"
        value="${escapeAttr(query)}"
        placeholder="Szukaj po nazwie lub opisie..."
      >
      <div class="shared-catalog-pager">
        <button class="btn btn-secondary btn-sm btn-shared-page" data-dir="-1" ${page <= 1 ? 'disabled' : ''}>Poprzednia</button>
        <span class="shared-page-info">${total} wyników • strona ${page}/${totalPages}</span>
        <button class="btn btn-secondary btn-sm btn-shared-page" data-dir="1" ${page >= totalPages ? 'disabled' : ''}>Następna</button>
      </div>
    </section>
    ${guestHint}
    <div class="deck-groups">
      <section class="deck-group-section">
        <div class="deck-list-grid ${options.deckListMode === 'classic' ? 'classic' : 'compact'}">
          ${cardsHtml}
        </div>
      </section>
    </div>
  `;
}

// --- Question Rendering ---

export function renderQuestion(
  question,
  cardNumber,
  totalForSession,
  selectionMode = 'multiple',
  shouldShuffle = true,
  showReroll = false,
  flagged = false,
  canEdit = true
) {
  const isMultiSelect = selectionMode === 'multiple';
  const flashcard = isFlashcard(question);
  const shuffledAnswers = flashcard ? [] : (shouldShuffle ? shuffle(question.answers) : [...question.answers]);
  const hint = flashcard
    ? '(Fiszka — kliknij aby zobaczyć odpowiedź)'
    : (isMultiSelect ? '(Zaznacz wszystkie poprawne)' : '(Wybierz jedną odpowiedź)');
  const indicatorType = isMultiSelect ? 'checkbox' : '';

  const rerollBtn = showReroll
    ? `<button class="btn-reroll" id="btn-reroll-question" ${tooltipAttrs('Wylosuj nowy wariant pytania')} aria-label="Wylosuj nowy wariant pytania">&#x1F3B2;</button>`
    : '';

  const flagTooltip = flagged
    ? 'Usuń oznaczenie pytania (skrót: F)'
    : 'Oznacz pytanie flagą (skrót: F)';
  const flagAria = flagged ? 'Usuń oznaczenie pytania' : 'Oznacz pytanie flagą';
  const flagBtn = `<button class="btn-flag-question${flagged ? ' flagged' : ''}" id="btn-flag-question" ${tooltipAttrs(flagTooltip)} aria-label="${flagAria}">${flagged ? '&#x1F6A9;' : '&#x2691;'}</button>`;
  const editBtn = canEdit
    ? `<button class="btn-edit-question" id="btn-edit-question" ${tooltipAttrs('Edytuj treść pytania')} aria-label="Edytuj treść pytania">&#9998;</button>`
    : '';

  const answersHtml = flashcard ? '' : `
      <div class="answers-list" id="answers-list">
        ${shuffledAnswers.map((a, i) => `
          <div class="answer-option" data-answer-id="${escapeAttr(a.id)}" data-index="${i}">
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
          ${editBtn}
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

export function renderAnswerFeedback(
  question,
  shuffledAnswers,
  selectedIds,
  selectionMode = 'multiple',
  explanation,
  intervals,
  keybindings = null,
  flagged = false,
  canEdit = true,
  voteSummaryByAnswer = null,
  voteConfig = null
) {
  const isMultiSelect = selectionMode === 'multiple';
  const flashcard = isFlashcard(question);

  let answersHtml = '';
  if (!flashcard) {
    const correctIds = new Set(question.answers.filter(a => a.correct).map(a => a.id));
    const noSelection = selectedIds.size === 0;

    answersHtml = shuffledAnswers.map(a => {
      const isCorrect = correctIds.has(a.id);
      const isSelected = selectedIds.has(a.id);

      let stateClass = 'disabled';

      if (noSelection) {
        if (isCorrect) {
          stateClass += ' correct-selected';
        }
      } else if (isSelected && isCorrect) {
        stateClass += ' correct-selected';
      } else if (isSelected && !isCorrect) {
        stateClass += ' incorrect-selected';
      } else if (!isSelected && isCorrect) {
        stateClass += ' correct-missed';
      }

      const votesHtml = renderAnswerVoteControls(
        question.id,
        a.id,
        voteSummaryByAnswer,
        voteConfig
      );

      return `
        <div class="answer-option ${stateClass}" data-answer-id="${escapeAttr(a.id)}">
          <div class="answer-indicator ${isMultiSelect ? 'checkbox' : ''}"></div>
          <div class="answer-text">${renderLatex(escapeHtml(a.text))}</div>
          ${votesHtml}
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

  const feedbackFlagTooltip = flagged
    ? 'Usuń oznaczenie pytania (skrót: F)'
    : 'Oznacz pytanie flagą (skrót: F)';
  const feedbackFlagAria = flagged ? 'Usuń oznaczenie pytania' : 'Oznacz pytanie flagą';
  const feedbackFlagBtn = `<button class="btn-flag-question${flagged ? ' flagged' : ''}" id="btn-flag-question" ${tooltipAttrs(feedbackFlagTooltip)} aria-label="${feedbackFlagAria}">${flagged ? '&#x1F6A9;' : '&#x2691;'}</button>`;
  const feedbackEditBtn = canEdit
    ? `<button class="btn-edit-question" id="btn-edit-question" ${tooltipAttrs('Edytuj treść pytania')} aria-label="Edytuj treść pytania">&#9998;</button>`
    : '';

  document.getElementById('study-content').innerHTML = `
    <div class="question-card${flashcard ? ' flashcard' : ''}">
      <div class="question-card-topbar">
        <div></div>
        <div class="question-card-topbar-actions">
          ${feedbackFlagBtn}
          ${feedbackEditBtn}
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
  const views = document.querySelectorAll('.view');
  views.forEach(v => v.classList.remove('active'));

  const target = document.getElementById(`view-${viewId}`);
  if (!target) {
    console.error(`Missing view element: view-${viewId}`);
    // Fallback to first available view to avoid hard crash
    if (views.length > 0) {
      views[0].classList.add('active');
    }
    return;
  }

  target.classList.add('active');

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

export function showConfirm(title, text, options = {}) {
  return showConfirmWithOptions(title, text, options);
}

export function showConfirmWithOptions(title, text, options = {}) {
  const confirmLabel = options.confirmLabel || 'Usuń';
  const cancelLabel = options.cancelLabel || 'Anuluj';
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-text">${escapeHtml(text)}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary modal-cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn btn-danger modal-confirm">${escapeHtml(confirmLabel)}</button>
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

// --- Prompt Modal ---

export function showPrompt(options = {}) {
  const {
    title = 'Podaj wartość',
    text = '',
    label = 'Wartość',
    placeholder = '',
    initialValue = '',
    confirmLabel = 'Zapisz',
    cancelLabel = 'Anuluj',
    validator = null,
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${escapeHtml(title)}</div>
        ${text ? `<div class="modal-text">${escapeHtml(text)}</div>` : ''}
        <form class="modal-form" id="modal-prompt-form">
          <div class="modal-form-group">
            <label class="modal-form-label" for="modal-prompt-input">${escapeHtml(label)}</label>
            <input class="modal-form-input" id="modal-prompt-input" type="text" value="${escapeAttr(initialValue)}" placeholder="${escapeAttr(placeholder)}" required>
          </div>
          <div class="modal-form-error" id="modal-prompt-error"></div>
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" id="modal-prompt-cancel">${escapeHtml(cancelLabel)}</button>
            <button class="btn btn-primary" type="submit">${escapeHtml(confirmLabel)}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#modal-prompt-form');
    const input = overlay.querySelector('#modal-prompt-input');
    const errorEl = overlay.querySelector('#modal-prompt-error');
    const cancelBtn = overlay.querySelector('#modal-prompt-cancel');

    let resolved = false;
    const onEsc = (e) => {
      if (e.key !== 'Escape' || resolved) return;
      finalize(null);
    };
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onEsc);
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => finalize(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finalize(null);
    });
    document.addEventListener('keydown', onEsc);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = String(input.value || '').trim();
      if (!value) {
        errorEl.textContent = 'To pole jest wymagane.';
        return;
      }

      if (typeof validator === 'function') {
        const validation = validator(value);
        if (validation !== true) {
          errorEl.textContent = typeof validation === 'string' ? validation : 'Nieprawidłowa wartość.';
          return;
        }
      }

      finalize(value);
    });

    requestAnimationFrame(() => {
      input.focus();
      input.select();
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
      <div class="category-card" data-category="${escapeAttr(cat.id)}">
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

export function renderModeSelect(deckName, deckStats, options = {}) {
  document.getElementById('mode-select-deck-name').textContent = deckName;

  const canStartAnki = (Number(deckStats.totalCards) || 0) > 0;
  const flaggedCount = deckStats.flagged || 0;
  const canEdit = options.canEdit === true;
  const browseDesc = canEdit
    ? 'Lista wszystkich pytań z odpowiedziami + możliwość dodawania nowych pytań'
    : 'Lista wszystkich pytań z odpowiedziami';

  const flaggedCard = flaggedCount > 0 ? `
      <div class="mode-card" data-mode="flagged">
        <div class="mode-card-icon">&#x1F6A9;</div>
        <div class="mode-card-name">Oznaczone</div>
        <div class="mode-card-desc">Przeglądaj oflagowane pytania (${flaggedCount})</div>
      </div>` : '';

  document.getElementById('mode-select-content').innerHTML = `
    <div class="mode-select-grid">
      <div class="mode-card ${!canStartAnki ? 'disabled' : ''}" data-mode="anki">
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
        <div class="mode-card-desc">${browseDesc}</div>
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

export function renderTestQuestion(question, num, total, selectionMode = 'multiple', shouldShuffle = true, preShuffledAnswers = null, previousSelection = null) {
  const isMulti = selectionMode === 'multiple';
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
          <div class="answer-option ${previousSelection && previousSelection.has(a.id) ? 'selected' : ''}" data-answer-id="${escapeAttr(a.id)}" data-index="${i}">
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
  const voteSummaryByQuestion = results.voteSummaryByQuestion && typeof results.voteSummaryByQuestion === 'object'
    ? results.voteSummaryByQuestion
    : null;
  const voteConfigBase = results.voteConfig && typeof results.voteConfig === 'object'
    ? results.voteConfig
    : { enabled: false, canVote: false };
  const deckDefaultSelectionMode = normalizeSelectionMode(results.deckDefaultSelectionMode, 'multiple');
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

    const questionSelectionMode = getEffectiveQuestionSelectionMode(a.question, deckDefaultSelectionMode);
    const showMinus = questionSelectionMode === 'multiple';
    const questionVotes = voteSummaryByQuestion && typeof voteSummaryByQuestion === 'object'
      ? voteSummaryByQuestion[a.question.id] || null
      : null;

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

      const votesHtml = renderAnswerVoteControls(
        a.question.id,
        ans.id,
        questionVotes,
        {
          enabled: voteConfigBase.enabled === true,
          canVote: voteConfigBase.canVote === true,
          showMinus,
        }
      );

      return `<div class="test-review-answer ${cssClass}">${icon}<span>${renderLatex(escapeHtml(ans.text))}</span>${votesHtml}</div>`;
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

export function renderBrowse(deckName, questions, options = {}) {
  const canEdit = options.canEdit !== false;
  const voteSummaryByQuestion = options.voteSummaryByQuestion && typeof options.voteSummaryByQuestion === 'object'
    ? options.voteSummaryByQuestion
    : null;
  const voteConfigBase = options.voteConfig && typeof options.voteConfig === 'object'
    ? options.voteConfig
    : { enabled: false, canVote: false };
  const deckDefaultSelectionMode = normalizeSelectionMode(options.deckDefaultSelectionMode, 'multiple');
  document.getElementById('browse-deck-name').textContent = deckName;

  const toolbarHtml = `
    <div class="browse-toolbar">
      <div class="browse-search">
        <input type="text" id="browse-search-input" placeholder="Szukaj pytania...">
      </div>
      ${canEdit ? '<button class="btn btn-primary btn-sm" id="btn-browse-add-question">+ Dodaj pytanie</button>' : ''}
    </div>
  `;

  const listHtml = questions.map((q, i) => {
    const flashcard = isFlashcard(q);
    const questionSelectionMode = getEffectiveQuestionSelectionMode(q, deckDefaultSelectionMode);
    const showMinus = questionSelectionMode === 'multiple';
    const questionVotes = voteSummaryByQuestion && typeof voteSummaryByQuestion === 'object'
      ? voteSummaryByQuestion[q.id] || null
      : null;

    let answersHtml = '';
    if (!flashcard) {
      answersHtml = q.answers.map(a => {
        const isCorrect = a.correct;
        const cls = isCorrect ? 'correct' : '';
        const icon = isCorrect
          ? '<span class="browse-answer-icon" style="color: var(--color-success)">&#10003;</span>'
          : '<span class="browse-answer-icon" style="color: transparent">&#8226;</span>';
        const votesHtml = renderAnswerVoteControls(
          q.id,
          a.id,
          questionVotes,
          {
            enabled: voteConfigBase.enabled === true,
            canVote: voteConfigBase.canVote === true,
            showMinus,
          }
        );
        return `<div class="browse-answer ${cls}">${icon}<span class="browse-answer-text">${renderLatex(escapeHtml(a.text))}</span>${votesHtml}</div>`;
      }).join('');
    }

    const explanationHtml = q.explanation
      ? `<div class="browse-item-explanation"><strong>Wyjaśnienie:</strong> ${renderLatex(escapeHtml(q.explanation))}</div>`
      : '';

    const editBtn = canEdit
      ? `<button class="btn-edit-question browse-edit-btn" data-question-index="${i}" ${tooltipAttrs('Edytuj treść pytania')} aria-label="Edytuj treść pytania">&#9998;</button>`
      : '';

    return `
      <div class="browse-item" data-search-text="${escapeAttr(q.text.toLowerCase())}" data-question-index="${i}">
        <div class="browse-item-header">
          <div class="browse-item-number">${flashcard ? 'Fiszka' : 'Pytanie'} ${i + 1}</div>
          ${editBtn}
        </div>
        <div class="browse-item-question">${renderLatex(escapeHtml(q.text))}</div>
        ${answersHtml ? `<div class="browse-item-answers">${answersHtml}</div>` : ''}
        ${explanationHtml}
      </div>
    `;
  }).join('');

  document.getElementById('browse-content').innerHTML = toolbarHtml + `<div class="browse-list" id="browse-list">${listHtml}</div>`;
}

export function renderBrowseCreateEditor(options = {}) {
  const categories = Array.isArray(options.categories) ? options.categories : [];
  const selectedCategory = typeof options.selectedCategory === 'string' ? options.selectedCategory : '';
  const questionText = typeof options.text === 'string' ? options.text : '';
  const explanation = typeof options.explanation === 'string' ? options.explanation : '';
  const isFlashcard = !!options.isFlashcard;
  const selectionMode = normalizeSelectionMode(options.selectionMode, 'multiple');
  const answers = Array.isArray(options.answers) && options.answers.length > 0
    ? options.answers
    : [
      { text: '', correct: true },
      { text: '', correct: false },
    ];

  const answerRowsHtml = answers.map((a, idx) => `
    <div class="editor-answer-row create-answer-row" data-answer-index="${idx}">
      <label class="toggle-switch toggle-switch-sm">
        <input type="checkbox" class="create-answer-correct" ${a.correct ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <input type="text" class="editor-answer-text create-answer-text" value="${escapeAttr(a.text || '')}" placeholder="Treść odpowiedzi">
      <button class="btn-remove-create-answer" ${tooltipAttrs('Usuń odpowiedź')} aria-label="Usuń odpowiedź" ${answers.length <= 2 ? 'disabled' : ''}>&times;</button>
    </div>
  `).join('');

  const categorySection = categories.length > 0 ? `
    <div class="editor-section">
      <label class="editor-label" for="create-question-category">Kategoria</label>
      <select class="editor-select" id="create-question-category">
        <option value="">(Bez kategorii)</option>
        ${categories.map((cat) => `
          <option value="${escapeAttr(cat.id)}" ${cat.id === selectedCategory ? 'selected' : ''}>
            ${escapeHtml(cat.name || cat.id)}
          </option>
        `).join('')}
      </select>
    </div>
  ` : '';

  return `
    <div class="question-card question-editor browse-editor browse-create-editor">
      <div class="editor-section">
        <label class="editor-label">Nowe pytanie</label>
        <div class="editor-type-toggle">
          <div class="editor-type-toggle-text">Pytanie testowe / fiszka</div>
          <label class="toggle-switch toggle-switch-sm">
            <input type="checkbox" id="create-question-is-flashcard" ${isFlashcard ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      ${categorySection}
      <div class="editor-section">
        <label class="editor-label" for="create-question-text">Treść pytania</label>
        <textarea class="editor-textarea" id="create-question-text" rows="3">${escapeHtml(questionText)}</textarea>
      </div>
      <div class="editor-section" id="create-editor-answers-section" style="${isFlashcard ? 'display:none' : ''}">
        <label class="editor-label" for="create-question-selection-mode">Typ wyboru</label>
        <select class="editor-select" id="create-question-selection-mode">
          <option value="multiple" ${selectionMode === 'multiple' ? 'selected' : ''}>Wielokrotny wybór</option>
          <option value="single" ${selectionMode === 'single' ? 'selected' : ''}>Pojedynczy wybór</option>
        </select>
        <label class="editor-label">Odpowiedzi <span class="editor-label-hint">(przełącznik = poprawna)</span></label>
        <div class="editor-answers-list" id="create-editor-answers-list">
          ${answerRowsHtml}
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-create-add-answer">+ Dodaj odpowiedź</button>
      </div>
      <div class="editor-section">
        <label class="editor-label" for="create-question-explanation">Wyjaśnienie <span class="editor-label-hint">(opcjonalne)</span></label>
        <textarea class="editor-textarea" id="create-question-explanation" rows="2">${escapeHtml(explanation)}</textarea>
      </div>
      <div class="editor-section editor-randomize-section">
        <div class="editor-randomize-header">
          <label class="editor-label">Losowe wartości</label>
          <label class="toggle-switch toggle-switch-sm">
            <input type="checkbox" class="editor-randomize-toggle">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="editor-randomize-body" style="display:none">
          <div class="editor-randomize-hint">
            Użyj <code>{nazwa}</code> w treści, <code>=&#123;wyrażenie&#125;</code> w odpowiedziach.
            Zakres: <code>min, max</code> (2 liczby) lub lista: <code>v1, v2, v3</code> (3+).
          </div>
          <div class="editor-vars-list"></div>
          <button class="btn btn-secondary btn-sm btn-add-var">+ Dodaj zmienną</button>
          <div class="editor-subsection">
            <label class="editor-label editor-sublabel">Zmienne pochodne ($derived)</label>
            <div class="editor-derived-list"></div>
            <button class="btn btn-secondary btn-sm btn-add-derived">+ Dodaj pochodną</button>
          </div>
          <div class="editor-subsection">
            <label class="editor-label editor-sublabel">Ograniczenia ($constraints)</label>
            <div class="editor-constraints-list"></div>
            <button class="btn btn-secondary btn-sm btn-add-constraint">+ Dodaj ograniczenie</button>
          </div>
        </div>
      </div>
      <div class="editor-actions">
        <button class="btn btn-secondary" id="btn-create-question-cancel">Anuluj</button>
        <button class="btn btn-primary" id="btn-create-question-save">Dodaj pytanie</button>
      </div>
    </div>
  `;
}

// --- Browse Editor (inline) ---

export function renderBrowseEditor(question, index, deckDefaultSelectionMode = 'multiple') {
  const flashcard = isFlashcard(question);
  const selectionMode = normalizeSelectionMode(question.selectionMode, normalizeSelectionMode(deckDefaultSelectionMode, 'multiple'));

  const answersHtml = flashcard ? '' : question.answers.map((a) => `
    <div class="editor-answer-row" data-answer-id="${escapeAttr(a.id)}">
      <label class="toggle-switch toggle-switch-sm">
        <input type="checkbox" class="editor-answer-correct" data-answer-id="${escapeAttr(a.id)}" ${a.correct ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <input type="text" class="editor-answer-text" data-answer-id="${escapeAttr(a.id)}" value="${escapeAttr(a.text)}">
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
      <button class="btn-remove-var" ${tooltipAttrs('Usuń zmienną')} aria-label="Usuń zmienną">&times;</button>
    </div>
  `).join('');

  const derivedEntries = hasRandomize && question.randomize.$derived
    ? Object.entries(question.randomize.$derived) : [];
  const derivedHtml = derivedEntries.map(([name, expr]) => `
    <div class="editor-derived-row">
      <input type="text" class="editor-derived-name" value="${escapeAttr(name)}" placeholder="nazwa">
      <input type="text" class="editor-derived-expr" value="${escapeAttr(expr)}" placeholder="wyrażenie, np. a + b">
      <button class="btn-remove-derived" ${tooltipAttrs('Usuń pochodną')} aria-label="Usuń pochodną">&times;</button>
    </div>
  `).join('');

  const constraintsList = hasRandomize && Array.isArray(question.randomize.$constraints)
    ? question.randomize.$constraints : [];
  const constraintsHtml = constraintsList.map(expr => `
    <div class="editor-constraint-row">
      <input type="text" class="editor-constraint-expr" value="${escapeAttr(expr)}" placeholder="warunek, np. a != b">
      <button class="btn-remove-constraint" ${tooltipAttrs('Usuń ograniczenie')} aria-label="Usuń ograniczenie">&times;</button>
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
        <label class="editor-label">Typ wyboru</label>
        <select class="editor-select editor-selection-mode">
          <option value="multiple" ${selectionMode === 'multiple' ? 'selected' : ''}>Wielokrotny wybór</option>
          <option value="single" ${selectionMode === 'single' ? 'selected' : ''}>Pojedynczy wybór</option>
        </select>
      </div>
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
      <div class="browse-item flagged-item" data-question-id="${escapeAttr(q.id)}">
        <div class="browse-item-number">${flashcard ? 'Fiszka' : 'Pytanie'} ${i + 1}</div>
        <div class="browse-item-question">${renderLatex(escapeHtml(q.text))}</div>
        ${answersHtml ? `<div class="browse-item-answers">${answersHtml}</div>` : ''}
        <div class="flagged-item-actions">
          <button class="btn btn-secondary btn-sm btn-unflag" data-question-id="${escapeAttr(q.id)}">Odznacz</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('browse-content').innerHTML = headerHtml + `<div class="browse-list">${listHtml}</div>`;
}

// --- Settings ---

export function renderSettings(settings, defaults, options = {}) {
  const stepsToStr = (arr) => Array.isArray(arr) ? arr.join(', ') : String(arr);
  const deckMeta = options.deckMeta && typeof options.deckMeta === 'object' ? options.deckMeta : null;
  const canEditMeta = options.canEditMeta === true;
  const normalizeGroup = (value) => (
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  );
  const groupOptions = Array.isArray(options.groupOptions)
    ? [...new Set(options.groupOptions
      .map((group) => normalizeGroup(group))
      .filter((group) => group.length > 0))]
    : [];
  const currentGroup = normalizeGroup(deckMeta?.group);
  if (currentGroup && !groupOptions.includes(currentGroup)) {
    groupOptions.push(currentGroup);
  }
  const selectedGroupValue = currentGroup || '';
  const groupOptionsHtml = groupOptions
    .map((groupName) => `<option value="${escapeAttr(groupName)}" ${selectedGroupValue === groupName ? 'selected' : ''}>${escapeHtml(groupName)}</option>`)
    .join('');

  const groupFieldHtml = canEditMeta ? `
    <div class="settings-group">
      <label class="settings-label" for="set-deck-group-select">Grupa talii</label>
      <select class="settings-input" id="set-deck-group-select">
        <option value="" ${selectedGroupValue === '' ? 'selected' : ''}>Bez grupy</option>
        ${groupOptionsHtml}
        <option value="__new__" ${selectedGroupValue === '__new__' ? 'selected' : ''}>+ Nowa grupa</option>
      </select>
      <div class="settings-hint">Wybierz gotową grupę. Opcja „Nowa grupa” otworzy popup z nazwą.</div>
    </div>
  ` : `
    <div class="settings-group">
      <label class="settings-label" for="set-deck-group">Grupa talii</label>
      <input class="settings-input" type="text" id="set-deck-group" value="${escapeAttr(currentGroup)}" disabled>
      <div class="settings-hint">Talia ogólna: grupa jest tylko do odczytu.</div>
    </div>
  `;

  const deckMetaHtml = deckMeta ? `
    <div class="settings-form">
      <div class="settings-group">
        <label class="settings-label" for="set-deck-name">Nazwa talii</label>
        <input class="settings-input" type="text" id="set-deck-name" value="${escapeAttr(deckMeta.name || '')}" ${canEditMeta ? '' : 'disabled'}>
        <div class="settings-hint">${canEditMeta ? 'Edytowalna nazwa prywatnej talii.' : 'Talia ogólna: nazwa jest tylko do odczytu.'}</div>
      </div>
      <div class="settings-group">
        <label class="settings-label" for="set-deck-description">Opis talii</label>
        <textarea class="settings-input" id="set-deck-description" rows="3" ${canEditMeta ? '' : 'disabled'}>${escapeHtml(deckMeta.description || '')}</textarea>
        <div class="settings-hint">${canEditMeta ? 'Edytowalny opis prywatnej talii.' : 'Talia ogólna: opis jest tylko do odczytu.'}</div>
      </div>
      ${groupFieldHtml}
      ${canEditMeta ? `
      <div class="settings-actions">
        <button class="btn btn-secondary" id="btn-save-deck-meta">Zapisz nazwę, opis i grupę</button>
      </div>
      ` : ''}
    </div>
  ` : '';

  document.getElementById('settings-content').innerHTML = `
    ${deckMetaHtml}
    <div class="settings-form">
      <div class="settings-group">
        <div class="toggle-row">
          <div>
            <div class="toggle-label-text">Losuj wbudowane warianty pytań obliczeniowych</div>
            <div class="toggle-hint">Dotyczy pytań z gotowym generatorem (ikona kostki). Pytania szablonowe działają niezależnie.</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="set-builtInCalculationVariants" ${settings.builtInCalculationVariants ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
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

export function renderQuestionEditor(question, deckDefaultSelectionMode = 'multiple') {
  const flashcard = isFlashcard(question);
  const selectionMode = normalizeSelectionMode(question.selectionMode, normalizeSelectionMode(deckDefaultSelectionMode, 'multiple'));

  const answersHtml = flashcard ? '' : question.answers.map((a, i) => `
    <div class="editor-answer-row" data-answer-id="${escapeAttr(a.id)}">
      <label class="toggle-switch toggle-switch-sm">
        <input type="checkbox" class="editor-answer-correct" data-answer-id="${escapeAttr(a.id)}" ${a.correct ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <input type="text" class="editor-answer-text" data-answer-id="${escapeAttr(a.id)}" value="${escapeAttr(a.text)}">
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
      <button class="btn-remove-var" ${tooltipAttrs('Usuń zmienną')} aria-label="Usuń zmienną">&times;</button>
    </div>
  `).join('');

  const derivedEntries = hasRandomize && question.randomize.$derived
    ? Object.entries(question.randomize.$derived) : [];
  const derivedHtml = derivedEntries.map(([name, expr]) => `
    <div class="editor-derived-row">
      <input type="text" class="editor-derived-name" value="${escapeAttr(name)}" placeholder="nazwa">
      <input type="text" class="editor-derived-expr" value="${escapeAttr(expr)}" placeholder="wyrażenie, np. a + b">
      <button class="btn-remove-derived" ${tooltipAttrs('Usuń pochodną')} aria-label="Usuń pochodną">&times;</button>
    </div>
  `).join('');

  const constraintsList = hasRandomize && Array.isArray(question.randomize.$constraints)
    ? question.randomize.$constraints : [];
  const constraintsHtml = constraintsList.map(expr => `
    <div class="editor-constraint-row">
      <input type="text" class="editor-constraint-expr" value="${escapeAttr(expr)}" placeholder="warunek, np. a != b">
      <button class="btn-remove-constraint" ${tooltipAttrs('Usuń ograniczenie')} aria-label="Usuń ograniczenie">&times;</button>
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
        <label class="editor-label" for="editor-selection-mode">Typ wyboru</label>
        <select class="editor-select" id="editor-selection-mode">
          <option value="multiple" ${selectionMode === 'multiple' ? 'selected' : ''}>Wielokrotny wybór</option>
          <option value="single" ${selectionMode === 'single' ? 'selected' : ''}>Pojedynczy wybór</option>
        </select>
      </div>
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
        <button class="btn-remove-var" ${tooltipAttrs('Usuń zmienną')} aria-label="Usuń zmienną">&times;</button>
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
        <button class="btn-remove-derived" ${tooltipAttrs('Usuń pochodną')} aria-label="Usuń pochodną">&times;</button>
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
        <button class="btn-remove-constraint" ${tooltipAttrs('Usuń ograniczenie')} aria-label="Usuń ograniczenie">&times;</button>
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
    { value: '65%', label: 'Normalny', desc: '65%' },
    { value: '50%', label: 'Kompaktowy', desc: '50%' },
  ];

  const layoutHtml = layoutWidths.map(lw => `
    <button class="layout-width-option ${appSettings.layoutWidth === lw.value ? 'active' : ''}" data-width="${lw.value}">
      <div class="layout-width-label">${lw.label}</div>
      <div class="layout-width-desc">${lw.desc}</div>
    </button>
  `).join('');

  const deckListLayouts = [
    { value: 'compact', label: 'Kompaktowy', desc: '2 talie obok siebie na desktopie' },
    { value: 'classic', label: 'Klasyczny', desc: '1 talia w wierszu (jak wcześniej)' },
  ];
  const deckListMode = appSettings.deckListMode === 'classic' ? 'classic' : 'compact';

  const deckListLayoutHtml = deckListLayouts.map((layout) => `
    <button class="deck-layout-option ${deckListMode === layout.value ? 'active' : ''}" data-deck-layout="${layout.value}">
      <div class="layout-width-label">${layout.label}</div>
      <div class="layout-width-desc">${layout.desc}</div>
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
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Widok listy talii</div>
        <div class="deck-layout-options" id="deck-layout-options">
          ${deckListLayoutHtml}
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
            <div class="toggle-label-text">Oznaczone pytania w trybie Anki</div>
            <div class="toggle-hint">Domyślnie włączone: standardowy Anki może pokazywać także pytania oznaczone.</div>
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
          Bazunia — aplikacja do nauki z powtarzaniem rozłożonym w czasie.
        </p>
        <button class="btn btn-secondary btn-sm" id="btn-open-docs">Dokumentacja</button>
      </div>
    </div>
  `;
}

// --- User/Profile ---

function formatDateTime(value) {
  if (!value) return 'brak danych';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function renderUserProfile(profile = {}) {
  const roleLabel = profile.role || 'user';
  const username = String(profile.username || '');
  const items = [
    { label: 'E-mail', value: profile.email || 'brak danych' },
    { label: 'ID użytkownika', value: profile.userId || 'brak danych' },
    { label: 'Rola', value: roleLabel },
    { label: 'Data utworzenia konta', value: formatDateTime(profile.createdAt) },
    { label: 'Ostatnie logowanie', value: formatDateTime(profile.lastSignInAt) },
  ];

  const html = items.map((item) => `
    <div class="user-card-item">
      <div class="user-card-label">${escapeHtml(item.label)}</div>
      <div class="user-card-value">${escapeHtml(String(item.value))}</div>
    </div>
  `).join('');

  document.getElementById('user-profile-content').innerHTML = `
    <div class="user-card">
      <div class="user-card-grid">
        <div class="user-card-item">
          <div class="user-card-label">Username</div>
          <div class="user-profile-username-display" id="profile-username-display-row">
            <div class="user-card-value" id="profile-username-value">${escapeHtml(username || 'brak danych')}</div>
            <button class="btn btn-secondary btn-sm" id="btn-edit-username" type="button">Edytuj</button>
          </div>
          <div class="user-profile-username-edit" id="profile-username-edit-row" hidden>
            <div class="user-profile-username-row">
              <input
                class="settings-input user-profile-username-input"
                id="profile-username-input"
                type="text"
                value="${escapeAttr(username)}"
                placeholder="np. u_abc123"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
              >
              <button class="btn btn-primary btn-sm" id="btn-save-username" type="button">Zapisz</button>
              <button class="btn btn-secondary btn-sm" id="btn-cancel-username-edit" type="button">Anuluj</button>
            </div>
            <div class="modal-form-hint">Dozwolone: 3-24 znaki, małe litery, cyfry oraz _ . -</div>
            <div class="modal-form-error" id="profile-username-error"></div>
          </div>
        </div>
        ${html}
      </div>
    </div>
  `;
}

// --- Admin ---

function roleBadge(role) {
  const normalized = role === 'dev' || role === 'admin' ? role : 'user';
  return `<span class="admin-role-badge role-${normalized}">${escapeHtml(normalized)}</span>`;
}

export function renderAdminPanel(data = {}) {
  const users = Array.isArray(data.users) ? data.users : [];
  const hiddenDecks = Array.isArray(data.hiddenDecks) ? data.hiddenDecks : [];
  const currentUserRole = data.currentUserRole === 'dev' ? 'dev' : (data.currentUserRole === 'admin' ? 'admin' : 'user');
  const userQuery = String(data.userQuery || '');
  const hiddenDeckQuery = String(data.hiddenDeckQuery || '');
  const usersPage = Number(data.usersPage) || 1;
  const usersPages = Number(data.usersPages) || 1;
  const usersTotal = Number(data.usersTotal) || users.length;
  const hiddenPage = Number(data.hiddenPage) || 1;
  const hiddenPages = Number(data.hiddenPages) || 1;
  const hiddenTotal = Number(data.hiddenTotal) || hiddenDecks.length;

  const userRows = users.map((u) => {
    const role = u.role === 'dev' || u.role === 'admin' ? u.role : 'user';
    const actions = [];

    if (role === 'user' && (currentUserRole === 'admin' || currentUserRole === 'dev')) {
      actions.push(`<button class="btn btn-secondary btn-sm admin-user-action" data-user-id="${escapeAttr(u.user_id)}" data-next-role="admin">Ustaw admina</button>`);
    }
    if (role === 'admin' && currentUserRole === 'dev') {
      actions.push(`<button class="btn btn-secondary btn-sm admin-user-action" data-user-id="${escapeAttr(u.user_id)}" data-next-role="user">Zdejmij admina</button>`);
    }

    return `
      <tr>
        <td>${escapeHtml(u.email || '(brak e-maila)')}</td>
        <td>${roleBadge(role)}</td>
        <td>${escapeHtml(formatDateTime(u.created_at))}</td>
        <td>${escapeHtml(formatDateTime(u.last_sign_in_at))}</td>
        <td>
          <div class="admin-actions-row">
            ${actions.join('') || '<span class="user-card-label">brak akcji</span>'}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const hiddenRows = hiddenDecks.map((d) => `
    <tr>
      <td>${escapeHtml(d.name || d.id)}</td>
      <td>${escapeHtml(d.id)}</td>
      <td>${escapeHtml(formatDateTime(d.updated_at))}</td>
      <td>
        <button class="btn btn-secondary btn-sm admin-unhide-deck" data-deck-id="${escapeAttr(d.id)}">Pokaż</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('admin-panel-content').innerHTML = `
    <div class="admin-panel">
      <div class="admin-section">
        <h3 class="admin-section-title">Użytkownicy</h3>
        <div class="admin-toolbar">
          <input type="text" class="settings-input admin-search-input" id="admin-user-search" placeholder="Szukaj po e-mailu, ID lub roli..." value="${escapeAttr(userQuery)}">
          <div class="admin-pager">
            <button class="btn btn-secondary btn-sm admin-page-btn" data-target="users" data-dir="-1" ${usersPage <= 1 ? 'disabled' : ''}>Poprzednia</button>
            <span class="admin-page-info">${usersTotal} wyników • strona ${usersPage}/${usersPages}</span>
            <button class="btn btn-secondary btn-sm admin-page-btn" data-target="users" data-dir="1" ${usersPage >= usersPages ? 'disabled' : ''}>Następna</button>
          </div>
        </div>
        ${usersTotal === 0 ? '<div class="admin-empty">Brak użytkowników dla podanego filtra.</div>' : `
          <table class="admin-table">
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Rola</th>
                <th>Konto od</th>
                <th>Ostatnie logowanie</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              ${userRows}
            </tbody>
          </table>
        `}
      </div>

      <div class="admin-section">
        <h3 class="admin-section-title">Ukryte talie ogólne (widoczne tylko dla admin/dev)</h3>
        <div class="admin-toolbar">
          <input type="text" class="settings-input admin-search-input" id="admin-hidden-search" placeholder="Szukaj po nazwie lub ID talii..." value="${escapeAttr(hiddenDeckQuery)}">
          <div class="admin-pager">
            <button class="btn btn-secondary btn-sm admin-page-btn" data-target="hidden" data-dir="-1" ${hiddenPage <= 1 ? 'disabled' : ''}>Poprzednia</button>
            <span class="admin-page-info">${hiddenTotal} wyników • strona ${hiddenPage}/${hiddenPages}</span>
            <button class="btn btn-secondary btn-sm admin-page-btn" data-target="hidden" data-dir="1" ${hiddenPage >= hiddenPages ? 'disabled' : ''}>Następna</button>
          </div>
        </div>
        ${hiddenTotal === 0 ? '<div class="admin-empty">Brak ukrytych talii dla podanego filtra.</div>' : `
          <table class="admin-table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>ID</th>
                <th>Zmodyfikowano</th>
                <th>Akcja</th>
              </tr>
            </thead>
            <tbody>
              ${hiddenRows}
            </tbody>
          </table>
        `}
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
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
