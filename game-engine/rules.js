// Monopoly Deal - Rules Engine
// Pure validation functions — no side effects

// Wrap in IIFE to avoid redeclaring const variables from deck.js in the
// global scope (which would cause a SyntaxError in the browser).
;(function () {

const {
  COLORS, SET_REQUIREMENTS, RENT_VALUES, CARD_TYPE, ACTION_TYPE,
} = typeof require !== 'undefined'
  ? require('./deck.js')
  : window.MonopolyDeck;

const Rules = {

  // ── helpers ──────────────────────────────────────────────────────────

  getPlayer(state, playerId) {
    return state.players.find(p => p.id === playerId);
  },

  isCurrentPlayer(state, playerId) {
    return state.currentPlayer === playerId;
  },

  canPlayCards(state) {
    return state.turnPlaysRemaining > 0;
  },

  getCardFromHand(player, cardId) {
    return player.hand.find(c => c.id === cardId);
  },

  // Count how many properties of a given color a player has (including wilds)
  countColor(player, color) {
    let count = 0;
    for (const card of player.properties) {
      if (card.type === CARD_TYPE.PROPERTY && card.color === color) count++;
      if (card.type === CARD_TYPE.WILD_PROPERTY && card.currentColor === color) count++;
    }
    return count;
  },

  isSetComplete(player, color) {
    const required = SET_REQUIREMENTS[color];
    if (!required) return false;
    return this.countColor(player, color) >= required;
  },

  getCompletedSets(player) {
    const sets = [];
    for (const color of Object.values(COLORS)) {
      if (this.isSetComplete(player, color)) {
        sets.push(color);
      }
    }
    return sets;
  },

  hasWon(player) {
    return this.getCompletedSets(player).length >= 3;
  },

  // Total bank value
  bankTotal(player) {
    return player.bank.reduce((s, c) => s + c.value, 0);
  },

  // Total property value (for payments)
  propertyTotal(player) {
    return player.properties.reduce((s, c) => s + c.value, 0);
  },

  totalAssets(player) {
    return this.bankTotal(player) + this.propertyTotal(player);
  },

  // Count houses/hotels on a given color set
  countHousesOnColor(player, color) {
    return player.properties.filter(c => c.actionType === ACTION_TYPE.HOUSE && c.attachedColor === color).length;
  },

  countHotelsOnColor(player, color) {
    return player.properties.filter(c => c.actionType === ACTION_TYPE.HOTEL && c.attachedColor === color).length;
  },

  // Rent for a given color (includes house/hotel bonuses)
  rentAmount(player, color) {
    const count = this.countColor(player, color);
    const table = RENT_VALUES[color];
    if (!table || count === 0) return 0;
    let rent = table[Math.min(count, table.length) - 1];
    // Add house bonus (3M each) and hotel bonus (4M each)
    rent += this.countHousesOnColor(player, color) * 3;
    rent += this.countHotelsOnColor(player, color) * 4;
    return rent;
  },

  // Is a property part of a completed set?
  isInCompletedSet(player, card) {
    if (card.actionType === ACTION_TYPE.HOUSE || card.actionType === ACTION_TYPE.HOTEL) {
      return card.attachedColor ? this.isSetComplete(player, card.attachedColor) : false;
    }
    const color = card.type === CARD_TYPE.WILD_PROPERTY ? card.currentColor : card.color;
    return this.isSetComplete(player, color);
  },

  // ── validation ───────────────────────────────────────────────────────

  validatePlayProperty(state, playerId, cardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.type !== CARD_TYPE.PROPERTY && card.type !== CARD_TYPE.WILD_PROPERTY) {
      return { valid: false, reason: 'Not a property card' };
    }
    return { valid: true };
  },

  validateBankCard(state, playerId, cardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    // Property cards cannot be banked — they must be played as properties
    if (card.type === CARD_TYPE.PROPERTY || card.type === CARD_TYPE.WILD_PROPERTY) {
      return { valid: false, reason: 'Property cards cannot be banked' };
    }
    return { valid: true };
  },

  validatePassGo(state, playerId, cardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.PASS_GO) return { valid: false, reason: 'Not a Pass Go card' };
    return { valid: true };
  },

  validateRent(state, playerId, cardId, targetColor, doubleCardId, targetPlayerId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };

    if (card.actionType === ACTION_TYPE.RENT) {
      if (!card.rentColors.includes(targetColor)) {
        return { valid: false, reason: 'Invalid rent color for this card' };
      }
    } else if (card.actionType === ACTION_TYPE.MULTI_RENT) {
      if (!Object.values(COLORS).includes(targetColor)) {
        return { valid: false, reason: 'Invalid color' };
      }
      // Multi rent requires choosing a single target player
      if (!targetPlayerId) return { valid: false, reason: 'Must choose a target player for Multi Rent' };
      if (targetPlayerId === playerId) return { valid: false, reason: 'Cannot target yourself' };
      if (!this.getPlayer(state, targetPlayerId)) return { valid: false, reason: 'Target player not found' };
    } else {
      return { valid: false, reason: 'Not a rent card' };
    }

    if (this.countColor(player, targetColor) === 0) {
      return { valid: false, reason: 'You have no properties of that color' };
    }

    // Validate optional double-the-rent
    let playsNeeded = 1;
    if (doubleCardId) {
      const doubleCard = this.getCardFromHand(player, doubleCardId);
      if (!doubleCard || doubleCard.actionType !== ACTION_TYPE.DOUBLE_RENT) {
        return { valid: false, reason: 'Invalid Double The Rent card' };
      }
      playsNeeded = 2;
    }
    if (state.turnPlaysRemaining < playsNeeded) {
      return { valid: false, reason: 'Not enough plays remaining for rent + double' };
    }

    return { valid: true };
  },

  validateDebtCollector(state, playerId, cardId, targetId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.DEBT_COLLECTOR) return { valid: false, reason: 'Not a Debt Collector' };
    if (targetId === playerId) return { valid: false, reason: 'Cannot target yourself' };
    if (!this.getPlayer(state, targetId)) return { valid: false, reason: 'Target not found' };
    return { valid: true };
  },

  validateBirthday(state, playerId, cardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.BIRTHDAY) return { valid: false, reason: 'Not a Birthday card' };
    return { valid: true };
  },

  validateSlyDeal(state, playerId, cardId, targetId, targetCardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.SLY_DEAL) return { valid: false, reason: 'Not a Sly Deal' };
    if (targetId === playerId) return { valid: false, reason: 'Cannot target yourself' };
    const target = this.getPlayer(state, targetId);
    if (!target) return { valid: false, reason: 'Target not found' };
    const targetCard = target.properties.find(c => c.id === targetCardId);
    if (!targetCard) return { valid: false, reason: 'Target card not found' };
    if (this.isInCompletedSet(target, targetCard)) {
      return { valid: false, reason: 'Cannot steal from a completed set' };
    }
    return { valid: true };
  },

  validateForcedDeal(state, playerId, cardId, targetId, targetCardId, myCardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.FORCED_DEAL) return { valid: false, reason: 'Not a Forced Deal' };
    if (targetId === playerId) return { valid: false, reason: 'Cannot target yourself' };
    const target = this.getPlayer(state, targetId);
    if (!target) return { valid: false, reason: 'Target not found' };
    const targetCard = target.properties.find(c => c.id === targetCardId);
    if (!targetCard) return { valid: false, reason: 'Target card not found' };
    if (this.isInCompletedSet(target, targetCard)) {
      return { valid: false, reason: 'Cannot take from a completed set' };
    }
    const myCard = player.properties.find(c => c.id === myCardId);
    if (!myCard) return { valid: false, reason: 'Your property not found' };
    if (this.isInCompletedSet(player, myCard)) {
      return { valid: false, reason: 'Cannot give from your completed set' };
    }
    return { valid: true };
  },

  validateDealBreaker(state, playerId, cardId, targetId, targetColor) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.DEAL_BREAKER) return { valid: false, reason: 'Not a Deal Breaker' };
    if (targetId === playerId) return { valid: false, reason: 'Cannot target yourself' };
    const target = this.getPlayer(state, targetId);
    if (!target) return { valid: false, reason: 'Target not found' };
    if (!this.isSetComplete(target, targetColor)) {
      return { valid: false, reason: 'Target set is not complete' };
    }
    return { valid: true };
  },

  validateJustSayNo(state, playerId, cardId) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.JUST_SAY_NO) return { valid: false, reason: 'Not a Just Say No' };
    return { valid: true };
  },

  validatePayment(state, playerId, bankCardIds, propertyCardIds, amount) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };

    let total = 0;
    for (const id of bankCardIds) {
      const c = player.bank.find(b => b.id === id);
      if (!c) return { valid: false, reason: 'Bank card not found: ' + id };
      total += c.value;
    }
    for (const id of propertyCardIds) {
      const c = player.properties.find(p => p.id === id);
      if (!c) return { valid: false, reason: 'Property card not found: ' + id };
      total += c.value;
    }

    // Player must pay what they can (cannot underpay if they have assets)
    const totalAssets = this.totalAssets(player);
    const requiredPayment = Math.min(amount, totalAssets);
    if (total < requiredPayment) {
      return { valid: false, reason: 'Insufficient payment' };
    }
    return { valid: true };
  },

  validateMoveWild(state, playerId, cardId, newColor) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    const card = player.properties.find(c => c.id === cardId);
    if (!card) return { valid: false, reason: 'Card not in properties' };
    if (card.type !== CARD_TYPE.WILD_PROPERTY) return { valid: false, reason: 'Not a wild property' };
    if (card.colors[0] === 'all') {
      if (!Object.values(COLORS).includes(newColor)) return { valid: false, reason: 'Invalid color' };
    } else {
      if (!card.colors.includes(newColor)) return { valid: false, reason: 'Wild cannot be that color' };
    }
    // Cannot move out of a completed set
    if (this.isInCompletedSet(player, card)) {
      return { valid: false, reason: 'Cannot move wild from completed set' };
    }
    return { valid: true };
  },

  validatePlayHouseHotel(state, playerId, cardId, targetColor) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    if (!this.canPlayCards(state)) return { valid: false, reason: 'No plays remaining' };
    const card = this.getCardFromHand(player, cardId);
    if (!card) return { valid: false, reason: 'Card not in hand' };
    if (card.actionType !== ACTION_TYPE.HOUSE && card.actionType !== ACTION_TYPE.HOTEL) {
      return { valid: false, reason: 'Not a House or Hotel card' };
    }
    if (!targetColor) return { valid: false, reason: 'Must specify a target color' };
    // Cannot add to railroad or utility sets
    if (targetColor === COLORS.RAILROAD || targetColor === COLORS.UTILITY) {
      return { valid: false, reason: 'Cannot add houses/hotels to railroad or utility sets' };
    }
    // Must be a complete set
    if (!this.isSetComplete(player, targetColor)) {
      return { valid: false, reason: 'Can only add to a complete property set' };
    }
    return { valid: true };
  },

  validateEndTurn(state, playerId) {
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    // Check if there's a pending action that needs resolution
    if (state.pendingAction) return { valid: false, reason: 'Must resolve pending action first' };
    return { valid: true };
  },

  validateDiscard(state, playerId, cardIds) {
    const player = this.getPlayer(state, playerId);
    if (!player) return { valid: false, reason: 'Player not found' };
    if (!this.isCurrentPlayer(state, playerId)) return { valid: false, reason: 'Not your turn' };
    const handAfter = player.hand.length - cardIds.length;
    if (handAfter > 7) return { valid: false, reason: 'Must discard to 7 cards' };
    for (const id of cardIds) {
      if (!player.hand.find(c => c.id === id)) return { valid: false, reason: 'Card not in hand' };
    }
    return { valid: true };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Rules };
}
if (typeof window !== 'undefined') {
  window.MonopolyRules = Rules;
}

})();
