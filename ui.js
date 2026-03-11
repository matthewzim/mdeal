// Monopoly Deal - UI Controller
// Manages all DOM rendering and user interactions

const UI = (() => {
  // ── Color map for card backgrounds ───────────────────────────────────
  const COLOR_MAP = {
    brown: '#8B4513',
    darkblue: '#00008B',
    lightblue: '#87CEEB',
    pink: '#FF69B4',
    orange: '#FF8C00',
    red: '#DC143C',
    yellow: '#FFD700',
    green: '#228B22',
    railroad: '#333333',
    utility: '#9370DB',
  };

  const COLOR_LABELS = {
    brown: 'Brown', darkblue: 'Dark Blue', lightblue: 'Light Blue',
    pink: 'Pink', orange: 'Orange', red: 'Red', yellow: 'Yellow',
    green: 'Green', railroad: 'Railroad', utility: 'Utility',
  };

  let selectedCards = []; // for payment selection
  let discardMode = false;
  let discardNeeded = 0;
  let selectedDiscards = [];
  let actionTargetMode = null; // for targeting actions
  let lastRenderedHandIds = null; // track hand card IDs to avoid unnecessary re-renders
  let playedCardFadeTimeout = null; // track showPlayedCard timeouts to avoid overlap
  let playedCardCleanTimeout = null;
  let lastActionCard = null; // track the last action card played (for center display)

  // ── Screen management ────────────────────────────────────────────────

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  function showLoginScreen() { showScreen('login-screen'); }
  function showLobbyScreen() { showScreen('lobby-screen'); }
  function showGameScreen() { showScreen('game-screen'); }

  // ── Login screen ─────────────────────────────────────────────────────

  function initLoginHandlers() {
    document.getElementById('btn-create-room').addEventListener('click', async () => {
      const name = document.getElementById('input-username').value.trim();
      if (!name) return showError('Enter a username');
      try {
        showLoading(true);
        const data = await ClientGame.createRoom(name);
        document.getElementById('lobby-room-code').textContent = data.roomCode;
        showLobbyScreen();
        await ClientGame.refreshRoomPlayers();
      } catch (err) {
        showError(err.message);
      } finally {
        showLoading(false);
      }
    });

    document.getElementById('btn-join-room').addEventListener('click', async () => {
      const name = document.getElementById('input-username').value.trim();
      const code = document.getElementById('input-room-code').value.trim().toUpperCase();
      if (!name) return showError('Enter a username');
      if (!code) return showError('Enter a room code');
      try {
        showLoading(true);
        const data = await ClientGame.joinRoom(name, code);
        document.getElementById('lobby-room-code').textContent = data.roomCode;
        showLobbyScreen();
        await ClientGame.refreshRoomPlayers();
      } catch (err) {
        showError(err.message);
      } finally {
        showLoading(false);
      }
    });

    // Play Against Computer
    document.getElementById('btn-play-computer').addEventListener('click', () => {
      const name = document.getElementById('input-username').value.trim();
      if (!name) return showError('Enter a username');
      document.getElementById('computer-setup-modal').classList.add('active');
    });

    document.getElementById('btn-cancel-computer').addEventListener('click', () => {
      document.getElementById('computer-setup-modal').classList.remove('active');
    });

    document.querySelectorAll('.btn-computer-count').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = document.getElementById('input-username').value.trim();
        const count = parseInt(btn.dataset.count);
        document.getElementById('computer-setup-modal').classList.remove('active');
        try {
          ClientGame.startLocalGame(name, count);
        } catch (err) {
          showError('Failed to start game: ' + err.message);
          console.error(err);
        }
      });
    });
  }

  // ── Lobby screen ─────────────────────────────────────────────────────

  function updateLobby(players, isHost, playerId) {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';

    for (const p of players) {
      const div = document.createElement('div');
      div.className = 'lobby-player' + (p.ready_status ? ' ready' : '');
      const name = p.players?.username || 'Unknown';
      const hostBadge = p.player_id === players.find(pp => pp.seat_position === 0)?.player_id ? ' (Host)' : '';
      const youBadge = p.player_id === playerId ? ' (You)' : '';
      div.innerHTML = `
        <div class="lobby-player-avatar">P${p.seat_position + 1}</div>
        <div class="lobby-player-info">
          <div class="lobby-player-name">${escapeHtml(name)}${hostBadge}${youBadge}</div>
          <div class="lobby-player-status">${p.ready_status ? 'READY' : 'Not Ready'}</div>
        </div>
      `;
      list.appendChild(div);
    }

    // Show/hide start button
    const startBtn = document.getElementById('btn-start-game');
    startBtn.style.display = isHost ? 'block' : 'none';
    const allReady = players.length >= 2 && players.every(p => p.ready_status);
    startBtn.disabled = !allReady;
    startBtn.textContent = allReady ? 'Start Game!' : 'Waiting for all players...';
  }

  function initLobbyHandlers() {
    document.getElementById('btn-ready').addEventListener('click', async () => {
      try {
        await ClientGame.toggleReady();
      } catch (err) {
        showError(err.message);
      }
    });

    document.getElementById('btn-start-game').addEventListener('click', async () => {
      try {
        showLoading(true);
        await ClientGame.startGame();
      } catch (err) {
        showError(err.message);
      } finally {
        showLoading(false);
      }
    });

    // Copy room code
    document.getElementById('lobby-room-code').addEventListener('click', () => {
      const code = document.getElementById('lobby-room-code').textContent;
      navigator.clipboard?.writeText(code);
      showToast('Room code copied!');
    });
  }

  // ── Game rendering ───────────────────────────────────────────────────

  function renderGame(state, myId, names) {
    if (!state || !state.players) return;

    const myPlayer = state.players.find(p => p.id === myId);
    const opponents = state.players.filter(p => p.id !== myId);

    // Render opponents in seats
    renderOpponents(opponents, names, state);

    // Render my hand
    renderMyHand(myPlayer, state);

    // Render my properties
    renderMyProperties(myPlayer, state, myId);

    // Render my bank
    renderMyBank(myPlayer);

    // Render game info
    renderGameInfo(state, myId, names);

    // Render game log
    renderGameLog(state.log, names);

    // Render deck and last action card in center
    renderDeckAndDiscard(state);

    // Render action bar (draw / end turn / etc)
    renderActionBar(state, myId);

    // Render pending action UI
    renderPendingAction(state, myId, names);

    // Check winner
    if (state.phase === 'finished' && state.winner) {
      showWinner(state.winner, names);
    }
  }

  function renderOpponents(opponents, names, state) {
    const positions = ['top', 'left', 'right', 'top-left']; // up to 4 opponents
    // Clear all opponent seats
    for (const pos of positions) {
      const el = document.getElementById('opponent-' + pos);
      if (el) el.innerHTML = '';
      if (el) el.style.display = 'none';
    }

    opponents.forEach((opp, i) => {
      if (i >= positions.length) return;
      const el = document.getElementById('opponent-' + positions[i]);
      if (!el) return;
      el.style.display = 'flex';

      const name = names[opp.id] || 'Unknown';
      const cardCount = opp.hand.length;
      const bankValue = opp.bank.reduce((s, c) => s + (c.value || 0), 0);
      const completedSets = countCompletedSets(opp);

      let propsHtml = '';
      // Group properties by color
      const propGroups = groupProperties(opp.properties);
      for (const [color, cards] of Object.entries(propGroups)) {
        propsHtml += `<div class="prop-group">`;
        propsHtml += `<div class="prop-group-label" style="background:${COLOR_MAP[color] || '#666'}">${COLOR_LABELS[color] || color} (${cards.length})</div>`;
        for (const card of cards) {
          propsHtml += createMiniPropertyCard(card);
        }
        propsHtml += `</div>`;
      }

      const pos = positions[i];
      const isSide = (pos === 'left' || pos === 'right');

      const bankHtml = opp.bank.map(c => {
        const hasImg = getCardImagePath(c) ? ' has-card-img' : '';
        return `<div class="card-image-tiny${hasImg}">${buildCardImageHtml(c)}</div>`;
      }).join('');

      const cardAreaHtml = isSide
        ? `<div class="opponent-card-area opponent-card-area--columns">
            <div class="opponent-column opponent-column--cash">
              <div class="opponent-column-label">Cash</div>
              <div class="opponent-bank">${bankHtml}</div>
            </div>
            <div class="opponent-column opponent-column--properties">
              <div class="opponent-column-label">Properties</div>
              <div class="opponent-properties">${propsHtml}</div>
            </div>
          </div>`
        : `<div class="opponent-card-area">
            <div class="opponent-cards">
              ${Array(cardCount).fill('<div class="card card-back mini"></div>').join('')}
            </div>
            <div class="opponent-bank">${bankHtml}</div>
            <div class="opponent-properties">${propsHtml}</div>
          </div>`;

      el.innerHTML = `
        <div class="opponent-header">
          <div class="opponent-avatar">
            <div class="avatar-circle">${name.charAt(0).toUpperCase()}</div>
          </div>
          <div class="opponent-info">
            <div class="opponent-name">${escapeHtml(name)}</div>
            <div class="opponent-stats">
              <span class="stat">Cards: ${cardCount}</span>
              <span class="stat">Bank: ${bankValue}M</span>
              <span class="stat">Sets: ${completedSets}/3</span>
            </div>
          </div>
          ${state.currentPlayer === opp.id ? '<div class="turn-indicator">TURN</div>' : ''}
        </div>
        ${cardAreaHtml}
      `;
    });
  }

  function renderMyHand(player, state, forceRender) {
    const container = document.getElementById('my-hand');

    if (!player || !player.hand) {
      container.innerHTML = '';
      lastRenderedHandIds = null;
      return;
    }

    // Check if the hand cards have actually changed
    const currentIds = player.hand.filter(c => c.type !== 'hidden').map(c => c.id).join(',');
    if (!forceRender && lastRenderedHandIds === currentIds && !discardMode) {
      return; // hand hasn't changed, skip re-render
    }
    lastRenderedHandIds = currentIds;

    container.innerHTML = '';

    player.hand.forEach((card, i) => {
      if (card.type === 'hidden') return;
      const el = createCardElement(card, true);
      el.style.animationDelay = (i * 0.05) + 's';
      el.classList.add('hand-card');

      if (discardMode) {
        el.addEventListener('click', () => toggleDiscardSelect(card.id, el));
        if (selectedDiscards.includes(card.id)) {
          el.classList.add('selected');
        }
      } else if (state.currentPlayer === player.id && state.phase === 'play' && state.turnPlaysRemaining > 0) {
        el.addEventListener('click', () => showCardActions(card, state, player));
      }

      container.appendChild(el);
    });
  }

  function renderMyProperties(player, state, myId) {
    const container = document.getElementById('my-properties');
    container.innerHTML = '';
    if (!player) return;

    const isMyTurn = state && state.currentPlayer === myId;
    const groups = groupProperties(player.properties);
    for (const [color, cards] of Object.entries(groups)) {
      const groupEl = document.createElement('div');
      groupEl.className = 'my-prop-group';

      const req = getSetRequirement(color);
      const isComplete = cards.length >= req;

      const label = document.createElement('div');
      label.className = 'my-prop-label' + (isComplete ? ' complete' : '');
      label.style.borderColor = COLOR_MAP[color] || '#666';
      label.textContent = `${COLOR_LABELS[color] || color} (${cards.length}/${req})${isComplete ? ' ★' : ''}`;
      groupEl.appendChild(label);

      const cardsRow = document.createElement('div');
      cardsRow.className = 'my-prop-cards';
      for (const card of cards) {
        const el = createPropertyCardElement(card);
        // Allow selecting for payment or forced deal
        if (actionTargetMode === 'select_my_property') {
          el.classList.add('selectable');
          el.addEventListener('click', () => {
            if (typeof actionTargetMode._callback === 'function') {
              actionTargetMode._callback(card.id);
            }
          });
        }
        // Wild cards are switchable on player's turn
        else if (isMyTurn && card.type === 'wild_property') {
          el.classList.add('switchable');
          el.addEventListener('click', () => showWildColorSwitch(card));
        }
        cardsRow.appendChild(el);
      }
      groupEl.appendChild(cardsRow);
      container.appendChild(groupEl);
    }
  }

  function renderMyBank(player) {
    const container = document.getElementById('my-bank');
    container.innerHTML = '';
    if (!player) return;

    const total = player.bank.reduce((s, c) => s + c.value, 0);
    const header = document.createElement('div');
    header.className = 'bank-header';
    header.textContent = `Bank: ${total}M`;
    container.appendChild(header);

    for (const card of player.bank) {
      const el = document.createElement('div');
      el.className = 'card-image-mini bank-card-img';
      if (getCardImagePath(card)) el.classList.add('has-card-img');
      el.dataset.cardId = card.id;
      el.innerHTML = buildCardImageHtml(card);
      container.appendChild(el);
    }
  }

  function renderGameInfo(state, myId, names) {
    const el = document.getElementById('game-info');
    const currentName = names[state.currentPlayer] || 'Unknown';
    const isMyTurn = state.currentPlayer === myId;

    el.innerHTML = `
      <div class="info-row ${isMyTurn ? 'my-turn' : ''}">
        <span class="info-label">Turn:</span>
        <span class="info-value">${isMyTurn ? 'YOUR TURN' : escapeHtml(currentName) + "'s turn"}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Plays left:</span>
        <span class="info-value">${state.turnPlaysRemaining}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Phase:</span>
        <span class="info-value">${state.phase}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Deck:</span>
        <span class="info-value">${typeof state.deck === 'number' ? state.deck : state.deck?.length || 0} cards</span>
      </div>
    `;
  }

  function renderGameLog(log, names) {
    const el = document.getElementById('game-log');
    if (!log) return;

    // Show last 20 entries
    const recent = log.slice(-20).reverse();
    el.innerHTML = recent.map(entry => {
      const name = names[entry.player] || 'Unknown';
      return `<div class="log-entry">${formatLogEntry(entry, names)}</div>`;
    }).join('');
  }

  function formatLogEntry(entry, names) {
    const n = (id) => escapeHtml(names[id] || 'Unknown');
    switch (entry.type) {
      case 'draw': return `${n(entry.player)} drew ${entry.count} cards`;
      case 'play_property': return `${n(entry.player)} played ${entry.card} (${COLOR_LABELS[entry.color] || entry.color})`;
      case 'bank': return `${n(entry.player)} banked ${entry.value}M`;
      case 'pass_go': return `${n(entry.player)} played Pass Go, drew ${entry.drawn} cards`;
      case 'rent': return `${n(entry.player)} charged ${entry.amount}M rent for ${COLOR_LABELS[entry.color] || entry.color}${entry.doubled ? ' (doubled!)' : ''}`;
      case 'debt_collector': return `${n(entry.player)} played Debt Collector on ${n(entry.target)}`;
      case 'birthday': return `${n(entry.player)} played It's My Birthday!`;
      case 'sly_deal': return `${n(entry.player)} played Sly Deal on ${n(entry.target)}`;
      case 'forced_deal': return `${n(entry.player)} played Forced Deal on ${n(entry.target)}`;
      case 'deal_breaker': return `${n(entry.player)} played Deal Breaker on ${n(entry.target)} for ${COLOR_LABELS[entry.color] || entry.color}`;
      case 'just_say_no': return `${n(entry.player)} played Just Say No!`;
      case 'payment': return `${n(entry.from)} paid ${n(entry.to)}`;
      case 'discard': return `${n(entry.player)} discarded ${entry.count} cards`;
      case 'end_turn': return `${n(entry.player)} ended their turn`;
      case 'win': return `🏆 ${n(entry.player)} WINS! 🏆`;
      case 'move_wild': return `${n(entry.player)} moved ${entry.card} to ${COLOR_LABELS[entry.color] || entry.color}`;
      default: return JSON.stringify(entry);
    }
  }

  // ── Deck & Last Action Card (center area) ───────────────────────────

  function renderDeckAndDiscard(state) {
    const container = document.getElementById('deck-and-discard');
    if (!container || !state) return;

    const deckCount = typeof state.deck === 'number' ? state.deck : (state.deck?.length || 0);
    let html = '';

    // Last action card (slightly to the left)
    html += '<div class="last-action-card-slot">';
    html += '<div class="slot-label">Last Action</div>';
    if (lastActionCard) {
      const cardEl = createCardElement(lastActionCard, false);
      // We need to build HTML string, so use innerHTML approach
      const imgPath = getCardImagePath(lastActionCard);
      if (imgPath) {
        html += `<div class="card card-has-image"><img class="card-img" src="${imgPath}" alt="${escapeHtml(lastActionCard.name)}" draggable="false"></div>`;
      } else {
        let actionColor = '#e67e22';
        if (lastActionCard.actionType === 'just_say_no') actionColor = '#e74c3c';
        if (lastActionCard.actionType === 'rent' || lastActionCard.actionType === 'multi_rent') actionColor = '#3498db';
        if (lastActionCard.actionType === 'deal_breaker') actionColor = '#9b59b6';
        html += `<div class="card card-action">
          <div class="card-color-bar" style="background:${actionColor}"></div>
          <div class="card-name">${escapeHtml(lastActionCard.name)}</div>
          <div class="card-value">${lastActionCard.value}M</div>
        </div>`;
      }
    } else {
      html += '<div class="last-action-empty">No action played</div>';
    }
    html += '</div>';

    // Deck (slightly to the right)
    if (deckCount > 0) {
      html += '<div class="deck-card-slot">';
      html += '<div class="slot-label">Deck</div>';
      html += `<img class="deck-card-img" src="assets/cards/back-cover.png" alt="Deck" draggable="false">`;
      html += `<div class="deck-count">${deckCount} cards</div>`;
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ── Action bar ───────────────────────────────────────────────────────

  function renderActionBar(state, myId) {
    const bar = document.getElementById('action-bar');
    bar.innerHTML = '';

    if (state.phase === 'finished') return;

    const isMyTurn = state.currentPlayer === myId;

    if (isMyTurn && state.phase === 'draw') {
      const btn = createButton('Draw Cards', 'btn-draw', async () => {
        await ClientGame.drawCards();
      });
      bar.appendChild(btn);
    }

    if (isMyTurn && state.phase === 'play') {
      const btn = createButton('End Turn', 'btn-end-turn', async () => {
        await ClientGame.endTurn();
      });
      bar.appendChild(btn);
    }

    if (isMyTurn && state.phase === 'discard') {
      if (!discardMode) {
        discardMode = true;
        const player = state.players.find(p => p.id === myId);
        discardNeeded = player ? player.hand.length - 7 : 0;
        selectedDiscards = [];
        renderMyHand(player, state, true);
      }
      const info = document.createElement('div');
      info.className = 'discard-info';
      info.textContent = `Discard ${discardNeeded} card(s) (selected: ${selectedDiscards.length})`;
      bar.appendChild(info);

      const btn = createButton('Confirm Discard', 'btn-confirm-discard', async () => {
        if (selectedDiscards.length < discardNeeded) {
          showError(`Select at least ${discardNeeded} cards to discard`);
          return;
        }
        discardMode = false;
        await ClientGame.endTurn(selectedDiscards);
        selectedDiscards = [];
      });
      btn.disabled = selectedDiscards.length < discardNeeded;
      bar.appendChild(btn);
    } else {
      discardMode = false;
    }
  }

  // ── Pending action UI ────────────────────────────────────────────────

  function renderPendingAction(state, myId, names) {
    const overlay = document.getElementById('action-overlay');
    const pending = state.pendingAction;

    if (!pending) {
      overlay.style.display = 'none';
      return;
    }

    // Am I involved?
    const isResponder = pending.currentResponder === myId;
    const isPayer = state.phase === 'pay' && pending.currentPayer === myId;
    const isInitiator = pending.from === myId;

    if (!isResponder && !isPayer) {
      // Show status only
      if (isInitiator) {
        overlay.style.display = 'flex';
        overlay.innerHTML = `
          <div class="action-modal">
            <h3>Waiting for Response</h3>
            <p>Waiting for ${escapeHtml(names[pending.currentResponder] || names[pending.currentPayer] || 'opponent')}...</p>
          </div>
        `;
      } else {
        overlay.style.display = 'flex';
        overlay.innerHTML = `
          <div class="action-modal">
            <h3>Action in Progress</h3>
            <p>${escapeHtml(names[pending.from] || 'Someone')} played an action...</p>
          </div>
        `;
      }
      return;
    }

    overlay.style.display = 'flex';

    // ── Respond phase (Just Say No or Accept) ──
    if (isResponder && state.phase === 'respond') {
      const myPlayer = state.players.find(p => p.id === myId);
      const hasJSN = myPlayer?.hand?.some(c => c.actionType === 'just_say_no');
      const actionDesc = describeAction(pending, names);

      let html = `
        <div class="action-modal">
          <h3>Action Against You!</h3>
          <p>${actionDesc}</p>
          <div class="action-buttons">
            <button class="btn btn-accept" onclick="UI._handleAccept()">Accept</button>
      `;

      if (hasJSN) {
        const jsnCard = myPlayer.hand.find(c => c.actionType === 'just_say_no');
        html += `<button class="btn btn-jsn" onclick="UI._handleJSN('${jsnCard.id}')">Just Say No!</button>`;
      }

      html += `</div></div>`;
      overlay.innerHTML = html;
      return;
    }

    // ── Payment phase ──
    if (isPayer && state.phase === 'pay') {
      const target = pending.targets.find(t => t.playerId === myId);
      const myPlayer = state.players.find(p => p.id === myId);
      renderPaymentUI(overlay, target.amount, myPlayer, names[pending.from]);
      return;
    }
  }

  function describeAction(pending, names) {
    const n = (id) => escapeHtml(names[id] || 'Unknown');
    switch (pending.type) {
      case 'rent': return `${n(pending.from)} charged ${pending.amount}M rent for ${COLOR_LABELS[pending.color] || pending.color}`;
      case 'debt_collector': return `${n(pending.from)} played Debt Collector — pay 5M!`;
      case 'birthday': return `${n(pending.from)} says It's My Birthday — pay 2M!`;
      case 'sly_deal': return `${n(pending.from)} wants to steal one of your properties!`;
      case 'forced_deal': return `${n(pending.from)} wants to swap properties with you!`;
      case 'deal_breaker': return `${n(pending.from)} wants to steal your complete ${COLOR_LABELS[pending.targetColor] || pending.targetColor} set!`;
      default: return `${n(pending.from)} played an action against you.`;
    }
  }

  function renderPaymentUI(overlay, amount, myPlayer, fromName) {
    selectedCards = [];
    const bankTotal = myPlayer.bank.reduce((s, c) => s + c.value, 0);
    const propTotal = myPlayer.properties.reduce((s, c) => s + c.value, 0);
    const totalAssets = bankTotal + propTotal;
    const requiredPayment = Math.min(amount, totalAssets);

    let html = `
      <div class="action-modal payment-modal">
        <h3>Payment Required: ${amount}M</h3>
        <p>Pay ${escapeHtml(fromName || 'opponent')}. Select cards to pay with (need ${requiredPayment}M).</p>
        <div class="payment-selected">Selected: <span id="payment-total">0</span>M</div>
        <div class="payment-section">
          <h4>Bank (${bankTotal}M)</h4>
          <div class="payment-cards" id="payment-bank">
    `;

    for (const card of myPlayer.bank) {
      const hasImg = getCardImagePath(card) ? ' has-card-img' : '';
      html += `<div class="card-image-mini selectable${hasImg}" data-card-id="${card.id}" data-value="${card.value}" data-source="bank" onclick="UI._togglePaymentCard(this)">${buildCardImageHtml(card)}</div>`;
    }

    html += `</div></div><div class="payment-section"><h4>Properties</h4><div class="payment-cards" id="payment-props">`;

    for (const card of myPlayer.properties) {
      const hasImg = getCardImagePath(card) ? ' has-card-img' : '';
      html += `<div class="card-image-mini selectable${hasImg}" data-card-id="${card.id}" data-value="${card.value}" data-source="property" onclick="UI._togglePaymentCard(this)">${buildCardImageHtml(card)}</div>`;
    }

    html += `
          </div>
        </div>
        <button class="btn btn-pay" id="btn-confirm-payment" onclick="UI._confirmPayment(${requiredPayment})">Confirm Payment</button>
      </div>
    `;

    overlay.innerHTML = html;
  }

  // ── Card action menu ─────────────────────────────────────────────────

  function showCardActions(card, state, player) {
    const overlay = document.getElementById('action-overlay');
    overlay.style.display = 'flex';

    let html = `<div class="action-modal card-action-modal">`;
    html += `<h3>${escapeHtml(card.name)}</h3>`;
    html += `<p class="card-detail">Value: ${card.value}M</p>`;

    html += `<div class="action-buttons">`;

    // Bank (any card)
    html += `<button class="btn btn-bank" onclick="UI._doBank('${card.id}')">Bank (${card.value}M)</button>`;

    // Property
    if (card.type === 'property') {
      html += `<button class="btn btn-property" onclick="UI._doPlayProperty('${card.id}')">Play Property</button>`;
    }

    // Wild Property
    if (card.type === 'wild_property') {
      if (card.colors[0] === 'all') {
        html += `<div class="color-picker"><p>Play as:</p>`;
        for (const color of Object.keys(COLOR_MAP)) {
          html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doPlayProperty('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
        }
        html += `</div>`;
      } else {
        for (const color of card.colors) {
          html += `<button class="btn btn-property" style="background:${COLOR_MAP[color]}" onclick="UI._doPlayProperty('${card.id}', '${color}')">Play as ${COLOR_LABELS[color]}</button>`;
        }
      }
    }

    // Action cards
    if (card.type === 'action') {
      switch (card.actionType) {
        case 'pass_go':
          html += `<button class="btn btn-action" onclick="UI._doPassGo('${card.id}')">Play: Draw 2 Cards</button>`;
          break;

        case 'rent':
        case 'multi_rent':
          const rentColors = card.actionType === 'multi_rent'
            ? Object.keys(COLOR_MAP)
            : card.rentColors;
          html += `<div class="color-picker"><p>Charge rent for:</p>`;
          for (const color of rentColors) {
            if (countPlayerColor(player, color) > 0) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doRent('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
          }
          html += `</div>`;
          break;

        case 'debt_collector':
          html += `<div class="target-picker"><p>Target player:</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            html += `<button class="btn btn-target" onclick="UI._doDebtCollector('${card.id}', '${p.id}')">${escapeHtml(name)}</button>`;
          }
          html += `</div>`;
          break;

        case 'birthday':
          html += `<button class="btn btn-action" onclick="UI._doBirthday('${card.id}')">Play: Everyone pays 2M</button>`;
          break;

        case 'sly_deal':
          html += `<div class="target-picker"><p>Steal a property from:</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            const stealable = p.properties.filter(c => !isCardInCompletedSet(p, c));
            if (stealable.length === 0) continue;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            html += `<div class="target-group"><strong>${escapeHtml(name)}</strong>`;
            for (const prop of stealable) {
              const color = prop.type === 'wild_property' ? prop.currentColor : prop.color;
              html += `<button class="btn btn-sm" style="border-left:4px solid ${COLOR_MAP[color] || '#666'}" onclick="UI._doSlyDeal('${card.id}', '${p.id}', '${prop.id}')">${escapeHtml(prop.name)}</button>`;
            }
            html += `</div>`;
          }
          html += `</div>`;
          break;

        case 'forced_deal':
          html += `<div class="target-picker"><p>Select opponent's property to take:</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            const swappable = p.properties.filter(c => !isCardInCompletedSet(p, c));
            if (swappable.length === 0) continue;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            html += `<div class="target-group"><strong>${escapeHtml(name)}</strong>`;
            for (const prop of swappable) {
              const color = prop.type === 'wild_property' ? prop.currentColor : prop.color;
              html += `<button class="btn btn-sm" style="border-left:4px solid ${COLOR_MAP[color] || '#666'}" onclick="UI._startForcedDeal('${card.id}', '${p.id}', '${prop.id}')">${escapeHtml(prop.name)}</button>`;
            }
            html += `</div>`;
          }
          html += `</div>`;
          break;

        case 'deal_breaker':
          html += `<div class="target-picker"><p>Steal complete set from:</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            const completedColors = getCompletedSetColors(p);
            for (const color of completedColors) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doDealBreaker('${card.id}', '${p.id}', '${color}')">${escapeHtml(name)}: ${COLOR_LABELS[color]}</button>`;
            }
          }
          html += `</div>`;
          break;

        case 'double_rent':
          html += `<p class="card-detail">Play this with a Rent card (auto-applied when charging rent)</p>`;
          break;

        case 'just_say_no':
          html += `<p class="card-detail">This card is played in response to actions against you.</p>`;
          break;
      }
    }

    html += `<button class="btn btn-cancel" onclick="UI._closeOverlay()">Cancel</button>`;
    html += `</div></div>`;

    overlay.innerHTML = html;
  }

  // ── Wild card color switch ──────────────────────────────────────────

  function showWildColorSwitch(card) {
    const overlay = document.getElementById('action-overlay');
    overlay.style.display = 'flex';

    const availableColors = card.colors[0] === 'all'
      ? Object.keys(COLOR_MAP)
      : card.colors;

    let html = `<div class="action-modal card-action-modal">`;
    html += `<h3>Switch Color</h3>`;
    html += `<p class="card-detail">${escapeHtml(card.name)}</p>`;
    html += `<div class="color-picker"><p>Switch to:</p>`;
    for (const color of availableColors) {
      if (color === card.currentColor) continue;
      html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doSwitchWild('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
    }
    html += `</div>`;
    html += `<button class="btn btn-cancel" onclick="UI._closeOverlay()">Cancel</button>`;
    html += `</div></div>`;

    overlay.innerHTML = html;
  }

  async function _doSwitchWild(cardId, chosenColor) {
    _closeOverlay();
    await ClientGame.moveWild(cardId, chosenColor);
  }

  // ── Action handlers ──────────────────────────────────────────────────

  function _closeOverlay() {
    document.getElementById('action-overlay').style.display = 'none';
    actionTargetMode = null;
  }

  function _getCardFromHand(cardId) {
    const state = ClientGame.getGameState();
    if (!state) return null;
    const myPlayer = state.players.find(p => p.id === ClientGame.getPlayerId());
    if (!myPlayer) return null;
    return myPlayer.hand.find(c => c.id === cardId);
  }

  function _showMyPlayedCard(cardId) {
    const card = _getCardFromHand(cardId);
    if (card) {
      const name = ClientGame.getPlayerNames()[ClientGame.getPlayerId()] || 'You';
      showPlayedCard(card, name);
    }
  }

  async function _doBank(cardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.bankCard(cardId);
  }

  async function _doPlayProperty(cardId, chosenColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playProperty(cardId, chosenColor);
  }

  async function _doPassGo(cardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playPassGo(cardId);
  }

  async function _doRent(cardId, targetColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    // TODO: support double rent selection
    await ClientGame.playRent(cardId, targetColor, null);
  }

  async function _doDebtCollector(cardId, targetId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playDebtCollector(cardId, targetId);
  }

  async function _doBirthday(cardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playBirthday(cardId);
  }

  async function _doSlyDeal(cardId, targetId, targetCardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playSlyDeal(cardId, targetId, targetCardId);
  }

  function _startForcedDeal(cardId, targetId, targetCardId) {
    // Now need to pick own property to give
    const overlay = document.getElementById('action-overlay');
    const player = ClientGame.getGameState().players.find(p => p.id === ClientGame.getPlayerId());
    const giveable = player.properties.filter(c => !isCardInCompletedSet(player, c));

    let html = `<div class="action-modal"><h3>Select your property to give:</h3><div class="target-picker">`;
    for (const prop of giveable) {
      const color = prop.type === 'wild_property' ? prop.currentColor : prop.color;
      html += `<button class="btn btn-sm" style="border-left:4px solid ${COLOR_MAP[color] || '#666'}" onclick="UI._doForcedDeal('${cardId}', '${targetId}', '${targetCardId}', '${prop.id}')">${escapeHtml(prop.name)}</button>`;
    }
    html += `<button class="btn btn-cancel" onclick="UI._closeOverlay()">Cancel</button>`;
    html += `</div></div>`;
    overlay.innerHTML = html;
  }

  async function _doForcedDeal(cardId, targetId, targetCardId, myCardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playForcedDeal(cardId, targetId, targetCardId, myCardId);
  }

  async function _doDealBreaker(cardId, targetId, targetColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playDealBreaker(cardId, targetId, targetColor);
  }

  async function _handleAccept() {
    _closeOverlay();
    await ClientGame.respondAccept();
  }

  async function _handleJSN(cardId) {
    _closeOverlay();
    await ClientGame.respondJustSayNo(cardId);
  }

  function _togglePaymentCard(el) {
    el.classList.toggle('selected');
    _updatePaymentTotal();
  }

  function _updatePaymentTotal() {
    const selected = document.querySelectorAll('.payment-modal .selectable.selected');
    let total = 0;
    selected.forEach(el => { total += parseInt(el.dataset.value) || 0; });
    const totalEl = document.getElementById('payment-total');
    if (totalEl) totalEl.textContent = total;
  }

  async function _confirmPayment(required) {
    const selected = document.querySelectorAll('.payment-modal .selectable.selected');
    let total = 0;
    const bankIds = [];
    const propIds = [];

    selected.forEach(el => {
      total += parseInt(el.dataset.value) || 0;
      if (el.dataset.source === 'bank') bankIds.push(el.dataset.cardId);
      else propIds.push(el.dataset.cardId);
    });

    if (total < required) {
      showError(`Need at least ${required}M (selected: ${total}M)`);
      return;
    }

    _closeOverlay();
    await ClientGame.makePayment(bankIds, propIds);
  }

  // ── Discard handling ─────────────────────────────────────────────────

  function toggleDiscardSelect(cardId, el) {
    const idx = selectedDiscards.indexOf(cardId);
    if (idx === -1) {
      selectedDiscards.push(cardId);
      el.classList.add('selected');
    } else {
      selectedDiscards.splice(idx, 1);
      el.classList.remove('selected');
    }
    // Re-render action bar to update count
    const state = ClientGame.getGameState();
    renderActionBar(state, ClientGame.getPlayerId());
  }

  function showDiscardPrompt(excess) {
    discardMode = true;
    discardNeeded = excess;
    selectedDiscards = [];
    const state = ClientGame.getGameState();
    const player = state.players.find(p => p.id === ClientGame.getPlayerId());
    renderMyHand(player, state, true);
    renderActionBar(state, ClientGame.getPlayerId());
  }

  // ── Card image path mapping ──────────────────────────────────────────

  const CARD_IMAGE_MAP = {
    // Property cards (by name)
    'Mediterranean Ave': 'mediterranean.png',
    'Baltic Ave': 'baltic.png',
    'Park Place': 'park-place.png',
    'Boardwalk': 'boardwalk.png',
    'Oriental Ave': 'oriental.png',
    'Vermont Ave': 'vermont.png',
    'Connecticut Ave': 'connecticut.png',
    'St. Charles Place': 'st-charles.png',
    'Virginia Ave': 'virginia.png',
    'States Ave': 'states.png',
    'St. James Place': 'st-james.png',
    'Tennessee Ave': 'tennessee.png',
    'New York Ave': 'new-york.png',
    'Kentucky Ave': 'kentucky.png',
    'Indiana Ave': 'indiana.png',
    'Illinois Ave': 'illinois.png',
    'Atlantic Ave': 'atlantic.png',
    'Ventnor Ave': 'ventnor.png',
    'Marvin Gardens': 'marvin-gardens.png',
    'Pacific Ave': 'pacific.png',
    'North Carolina Ave': 'north-carolina.png',
    'Pennsylvania Ave': 'pennsylvania.png',
    'Reading Railroad': 'reading.png',
    'Pennsylvania Railroad': 'pennsylvania-railrod.png',
    'B&O Railroad': 'b-and-o.png',
    'Short Line': 'short-line.png',
    'Electric Company': 'electric.png',
    'Water Works': 'water.png',
    // Wild property cards
    'Wild: Brown/Light Blue': 'wildcard-light-blue-and-brown.png',
    'Wild: Dark Blue/Green': 'wildcard-dark-blue-and-green.png',
    'Wild: Light Blue/Railroad': 'wildcard-light-blue-and-black.png',
    'Wild: Pink/Orange': 'wildcard-orange-and-pink.png',
    'Wild: Railroad/Utility': 'wildcard-utility-and-black.png',
    'Wild: Railroad/Green': 'wildcard-green-and-black.png',
    'Wild: Red/Yellow': 'wildcard-yellow-and-red.png',
    'Wild Property': 'wildcard-all-colours.png',
    // Action cards
    'Pass Go': 'pass-go.png',
    'Debt Collector': 'debt-collector.png',
    "It's My Birthday": 'birthday.png',
    'Double The Rent': 'double-rent.png',
    'Sly Deal': 'sly-deal.png',
    'Forced Deal': 'forced-deal.png',
    'Deal Breaker': 'deal-breaker.png',
    'Just Say No': 'say-no.png',
    // Rent cards
    'Rent: Brown/Lightblue': 'rent-brown-and-light-blue.png',
    'Rent: Pink/Orange': 'rent-pink-and-orange.png',
    'Rent: Red/Yellow': 'rent-red-and-yellow.png',
    'Rent: Darkblue/Green': 'rent-dark-blue-and-green.png',
    'Rent: Railroad/Utility': 'rent-black-and-utility.png',
    'Multi Rent (Wild)': 'rent-all-colours.png',
  };

  const RENT_COLOR_IMAGE_MAP = {
    'brown,lightblue': 'rent-brown-and-light-blue.png',
    'pink,orange': 'rent-pink-and-orange.png',
    'red,yellow': 'rent-red-and-yellow.png',
    'darkblue,green': 'rent-dark-blue-and-green.png',
    'railroad,utility': 'rent-black-and-utility.png',
  };

  function getCardImagePath(card) {
    if (!card || !card.name) return null;
    // Check direct name match
    if (CARD_IMAGE_MAP[card.name]) return 'assets/cards/' + CARD_IMAGE_MAP[card.name];
    // Money cards by value
    if (card.type === 'money') return 'assets/cards/cash-' + card.value + 'M.png';
    // Rent cards by rentColors
    if (card.actionType === 'rent' && card.rentColors) {
      const key = card.rentColors.join(',');
      if (RENT_COLOR_IMAGE_MAP[key]) return 'assets/cards/' + RENT_COLOR_IMAGE_MAP[key];
    }
    return null;
  }

  // ── Card element creation ────────────────────────────────────────────

  function createCardElement(card, interactive) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cardId = card.id;

    const imgPath = getCardImagePath(card);
    if (imgPath) {
      el.classList.add('card-has-image');
      el.innerHTML = `<img class="card-img" src="${imgPath}" alt="${escapeHtml(card.name)}" draggable="false">`;
    } else if (card.type === 'property') {
      el.classList.add('card-property');
      el.style.borderColor = COLOR_MAP[card.color] || '#666';
      el.style.borderTopColor = COLOR_MAP[card.color] || '#666';
      el.innerHTML = `
        <div class="card-color-bar" style="background:${COLOR_MAP[card.color]}"></div>
        <div class="card-name">${escapeHtml(card.name)}</div>
        <div class="card-value">${card.value}M</div>
      `;
    } else if (card.type === 'wild_property') {
      el.classList.add('card-wild');
      const colors = card.colors[0] === 'all'
        ? 'linear-gradient(135deg, #ff0, #f0f, #0ff, #0f0)'
        : `linear-gradient(135deg, ${COLOR_MAP[card.colors[0]]}, ${COLOR_MAP[card.colors[1]]})`;
      el.innerHTML = `
        <div class="card-color-bar" style="background:${colors}"></div>
        <div class="card-name">${escapeHtml(card.name)}</div>
        <div class="card-value">${card.value}M</div>
      `;
    } else if (card.type === 'money') {
      el.classList.add('card-money');
      el.innerHTML = `
        <div class="card-color-bar" style="background:#2ecc71"></div>
        <div class="card-name">${card.value}M</div>
        <div class="card-value">Money</div>
      `;
    } else if (card.type === 'action') {
      el.classList.add('card-action');
      let actionColor = '#e67e22';
      if (card.actionType === 'just_say_no') actionColor = '#e74c3c';
      if (card.actionType === 'rent' || card.actionType === 'multi_rent') actionColor = '#3498db';
      if (card.actionType === 'deal_breaker') actionColor = '#9b59b6';
      el.innerHTML = `
        <div class="card-color-bar" style="background:${actionColor}"></div>
        <div class="card-name">${escapeHtml(card.name)}</div>
        <div class="card-value">${card.value}M</div>
      `;
    }

    if (interactive) {
      el.classList.add('interactive');
    }

    return el;
  }

  function createPropertyCardElement(card) {
    const el = document.createElement('div');
    el.className = 'card-image-mini';
    if (getCardImagePath(card)) el.classList.add('has-card-img');
    el.dataset.cardId = card.id;
    el.innerHTML = buildCardImageHtml(card);
    return el;
  }

  function createMiniPropertyCard(card) {
    const hasImg = getCardImagePath(card) ? ' has-card-img' : '';
    return `<div class="card-image-tiny${hasImg}">${buildCardImageHtml(card)}</div>`;
  }

  function buildCardImageHtml(card) {
    const imgPath = getCardImagePath(card);
    if (imgPath) {
      return `<img class="card-img" src="${imgPath}" alt="${escapeHtml(card.name)}" draggable="false">`;
    }
    if (card.type === 'property') {
      return `
        <div class="card-img-bar" style="background:${COLOR_MAP[card.color] || '#666'}"></div>
        <div class="card-img-name">${escapeHtml(card.name)}</div>
        <div class="card-img-value">${card.value}M</div>
      `;
    } else if (card.type === 'wild_property') {
      const color = card.currentColor || card.colors[0];
      const barBg = card.colors[0] === 'all'
        ? 'linear-gradient(135deg, #ff0, #f0f, #0ff, #0f0)'
        : `linear-gradient(135deg, ${COLOR_MAP[card.colors[0]]}, ${COLOR_MAP[card.colors[1]]})`;
      return `
        <div class="card-img-bar" style="background:${barBg}"></div>
        <div class="card-img-name">${escapeHtml(card.name)}</div>
        <div class="card-img-value">${card.value}M</div>
      `;
    } else if (card.type === 'money') {
      return `
        <div class="card-img-bar" style="background:#2ecc71"></div>
        <div class="card-img-name">${card.value}M</div>
        <div class="card-img-value">Money</div>
      `;
    } else if (card.type === 'action') {
      let actionColor = '#e67e22';
      if (card.actionType === 'just_say_no') actionColor = '#e74c3c';
      if (card.actionType === 'rent' || card.actionType === 'multi_rent') actionColor = '#3498db';
      if (card.actionType === 'deal_breaker') actionColor = '#9b59b6';
      return `
        <div class="card-img-bar" style="background:${actionColor}"></div>
        <div class="card-img-name">${escapeHtml(card.name)}</div>
        <div class="card-img-value">${card.value}M</div>
      `;
    }
    return `<div class="card-img-name">${escapeHtml(card.name || '?')}</div>`;
  }

  // ── Helper functions ─────────────────────────────────────────────────

  function groupProperties(properties) {
    const groups = {};
    for (const card of properties) {
      const color = card.type === 'wild_property' ? card.currentColor : card.color;
      if (!groups[color]) groups[color] = [];
      groups[color].push(card);
    }
    return groups;
  }

  function getSetRequirement(color) {
    const reqs = {
      brown: 2, darkblue: 2, lightblue: 3, pink: 3, orange: 3,
      red: 3, yellow: 3, green: 3, railroad: 4, utility: 2,
    };
    return reqs[color] || 3;
  }

  function countPlayerColor(player, color) {
    let count = 0;
    for (const c of player.properties) {
      if (c.type === 'property' && c.color === color) count++;
      if (c.type === 'wild_property' && c.currentColor === color) count++;
    }
    return count;
  }

  function countCompletedSets(player) {
    let count = 0;
    for (const color of Object.keys(COLOR_MAP)) {
      const req = getSetRequirement(color);
      if (countPlayerColor(player, color) >= req) count++;
    }
    return count;
  }

  function getCompletedSetColors(player) {
    const colors = [];
    for (const color of Object.keys(COLOR_MAP)) {
      const req = getSetRequirement(color);
      if (countPlayerColor(player, color) >= req) colors.push(color);
    }
    return colors;
  }

  function isCardInCompletedSet(player, card) {
    const color = card.type === 'wild_property' ? card.currentColor : card.color;
    return countPlayerColor(player, color) >= getSetRequirement(color);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function createButton(text, className, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── Notifications ────────────────────────────────────────────────────

  function showError(msg) {
    showToast(msg, 'error');
  }

  function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function showLoading(visible) {
    document.getElementById('loading-overlay').style.display = visible ? 'flex' : 'none';
  }

  function showDrawnCards(cards) {
    // Brief animation showing drawn cards
    showToast(`Drew ${cards.length} card(s)`);
  }

  function showPlayedCard(card, playerName) {
    const container = document.getElementById('played-card-display');

    // Track last action card played (only action type, not property or money)
    if (card && card.type === 'action') {
      lastActionCard = card;
      renderDeckAndDiscard(ClientGame.getGameState());
    }

    // Cancel any pending timeouts from a previous card display
    if (playedCardFadeTimeout) clearTimeout(playedCardFadeTimeout);
    if (playedCardCleanTimeout) clearTimeout(playedCardCleanTimeout);

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'played-card-wrapper';

    const cardEl = createCardElement(card, false);
    wrapper.appendChild(cardEl);

    if (playerName) {
      const label = document.createElement('div');
      label.className = 'played-card-label';
      label.textContent = `${playerName} played`;
      wrapper.appendChild(label);
    }

    container.appendChild(wrapper);

    // Start fade-out after a delay, then remove
    playedCardFadeTimeout = setTimeout(() => {
      wrapper.classList.add('fade-out');
      playedCardCleanTimeout = setTimeout(() => { container.innerHTML = ''; }, 500);
    }, 1200);
  }

  function showWinner(winnerId, names) {
    const overlay = document.getElementById('action-overlay');
    overlay.style.display = 'flex';
    const name = names[winnerId] || 'Unknown';
    const isMe = winnerId === ClientGame.getPlayerId();
    overlay.innerHTML = `
      <div class="action-modal winner-modal">
        <h2>${isMe ? 'YOU WIN!' : escapeHtml(name) + ' Wins!'}</h2>
        <p>${isMe ? 'Congratulations! You completed 3 property sets!' : escapeHtml(name) + ' completed 3 property sets.'}</p>
        <button class="btn btn-primary" onclick="location.reload()">Play Again</button>
      </div>
    `;
  }

  // ── Init ─────────────────────────────────────────────────────────────

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    initLoginHandlers();
    initLobbyHandlers();
  }

  return {
    init, showScreen, showLoginScreen, showLobbyScreen, showGameScreen,
    updateLobby, renderGame, showError, showToast, showLoading,
    showDrawnCards, showDiscardPrompt, showWinner, showPlayedCard,
    // Exposed for onclick handlers in HTML
    _closeOverlay, _doBank, _doPlayProperty, _doPassGo, _doRent,
    _doDebtCollector, _doBirthday, _doSlyDeal, _startForcedDeal,
    _doForcedDeal, _doDealBreaker, _handleAccept, _handleJSN,
    _togglePaymentCard, _confirmPayment, _doSwitchWild,
  };
})();
