// Monopoly Deal - Game Engine
// Mutates game state based on validated actions

const {
  COLORS, SET_REQUIREMENTS, RENT_VALUES, CARD_TYPE, ACTION_TYPE,
  buildFullDeck, shuffleDeck,
} = typeof require !== 'undefined'
  ? require('./deck.js')
  : window.MonopolyDeck;

const { Rules } = typeof require !== 'undefined'
  ? require('./rules.js')
  : { Rules: window.MonopolyRules };

const GameEngine = {

  // ── Initialization ───────────────────────────────────────────────────

  createInitialState(playerIds) {
    const deck = shuffleDeck(buildFullDeck());

    const players = playerIds.map(id => ({
      id,
      hand: [],
      bank: [],
      properties: [],
    }));

    const state = {
      deck,
      discardPile: [],
      players,
      currentPlayer: playerIds[0],
      turnPlaysRemaining: 3,
      phase: 'play',        // 'draw' | 'play' | 'discard' | 'pay' | 'respond' | 'finished'
      pendingAction: null,   // for actions that require opponent response
      winner: null,
      log: [],
      turnDrawn: false,
    };

    // Deal 5 cards to each player
    for (const player of state.players) {
      for (let i = 0; i < 5; i++) {
        player.hand.push(this.drawCard(state));
      }
    }

    state.phase = 'draw';
    return state;
  },

  // ── Deck operations ──────────────────────────────────────────────────

  drawCard(state) {
    if (state.deck.length === 0) {
      // Reshuffle discard pile
      if (state.discardPile.length === 0) return null;
      state.deck = shuffleDeck(state.discardPile);
      state.discardPile = [];
    }
    return state.deck.pop();
  },

  drawCards(state, playerId, count) {
    const player = Rules.getPlayer(state, playerId);
    const drawn = [];
    for (let i = 0; i < count; i++) {
      const card = this.drawCard(state);
      if (card) {
        player.hand.push(card);
        drawn.push(card);
      }
    }
    return drawn;
  },

  // ── Turn management ──────────────────────────────────────────────────

  startTurn(state) {
    const player = Rules.getPlayer(state, state.currentPlayer);
    const drawCount = player.hand.length === 0 ? 5 : 2;
    const drawn = this.drawCards(state, state.currentPlayer, drawCount);
    state.turnPlaysRemaining = 3;
    state.phase = 'play';
    state.turnDrawn = true;
    state.log.push({
      type: 'draw',
      player: state.currentPlayer,
      count: drawn.length,
    });
    return { drawn };
  },

  endTurn(state) {
    const player = Rules.getPlayer(state, state.currentPlayer);

    // Check hand limit
    if (player.hand.length > 7) {
      state.phase = 'discard';
      return { needsDiscard: true, excess: player.hand.length - 7 };
    }

    return this._advanceTurn(state);
  },

  _advanceTurn(state) {
    // Check win condition
    const player = Rules.getPlayer(state, state.currentPlayer);
    if (Rules.hasWon(player)) {
      state.phase = 'finished';
      state.winner = state.currentPlayer;
      state.log.push({ type: 'win', player: state.currentPlayer });
      return { winner: state.currentPlayer };
    }

    // Advance to next player
    const idx = state.players.findIndex(p => p.id === state.currentPlayer);
    const nextIdx = (idx + 1) % state.players.length;
    state.currentPlayer = state.players[nextIdx].id;
    state.turnPlaysRemaining = 3;
    state.phase = 'draw';
    state.turnDrawn = false;
    state.log.push({ type: 'end_turn', player: state.players[idx].id });
    return {};
  },

  discardCards(state, playerId, cardIds) {
    const player = Rules.getPlayer(state, playerId);
    for (const id of cardIds) {
      const idx = player.hand.findIndex(c => c.id === id);
      if (idx !== -1) {
        const [card] = player.hand.splice(idx, 1);
        state.discardPile.push(card);
      }
    }
    state.log.push({ type: 'discard', player: playerId, count: cardIds.length });
    return this._advanceTurn(state);
  },

  // ── Card plays ───────────────────────────────────────────────────────

  removeFromHand(player, cardId) {
    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return null;
    return player.hand.splice(idx, 1)[0];
  },

  playProperty(state, playerId, cardId, chosenColor) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    if (card.type === CARD_TYPE.WILD_PROPERTY && chosenColor) {
      card.currentColor = chosenColor;
    }
    player.properties.push(card);
    state.turnPlaysRemaining--;
    state.log.push({
      type: 'play_property',
      player: playerId,
      card: card.name,
      color: card.currentColor || card.color,
    });
    this._checkWin(state, playerId);
    return { card };
  },

  bankCard(state, playerId, cardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    player.bank.push(card);
    state.turnPlaysRemaining--;
    state.log.push({
      type: 'bank',
      player: playerId,
      card: card.name,
      value: card.value,
    });
    return { card };
  },

  playPassGo(state, playerId, cardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;
    const drawn = this.drawCards(state, playerId, 2);
    state.log.push({
      type: 'pass_go',
      player: playerId,
      drawn: drawn.length,
    });
    return { drawn };
  },

  playRent(state, playerId, cardId, targetColor, doubleCardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    let rentAmount = Rules.rentAmount(player, targetColor);
    let doubled = false;

    if (doubleCardId) {
      const doubleCard = this.removeFromHand(player, doubleCardId);
      state.discardPile.push(doubleCard);
      state.turnPlaysRemaining--;
      rentAmount *= 2;
      doubled = true;
    }

    // Determine targets
    let targets;
    if (card.actionType === ACTION_TYPE.MULTI_RENT) {
      // Multi rent: choose one player (handled by passing targetPlayerId in move data)
      // For simplicity, multi rent charges all players like regular rent
      // The spec says "wild rent" — we'll charge all opponents
      targets = state.players.filter(p => p.id !== playerId).map(p => p.id);
    } else {
      // Standard rent: all opponents
      targets = state.players.filter(p => p.id !== playerId).map(p => p.id);
    }

    // Set up pending payments
    state.pendingAction = {
      type: 'rent',
      from: playerId,
      targets: targets.map(t => ({ playerId: t, amount: rentAmount, paid: false, cancelled: false })),
      color: targetColor,
      amount: rentAmount,
      doubled,
      respondQueue: [...targets], // players who can respond with Just Say No
      currentResponder: targets[0] || null,
    };
    state.phase = 'respond';

    state.log.push({
      type: 'rent',
      player: playerId,
      color: targetColor,
      amount: rentAmount,
      doubled,
    });

    return { rentAmount, targets };
  },

  playDebtCollector(state, playerId, cardId, targetId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'debt_collector',
      from: playerId,
      targets: [{ playerId: targetId, amount: 5, paid: false, cancelled: false }],
      respondQueue: [targetId],
      currentResponder: targetId,
    };
    state.phase = 'respond';

    state.log.push({ type: 'debt_collector', player: playerId, target: targetId });
    return {};
  },

  playBirthday(state, playerId, cardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    const targets = state.players.filter(p => p.id !== playerId).map(p => p.id);
    state.pendingAction = {
      type: 'birthday',
      from: playerId,
      targets: targets.map(t => ({ playerId: t, amount: 2, paid: false, cancelled: false })),
      respondQueue: [...targets],
      currentResponder: targets[0] || null,
    };
    state.phase = 'respond';

    state.log.push({ type: 'birthday', player: playerId });
    return {};
  },

  playSlyDeal(state, playerId, cardId, targetId, targetCardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'sly_deal',
      from: playerId,
      targetId,
      targetCardId,
      respondQueue: [targetId],
      currentResponder: targetId,
      cancelled: false,
    };
    state.phase = 'respond';

    state.log.push({ type: 'sly_deal', player: playerId, target: targetId });
    return {};
  },

  playForcedDeal(state, playerId, cardId, targetId, targetCardId, myCardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'forced_deal',
      from: playerId,
      targetId,
      targetCardId,
      myCardId,
      respondQueue: [targetId],
      currentResponder: targetId,
      cancelled: false,
    };
    state.phase = 'respond';

    state.log.push({ type: 'forced_deal', player: playerId, target: targetId });
    return {};
  },

  playDealBreaker(state, playerId, cardId, targetId, targetColor) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'deal_breaker',
      from: playerId,
      targetId,
      targetColor,
      respondQueue: [targetId],
      currentResponder: targetId,
      cancelled: false,
    };
    state.phase = 'respond';

    state.log.push({ type: 'deal_breaker', player: playerId, target: targetId, color: targetColor });
    return {};
  },

  // ── Response handling (Just Say No chains) ───────────────────────────

  respondJustSayNo(state, playerId, cardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);

    const pending = state.pendingAction;

    // Toggle cancel state - Just Say No chains
    if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday') {
      const target = pending.targets.find(t => t.playerId === playerId);
      if (target) target.cancelled = !target.cancelled;
    } else {
      pending.cancelled = !pending.cancelled;
    }

    // The other party can now respond with their own Just Say No
    // Set the responder to the other party
    if (pending.from === playerId) {
      // The action initiator countered, so the target can respond again
      pending.currentResponder = pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday'
        ? pending.respondQueue.find(t => {
            const tgt = pending.targets.find(tt => tt.playerId === t);
            return tgt && tgt.cancelled;
          }) || null
        : pending.targetId;
    } else {
      // Target said no, action initiator can counter
      pending.currentResponder = pending.from;
    }

    state.log.push({ type: 'just_say_no', player: playerId });
    return {};
  },

  respondAccept(state, playerId) {
    const pending = state.pendingAction;

    if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday') {
      // Move to next responder or start payment phase
      const idx = pending.respondQueue.indexOf(playerId);
      if (idx !== -1) pending.respondQueue.splice(idx, 1);

      if (pending.currentResponder === playerId) {
        // Find next responder
        pending.currentResponder = pending.respondQueue[0] || null;
      }

      if (pending.respondQueue.length === 0 || pending.currentResponder === null) {
        // All responded, now collect payments
        const unpaid = pending.targets.filter(t => !t.cancelled && !t.paid);
        if (unpaid.length > 0) {
          state.phase = 'pay';
          pending.currentPayer = unpaid[0].playerId;
        } else {
          this._resolveAction(state);
        }
      }
    } else {
      // Sly Deal, Forced Deal, Deal Breaker - single target accepts
      if (!pending.cancelled) {
        this._executePropertyAction(state);
      }
      this._resolveAction(state);
    }

    return {};
  },

  // ── Payment ──────────────────────────────────────────────────────────

  makePayment(state, payerId, bankCardIds, propertyCardIds) {
    const pending = state.pendingAction;
    const payer = Rules.getPlayer(state, payerId);
    const receiver = Rules.getPlayer(state, pending.from);
    const target = pending.targets.find(t => t.playerId === payerId);

    // Transfer bank cards
    for (const id of bankCardIds) {
      const idx = payer.bank.findIndex(c => c.id === id);
      if (idx !== -1) {
        const [card] = payer.bank.splice(idx, 1);
        receiver.bank.push(card);
      }
    }

    // Transfer property cards
    for (const id of propertyCardIds) {
      const idx = payer.properties.findIndex(c => c.id === id);
      if (idx !== -1) {
        const [card] = payer.properties.splice(idx, 1);
        receiver.properties.push(card);
      }
    }

    target.paid = true;

    state.log.push({
      type: 'payment',
      from: payerId,
      to: pending.from,
      bankCards: bankCardIds.length,
      propertyCards: propertyCardIds.length,
    });

    // Check for next payer
    const nextUnpaid = pending.targets.find(t => !t.cancelled && !t.paid);
    if (nextUnpaid) {
      pending.currentPayer = nextUnpaid.playerId;
    } else {
      this._resolveAction(state);
    }

    return {};
  },

  // ── Action resolution ────────────────────────────────────────────────

  _executePropertyAction(state) {
    const pending = state.pendingAction;
    const from = Rules.getPlayer(state, pending.from);

    if (pending.type === 'sly_deal') {
      const target = Rules.getPlayer(state, pending.targetId);
      const idx = target.properties.findIndex(c => c.id === pending.targetCardId);
      if (idx !== -1) {
        const [card] = target.properties.splice(idx, 1);
        from.properties.push(card);
      }
    } else if (pending.type === 'forced_deal') {
      const target = Rules.getPlayer(state, pending.targetId);
      const tIdx = target.properties.findIndex(c => c.id === pending.targetCardId);
      const mIdx = from.properties.findIndex(c => c.id === pending.myCardId);
      if (tIdx !== -1 && mIdx !== -1) {
        const [targetCard] = target.properties.splice(tIdx, 1);
        const [myCard] = from.properties.splice(mIdx, 1);
        from.properties.push(targetCard);
        target.properties.push(myCard);
      }
    } else if (pending.type === 'deal_breaker') {
      const target = Rules.getPlayer(state, pending.targetId);
      const color = pending.targetColor;
      const setCards = target.properties.filter(c => {
        if (c.type === CARD_TYPE.PROPERTY) return c.color === color;
        if (c.type === CARD_TYPE.WILD_PROPERTY) return c.currentColor === color;
        return false;
      });
      for (const card of setCards) {
        const idx = target.properties.indexOf(card);
        if (idx !== -1) {
          target.properties.splice(idx, 1);
          from.properties.push(card);
        }
      }
    }
  },

  _resolveAction(state) {
    state.pendingAction = null;
    state.phase = 'play';
    // Check win after action resolution
    this._checkWin(state, state.currentPlayer);
  },

  _checkWin(state, playerId) {
    const player = Rules.getPlayer(state, playerId);
    if (Rules.hasWon(player)) {
      state.phase = 'finished';
      state.winner = playerId;
      state.log.push({ type: 'win', player: playerId });
    }
  },

  moveWild(state, playerId, cardId, newColor) {
    const player = Rules.getPlayer(state, playerId);
    const card = player.properties.find(c => c.id === cardId);
    card.currentColor = newColor;
    state.log.push({ type: 'move_wild', player: playerId, card: card.name, color: newColor });
    return {};
  },

  // ── Serialization helper ─────────────────────────────────────────────

  // Create a view of state safe for a specific player (hide other hands)
  getPlayerView(state, playerId) {
    return {
      ...state,
      deck: state.deck.length, // just the count
      players: state.players.map(p => ({
        ...p,
        hand: p.id === playerId ? p.hand : p.hand.map(() => ({ id: 'hidden', type: 'hidden' })),
      })),
    };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameEngine };
}
