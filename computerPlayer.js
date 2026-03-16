// Computer Player AI for Monopoly Deal
// Strategic AI that prioritizes completing three property sets

const ComputerPlayer = (() => {

  const COMPUTER_NAMES = ['Bot Alice', 'Bot Bob', 'Bot Charlie'];

  // Delay between computer actions (ms) for readability
  const ACTION_DELAY = 800;

  const SET_REQS = {
    brown: 2, darkblue: 2, lightblue: 3, pink: 3, orange: 3,
    red: 3, yellow: 3, green: 3, railroad: 4, utility: 2,
  };

  const RENT_VALUES = {
    brown: [1, 2], darkblue: [3, 8], lightblue: [1, 2, 3],
    pink: [1, 2, 4], orange: [1, 3, 5], red: [2, 3, 6],
    yellow: [2, 4, 6], green: [2, 4, 7], railroad: [1, 2, 3, 4],
    utility: [1, 2],
  };

  const ALL_COLORS = Object.keys(SET_REQS);

  // Cards we should never bank or discard lightly
  const POWERFUL_ACTIONS = ['deal_breaker', 'just_say_no', 'sly_deal', 'super_sly_deal', 'repossession'];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Utility helpers ───────────────────────────────────────────────────

  function countPlayerColor(player, color) {
    let count = 0;
    for (const card of player.properties) {
      if (card.type === 'property' && card.color === color) count++;
      if (card.type === 'wild_property' && card.currentColor === color) count++;
    }
    return count;
  }

  function isSetComplete(player, color) {
    return countPlayerColor(player, color) >= SET_REQS[color];
  }

  function getCompletedSets(player) {
    return ALL_COLORS.filter(c => isSetComplete(player, c));
  }

  function bankTotal(player) {
    return player.bank.reduce((s, c) => s + c.value, 0);
  }

  function totalAssets(player) {
    const bank = player.bank.reduce((s, c) => s + c.value, 0);
    const props = player.properties.reduce((s, c) => s + c.value, 0);
    return bank + props;
  }

  function completionRatio(player, color) {
    const count = countPlayerColor(player, color);
    const req = SET_REQS[color];
    return count / req;
  }

  function cardsNeeded(player, color) {
    return Math.max(0, SET_REQS[color] - countPlayerColor(player, color));
  }

  function rentAmount(player, color) {
    const count = countPlayerColor(player, color);
    const table = RENT_VALUES[color];
    if (!table || count === 0) return 0;
    return table[Math.min(count, table.length) - 1];
  }

  // Check if a property card is part of a completed set
  function isInCompletedSet(player, card) {
    if (card.actionType === 'house' || card.actionType === 'hotel' || card.actionType === 'shack') {
      return card.attachedColor ? isSetComplete(player, card.attachedColor) : false;
    }
    const color = card.type === 'wild_property' ? card.currentColor : card.color;
    return isSetComplete(player, color);
  }

  // Get the most dangerous opponent (closest to winning)
  function getMostThreateningOpponent(state, computerId) {
    const opponents = state.players.filter(p => p.id !== computerId);
    let worst = null;
    let worstSets = -1;
    for (const opp of opponents) {
      const sets = getCompletedSets(opp).length;
      if (sets > worstSets) {
        worstSets = sets;
        worst = opp;
      }
    }
    return worst;
  }

  // Get opponents with 2 completed sets (close to winning)
  function getThreateningOpponents(state, computerId) {
    return state.players.filter(p =>
      p.id !== computerId && getCompletedSets(p).length >= 2
    );
  }

  function chooseRichestOpponent(state, computerId) {
    const opponents = state.players.filter(p => p.id !== computerId);
    if (opponents.length === 0) return null;
    let richest = opponents[0];
    let maxAssets = totalAssets(opponents[0]);
    for (const opp of opponents.slice(1)) {
      const assets = totalAssets(opp);
      if (assets > maxAssets) {
        maxAssets = assets;
        richest = opp;
      }
    }
    return richest;
  }

  // Get colors sorted by completion ratio (highest first), excluding complete sets
  function getColorsByPriority(player) {
    return ALL_COLORS
      .filter(c => !isSetComplete(player, c))
      .map(c => ({ color: c, ratio: completionRatio(player, c), needed: cardsNeeded(player, c) }))
      .filter(c => c.ratio > 0) // only colors we have at least one card in
      .sort((a, b) => {
        // Higher ratio first; break ties by fewer cards needed
        if (b.ratio !== a.ratio) return b.ratio - a.ratio;
        return a.needed - b.needed;
      });
  }

  // ── Win detection ─────────────────────────────────────────────────────

  // Check if playing a specific card as a given color would win
  function wouldWinWithProperty(player, color) {
    const currentSets = getCompletedSets(player);
    if (currentSets.length < 2) return false;
    // Would this color become complete with one more card?
    if (isSetComplete(player, color)) return false; // already complete
    if (cardsNeeded(player, color) === 1) {
      // Check if this would create a NEW completed set (not one already counted)
      return !currentSets.includes(color);
    }
    return false;
  }

  // Check if stealing a completed set via Deal Breaker would win
  function wouldWinWithDealBreaker(player) {
    return getCompletedSets(player).length >= 2;
  }

  // Find a property card in hand that would complete a winning set
  function findWinningPropertyPlay(player) {
    for (const card of player.hand) {
      if (card.type === 'property') {
        if (wouldWinWithProperty(player, card.color)) {
          return { card, color: card.color };
        }
      }
      if (card.type === 'wild_property') {
        const colors = card.colors[0] === 'all' ? ALL_COLORS : card.colors;
        for (const color of colors) {
          if (wouldWinWithProperty(player, color)) {
            return { card, color };
          }
        }
      }
    }
    return null;
  }

  // Find a wild card already on the board that could be moved to win
  function findWinningWildMove(player) {
    const currentSets = getCompletedSets(player);
    if (currentSets.length < 2) return null;

    for (const card of player.properties) {
      if (card.type !== 'wild_property') continue;
      if (isInCompletedSet(player, card)) continue; // can't move from completed set

      const possibleColors = card.colors[0] === 'all' ? ALL_COLORS : card.colors;
      for (const color of possibleColors) {
        if (color === card.currentColor) continue;
        if (isSetComplete(player, color)) continue;
        if (cardsNeeded(player, color) === 1 && !currentSets.includes(color)) {
          return { card, newColor: color };
        }
      }
    }
    return null;
  }

  // Find a Sly Deal that would complete a winning set
  function findWinningSlyDeal(player, state, computerId) {
    const currentSets = getCompletedSets(player);
    if (currentSets.length < 2) return null;

    const slyDeal = player.hand.find(c => c.actionType === 'sly_deal');
    if (!slyDeal) return null;

    // Find a property we need from opponents (not in their completed sets)
    for (const color of ALL_COLORS) {
      if (isSetComplete(player, color)) continue;
      if (cardsNeeded(player, color) !== 1) continue;
      if (currentSets.includes(color)) continue;

      for (const opp of state.players) {
        if (opp.id === computerId) continue;
        for (const card of opp.properties) {
          const cardColor = card.type === 'wild_property' ? card.currentColor : card.color;
          if (cardColor === color && !isInCompletedSet(opp, card)) {
            return { slyDeal, targetId: opp.id, targetCardId: card.id };
          }
        }
      }
    }
    return null;
  }

  // ── Main turn logic ───────────────────────────────────────────────────

  async function takeTurn(state, computerId, callbacks) {
    if (state.phase === 'draw' && state.currentPlayer === computerId) {
      await delay(ACTION_DELAY);
      callbacks.drawCards();
      return;
    }

    if (state.phase === 'play' && state.currentPlayer === computerId) {
      await playPhase(state, computerId, callbacks);
      return;
    }

    if (state.phase === 'discard' && state.currentPlayer === computerId) {
      await delay(ACTION_DELAY);
      discardPhase(state, computerId, callbacks);
      return;
    }
  }

  async function playPhase(state, computerId, callbacks) {
    const player = state.players.find(p => p.id === computerId);
    if (!player || state.turnPlaysRemaining <= 0) {
      await delay(ACTION_DELAY);
      callbacks.endTurn();
      return;
    }

    await delay(ACTION_DELAY);

    const myCompletedSets = getCompletedSets(player);
    const defensiveMode = myCompletedSets.length >= 2;

    // ── PRIORITY 1: Check for instant win ────────────────────────────

    // 1a: Win by playing a property/wild from hand
    const winProp = findWinningPropertyPlay(player);
    if (winProp) {
      if (winProp.card.type === 'wild_property') {
        callbacks.playProperty(winProp.card.id, winProp.color);
      } else {
        callbacks.playProperty(winProp.card.id);
      }
      return;
    }

    // 1b: Win by moving a wild card already on the board
    const winWild = findWinningWildMove(player);
    if (winWild) {
      callbacks.moveWild(winWild.card.id, winWild.newColor);
      // moveWild doesn't use a play, so continue playing
      // Re-enter playPhase to check if we now win or do other actions
      return;
    }

    // 1c: Win by Deal Breaker (steal a set to get 3rd completed set)
    if (wouldWinWithDealBreaker(player)) {
      const dealBreaker = player.hand.find(c => c.actionType === 'deal_breaker');
      if (dealBreaker) {
        const target = findDealBreakerTarget(state, computerId);
        if (target) {
          callbacks.playDealBreaker(dealBreaker.id, target.targetId, target.color);
          return;
        }
      }
    }

    // 1d: Win by Sly Deal (steal one card to complete 3rd set)
    const winningSly = findWinningSlyDeal(player, state, computerId);
    if (winningSly) {
      callbacks.playSlyDeal(winningSly.slyDeal.id, winningSly.targetId, winningSly.targetCardId);
      return;
    }

    // ── PRIORITY 2: Disrupt opponents close to winning ───────────────

    const threats = getThreateningOpponents(state, computerId);
    if (threats.length > 0 && !defensiveMode) {
      const disrupted = tryDisruptOpponent(player, state, computerId, threats, callbacks);
      if (disrupted) return;
    }

    // ── DEFENSIVE MODE: Bank aggressively if we have 2 sets ──────────

    if (defensiveMode) {
      // Play properties that advance toward the 3rd set
      const propPlay = findBestPropertyPlay(player);
      if (propPlay) {
        if (propPlay.card.type === 'wild_property') {
          callbacks.playProperty(propPlay.card.id, propPlay.color);
        } else {
          callbacks.playProperty(propPlay.card.id);
        }
        return;
      }

      // Charge high rent
      const rentPlay = findBestRentPlay(player, state, computerId);
      if (rentPlay && rentPlay.amount >= 3) {
        if (rentPlay.isDoubleRentAlone) {
          callbacks.playDoubleRentAlone(rentPlay.cardId, rentPlay.color);
        } else if (rentPlay.isNmRent) {
          callbacks.playNmRent(rentPlay.cardId, rentPlay.color, rentPlay.doubleCardId || null);
        } else {
          const rentTarget = rentPlay.isMultiRent ? chooseRichestOpponent(state, computerId)?.id : undefined;
          if (rentPlay.doubleCardId) {
            callbacks.playRent(rentPlay.cardId, rentPlay.color, rentPlay.doubleCardId, rentTarget);
          } else {
            callbacks.playRent(rentPlay.cardId, rentPlay.color, undefined, rentTarget);
          }
        }
        return;
      }

      // Bank aggressively in defensive mode
      const banked = tryBankCard(player, callbacks, true);
      if (banked) return;

      // Play Pass Go for more cards
      const passGo = player.hand.find(c => c.actionType === 'pass_go');
      if (passGo) {
        callbacks.playPassGo(passGo.id);
        return;
      }
      const nmPassGoD = player.hand.find(c => c.actionType === 'nm_pass_go');
      if (nmPassGoD) {
        callbacks.playNmPassGo(nmPassGoD.id);
        return;
      }

      callbacks.endTurn();
      return;
    }

    // ── NORMAL MODE: Build sets and generate money ───────────────────

    // Priority 3: Play property/wild cards that build toward sets
    const propPlay = findBestPropertyPlay(player);
    if (propPlay) {
      if (propPlay.card.type === 'wild_property') {
        callbacks.playProperty(propPlay.card.id, propPlay.color);
      } else {
        callbacks.playProperty(propPlay.card.id);
      }
      return;
    }

    // Priority 3b: Play shack/house/hotel cards onto complete sets
    const shackCard = player.hand.find(c => c.actionType === 'shack');
    if (shackCard) {
      const eligibleSetsForShack = getCompletedSets(player);
      if (eligibleSetsForShack.length > 0) {
        let bestColor = eligibleSetsForShack[0];
        let bestRent = rentAmount(player, eligibleSetsForShack[0]);
        for (const color of eligibleSetsForShack.slice(1)) {
          const r = rentAmount(player, color);
          if (r > bestRent) { bestRent = r; bestColor = color; }
        }
        callbacks.playShack(shackCard.id, bestColor);
        return;
      }
    }

    const houseHotelCard = player.hand.find(c => c.actionType === 'house' || c.actionType === 'hotel');
    if (houseHotelCard) {
      const eligibleSets = getCompletedSets(player).filter(c => c !== 'railroad' && c !== 'utility');
      if (eligibleSets.length > 0) {
        // Pick the set with the highest base rent to maximize benefit
        let bestColor = eligibleSets[0];
        let bestRent = rentAmount(player, eligibleSets[0]);
        for (const color of eligibleSets.slice(1)) {
          const r = rentAmount(player, color);
          if (r > bestRent) {
            bestRent = r;
            bestColor = color;
          }
        }
        callbacks.playHouseHotel(houseHotelCard.id, bestColor);
        return;
      }
    }

    // Priority 4: Deal Breaker to steal a completed set (even if not winning)
    const dealBreaker = player.hand.find(c => c.actionType === 'deal_breaker');
    if (dealBreaker) {
      const target = findDealBreakerTarget(state, computerId);
      if (target) {
        callbacks.playDealBreaker(dealBreaker.id, target.targetId, target.color);
        return;
      }
    }

    // Priority 5: Sly Deal to advance our sets
    const slyPlay = findBestSlyDeal(player, state, computerId);
    if (slyPlay) {
      callbacks.playSlyDeal(slyPlay.slyDeal.id, slyPlay.targetId, slyPlay.targetCardId);
      return;
    }

    // Priority 6: Forced Deal to trade weak properties for needed ones
    const forcedPlay = findBestForcedDeal(player, state, computerId);
    if (forcedPlay) {
      callbacks.playForcedDeal(forcedPlay.forcedDeal.id, forcedPlay.targetId,
        forcedPlay.targetCardId, forcedPlay.myCardId);
      return;
    }

    // Priority 7: Play rent (especially if high payout or double rent available)
    const rentPlay = findBestRentPlay(player, state, computerId);
    if (rentPlay) {
      if (rentPlay.isDoubleRentAlone) {
        callbacks.playDoubleRentAlone(rentPlay.cardId, rentPlay.color);
      } else if (rentPlay.isNmRent) {
        callbacks.playNmRent(rentPlay.cardId, rentPlay.color, rentPlay.doubleCardId || null);
      } else {
        const rentTarget = rentPlay.isMultiRent ? chooseRichestOpponent(state, computerId)?.id : undefined;
        if (rentPlay.doubleCardId) {
          callbacks.playRent(rentPlay.cardId, rentPlay.color, rentPlay.doubleCardId, rentTarget);
        } else {
          callbacks.playRent(rentPlay.cardId, rentPlay.color, undefined, rentTarget);
        }
      }
      return;
    }

    // Priority 8: Play Pass Go for card advantage
    const passGo = player.hand.find(c => c.actionType === 'pass_go');
    if (passGo) {
      callbacks.playPassGo(passGo.id);
      return;
    }

    // Priority 9: Play Debt Collector (target richest opponent)
    const debtCollector = player.hand.find(c => c.actionType === 'debt_collector');
    if (debtCollector) {
      const target = chooseRichestOpponent(state, computerId);
      if (target) {
        callbacks.playDebtCollector(debtCollector.id, target.id);
        return;
      }
    }

    // Priority 10: Play Birthday
    const birthday = player.hand.find(c => c.actionType === 'birthday');
    if (birthday) {
      callbacks.playBirthday(birthday.id);
      return;
    }

    // ── No Mercy-specific action cards ──

    // Super Sly Deal: steal all of a color from all opponents
    const superSlyDeal = player.hand.find(c => c.actionType === 'super_sly_deal');
    if (superSlyDeal) {
      // Pick the color with the most opponent properties
      let bestColor = null;
      let bestCount = 0;
      for (const color of ALL_COLORS) {
        let count = 0;
        for (const opp of state.players) {
          if (opp.id === computerId) continue;
          count += countPlayerColor(opp, color);
        }
        if (count > bestCount) { bestCount = count; bestColor = color; }
      }
      if (bestColor && bestCount > 0) {
        callbacks.playSuperSlyDeal(superSlyDeal.id, bestColor);
        return;
      }
    }

    // Repossession: target player with the most properties
    const repossession = player.hand.find(c => c.actionType === 'repossession');
    if (repossession) {
      let bestTarget = null;
      let maxProps = 1; // must have >1 property to be worth it
      for (const opp of state.players) {
        if (opp.id === computerId) continue;
        if (opp.properties.length > maxProps) {
          maxProps = opp.properties.length;
          bestTarget = opp;
        }
      }
      if (bestTarget) {
        callbacks.playRepossession(repossession.id, bestTarget.id);
        return;
      }
    }

    // Yoink: steal 10M from richest opponent's bank
    const yoink = player.hand.find(c => c.actionType === 'yoink');
    if (yoink) {
      let bestTarget = null;
      let maxBank = 0;
      for (const opp of state.players) {
        if (opp.id === computerId) continue;
        const bk = bankTotal(opp);
        if (bk > maxBank) { maxBank = bk; bestTarget = opp; }
      }
      if (bestTarget && maxBank >= 5) {
        callbacks.playYoink(yoink.id, bestTarget.id);
        return;
      }
    }

    // Tough Luck: steal all of one card type from a player's hand
    const toughLuck = player.hand.find(c => c.actionType === 'tough_luck');
    if (toughLuck) {
      // Target the player with the largest hand, steal properties or actions
      let bestTarget = null;
      let maxHand = 0;
      for (const opp of state.players) {
        if (opp.id === computerId) continue;
        const handSize = opp.hand?.length || opp.handSize || 0;
        if (handSize > maxHand) { maxHand = handSize; bestTarget = opp; }
      }
      if (bestTarget && maxHand > 2) {
        callbacks.playToughLuck(toughLuck.id, bestTarget.id, 'property');
        return;
      }
    }

    // Unfair Trade: swap banks if opponent has more
    const unfairTrade = player.hand.find(c => c.actionType === 'unfair_trade');
    if (unfairTrade) {
      const myBank = bankTotal(player);
      if (myBank > 0) {
        let bestTarget = null;
        let maxBank = myBank;
        for (const opp of state.players) {
          if (opp.id === computerId) continue;
          const bk = bankTotal(opp);
          if (bk > maxBank) { maxBank = bk; bestTarget = opp; }
        }
        if (bestTarget) {
          callbacks.playUnfairTrade(unfairTrade.id, bestTarget.id);
          return;
        }
      }
    }

    // No Mercy Pass Go: draw until 7 in hand
    const nmPassGo = player.hand.find(c => c.actionType === 'nm_pass_go');
    if (nmPassGo) {
      callbacks.playNmPassGo(nmPassGo.id);
      return;
    }

    // Priority 11: Bank money cards (maintain moderate bank 5-10M)
    const banked = tryBankCard(player, callbacks, false);
    if (banked) return;

    // No more useful plays
    callbacks.endTurn();
  }

  // ── Play helpers ────────────────────────────────────────────────────

  function findBestPropertyPlay(player) {
    const priorities = getColorsByPriority(player);

    // First: try to play property cards that advance highest-priority sets
    for (const { color } of priorities) {
      const card = player.hand.find(c =>
        c.type === 'property' && c.color === color
      );
      if (card) return { card, color };
    }

    // Any property card (even starting a new set)
    const anyProp = player.hand.find(c => c.type === 'property');
    if (anyProp) return { card: anyProp, color: anyProp.color };

    // Wild property cards - place on best color
    const wildProp = player.hand.find(c => c.type === 'wild_property');
    if (wildProp) {
      const color = chooseBestColorForWild(player, wildProp);
      return { card: wildProp, color };
    }

    return null;
  }

  function chooseBestColorForWild(player, wildCard) {
    const possibleColors = wildCard.colors[0] === 'all' ? ALL_COLORS : wildCard.colors;

    let bestColor = possibleColors[0];
    let bestRatio = -1;

    for (const color of possibleColors) {
      if (isSetComplete(player, color)) continue;
      const ratio = completionRatio(player, color);
      const needed = cardsNeeded(player, color);
      // Prefer highest ratio; break ties by fewer cards needed
      if (ratio > bestRatio || (ratio === bestRatio && needed < cardsNeeded(player, bestColor))) {
        bestRatio = ratio;
        bestColor = color;
      }
    }

    return bestColor;
  }

  function findDealBreakerTarget(state, computerId) {
    // Prefer stealing from the most threatening opponent
    const opponents = state.players.filter(p => p.id !== computerId);

    // Sort opponents by threat level (most completed sets first)
    opponents.sort((a, b) => getCompletedSets(b).length - getCompletedSets(a).length);

    for (const opp of opponents) {
      const completedColors = getCompletedSets(opp);
      if (completedColors.length > 0) {
        // Steal the highest-value set
        let bestColor = null;
        let bestValue = -1;
        for (const color of completedColors) {
          const maxRent = RENT_VALUES[color][RENT_VALUES[color].length - 1];
          if (maxRent > bestValue) {
            bestValue = maxRent;
            bestColor = color;
          }
        }
        if (bestColor) return { targetId: opp.id, color: bestColor };
      }
    }
    return null;
  }

  function findBestSlyDeal(player, state, computerId) {
    const slyDeal = player.hand.find(c => c.actionType === 'sly_deal');
    if (!slyDeal) return null;

    const priorities = getColorsByPriority(player);

    // Look for a stealable property that advances our best sets
    for (const { color } of priorities) {
      for (const opp of state.players) {
        if (opp.id === computerId) continue;
        for (const card of opp.properties) {
          const cardColor = card.type === 'wild_property' ? card.currentColor : card.color;
          if (cardColor === color && !isInCompletedSet(opp, card)) {
            return { slyDeal, targetId: opp.id, targetCardId: card.id };
          }
        }
      }
    }

    return null;
  }

  function findBestForcedDeal(player, state, computerId) {
    const forcedDeal = player.hand.find(c => c.actionType === 'forced_deal');
    if (!forcedDeal) return null;
    if (player.properties.length === 0) return null;

    const priorities = getColorsByPriority(player);

    // Find a property we can give away (least useful, not in completed set)
    const giveAway = findLeastUsefulProperty(player);
    if (!giveAway) return null;

    // Find a property we want (advances our priority sets)
    for (const { color } of priorities) {
      for (const opp of state.players) {
        if (opp.id === computerId) continue;
        for (const card of opp.properties) {
          const cardColor = card.type === 'wild_property' ? card.currentColor : card.color;
          if (cardColor === color && !isInCompletedSet(opp, card)) {
            return {
              forcedDeal,
              targetId: opp.id,
              targetCardId: card.id,
              myCardId: giveAway.id,
            };
          }
        }
      }
    }

    return null;
  }

  function findLeastUsefulProperty(player) {
    // Find a property that's least valuable to our set completion
    let worstCard = null;
    let worstScore = Infinity;

    for (const card of player.properties) {
      if (isInCompletedSet(player, card)) continue; // never give from completed set

      const color = card.type === 'wild_property' ? card.currentColor : card.color;
      const ratio = completionRatio(player, color);
      // Lower ratio = less useful; also prefer giving away lower-value cards
      const score = ratio * 10 + (card.value || 0);
      if (score < worstScore) {
        worstScore = score;
        worstCard = card;
      }
    }

    return worstCard;
  }

  function findBestRentPlay(player, state, computerId) {
    const rentCards = player.hand.filter(c =>
      c.actionType === 'rent' || c.actionType === 'multi_rent' || c.actionType === 'nm_rent'
    );
    const doubleRent = player.hand.find(c => c.actionType === 'double_rent');

    let bestPlay = null;
    let bestAmount = 0;

    for (const card of rentCards) {
      // nm_rent is universal (any color, charges all opponents)
      const colors = (card.actionType === 'multi_rent' || card.actionType === 'nm_rent')
        ? ALL_COLORS
        : (card.rentColors || []);

      for (const color of colors) {
        const amount = rentAmount(player, color);
        if (amount === 0) continue;

        const effectiveAmount = doubleRent ? amount * 2 : amount;
        if (effectiveAmount > bestAmount) {
          bestAmount = effectiveAmount;
          bestPlay = {
            cardId: card.id,
            color,
            amount: effectiveAmount,
            doubleCardId: doubleRent ? doubleRent.id : null,
            isMultiRent: card.actionType === 'multi_rent',
            isNmRent: card.actionType === 'nm_rent',
            isDoubleRentAlone: false,
          };
        }
      }
    }

    // In no mercy mode, double rent can be played alone
    if (rentCards.length === 0 && doubleRent && state.gameMode === 'nomercy') {
      for (const color of ALL_COLORS) {
        const amount = rentAmount(player, color);
        if (amount === 0) continue;
        const effectiveAmount = amount * 2;
        if (effectiveAmount > bestAmount) {
          bestAmount = effectiveAmount;
          bestPlay = {
            cardId: doubleRent.id,
            color,
            amount: effectiveAmount,
            doubleCardId: null,
            isMultiRent: false,
            isNmRent: false,
            isDoubleRentAlone: true,
          };
        }
      }
    }

    // Only play rent if payout is decent (>= 2) or if we can double it
    if (bestPlay && bestAmount >= 2) {
      // Check if we have enough plays for double rent
      if (bestPlay.doubleCardId && state.turnPlaysRemaining < 2) {
        bestPlay.doubleCardId = null;
        bestPlay.amount = bestAmount / 2; // revert to base amount
      }
      return bestPlay;
    }

    // Still play rent even for small amounts if we have no better options
    if (bestPlay) return bestPlay;

    return null;
  }

  function tryDisruptOpponent(player, state, computerId, threats, callbacks) {
    // Use Deal Breaker against threatening opponents
    const dealBreaker = player.hand.find(c => c.actionType === 'deal_breaker');
    if (dealBreaker) {
      for (const threat of threats) {
        const completedColors = getCompletedSets(threat);
        if (completedColors.length > 0) {
          callbacks.playDealBreaker(dealBreaker.id, threat.id, completedColors[0]);
          return true;
        }
      }
    }

    // Use Sly Deal to steal from near-complete sets of threatening opponents
    const slyDeal = player.hand.find(c => c.actionType === 'sly_deal');
    if (slyDeal) {
      for (const threat of threats) {
        // Find their near-complete sets and steal from them
        for (const color of ALL_COLORS) {
          if (isSetComplete(threat, color)) continue;
          const needed = cardsNeeded(threat, color);
          if (needed === 1) {
            // This set is close to completion - disrupt it
            const stealable = threat.properties.find(c => {
              const cardColor = c.type === 'wild_property' ? c.currentColor : c.color;
              return cardColor === color && !isInCompletedSet(threat, c);
            });
            if (stealable) {
              callbacks.playSlyDeal(slyDeal.id, threat.id, stealable.id);
              return true;
            }
          }
        }
      }
    }

    // Use Forced Deal to disrupt threatening opponents
    const forcedDeal = player.hand.find(c => c.actionType === 'forced_deal');
    if (forcedDeal && player.properties.length > 0) {
      const giveAway = findLeastUsefulProperty(player);
      if (giveAway) {
        for (const threat of threats) {
          for (const color of ALL_COLORS) {
            if (isSetComplete(threat, color)) continue;
            const needed = cardsNeeded(threat, color);
            if (needed === 1) {
              const stealable = threat.properties.find(c => {
                const cardColor = c.type === 'wild_property' ? c.currentColor : c.color;
                return cardColor === color && !isInCompletedSet(threat, c);
              });
              if (stealable) {
                callbacks.playForcedDeal(forcedDeal.id, threat.id, stealable.id, giveAway.id);
                return true;
              }
            }
          }
        }
      }
    }

    return false;
  }

  function tryBankCard(player, callbacks, aggressive) {
    const currentBank = bankTotal(player);
    const TARGET_BANK = aggressive ? 15 : 10;

    // Bank money cards
    if (currentBank < TARGET_BANK) {
      const moneyCard = player.hand.find(c => c.type === 'money');
      if (moneyCard) {
        callbacks.bankCard(moneyCard.id);
        return true;
      }
    }

    // Bank non-powerful action cards
    const bankableAction = player.hand.find(c =>
      c.type === 'action' && c.value > 0 &&
      !POWERFUL_ACTIONS.includes(c.actionType) &&
      c.actionType !== 'double_rent'
    );
    if (bankableAction) {
      callbacks.bankCard(bankableAction.id);
      return true;
    }

    // In aggressive mode, bank money even over target
    if (aggressive) {
      const moneyCard = player.hand.find(c => c.type === 'money');
      if (moneyCard) {
        callbacks.bankCard(moneyCard.id);
        return true;
      }
    }

    return false;
  }

  // ── Response handling ─────────────────────────────────────────────────

  async function handleResponse(state, computerId, callbacks) {
    const pending = state.pendingAction;
    if (!pending) return;

    await delay(ACTION_DELAY);

    // Check if we're the responder (Just Say No decision)
    if (pending.currentResponder === computerId && state.phase === 'respond') {
      const player = state.players.find(p => p.id === computerId);
      const justSayNo = player.hand.find(c => c.actionType === 'just_say_no');

      if (justSayNo && shouldUseJustSayNo(state, computerId, pending)) {
        callbacks.respondJustSayNo(justSayNo.id);
        return;
      }

      callbacks.respondAccept();
      return;
    }

    // Check if we need to pay
    if (state.phase === 'pay' && pending.currentPayer === computerId) {
      handlePayment(state, computerId, callbacks);
      return;
    }
  }

  function shouldUseJustSayNo(state, computerId, pending) {
    const player = state.players.find(p => p.id === computerId);
    const myCompletedSets = getCompletedSets(player);

    // Always block Deal Breaker (especially if we have 2+ completed sets)
    if (pending.type === 'deal_breaker' && pending.targetId === computerId) {
      return true;
    }

    // Block Sly Deal if it targets a card in a near-complete set
    if (pending.type === 'sly_deal' && pending.targetId === computerId) {
      const targetCard = player.properties.find(c => c.id === pending.targetCardId);
      if (targetCard) {
        const color = targetCard.type === 'wild_property' ? targetCard.currentColor : targetCard.color;
        const needed = cardsNeeded(player, color);
        // Block if this card is in a set that needs 1 or fewer more cards
        if (needed <= 1) return true;
        // Block if we have 2 completed sets (protect everything)
        if (myCompletedSets.length >= 2) return true;
      }
    }

    // Block Forced Deal targeting important cards
    if (pending.type === 'forced_deal' && pending.targetId === computerId) {
      const targetCard = player.properties.find(c => c.id === pending.targetCardId);
      if (targetCard) {
        const color = targetCard.type === 'wild_property' ? targetCard.currentColor : targetCard.color;
        if (cardsNeeded(player, color) <= 1) return true;
        if (myCompletedSets.length >= 2) return true;
      }
    }

    // Block high rent (>= 5M) if we'd lose significant assets
    if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'nm_rent') {
      const target = pending.targets?.find(t => t.playerId === computerId);
      if (target && target.amount >= 5) {
        return true;
      }
    }

    // Always block Super Sly Deal, Repossession, Tough Luck, and Unfair Trade
    if (pending.type === 'super_sly_deal') return true;
    if (pending.type === 'repossession') return true;
    if (pending.type === 'tough_luck') return true;
    if (pending.type === 'unfair_trade') return true;

    // Block Yoink if we have significant bank
    if (pending.type === 'yoink') {
      const player = state.players.find(p => p.id === computerId);
      if (bankTotal(player) >= 5) return true;
    }

    return false;
  }

  // ── Payment handling ──────────────────────────────────────────────────

  function handlePayment(state, computerId, callbacks) {
    const pending = state.pendingAction;
    const player = state.players.find(p => p.id === computerId);
    const target = pending.targets.find(t => t.playerId === computerId);
    if (!target || !player) return;

    const amount = target.amount;
    const bTotal = bankTotal(player);
    const propTotal = player.properties.reduce((s, c) => s + c.value, 0);
    const assets = bTotal + propTotal;
    const requiredPayment = Math.min(amount, assets);

    // Sort bank cards by value (ascending) - pay with smallest first
    const sortedBank = [...player.bank].sort((a, b) => a.value - b.value);

    // Sort properties strategically: protect completed sets and near-complete sets
    const sortedProps = [...player.properties].sort((a, b) => {
      const aComplete = isInCompletedSet(player, a);
      const bComplete = isInCompletedSet(player, b);
      // Never sacrifice completed set cards if possible
      if (aComplete && !bComplete) return 1;
      if (!aComplete && bComplete) return -1;

      const aColor = a.type === 'wild_property' ? a.currentColor : a.color;
      const bColor = b.type === 'wild_property' ? b.currentColor : b.color;
      const aRatio = completionRatio(player, aColor);
      const bRatio = completionRatio(player, bColor);

      // Sacrifice cards from lower-completion sets first
      if (aRatio !== bRatio) return aRatio - bRatio;

      // Sacrifice lower value first
      return a.value - b.value;
    });

    const bankIds = [];
    const propIds = [];
    let paid = 0;

    // First try to pay with bank cards
    for (const card of sortedBank) {
      if (paid >= requiredPayment) break;
      bankIds.push(card.id);
      paid += card.value;
    }

    // If bank isn't enough, use properties (least valuable first)
    if (paid < requiredPayment) {
      for (const card of sortedProps) {
        if (paid >= requiredPayment) break;
        propIds.push(card.id);
        paid += card.value;
      }
    }

    callbacks.makePayment(bankIds, propIds);
  }

  // ── Discard handling ──────────────────────────────────────────────────

  function discardPhase(state, computerId, callbacks) {
    const player = state.players.find(p => p.id === computerId);
    if (!player) return;

    const excess = player.hand.length - 7;
    if (excess <= 0) {
      callbacks.endTurn();
      return;
    }

    // Score each card in hand (lower = discard first)
    const scored = player.hand.map(card => ({
      card,
      score: discardScore(card, player),
    }));

    // Sort by score ascending (discard lowest-scored cards first)
    scored.sort((a, b) => a.score - b.score);

    const discardIds = scored.slice(0, excess).map(s => s.card.id);
    callbacks.endTurn(discardIds);
  }

  function discardScore(card, player) {
    // Higher score = keep; lower score = discard first

    // Never discard powerful cards
    if (card.actionType === 'deal_breaker') return 100;
    if (card.actionType === 'just_say_no') return 95;
    if (card.type === 'wild_property' && card.colors && card.colors[0] === 'all') return 90;
    if (card.actionType === 'sly_deal') return 80;
    if (card.actionType === 'forced_deal') return 70;
    if (card.actionType === 'double_rent') return 65;
    if (card.actionType === 'house' || card.actionType === 'hotel') {
      const eligible = getCompletedSets(player).filter(c => c !== 'railroad' && c !== 'utility');
      return eligible.length > 0 ? 75 : 15;
    }
    if (card.actionType === 'shack') {
      return getCompletedSets(player).length > 0 ? 75 : 15;
    }
    if (card.actionType === 'super_sly_deal') return 85;
    if (card.actionType === 'repossession') return 80;
    if (card.actionType === 'yoink') return 40;
    if (card.actionType === 'tough_luck') return 45;
    if (card.actionType === 'unfair_trade') return 35;
    if (card.actionType === 'nm_pass_go') return 35;
    if (card.actionType === 'nm_rent') return 30;

    // Properties that advance sets are valuable
    if (card.type === 'property') {
      const ratio = completionRatio(player, card.color);
      // Higher ratio = closer to set completion = keep
      return 30 + ratio * 40;
    }

    // Wild properties are generally valuable
    if (card.type === 'wild_property') {
      return 60;
    }

    // Duplicate rent cards - check if we have another of same colors
    if (card.actionType === 'rent' || card.actionType === 'multi_rent' || card.actionType === 'nm_rent') {
      const dupes = player.hand.filter(c =>
        c.id !== card.id &&
        (c.actionType === 'rent' || c.actionType === 'multi_rent') &&
        JSON.stringify(c.rentColors) === JSON.stringify(card.rentColors)
      );
      if (dupes.length > 0) return 5; // discard duplicate rent cards
      return 25;
    }

    // Low-value money cards
    if (card.type === 'money') {
      return card.value * 3; // 1M = 3, 2M = 6, 10M = 30
    }

    // Other action cards (Pass Go, Debt Collector, Birthday)
    if (card.actionType === 'pass_go') return 35;
    if (card.actionType === 'debt_collector') return 30;
    if (card.actionType === 'birthday') return 25;

    // Default: base on card value
    return card.value || 5;
  }

  return {
    COMPUTER_NAMES,
    ACTION_DELAY,
    takeTurn,
    handleResponse,
  };
})();
