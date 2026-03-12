// Client Game Controller
// Manages game state, player actions, and coordinates between UI and Supabase

const ClientGame = (() => {
  let roomId = null;
  let gameId = null;
  let playerId = null;
  let username = null;
  let gameState = null;
  let playerNames = {};
  let isHost = false;
  let gameSubscription = null;
  let roomSubscription = null;
  let isLocalGame = false;
  let computerPlayerIds = [];
  let chatMessages = [];
  let chatSubscription = null;

  // ── Initialization ───────────────────────────────────────────────────

  function setPlayer(id, name) {
    playerId = id;
    username = name;
  }

  function getPlayerId() { return playerId; }
  function getUsername() { return username; }
  function getRoomId() { return roomId; }
  function getGameId() { return gameId; }
  function getGameState() { return gameState; }
  function getIsHost() { return isHost; }
  function getPlayerNames() { return playerNames; }

  // ── Room management ──────────────────────────────────────────────────

  async function createRoom(name) {
    const data = await SupabaseClient.createRoom(name);
    roomId = data.roomId;
    playerId = data.playerId;
    username = name;
    isHost = true;
    subscribeToRoomUpdates();
    return data;
  }

  async function joinRoom(name, roomCode) {
    const data = await SupabaseClient.joinRoom(name, roomCode);
    roomId = data.roomId;
    playerId = data.playerId;
    username = name;
    isHost = false;
    subscribeToRoomUpdates();
    return data;
  }

  async function toggleReady() {
    const players = await SupabaseClient.getRoomPlayers(roomId);
    const me = players.find(p => p.player_id === playerId);
    if (me) {
      await SupabaseClient.setReady(roomId, playerId, !me.ready_status);
    }
  }

  async function startGame() {
    const data = await SupabaseClient.startGame(roomId);
    gameId = data.gameId;
    return data;
  }

  // ── Room subscriptions ───────────────────────────────────────────────

  function subscribeToRoomUpdates() {
    roomSubscription = SupabaseClient.subscribeToRoom(roomId, async (payload) => {
      // Room status changed (game started)
      if (payload.table === 'rooms' && payload.new?.status === 'playing') {
        await loadGame();
        UI.showGameScreen();
        return;
      }
      // Player list changed
      await refreshRoomPlayers();
    });
  }

  async function refreshRoomPlayers() {
    const players = await SupabaseClient.getRoomPlayers(roomId);
    for (const p of players) {
      playerNames[p.player_id] = p.players?.username || 'Unknown';
    }
    UI.updateLobby(players, isHost, playerId);
  }

  // ── Game management ──────────────────────────────────────────────────

  async function loadGame() {
    const game = await SupabaseClient.getGame(roomId);
    if (!game) return;
    gameId = game.id;
    gameState = game.game_state_json;

    // Build player names map
    const players = await SupabaseClient.getRoomPlayers(roomId);
    for (const p of players) {
      playerNames[p.player_id] = p.players?.username || 'Unknown';
    }

    subscribeToGameUpdates();
    subscribeToChatUpdates();
    UI.renderGame(gameState, playerId, playerNames);
  }

  function subscribeToChatUpdates() {
    if (chatSubscription) return;
    chatMessages = [];
    chatSubscription = SupabaseClient.subscribeToChatChannel(roomId, (msg) => {
      chatMessages.push(msg);
      if (chatMessages.length > 100) chatMessages.shift();
      UI.renderChatMessages(chatMessages);
    });
  }

  function sendChat(text) {
    if (!text) return;
    const msg = {
      author: username,
      playerId: playerId,
      text: text,
      time: Date.now(),
    };
    chatMessages.push(msg);
    if (chatMessages.length > 100) chatMessages.shift();
    if (!isLocalGame) {
      SupabaseClient.sendChatMessage(roomId, msg);
    }
    UI.renderChatMessages(chatMessages);
  }

  function subscribeToGameUpdates() {
    if (gameSubscription) return;
    gameSubscription = SupabaseClient.subscribeToGame(gameId, async (payload) => {
      if (payload.new) {
        // Refetch the full game to get the state with our hand visible
        const game = await SupabaseClient.getGame(roomId);
        if (game) {
          gameState = game.game_state_json;
          UI.renderGame(gameState, playerId, playerNames);
        }
      }
    });
  }

  // ── Game actions ─────────────────────────────────────────────────────

  async function drawCards() {
    try {
      const result = await SupabaseClient.playCard(gameId, 'draw');
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
      if (result.drawnCards) {
        UI.showDrawnCards(result.drawnCards);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playProperty(cardId, chosenColor) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'play_property', { cardId, chosenColor });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function bankCard(cardId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'bank', { cardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playPassGo(cardId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'pass_go', { cardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playRent(cardId, targetColor, doubleCardId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'rent', { cardId, targetColor, doubleCardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playDebtCollector(cardId, targetId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'debt_collector', { cardId, targetId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playBirthday(cardId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'birthday', { cardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playSlyDeal(cardId, targetId, targetCardId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'sly_deal', { cardId, targetId, targetCardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playForcedDeal(cardId, targetId, targetCardId, myCardId) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'forced_deal', { cardId, targetId, targetCardId, myCardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function playDealBreaker(cardId, targetId, targetColor) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'deal_breaker', { cardId, targetId, targetColor });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function moveWild(cardId, chosenColor) {
    try {
      const result = await SupabaseClient.playCard(gameId, 'move_wild', { cardId, chosenColor });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function endTurn(discardCardIds) {
    try {
      const result = await SupabaseClient.endTurn(gameId, discardCardIds);
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
      if (result.needsDiscard) {
        UI.showDiscardPrompt(result.excess);
      }
      if (result.winner) {
        UI.showWinner(result.winner, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function respondJustSayNo(cardId) {
    try {
      const result = await SupabaseClient.respondAction(gameId, 'just_say_no', { cardId });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function respondAccept() {
    try {
      const result = await SupabaseClient.respondAction(gameId, 'accept');
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  async function makePayment(bankCardIds, propertyCardIds) {
    try {
      const result = await SupabaseClient.respondAction(gameId, 'pay', { bankCardIds, propertyCardIds });
      if (result.state) {
        gameState = result.state;
        UI.renderGame(gameState, playerId, playerNames);
      }
    } catch (err) {
      UI.showError(err.message);
    }
  }

  // ── Local (vs Computer) game mode ──────────────────────────────────

  function isComputerGame() { return isLocalGame; }

  function startLocalGame(name, numComputers) {
    username = name;
    playerId = 'human_' + crypto.randomUUID();
    isLocalGame = true;
    computerPlayerIds = [];
    playerNames = {};
    playerNames[playerId] = name;

    const allIds = [playerId];
    for (let i = 0; i < numComputers; i++) {
      const cpuId = 'cpu_' + (i + 1);
      computerPlayerIds.push(cpuId);
      allIds.push(cpuId);
      playerNames[cpuId] = ComputerPlayer.COMPUTER_NAMES[i] || ('Bot ' + (i + 1));
    }

    gameState = GameEngine.createInitialState(allIds);
    UI.showGameScreen();
    renderLocalGame();
  }

  function renderLocalGame() {
    // Show the human player's view (hide other hands)
    const view = GameEngine.getPlayerView(gameState, playerId);
    UI.renderGame(view, playerId, playerNames);
    // After rendering, check if a computer needs to act
    scheduleComputerAction();
  }

  function isComputerTurn() {
    return computerPlayerIds.includes(gameState.currentPlayer);
  }

  function isComputerResponder() {
    const pending = gameState.pendingAction;
    if (!pending) return false;
    if (gameState.phase === 'respond' && computerPlayerIds.includes(pending.currentResponder)) return true;
    if (gameState.phase === 'pay' && computerPlayerIds.includes(pending.currentPayer)) return true;
    return false;
  }

  function scheduleComputerAction() {
    if (!isLocalGame || gameState.phase === 'finished') return;

    if (isComputerResponder()) {
      const responder = gameState.phase === 'pay'
        ? gameState.pendingAction.currentPayer
        : gameState.pendingAction.currentResponder;
      ComputerPlayer.handleResponse(gameState, responder, localCallbacks());
      return;
    }

    if (isComputerTurn()) {
      ComputerPlayer.takeTurn(gameState, gameState.currentPlayer, localCallbacks());
    }
  }

  function localCallbacks() {
    return {
      drawCards: () => localDrawCards(),
      playProperty: (cardId, chosenColor) => localPlayProperty(cardId, chosenColor),
      playPassGo: (cardId) => localPlayPassGo(cardId),
      playRent: (cardId, color) => localPlayRent(cardId, color),
      playDebtCollector: (cardId, targetId) => localPlayDebtCollector(cardId, targetId),
      playBirthday: (cardId) => localPlayBirthday(cardId),
      bankCard: (cardId) => localBankCard(cardId),
      endTurn: (discardIds) => localEndTurn(discardIds),
      respondAccept: () => localRespondAccept(),
      respondJustSayNo: (cardId) => localRespondJustSayNo(cardId),
      makePayment: (bankIds, propIds) => localMakePayment(bankIds, propIds),
    };
  }

  function localDrawCards() {
    GameEngine.startTurn(gameState);
    renderLocalGame();
  }

  function _showCardBeforePlay(cardId, banked) {
    const player = gameState.players.find(p => p.id === gameState.currentPlayer);
    if (!player) return;
    const card = player.hand.find(c => c.id === cardId);
    if (card) {
      const name = playerNames[gameState.currentPlayer] || 'Unknown';
      UI.showPlayedCard(card, name, banked);
    }
  }

  function localPlayProperty(cardId, chosenColor) {
    _showCardBeforePlay(cardId);
    GameEngine.playProperty(gameState, gameState.currentPlayer, cardId, chosenColor);
    renderLocalGame();
  }

  function localPlayPassGo(cardId) {
    _showCardBeforePlay(cardId);
    GameEngine.playPassGo(gameState, gameState.currentPlayer, cardId);
    renderLocalGame();
  }

  function localPlayRent(cardId, color) {
    _showCardBeforePlay(cardId);
    GameEngine.playRent(gameState, gameState.currentPlayer, cardId, color, null);
    renderLocalGame();
  }

  function localPlayDebtCollector(cardId, targetId) {
    _showCardBeforePlay(cardId);
    GameEngine.playDebtCollector(gameState, gameState.currentPlayer, cardId, targetId);
    renderLocalGame();
  }

  function localPlayBirthday(cardId) {
    _showCardBeforePlay(cardId);
    GameEngine.playBirthday(gameState, gameState.currentPlayer, cardId);
    renderLocalGame();
  }

  function localBankCard(cardId) {
    _showCardBeforePlay(cardId, true);
    GameEngine.bankCard(gameState, gameState.currentPlayer, cardId);
    renderLocalGame();
  }

  function localEndTurn(discardIds) {
    if (gameState.phase === 'discard' && discardIds && discardIds.length > 0) {
      GameEngine.discardCards(gameState, gameState.currentPlayer, discardIds);
    } else {
      GameEngine.endTurn(gameState);
    }
    renderLocalGame();
  }

  function localRespondAccept() {
    GameEngine.respondAccept(gameState, gameState.pendingAction.currentResponder || gameState.pendingAction.currentPayer);
    renderLocalGame();
  }

  function localRespondJustSayNo(cardId) {
    const responder = gameState.pendingAction.currentResponder;
    GameEngine.respondJustSayNo(gameState, responder, cardId);
    renderLocalGame();
  }

  function localMakePayment(bankIds, propIds) {
    const payer = gameState.pendingAction.currentPayer;
    GameEngine.makePayment(gameState, payer, bankIds, propIds);
    renderLocalGame();
  }

  // Wrapper functions that work for both online and local modes

  async function drawCardsAny() {
    if (isLocalGame) {
      localDrawCards();
    } else {
      await drawCards();
    }
  }

  async function playPropertyAny(cardId, chosenColor) {
    if (isLocalGame) {
      localPlayProperty(cardId, chosenColor);
    } else {
      await playProperty(cardId, chosenColor);
    }
  }

  async function bankCardAny(cardId) {
    if (isLocalGame) {
      localBankCard(cardId);
    } else {
      await bankCard(cardId);
    }
  }

  async function playPassGoAny(cardId) {
    if (isLocalGame) {
      localPlayPassGo(cardId);
    } else {
      await playPassGo(cardId);
    }
  }

  async function playRentAny(cardId, targetColor, doubleCardId) {
    if (isLocalGame) {
      localPlayRent(cardId, targetColor);
    } else {
      await playRent(cardId, targetColor, doubleCardId);
    }
  }

  async function playDebtCollectorAny(cardId, targetId) {
    if (isLocalGame) {
      localPlayDebtCollector(cardId, targetId);
    } else {
      await playDebtCollector(cardId, targetId);
    }
  }

  async function playBirthdayAny(cardId) {
    if (isLocalGame) {
      localPlayBirthday(cardId);
    } else {
      await playBirthday(cardId);
    }
  }

  async function playSlyDealAny(cardId, targetId, targetCardId) {
    if (isLocalGame) {
      _showCardBeforePlay(cardId);
      GameEngine.playSlyDeal(gameState, gameState.currentPlayer, cardId, targetId, targetCardId);
      renderLocalGame();
    } else {
      await playSlyDeal(cardId, targetId, targetCardId);
    }
  }

  async function playForcedDealAny(cardId, targetId, targetCardId, myCardId) {
    if (isLocalGame) {
      _showCardBeforePlay(cardId);
      GameEngine.playForcedDeal(gameState, gameState.currentPlayer, cardId, targetId, targetCardId, myCardId);
      renderLocalGame();
    } else {
      await playForcedDeal(cardId, targetId, targetCardId, myCardId);
    }
  }

  async function playDealBreakerAny(cardId, targetId, targetColor) {
    if (isLocalGame) {
      _showCardBeforePlay(cardId);
      GameEngine.playDealBreaker(gameState, gameState.currentPlayer, cardId, targetId, targetColor);
      renderLocalGame();
    } else {
      await playDealBreaker(cardId, targetId, targetColor);
    }
  }

  async function moveWildAny(cardId, chosenColor) {
    if (isLocalGame) {
      GameEngine.moveWild(gameState, playerId, cardId, chosenColor);
      renderLocalGame();
    } else {
      await moveWild(cardId, chosenColor);
    }
  }

  async function endTurnAny(discardCardIds) {
    if (isLocalGame) {
      localEndTurn(discardCardIds);
    } else {
      await endTurn(discardCardIds);
    }
  }

  async function respondAcceptAny() {
    if (isLocalGame) {
      localRespondAccept();
    } else {
      await respondAccept();
    }
  }

  async function respondJustSayNoAny(cardId) {
    if (isLocalGame) {
      localRespondJustSayNo(cardId);
    } else {
      await respondJustSayNo(cardId);
    }
  }

  async function makePaymentAny(bankIds, propIds) {
    if (isLocalGame) {
      localMakePayment(bankIds, propIds);
    } else {
      await makePayment(bankIds, propIds);
    }
  }

  return {
    setPlayer, getPlayerId, getUsername, getRoomId, getGameId,
    getGameState, getIsHost, getPlayerNames, isComputerGame,
    createRoom, joinRoom, toggleReady, startGame, loadGame,
    refreshRoomPlayers, startLocalGame, sendChat,
    // Use "Any" variants which route to local or online
    drawCards: drawCardsAny,
    playProperty: playPropertyAny,
    bankCard: bankCardAny,
    playPassGo: playPassGoAny,
    playRent: playRentAny,
    playDebtCollector: playDebtCollectorAny,
    playBirthday: playBirthdayAny,
    playSlyDeal: playSlyDealAny,
    playForcedDeal: playForcedDealAny,
    playDealBreaker: playDealBreakerAny,
    moveWild: moveWildAny,
    endTurn: endTurnAny,
    respondJustSayNo: respondJustSayNoAny,
    respondAccept: respondAcceptAny,
    makePayment: makePaymentAny,
  };
})();
