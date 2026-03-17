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

  // ── Turn timer (online play only) ──────────────────────────────────
  const TIMER_DURATION = 30; // seconds per move
  const TIMER_CIRCUMFERENCE = 2 * Math.PI * 26; // matches SVG circle r=26
  let timerInterval = null;
  let timerSecondsLeft = TIMER_DURATION;
  let timerActive = false;

  function startTimer(state, myId) {
    stopTimer();

    // Only run timer in online play and when it's my turn
    if (ClientGame.isComputerGame()) {
      hideTimer();
      return;
    }

    const isMyTurn = state.currentPlayer === myId;
    const phase = state.phase;

    // Only show timer for actionable phases on my turn
    if (!isMyTurn || (phase !== 'draw' && phase !== 'play' && phase !== 'discard')) {
      hideTimer();
      return;
    }

    timerSecondsLeft = TIMER_DURATION;
    timerActive = true;
    showTimer();
    updateTimerDisplay();

    timerInterval = setInterval(() => {
      timerSecondsLeft--;
      updateTimerDisplay();

      if (timerSecondsLeft <= 0) {
        stopTimer();
        handleTimerExpired(phase);
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    timerActive = false;
  }

  function showTimer() {
    const el = document.getElementById('turn-timer');
    if (el) el.style.display = 'flex';
  }

  function hideTimer() {
    const el = document.getElementById('turn-timer');
    if (el) el.style.display = 'none';
    stopTimer();
  }

  function updateTimerDisplay() {
    const textEl = document.getElementById('timer-text');
    const progressEl = document.querySelector('.timer-ring-progress');
    const containerEl = document.getElementById('turn-timer');
    if (!textEl || !progressEl || !containerEl) return;

    const secs = Math.max(0, timerSecondsLeft);
    textEl.textContent = '0:' + String(secs).padStart(2, '0');

    // Update circular progress
    const fraction = secs / TIMER_DURATION;
    const offset = TIMER_CIRCUMFERENCE * (1 - fraction);
    progressEl.style.strokeDashoffset = offset;

    // Color states
    containerEl.classList.remove('warning', 'critical');
    if (secs <= 5) {
      containerEl.classList.add('critical');
    } else if (secs <= 10) {
      containerEl.classList.add('warning');
    }
  }

  async function handleTimerExpired(phase) {
    if (phase === 'draw') {
      // Auto-draw cards
      await ClientGame.drawCards();
    } else if (phase === 'play' || phase === 'discard') {
      // Auto-end turn (for discard, end without discarding will re-prompt or server handles it)
      if (phase === 'discard') {
        // Select random cards to discard if needed
        const state = ClientGame.getGameState();
        const myId = ClientGame.getPlayerId();
        if (state) {
          const player = state.players.find(p => p.id === myId);
          if (player) {
            const excess = player.hand.length - 7;
            if (excess > 0) {
              const discardIds = player.hand.slice(0, excess).map(c => c.id);
              await ClientGame.endTurn(discardIds);
              return;
            }
          }
        }
      }
      await ClientGame.endTurn();
    }
  }

  // ── Screen management ────────────────────────────────────────────────

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  function showLoginScreen() { showScreen('login-screen'); }
  function showLobbyScreen() { showScreen('lobby-screen'); }
  function showGameScreen() { showScreen('game-screen'); }

  function exitGame() {
    if (!confirm('Are you sure you want to exit the game?')) return;
    ClientGame.clearActiveSession();
    SupabaseClient.unsubscribeAll();
    // Hide game-specific panels
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) chatPanel.classList.remove('active');
    const exitBtn = document.getElementById('exit-game-btn');
    if (exitBtn) exitBtn.classList.remove('active');
    showLoginScreen();
  }

  // ── Login screen ─────────────────────────────────────────────────────

  function initLoginHandlers() {
    // Game mode toggle
    document.querySelectorAll('.game-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.game-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        ClientGame.setGameMode(mode);
        if (mode === 'nomercy') {
          document.body.classList.add('nomercy-mode');
        } else {
          document.body.classList.remove('nomercy-mode');
        }
      });
    });

    // Public/Private toggle
    const toggleInput = document.getElementById('toggle-public-input');
    const toggleLabel = document.getElementById('toggle-label');
    toggleInput.addEventListener('change', () => {
      toggleLabel.textContent = toggleInput.checked ? 'Public' : 'Private';
    });

    document.getElementById('btn-create-room').addEventListener('click', async () => {
      const name = document.getElementById('input-username').value.trim();
      if (!name) return showError('Enter a username');
      const isPublic = toggleInput.checked;
      try {
        showLoading(true);
        const data = await ClientGame.createRoom(name, isPublic);
        updateLobbyRoomCodeVisibility(isPublic, data.roomCode);
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
        updateLobbyRoomCodeVisibility(false, data.roomCode);
        showLobbyScreen();
        await ClientGame.refreshRoomPlayers();
      } catch (err) {
        showError(err.message);
      } finally {
        showLoading(false);
      }
    });

    // Refresh public games list
    document.getElementById('btn-refresh-public').addEventListener('click', () => {
      refreshPublicGames();
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

    // Load public games and player count on init
    refreshPublicGames();
    refreshOnlinePlayerCount();
    setInterval(refreshOnlinePlayerCount, 15000);
  }

  async function refreshOnlinePlayerCount() {
    try {
      const count = await SupabaseClient.getOnlinePlayerCount();
      const el = document.getElementById('online-player-count');
      if (el) el.textContent = count + ' Player' + (count !== 1 ? 's' : '') + ' Online';
    } catch (err) {
      console.error('Failed to refresh online player count:', err);
    }
  }

  function updateLobbyRoomCodeVisibility(isPublic, roomCode) {
    const codeSection = document.getElementById('lobby-room-code-section');
    const publicBadge = document.getElementById('lobby-public-badge');
    if (isPublic) {
      codeSection.style.display = 'none';
      publicBadge.style.display = 'block';
    } else {
      codeSection.style.display = 'block';
      publicBadge.style.display = 'none';
      document.getElementById('lobby-room-code').textContent = roomCode;
    }
  }

  async function refreshPublicGames() {
    const listEl = document.getElementById('public-games-list');
    if (!listEl) return;
    try {
      const rooms = await SupabaseClient.getPublicRooms();
      if (!rooms || rooms.length === 0) {
        listEl.innerHTML = '<div class="public-games-empty">No public games available</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const room of rooms) {
        const players = room.room_players || [];
        const playerNames = players.map(p => p.players?.username || 'Unknown');
        const div = document.createElement('div');
        div.className = 'public-game-item';
        div.innerHTML = `
          <div class="public-game-info">
            <div class="public-game-players-count">${players.length}/4 Players</div>
            <div class="public-game-player-names">${playerNames.map(n => escapeHtml(n)).join(', ')}</div>
          </div>
          <button class="btn btn-join btn-join-public" data-room-code="${room.room_code}">Join</button>
        `;
        div.querySelector('.btn-join-public').addEventListener('click', async () => {
          const name = document.getElementById('input-username').value.trim();
          if (!name) return showError('Enter a username');
          try {
            showLoading(true);
            const data = await ClientGame.joinPublicRoom(name, room.room_code);
            updateLobbyRoomCodeVisibility(true, data.roomCode);
            showLobbyScreen();
            await ClientGame.refreshRoomPlayers();
          } catch (err) {
            showError(err.message);
          } finally {
            showLoading(false);
          }
        });
        listEl.appendChild(div);
      }
    } catch (err) {
      listEl.innerHTML = '<div class="public-games-empty">Failed to load public games</div>';
    }
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

  function renderGame(state, myId, names, options) {
    if (!state || !state.players) return;

    const myPlayer = state.players.find(p => p.id === myId);
    const opponents = state.players.filter(p => p.id !== myId);

    // Render opponents in seats
    renderOpponents(opponents, names, state);

    // Render my hand (only animate on draw)
    const animateHand = options && options.animateHand;
    renderMyHand(myPlayer, state, false, animateHand);

    // Render my properties
    renderMyProperties(myPlayer, state, myId);

    // Render my bank
    renderMyBank(myPlayer);

    // Render game info
    renderGameInfo(state, myId, names);

    // Render game log
    renderGameLog(state.log, names);

    // Show chat panel
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) {
      chatPanel.classList.add('active');
    }

    // Show exit game button
    const exitBtn = document.getElementById('exit-game-btn');
    if (exitBtn) {
      exitBtn.classList.add('active');
    }

    // Render deck and last action card in center
    renderDeckAndDiscard(state);

    // Render action bar (draw / end turn / etc)
    renderActionBar(state, myId);

    // Render pending action UI
    renderPendingAction(state, myId, names);

    // Start/restart turn timer (online play only)
    startTimer(state, myId);

    // Check winner
    if (state.phase === 'finished' && state.winner) {
      hideTimer();
      showWinner(state.winner, names);
    }
  }

  function renderOpponents(opponents, names, state) {
    const positions = ['left', 'top', 'right', 'top-left']; // clockwise: main → left → top → right
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

      const pos = positions[i];
      const isSide = (pos === 'left' || pos === 'right');

      // Group properties by color
      const propGroups = groupProperties(opp.properties);

      let propsHtml = '';
      // Build stacked property groups (cards of same colour overlap vertically)
      function buildStackedPropGroup(color, cards) {
        const stackHeight = 8 + 58 + (cards.length - 1) * 15; // 6px label + 2px gap + card height + stacking offsets
        let html = `<div class="prop-group prop-group--stacked" style="height:${stackHeight}px">`;
        html += `<div class="prop-group-label" style="background:${COLOR_MAP[color] || '#666'}"></div>`;
        for (let ci = 0; ci < cards.length; ci++) {
          html += createMiniPropertyCard(cards[ci], ci);
        }
        html += `</div>`;
        return html;
      }

      if (isSide) {
        const propGroupEntries = Object.entries(propGroups);
        // Split into two rows of up to 5 colour groups each
        const row1Entries = propGroupEntries.slice(0, 5);
        const row2Entries = propGroupEntries.slice(5, 10);

        let propsRow1Html = '';
        for (const [color, cards] of row1Entries) {
          propsRow1Html += buildStackedPropGroup(color, cards);
        }
        let propsRow2Html = '';
        for (const [color, cards] of row2Entries) {
          propsRow2Html += buildStackedPropGroup(color, cards);
        }

        propsHtml = `<div class="opponent-props-row"><div class="opponent-properties">${propsRow1Html}</div></div>`;
        if (propsRow2Html) {
          propsHtml += `<div class="opponent-props-row"><div class="opponent-properties">${propsRow2Html}</div></div>`;
        }
      } else {
        // Top/across opponents: single row of stacked property groups
        for (const [color, cards] of Object.entries(propGroups)) {
          propsHtml += buildStackedPropGroup(color, cards);
        }
      }

      const bankHtml = opp.bank.map(c => {
        const hasImg = getCardImagePath(c) ? ' has-card-img' : '';
        return `<div class="card-image-tiny${hasImg}">${buildCardImageHtml(c)}</div>`;
      }).join('');

      const cashColHtml = `<div class="opponent-cash-col">
              <div class="opponent-row-label">Cash</div>
              <div class="opponent-bank">${bankHtml}</div>
            </div>`;
      const propsColHtml = `<div class="opponent-props-col">
              <div class="opponent-row-label">Properties</div>
              ${propsHtml}
            </div>`;

      const cardAreaHtml = isSide
        ? (pos === 'left'
          ? `<div class="opponent-card-area opponent-card-area--side">
              ${cashColHtml}${propsColHtml}
            </div>`
          : `<div class="opponent-card-area opponent-card-area--side">
              ${propsColHtml}${cashColHtml}
            </div>`)
        : `<div class="opponent-card-area opponent-card-area--rows">
            <div class="opponent-row opponent-row--cash">
              <div class="opponent-row-label">Cash</div>
              <div class="opponent-bank">${bankHtml}</div>
            </div>
            <div class="opponent-row opponent-row--properties">
              <div class="opponent-row-label">Properties</div>
              <div class="opponent-properties">${propsHtml}</div>
            </div>
          </div>`;

      el.innerHTML = `
        <div class="opponent-header${state.currentPlayer === opp.id ? ' active-turn' : ''}">
          <div class="opponent-avatar">
            <div class="avatar-circle">${name.charAt(0).toUpperCase()}</div>
          </div>
          <div class="opponent-info">
            <div class="opponent-name">${escapeHtml(name)}</div>
            <div class="opponent-stats">
              ${isSide ? `<span class="stat">Cards: ${cardCount}</span>` : ''}
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

  function renderMyHand(player, state, forceRender, animate) {
    const container = document.getElementById('my-hand');

    if (!player || !player.hand) {
      container.innerHTML = '';
      lastRenderedHandIds = null;
      return;
    }

    // Check if the hand cards or interactive state have actually changed
    const currentIds = player.hand.filter(c => c.type !== 'hidden').map(c => c.id).join(',')
      + '|' + state.phase + '|' + state.turnPlaysRemaining + '|' + state.currentPlayer;
    if (!forceRender && lastRenderedHandIds === currentIds && !discardMode) {
      return; // hand hasn't changed, skip re-render
    }
    lastRenderedHandIds = currentIds;

    container.innerHTML = '';

    player.hand.forEach((card, i) => {
      if (card.type === 'hidden') return;
      const el = createCardElement(card, true);
      if (animate) {
        el.style.animationDelay = (i * 0.05) + 's';
        el.classList.add('hand-card');
      }

      if (discardMode) {
        el.addEventListener('click', () => toggleDiscardSelect(card.id, el));
        if (selectedDiscards.includes(card.id)) {
          el.classList.add('selected');
        }
      } else if (state.currentPlayer === player.id && state.phase === 'play' && state.turnPlaysRemaining > 0) {
        if (card.type === 'money') {
          el.addEventListener('click', () => _doBank(card.id));
        } else if (card.type === 'property') {
          el.addEventListener('click', () => _doPlayProperty(card.id));
        } else {
          el.addEventListener('click', () => showCardActions(card, state, player));
        }
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
      label.style.background = COLOR_MAP[color] || '#666';
      groupEl.appendChild(label);

      // Separate property cards from house/hotel cards
      const propCards = cards.filter(c => c.actionType !== 'house' && c.actionType !== 'hotel');
      const upgradeCards = cards.filter(c => c.actionType === 'house' || c.actionType === 'hotel');

      const cardsRow = document.createElement('div');
      cardsRow.className = 'my-prop-cards my-prop-cards--stacked';
      // Calculate height: first card full height (58px) + 25% offset per additional card
      const cardHeight = 58;
      const stackOffset = Math.round(cardHeight * 0.25); // ~14-15px
      const totalCards = propCards.length + upgradeCards.length;
      if (totalCards > 0) {
        const stackHeight = cardHeight + (totalCards - 1) * stackOffset;
        cardsRow.style.height = stackHeight + 'px';
      }

      // Render property cards stacked
      let stackIndex = 0;
      for (const card of propCards) {
        const el = createPropertyCardElement(card);
        // Position for stacking
        el.style.position = 'absolute';
        el.style.top = (stackIndex * stackOffset) + 'px';
        el.style.left = '0';
        el.style.zIndex = stackIndex;

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
        stackIndex++;
      }

      // Render house/hotel cards stacked on top of properties
      for (const card of upgradeCards) {
        const el = createPropertyCardElement(card);
        el.style.position = 'absolute';
        el.style.top = (stackIndex * stackOffset) + 'px';
        el.style.left = '0';
        el.style.zIndex = stackIndex;

        if (actionTargetMode === 'select_my_property') {
          el.classList.add('selectable');
          el.addEventListener('click', () => {
            if (typeof actionTargetMode._callback === 'function') {
              actionTargetMode._callback(card.id);
            }
          });
        }
        cardsRow.appendChild(el);
        stackIndex++;
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
      case 'play_house_hotel': return `${n(entry.player)} played ${entry.card} on ${COLOR_LABELS[entry.color] || entry.color}`;
      case 'discard': return `${n(entry.player)} discarded ${entry.count} cards`;
      case 'end_turn': return `${n(entry.player)} ended their turn`;
      case 'win': return `🏆 ${n(entry.player)} WINS! 🏆`;
      case 'move_wild': return `${n(entry.player)} moved ${entry.card} to ${COLOR_LABELS[entry.color] || entry.color}`;
      // No Mercy log types
      case 'play_shack': return `${n(entry.player)} placed a Shack on ${COLOR_LABELS[entry.color] || entry.color} (+5M rent)`;
      case 'nm_pass_go': return `${n(entry.player)} played Pass Go, drew until 7 in hand`;
      case 'nm_rent': return `${n(entry.player)} charged ${entry.amount}M rent for ${COLOR_LABELS[entry.color] || entry.color} (all opponents)${entry.doubled ? ' (doubled!)' : ''}`;
      case 'super_sly_deal': return `${n(entry.player)} played Super Sly Deal — stealing all ${COLOR_LABELS[entry.color] || entry.color} from everyone!`;
      case 'repossession': return `${n(entry.player)} played Repossession on ${n(entry.target)}`;
      case 'tough_luck': return `${n(entry.player)} played Tough Luck on ${n(entry.target)} — stealing all ${entry.cardType} cards`;
      case 'yoink': return `${n(entry.player)} played Yoink on ${n(entry.target)} — stealing 10M!`;
      case 'unfair_trade': return `${n(entry.player)} played Unfair Trade — swapped banks with ${n(entry.target)}!`;
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
        const waitTitle = describeActionTitle(pending);
        overlay.innerHTML = `
          <div class="action-modal">
            <h3>${waitTitle} — Waiting</h3>
            <p>Waiting for ${escapeHtml(names[pending.currentResponder] || names[pending.currentPayer] || 'opponent')}...</p>
          </div>
        `;
      } else {
        overlay.style.display = 'flex';
        const actionTitle = describeActionTitle(pending);
        const actionDetail = describeActionSummary(pending, names);
        overlay.innerHTML = `
          <div class="action-modal">
            <h3>${actionTitle}</h3>
            <p>${actionDetail}</p>
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

      // Check if this is a Just Say No response (someone played JSN)
      const isJsnResponse = !!pending.lastJsnPlayer;
      let title, description;
      if (isJsnResponse) {
        const jsnPlayerName = escapeHtml(names[pending.lastJsnPlayer] || 'Opponent');
        title = `${jsnPlayerName} used Just Say No!`;
        description = `Your action has been blocked.`;
      } else {
        title = 'Action Against You!';
        description = describeAction(pending, names);
      }

      let html = `
        <div class="action-modal">
          <h3>${title}</h3>
          <p>${description}</p>
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
      case 'nm_rent': return `${n(pending.from)} charged ${pending.amount}M rent for ${COLOR_LABELS[pending.color] || pending.color} (all opponents)`;
      case 'super_sly_deal': return `${n(pending.from)} is stealing all your ${COLOR_LABELS[pending.targetColor] || pending.targetColor} properties!`;
      case 'repossession': return `${n(pending.from)} played Repossession — you must give up all but 1 property!`;
      case 'tough_luck': return `${n(pending.from)} played Tough Luck — stealing all ${pending.cardType || 'selected'} cards from your hand!`;
      case 'yoink': return `${n(pending.from)} played Yoink — stealing 10M from your bank!`;
      case 'unfair_trade': return `${n(pending.from)} played Unfair Trade — swapping banks with you!`;
      default: return `${n(pending.from)} played an action against you.`;
    }
  }

  function describeActionTitle(pending) {
    switch (pending.type) {
      case 'rent': return pending.doubled ? 'Double Rent!' : 'Rent';
      case 'debt_collector': return 'Debt Collector';
      case 'birthday': return "It's My Birthday";
      case 'sly_deal': return 'Sly Deal';
      case 'forced_deal': return 'Forced Deal';
      case 'deal_breaker': return 'Deal Breaker';
      case 'nm_rent': return pending.doubled ? 'Double Rent!' : 'Rent (All)';
      case 'super_sly_deal': return 'Super Sly Deal';
      case 'repossession': return 'Repossession';
      case 'tough_luck': return 'Tough Luck';
      case 'yoink': return 'Yoink!';
      case 'unfair_trade': return 'Unfair Trade';
      default: return 'Action in Progress';
    }
  }

  function describeActionSummary(pending, names) {
    const n = (id) => escapeHtml(names[id] || 'Someone');
    switch (pending.type) {
      case 'rent': return `${n(pending.from)} charged ${pending.amount}M rent for ${COLOR_LABELS[pending.color] || pending.color}${pending.doubled ? ' (doubled!)' : ''}`;
      case 'debt_collector': return `${n(pending.from)} played Debt Collector — collecting 5M`;
      case 'birthday': return `${n(pending.from)} played It's My Birthday — collecting 2M from everyone`;
      case 'sly_deal': return `${n(pending.from)} is stealing a property`;
      case 'forced_deal': return `${n(pending.from)} is swapping properties`;
      case 'deal_breaker': return `${n(pending.from)} is stealing a complete ${COLOR_LABELS[pending.targetColor] || pending.targetColor} set`;
      case 'nm_rent': return `${n(pending.from)} charged ${pending.amount}M rent for ${COLOR_LABELS[pending.color] || pending.color} (all opponents)${pending.doubled ? ' (doubled!)' : ''}`;
      case 'super_sly_deal': return `${n(pending.from)} is stealing all ${COLOR_LABELS[pending.targetColor] || pending.targetColor} properties from everyone`;
      case 'repossession': return `${n(pending.from)} played Repossession — target must give up all but 1 property`;
      case 'tough_luck': return `${n(pending.from)} is stealing all ${pending.cardType || 'selected'} cards from a player's hand`;
      case 'yoink': return `${n(pending.from)} is stealing 10M from a player's bank`;
      case 'unfair_trade': return `${n(pending.from)} is swapping banks with another player`;
      default: return `${n(pending.from)} played an action`;
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

    // Bank (any card except properties)
    if (card.type !== 'property' && card.type !== 'wild_property') {
      html += `<button class="btn btn-bank" onclick="UI._doBank('${card.id}')">Bank (${card.value}M)</button>`;
    }

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

        case 'rent': {
          const doubleRentCard = player.hand.find(c => c.actionType === 'double_rent');
          const canDouble = doubleRentCard && state.turnPlaysRemaining >= 2;
          html += `<div class="color-picker"><p>Charge rent for:</p>`;
          for (const color of card.rentColors) {
            if (countPlayerColor(player, color) > 0) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doRent('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
          }
          html += `</div>`;
          if (canDouble) {
            html += `<div class="double-rent-option"><label><input type="checkbox" id="double-rent-check" data-double-id="${doubleRentCard.id}"> Double The Rent! (uses 2 plays)</label></div>`;
          }
          break;
        }

        case 'multi_rent': {
          const doubleRentCardMR = player.hand.find(c => c.actionType === 'double_rent');
          const canDoubleMR = doubleRentCardMR && state.turnPlaysRemaining >= 2;
          html += `<div class="color-picker"><p>Charge rent for:</p>`;
          for (const color of Object.keys(COLOR_MAP)) {
            if (countPlayerColor(player, color) > 0) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._showMultiRentTargetPicker('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
          }
          html += `</div>`;
          if (canDoubleMR) {
            html += `<div class="double-rent-option"><label><input type="checkbox" id="double-rent-check" data-double-id="${doubleRentCardMR.id}"> Double The Rent! (uses 2 plays)</label></div>`;
          }
          break;
        }

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
          if (_isNoMercyMode()) {
            html += `<div class="color-picker"><p>Charge double rent for (all opponents):</p>`;
            for (const color of Object.keys(COLOR_MAP)) {
              if (countPlayerColor(player, color) > 0) {
                html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doDoubleRentAlone('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
              }
            }
            html += `</div>`;
          } else {
            html += `<p class="card-detail">Play this with a Rent card (auto-applied when charging rent)</p>`;
          }
          break;

        case 'just_say_no':
          html += `<p class="card-detail">This card is played in response to actions against you.</p>`;
          break;

        case 'house':
        case 'hotel': {
          const completedColors = getCompletedSetColors(player).filter(c => c !== 'railroad' && c !== 'utility');
          if (completedColors.length > 0) {
            html += `<div class="color-picker"><p>Add to complete set:</p>`;
            for (const color of completedColors) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doPlayHouseHotel('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
            html += `</div>`;
          } else {
            html += `<p class="card-detail">No eligible complete sets (requires a non-railroad/utility complete set)</p>`;
          }
          break;
        }

        // ── No Mercy action cards ──

        case 'shack': {
          // Shack can be placed on any set (including railroad/utility)
          const completedForShack = getCompletedSetColors(player);
          if (completedForShack.length > 0) {
            html += `<div class="color-picker"><p>Add Shack to set (+5M rent):</p>`;
            for (const color of completedForShack) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doShack('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
            html += `</div>`;
          } else {
            html += `<p class="card-detail">No complete sets to place a Shack on</p>`;
          }
          break;
        }

        case 'nm_pass_go':
          html += `<button class="btn btn-action" onclick="UI._doNmPassGo('${card.id}')">Play: Draw until 7 in hand</button>`;
          break;

        case 'nm_rent': {
          const doubleRentCardNM = player.hand.find(c => c.actionType === 'double_rent');
          const canDoubleNM = doubleRentCardNM && state.turnPlaysRemaining >= 2;
          html += `<div class="color-picker"><p>Charge rent for (all opponents):</p>`;
          for (const color of Object.keys(COLOR_MAP)) {
            if (countPlayerColor(player, color) > 0) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doNmRent('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
          }
          html += `</div>`;
          if (canDoubleNM) {
            html += `<div class="double-rent-option"><label><input type="checkbox" id="double-rent-check" data-double-id="${doubleRentCardNM.id}"> Double The Rent! (uses 2 plays)</label></div>`;
          }
          break;
        }

        case 'super_sly_deal': {
          // Pick a color to steal from all opponents
          const colorsInPlay = [];
          for (const p of state.players) {
            if (p.id === player.id) continue;
            for (const color of Object.keys(COLOR_MAP)) {
              if (countPlayerColor(p, color) > 0 && !colorsInPlay.includes(color)) {
                colorsInPlay.push(color);
              }
            }
          }
          if (colorsInPlay.length > 0) {
            html += `<div class="color-picker"><p>Steal ALL of one color from every player:</p>`;
            for (const color of colorsInPlay) {
              html += `<button class="btn btn-color" style="background:${COLOR_MAP[color]}" onclick="UI._doSuperSlyDeal('${card.id}', '${color}')">${COLOR_LABELS[color]}</button>`;
            }
            html += `</div>`;
          } else {
            html += `<p class="card-detail">No opponents have any properties to steal</p>`;
          }
          break;
        }

        case 'repossession': {
          html += `<div class="target-picker"><p>Choose player (they give all but 1 property):</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            if (p.properties.length <= 1) continue;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            html += `<button class="btn btn-target" onclick="UI._doRepossession('${card.id}', '${p.id}')">${escapeHtml(name)} (${p.properties.length} props)</button>`;
          }
          html += `</div>`;
          break;
        }

        case 'tough_luck': {
          html += `<div class="target-picker"><p>Choose a player, then steal all of one card type from their hand:</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            const handCount = p.hand?.length || p.handSize || 0;
            if (handCount === 0) continue;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            html += `<div class="target-group"><strong>${escapeHtml(name)} (${handCount} cards)</strong>`;
            html += `<button class="btn btn-sm" onclick="UI._doToughLuck('${card.id}', '${p.id}', 'property')">Properties</button>`;
            html += `<button class="btn btn-sm" onclick="UI._doToughLuck('${card.id}', '${p.id}', 'money')">Money</button>`;
            html += `<button class="btn btn-sm" onclick="UI._doToughLuck('${card.id}', '${p.id}', 'action')">Actions</button>`;
            html += `</div>`;
          }
          html += `</div>`;
          break;
        }

        case 'yoink': {
          html += `<div class="target-picker"><p>Steal 10M from:</p>`;
          for (const p of state.players) {
            if (p.id === player.id) continue;
            const bankTotal = p.bank?.reduce((s, c) => s + c.value, 0) || 0;
            const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
            html += `<button class="btn btn-target" onclick="UI._doYoink('${card.id}', '${p.id}')">${escapeHtml(name)} (${bankTotal}M bank)</button>`;
          }
          html += `</div>`;
          break;
        }

        case 'unfair_trade': {
          const myBankTotal = player.bank.reduce((s, c) => s + c.value, 0);
          if (myBankTotal === 0) {
            html += `<p class="card-detail">Cannot play: your bank is empty!</p>`;
          } else {
            html += `<div class="target-picker"><p>Swap your bank (${myBankTotal}M) with:</p>`;
            for (const p of state.players) {
              if (p.id === player.id) continue;
              const theirBank = p.bank?.reduce((s, c) => s + c.value, 0) || 0;
              const name = ClientGame.getPlayerNames()[p.id] || 'Unknown';
              html += `<button class="btn btn-target" onclick="UI._doUnfairTrade('${card.id}', '${p.id}')">${escapeHtml(name)} (${theirBank}M bank)</button>`;
            }
            html += `</div>`;
          }
          break;
        }
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

  function _showMyPlayedCard(cardId, banked) {
    const card = _getCardFromHand(cardId);
    if (card) {
      const name = ClientGame.getPlayerNames()[ClientGame.getPlayerId()] || 'You';
      showPlayedCard(card, name, banked);
    }
  }

  async function _doBank(cardId) {
    _showMyPlayedCard(cardId, true);
    _closeOverlay();
    await ClientGame.bankCard(cardId);
  }

  async function _doPlayProperty(cardId, chosenColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playProperty(cardId, chosenColor);
  }

  async function _doPlayHouseHotel(cardId, targetColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playHouseHotel(cardId, targetColor);
  }

  async function _doPassGo(cardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playPassGo(cardId);
  }

  async function _doRent(cardId, targetColor) {
    const checkbox = document.getElementById('double-rent-check');
    const doubleCardId = checkbox && checkbox.checked ? checkbox.dataset.doubleId : null;
    _showMyPlayedCard(cardId);
    if (doubleCardId) _showMyPlayedCard(doubleCardId);
    _closeOverlay();
    await ClientGame.playRent(cardId, targetColor, doubleCardId);
  }

  function _showMultiRentTargetPicker(cardId, targetColor) {
    // Capture double rent selection before rebuilding the overlay
    const checkbox = document.getElementById('double-rent-check');
    const doubleCardId = checkbox && checkbox.checked ? checkbox.dataset.doubleId : null;

    const state = ClientGame.getGameState();
    const myId = ClientGame.getPlayerId();
    const names = ClientGame.getPlayerNames();
    const overlay = document.getElementById('action-overlay');

    let html = `<div class="action-modal card-action-modal">`;
    html += `<h3>Multi Rent: ${COLOR_LABELS[targetColor]}${doubleCardId ? ' (Doubled!)' : ''}</h3>`;
    html += `<div class="target-picker"><p>Charge rent to:</p>`;
    for (const p of state.players) {
      if (p.id === myId) continue;
      const name = names[p.id] || 'Unknown';
      html += `<button class="btn btn-target" onclick="UI._doMultiRent('${cardId}', '${targetColor}', '${p.id}', ${doubleCardId ? `'${doubleCardId}'` : 'null'})">${escapeHtml(name)}</button>`;
    }
    html += `</div>`;
    html += `<button class="btn btn-cancel" onclick="UI._closeOverlay()">Cancel</button>`;
    html += `</div>`;

    overlay.innerHTML = html;
  }

  async function _doMultiRent(cardId, targetColor, targetId, doubleCardId) {
    _showMyPlayedCard(cardId);
    if (doubleCardId) _showMyPlayedCard(doubleCardId);
    _closeOverlay();
    await ClientGame.playRent(cardId, targetColor, doubleCardId || null, targetId);
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

  // ── No Mercy action handlers ──

  async function _doShack(cardId, targetColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playShack(cardId, targetColor);
  }

  async function _doNmPassGo(cardId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playNmPassGo(cardId);
  }

  async function _doNmRent(cardId, targetColor) {
    const checkbox = document.getElementById('double-rent-check');
    const doubleCardId = checkbox && checkbox.checked ? checkbox.dataset.doubleId : null;
    _showMyPlayedCard(cardId);
    if (doubleCardId) _showMyPlayedCard(doubleCardId);
    _closeOverlay();
    await ClientGame.playNmRent(cardId, targetColor, doubleCardId);
  }

  async function _doDoubleRentAlone(cardId, targetColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playDoubleRentAlone(cardId, targetColor);
  }

  async function _doSuperSlyDeal(cardId, targetColor) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playSuperSlyDeal(cardId, targetColor);
  }

  async function _doRepossession(cardId, targetId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playRepossession(cardId, targetId);
  }

  async function _doToughLuck(cardId, targetId, cardType) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playToughLuck(cardId, targetId, cardType);
  }

  async function _doYoink(cardId, targetId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playYoink(cardId, targetId);
  }

  async function _doUnfairTrade(cardId, targetId) {
    _showMyPlayedCard(cardId);
    _closeOverlay();
    await ClientGame.playUnfairTrade(cardId, targetId);
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
    'Rent: Darkblue/Green': 'rent-green-and-dark-blue.png',
    'Rent: Railroad/Utility': 'rent-black-and-utility.png',
    'Multi Rent (Wild)': 'rent-all-colours.png',
    // House & Hotel cards
    'House': 'house.png',
    'Hotel': 'hotel.png',
  };

  const RENT_COLOR_IMAGE_MAP = {
    'brown,lightblue': 'rent-brown-and-light-blue.png',
    'pink,orange': 'rent-pink-and-orange.png',
    'red,yellow': 'rent-red-and-yellow.png',
    'darkblue,green': 'rent-green-and-dark-blue.png',
    'railroad,utility': 'rent-black-and-utility.png',
  };

  // No Mercy card image overrides (maps card names to nomercy/ folder files)
  const NM_CARD_IMAGE_MAP = {
    // Properties (same names, nomercy art)
    'Mediterranean Ave': 'mediterranean.png',
    'Baltic Ave': 'baltic.png',
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
    'Marvin Gardens': 'marvin.png',
    'Pacific Ave': 'pacific.png',
    'North Carolina Ave': 'north-carolina.png',
    'Pennsylvania Ave': 'pennsylvania-avenue.png',
    'Reading Railroad': 'reading.png',
    'Pennsylvania Railroad': 'pennsylvania.png',
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
    'Wild: Red/Yellow': 'wild-red-and-yellow.png',
    'Wild Property': 'wild-property.png',
    // Action cards
    'Pass Go': 'pass-go.png',
    'Double The Rent': 'double-rent.png',
    'Just Say No': 'say-no.png',
    'Rent': 'rent.png',
    'Shack': 'shack.png',
    'Super Sly Deal': 'super-sly-deal.png',
    'Repossession': 'repossession.png',
    'Tough Luck': 'tough-luck.png',
    'Yoink': 'yoink.png',
    'Unfair Trade': 'unfair-trade.png',
  };

  function _isNoMercyMode() {
    const state = ClientGame.getGameState();
    return state?.gameMode === 'nomercy' || ClientGame.getGameMode() === 'nomercy';
  }

  function getCardImagePath(card) {
    if (!card || !card.name) return null;

    // No Mercy mode: use nomercy/ folder
    if (_isNoMercyMode()) {
      if (NM_CARD_IMAGE_MAP[card.name]) return 'assets/cards/nomercy/' + NM_CARD_IMAGE_MAP[card.name];
      // Money cards
      if (card.type === 'money') return 'assets/cards/nomercy/' + card.value + 'M.png';
      // NM rent is universal (no rentColors)
      if (card.actionType === 'nm_rent') return 'assets/cards/nomercy/rent.png';
      // Fall through to regular mapping for any missing nomercy assets
    }

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

  function createMiniPropertyCard(card, stackIndex) {
    const hasImg = getCardImagePath(card) ? ' has-card-img' : '';
    if (stackIndex != null) {
      const topPx = 8 + stackIndex * 15; // 6px label + 2px gap + stacking offset
      return `<div class="card-image-tiny${hasImg}" style="position:absolute;top:${topPx}px;left:0;z-index:${stackIndex}">${buildCardImageHtml(card)}</div>`;
    }
    return `<div class="card-image-tiny${hasImg}">${buildCardImageHtml(card)}</div>`;
  }

  // For dual-color wildcards, the image is designed with one color on top.
  // When switched to the other color, rotate 180° so the card visually flips.
  // Maps card name → the color that leaves the image unrotated.
  const WILD_UNROTATED_COLOR = {
    'Wild: Dark Blue/Green': 'darkblue',
    'Wild: Railroad/Green': 'green',
    'Wild: Light Blue/Railroad': 'lightblue',
    'Wild: Brown/Light Blue': 'lightblue',
    'Wild: Pink/Orange': 'orange',
    'Wild: Railroad/Utility': 'utility',
    'Wild: Red/Yellow': 'yellow',
  };

  function shouldRotateWild(card) {
    if (card.type !== 'wild_property') return false;
    const unrotated = WILD_UNROTATED_COLOR[card.name];
    if (!unrotated) return false;
    const current = card.currentColor || card.colors[0];
    return current !== unrotated;
  }

  function buildCardImageHtml(card) {
    const imgPath = getCardImagePath(card);
    if (imgPath) {
      const rotate = shouldRotateWild(card) ? ' style="transform:rotate(180deg)"' : '';
      return `<img class="card-img"${rotate} src="${imgPath}" alt="${escapeHtml(card.name)}" draggable="false">`;
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
      let color;
      if (card.actionType === 'house' || card.actionType === 'hotel') {
        color = card.attachedColor;
      } else {
        color = card.type === 'wild_property' ? card.currentColor : card.color;
      }
      if (!color) continue;
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
    if (card.actionType === 'house' || card.actionType === 'hotel' || card.actionType === 'shack') {
      return card.attachedColor ? countPlayerColor(player, card.attachedColor) >= getSetRequirement(card.attachedColor) : false;
    }
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

  function showPlayedCard(card, playerName, banked) {
    const container = document.getElementById('played-card-display');

    // Track last action card played (only action type, not property or money, and not banked)
    if (card && card.type === 'action' && !banked) {
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
    // Record game result and clear session
    ClientGame.handleGameOver(winnerId);

    const overlay = document.getElementById('action-overlay');
    overlay.style.display = 'flex';
    const name = names[winnerId] || 'Unknown';
    const isMe = winnerId === ClientGame.getPlayerId();
    const stats = ClientGame.getStats();
    overlay.innerHTML = `
      <div class="action-modal winner-modal">
        <h2>${isMe ? 'YOU WIN!' : escapeHtml(name) + ' Wins!'}</h2>
        <p>${isMe ? 'Congratulations! You completed 3 property sets!' : escapeHtml(name) + ' completed 3 property sets.'}</p>
        <div class="winner-stats-summary">
          <div class="winner-stat-row"><span>Games Played:</span><span>${stats.gamesPlayed}</span></div>
          <div class="winner-stat-row"><span>Win Rate:</span><span>${stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0}%</span></div>
          <div class="winner-stat-row"><span>Rating:</span><span>${stats.elo}</span></div>
        </div>
        <button class="btn btn-primary" onclick="location.reload()">Play Again</button>
      </div>
    `;
  }

  // ── Chat ──────────────────────────────────────────────────────────────

  function renderChatMessages(messages) {
    const el = document.getElementById('chat-messages');
    if (!el) return;

    el.innerHTML = messages.map(msg => {
      const time = new Date(msg.time);
      const timeStr = time.getHours().toString().padStart(2, '0') + ':' +
                      time.getMinutes().toString().padStart(2, '0');
      return `<div class="chat-message">` +
        `<span class="chat-author">${escapeHtml(msg.author)}:</span>` +
        `${escapeHtml(msg.text)}` +
        `<span class="chat-time">${timeStr}</span>` +
        `</div>`;
    }).join('');

    el.scrollTop = el.scrollHeight;
  }

  function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ClientGame.sendChat(text);
  }

  // ── Stats Dashboard ──────────────────────────────────────────────────

  function updateStatsDashboard() {
    const stats = ClientGame.getStats();
    const gamesEl = document.getElementById('stat-games');
    const winrateEl = document.getElementById('stat-winrate');
    const eloEl = document.getElementById('stat-elo');
    if (gamesEl) gamesEl.textContent = stats.gamesPlayed;
    if (winrateEl) winrateEl.textContent = stats.gamesPlayed > 0
      ? Math.round((stats.wins / stats.gamesPlayed) * 100) + '%'
      : '0%';
    if (eloEl) eloEl.textContent = stats.elo;
  }

  // ── Init ─────────────────────────────────────────────────────────────

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    initLoginHandlers();
    initLobbyHandlers();

    // Allow sending chat with Enter key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'chat-input') {
        e.preventDefault();
        sendChat();
      }
    });
  }

  return {
    init, showScreen, showLoginScreen, showLobbyScreen, showGameScreen, exitGame,
    updateLobby, refreshPublicGames, renderGame, showError, showToast, showLoading,
    showDrawnCards, showDiscardPrompt, showWinner, showPlayedCard,
    renderChatMessages, sendChat, updateStatsDashboard,
    // Exposed for onclick handlers in HTML
    _closeOverlay, _doBank, _doPlayProperty, _doPlayHouseHotel, _doPassGo, _doRent,
    _showMultiRentTargetPicker, _doMultiRent,
    _doDebtCollector, _doBirthday, _doSlyDeal, _startForcedDeal,
    _doForcedDeal, _doDealBreaker, _handleAccept, _handleJSN,
    _togglePaymentCard, _confirmPayment, _doSwitchWild,
    // No Mercy action handlers
    _doShack, _doNmPassGo, _doNmRent, _doDoubleRentAlone, _doSuperSlyDeal,
    _doRepossession, _doToughLuck, _doYoink, _doUnfairTrade,
  };
})();
