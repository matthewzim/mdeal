// Monopoly Deal - Game Engine
// Mutates game state based on validated actions

// Wrap in IIFE to avoid redeclaring const variables from deck.js in the
// global scope (which would cause a SyntaxError in the browser).
;(function () {

const {
  COLORS, SET_REQUIREMENTS, RENT_VALUES, CARD_TYPE, ACTION_TYPE,
  buildFullDeck, buildDeck, shuffleDeck,
} = typeof require !== 'undefined'
  ? require('./deck.js')
  : window.MonopolyDeck;

const { Rules } = typeof require !== 'undefined'
  ? require('./rules.js')
  : { Rules: window.MonopolyRules };

const GameEngine = {

  // ── Initialization ───────────────────────────────────────────────────

  createInitialState(playerIds, gameMode) {
    const deck = shuffleDeck(buildDeck(gameMode || 'regular'));

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
      phase: 'play',        // 'draw' | 'play' | 'discard' | 'pay' | 'respond' | 'finished' | 'redistribute'
      pendingAction: null,   // for actions that require opponent response
      winner: null,
      log: [],
      turnDrawn: false,
      gameMode: gameMode || 'regular',
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = player.hand.find(c => c.id === cardId);
    if (card && (card.type === 'property' || card.type === 'wild_property')) {
      return { error: 'Property cards cannot be banked' };
    }
    const removed = this.removeFromHand(player, cardId);
    player.bank.push(removed);
    state.turnPlaysRemaining--;
    state.log.push({
      type: 'bank',
      player: playerId,
      card: removed.name,
      value: removed.value,
    });
    return { card: removed };
  },

  playHouseHotel(state, playerId, cardId, targetColor) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    card.attachedColor = targetColor;
    player.properties.push(card);
    state.turnPlaysRemaining--;
    state.log.push({
      type: 'play_house_hotel',
      player: playerId,
      card: card.name,
      color: targetColor,
    });
    return { card };
  },

  playPassGo(state, playerId, cardId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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

  playRent(state, playerId, cardId, targetColor, doubleCardId, targetPlayerId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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
      // Multi rent: charge only the chosen player
      targets = [targetPlayerId];
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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

  // ── No Mercy actions ─────────────────────────────────────────────────

  playShack(state, playerId, cardId, targetColor) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    card.attachedColor = targetColor;
    player.properties.push(card);
    state.turnPlaysRemaining--;
    state.log.push({ type: 'play_shack', player: playerId, card: card.name, color: targetColor });
    return { card };
  },

  playNmPassGo(state, playerId, cardId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;
    const drawCount = Math.max(0, 7 - player.hand.length);
    const drawn = this.drawCards(state, playerId, drawCount);
    state.log.push({ type: 'nm_pass_go', player: playerId, drawn: drawn.length });
    return { drawn };
  },

  playNmRent(state, playerId, cardId, targetColor, doubleCardId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
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

    const targets = state.players.filter(p => p.id !== playerId).map(p => p.id);
    state.pendingAction = {
      type: 'rent',
      from: playerId,
      targets: targets.map(t => ({ playerId: t, amount: rentAmount, paid: false, cancelled: false })),
      color: targetColor,
      amount: rentAmount,
      doubled,
      respondQueue: [...targets],
      currentResponder: targets[0] || null,
    };
    state.phase = 'respond';
    state.log.push({ type: 'rent', player: playerId, color: targetColor, amount: rentAmount, doubled });
    return { rentAmount, targets };
  },

  playDoubleRentAlone(state, playerId, cardId, targetColor) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    let rentAmount = Rules.rentAmount(player, targetColor);
    rentAmount *= 2;

    const targets = state.players.filter(p => p.id !== playerId).map(p => p.id);
    state.pendingAction = {
      type: 'rent',
      from: playerId,
      targets: targets.map(t => ({ playerId: t, amount: rentAmount, paid: false, cancelled: false })),
      color: targetColor,
      amount: rentAmount,
      doubled: true,
      respondQueue: [...targets],
      currentResponder: targets[0] || null,
    };
    state.phase = 'respond';
    state.log.push({ type: 'rent', player: playerId, color: targetColor, amount: rentAmount, doubled: true });
    return { rentAmount, targets };
  },

  playSuperSlyDeal(state, playerId, cardId, targetColor) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    // Find all opponents who have properties of this color
    const affectedPlayers = state.players.filter(p => p.id !== playerId && Rules.countColor(p, targetColor) > 0).map(p => p.id);

    state.pendingAction = {
      type: 'super_sly_deal',
      from: playerId,
      targetColor,
      affectedPlayers: [...affectedPlayers],
      respondQueue: [...affectedPlayers],
      currentResponder: affectedPlayers[0] || null,
      cancelledPlayers: [],
    };
    state.phase = 'respond';
    state.log.push({ type: 'super_sly_deal', player: playerId, color: targetColor });
    return {};
  },

  playRepossession(state, playerId, cardId, targetId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'repossession',
      from: playerId,
      targetId,
      respondQueue: [targetId],
      currentResponder: targetId,
      cancelled: false,
    };
    state.phase = 'respond';
    state.log.push({ type: 'repossession', player: playerId, target: targetId });
    return {};
  },

  playToughLuck(state, playerId, cardId, targetId, cardType) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'tough_luck',
      from: playerId,
      targetId,
      cardType, // 'property' | 'money' | 'action'
      respondQueue: [targetId],
      currentResponder: targetId,
      cancelled: false,
    };
    state.phase = 'respond';
    state.log.push({ type: 'tough_luck', player: playerId, target: targetId, cardType });
    return {};
  },

  playYoink(state, playerId, cardId, targetId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'yoink',
      from: playerId,
      targets: [{ playerId: targetId, amount: 10, paid: false, cancelled: false }],
      respondQueue: [targetId],
      currentResponder: targetId,
    };
    state.phase = 'respond';
    state.log.push({ type: 'yoink', player: playerId, target: targetId });
    return {};
  },

  playUnfairTrade(state, playerId, cardId, targetId) {
    if (state.turnPlaysRemaining <= 0) return { error: 'No plays remaining' };
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);
    state.turnPlaysRemaining--;

    state.pendingAction = {
      type: 'unfair_trade',
      from: playerId,
      targetId,
      respondQueue: [targetId],
      currentResponder: targetId,
      cancelled: false,
    };
    state.phase = 'respond';
    state.log.push({ type: 'unfair_trade', player: playerId, target: targetId });
    return {};
  },

  // ── Response handling (Just Say No chains) ───────────────────────────

  respondJustSayNo(state, playerId, cardId) {
    const player = Rules.getPlayer(state, playerId);
    const card = this.removeFromHand(player, cardId);
    state.discardPile.push(card);

    const pending = state.pendingAction;

    // Toggle cancel state - Just Say No chains
    if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday' || pending.type === 'yoink') {
      const target = pending.targets.find(t => t.playerId === playerId);
      if (target) target.cancelled = !target.cancelled;
    } else {
      pending.cancelled = !pending.cancelled;
    }

    // The other party can now respond with their own Just Say No
    // Set the responder to the other party
    if (pending.from === playerId) {
      // The action initiator countered, so the target can respond again
      if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday' || pending.type === 'yoink') {
        pending.currentResponder = pending.respondQueue.find(t => {
            const tgt = pending.targets.find(tt => tt.playerId === t);
            return tgt && tgt.cancelled;
          }) || null;
      } else if (pending.type === 'super_sly_deal') {
        // Find which affected player was cancelled
        pending.currentResponder = pending.respondQueue.find(t => pending.cancelledPlayers.includes(t)) || null;
      } else {
        pending.currentResponder = pending.targetId;
      }
    } else {
      // Target said no, action initiator can counter
      if (pending.type === 'super_sly_deal') {
        // Track cancelled players for super sly deal
        if (!pending.cancelledPlayers.includes(playerId)) {
          pending.cancelledPlayers.push(playerId);
        } else {
          // Un-cancel (JSN chain)
          pending.cancelledPlayers = pending.cancelledPlayers.filter(id => id !== playerId);
        }
      }
      pending.currentResponder = pending.from;
    }

    state.log.push({ type: 'just_say_no', player: playerId });
    return {};
  },

  respondAccept(state, playerId) {
    const pending = state.pendingAction;

    if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday' || pending.type === 'yoink') {
      // Move to next responder or start payment phase
      const idx = pending.respondQueue.indexOf(playerId);
      if (idx !== -1) pending.respondQueue.splice(idx, 1);

      if (pending.currentResponder === playerId) {
        pending.currentResponder = pending.respondQueue[0] || null;
      }

      if (pending.respondQueue.length === 0 || pending.currentResponder === null) {
        // All responded, now collect payments
        for (const t of pending.targets) {
          if (!t.cancelled && !t.paid) {
            const p = Rules.getPlayer(state, t.playerId);
            if (Rules.totalAssets(p) === 0) {
              t.paid = true;
              state.log.push({ type: 'skip_payment', player: t.playerId, reason: 'no_assets' });
            }
          }
        }
        const unpaid = pending.targets.filter(t => !t.cancelled && !t.paid);
        if (unpaid.length > 0) {
          state.phase = 'pay';
          pending.currentPayer = unpaid[0].playerId;
        } else {
          this._resolveAction(state);
        }
      }
    } else if (pending.type === 'super_sly_deal') {
      // Each affected player can accept or JSN individually
      const idx = pending.respondQueue.indexOf(playerId);
      if (idx !== -1) pending.respondQueue.splice(idx, 1);

      if (pending.currentResponder === playerId) {
        pending.currentResponder = pending.respondQueue[0] || null;
      }

      if (pending.respondQueue.length === 0 || pending.currentResponder === null) {
        // Execute: steal all of targetColor from each non-cancelled player
        this._executeSuperSlyDeal(state);
        this._resolveAction(state);
      }
    } else if (pending.type === 'repossession') {
      if (!pending.cancelled) {
        this._executeRepossession(state);
      }
      this._resolveAction(state);
    } else if (pending.type === 'tough_luck') {
      if (!pending.cancelled) {
        this._executeToughLuck(state);
      }
      this._resolveAction(state);
    } else if (pending.type === 'unfair_trade') {
      if (!pending.cancelled) {
        this._executeUnfairTrade(state);
      }
      this._resolveAction(state);
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

    // Check for next payer, skipping those with no assets
    let nextUnpaid = pending.targets.find(t => !t.cancelled && !t.paid);
    while (nextUnpaid) {
      const np = Rules.getPlayer(state, nextUnpaid.playerId);
      if (Rules.totalAssets(np) === 0) {
        nextUnpaid.paid = true;
        state.log.push({ type: 'skip_payment', player: nextUnpaid.playerId, reason: 'no_assets' });
        nextUnpaid = pending.targets.find(t => !t.cancelled && !t.paid);
      } else {
        break;
      }
    }
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
        // Include houses/hotels/shacks attached to this color
        if ((c.actionType === ACTION_TYPE.HOUSE || c.actionType === ACTION_TYPE.HOTEL || c.actionType === ACTION_TYPE.SHACK) && c.attachedColor === color) return true;
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

  _executeSuperSlyDeal(state) {
    const pending = state.pendingAction;
    const from = Rules.getPlayer(state, pending.from);
    const color = pending.targetColor;

    for (const pid of pending.affectedPlayers) {
      if (pending.cancelledPlayers.includes(pid)) continue;
      const target = Rules.getPlayer(state, pid);
      const toSteal = target.properties.filter(c => {
        if (c.type === CARD_TYPE.PROPERTY) return c.color === color;
        if (c.type === CARD_TYPE.WILD_PROPERTY) return c.currentColor === color;
        // Include shacks/houses/hotels attached to this color
        if ((c.actionType === ACTION_TYPE.SHACK || c.actionType === ACTION_TYPE.HOUSE || c.actionType === ACTION_TYPE.HOTEL) && c.attachedColor === color) return true;
        return false;
      });
      for (const card of toSteal) {
        const idx = target.properties.indexOf(card);
        if (idx !== -1) {
          target.properties.splice(idx, 1);
          from.properties.push(card);
        }
      }
    }
  },

  _executeRepossession(state) {
    const pending = state.pendingAction;
    const from = Rules.getPlayer(state, pending.from);
    const target = Rules.getPlayer(state, pending.targetId);

    // Target must give all but one property to other players
    // For simplicity: properties go to the initiator (who played the card)
    // The target keeps their most valuable property
    const propCards = target.properties.filter(c => c.type === CARD_TYPE.PROPERTY || c.type === CARD_TYPE.WILD_PROPERTY);
    if (propCards.length <= 1) return;

    // Sort by value descending - keep the highest
    propCards.sort((a, b) => b.value - a.value);
    const keepCard = propCards[0];

    // Distribute the rest among other players (round-robin, excluding target)
    const recipients = state.players.filter(p => p.id !== pending.targetId);
    let recipientIdx = 0;

    // Also move any attached upgrades (shacks, houses, hotels)
    const allToGive = target.properties.filter(c => c !== keepCard && !(c.attachedColor && c.attachedColor === (keepCard.currentColor || keepCard.color)));

    for (const card of allToGive) {
      const idx = target.properties.indexOf(card);
      if (idx !== -1) {
        target.properties.splice(idx, 1);
        recipients[recipientIdx % recipients.length].properties.push(card);
        recipientIdx++;
      }
    }

    state.log.push({ type: 'repossession_done', target: pending.targetId, cardsGiven: allToGive.length });
  },

  _executeToughLuck(state) {
    const pending = state.pendingAction;
    const from = Rules.getPlayer(state, pending.from);
    const target = Rules.getPlayer(state, pending.targetId);
    const cardType = pending.cardType;

    const stolen = [];
    const toSteal = target.hand.filter(c => {
      if (cardType === 'property') return c.type === CARD_TYPE.PROPERTY || c.type === CARD_TYPE.WILD_PROPERTY;
      if (cardType === 'money') return c.type === CARD_TYPE.MONEY;
      if (cardType === 'action') return c.type === CARD_TYPE.ACTION;
      return false;
    });

    for (const card of toSteal) {
      const idx = target.hand.indexOf(card);
      if (idx !== -1) {
        target.hand.splice(idx, 1);
        from.hand.push(card);
        stolen.push(card);
      }
    }

    state.log.push({ type: 'tough_luck_done', from: pending.from, target: pending.targetId, cardType, count: stolen.length });
  },

  _executeUnfairTrade(state) {
    const pending = state.pendingAction;
    const from = Rules.getPlayer(state, pending.from);
    const target = Rules.getPlayer(state, pending.targetId);

    // Swap banks
    const tempBank = from.bank;
    from.bank = target.bank;
    target.bank = tempBank;

    state.log.push({ type: 'unfair_trade_done', from: pending.from, target: pending.targetId });
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
if (typeof window !== 'undefined') {
  window.MonopolyGameEngine = GameEngine;
  window.GameEngine = GameEngine;
}

})();
