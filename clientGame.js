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
    UI.renderGame(gameState, playerId, playerNames);
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

  return {
    setPlayer, getPlayerId, getUsername, getRoomId, getGameId,
    getGameState, getIsHost, getPlayerNames,
    createRoom, joinRoom, toggleReady, startGame, loadGame,
    refreshRoomPlayers,
    drawCards, playProperty, bankCard, playPassGo,
    playRent, playDebtCollector, playBirthday,
    playSlyDeal, playForcedDeal, playDealBreaker, moveWild,
    endTurn, respondJustSayNo, respondAccept, makePayment,
  };
})();
