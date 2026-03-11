// Computer Player AI for Monopoly Deal
// Basic strategy that can be refined later

const ComputerPlayer = (() => {

  const COMPUTER_NAMES = ['Bot Alice', 'Bot Bob', 'Bot Charlie'];

  // Delay between computer actions (ms) for readability
  const ACTION_DELAY = 800;

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Main turn logic ───────────────────────────────────────────────────

  async function takeTurn(state, computerId, callbacks) {
    // Draw phase
    if (state.phase === 'draw' && state.currentPlayer === computerId) {
      await delay(ACTION_DELAY);
      callbacks.drawCards();
      return;
    }

    // Play phase
    if (state.phase === 'play' && state.currentPlayer === computerId) {
      await playPhase(state, computerId, callbacks);
      return;
    }

    // Discard phase
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

    // Priority 1: Play property cards
    const propertyCard = player.hand.find(c => c.type === 'property');
    if (propertyCard && state.turnPlaysRemaining > 0) {
      callbacks.playProperty(propertyCard.id);
      return;
    }

    // Priority 2: Play wild property cards
    const wildProp = player.hand.find(c => c.type === 'wild_property');
    if (wildProp && state.turnPlaysRemaining > 0) {
      const chosenColor = chooseBestColorForWild(player, wildProp);
      callbacks.playProperty(wildProp.id, chosenColor);
      return;
    }

    // Priority 3: Play Pass Go for card advantage
    const passGo = player.hand.find(c => c.actionType === 'pass_go');
    if (passGo && state.turnPlaysRemaining > 0) {
      callbacks.playPassGo(passGo.id);
      return;
    }

    // Priority 4: Play rent if we have properties
    const rentCard = player.hand.find(c =>
      c.actionType === 'rent' || c.actionType === 'multi_rent'
    );
    if (rentCard && state.turnPlaysRemaining > 0) {
      const color = chooseBestRentColor(player, rentCard);
      if (color) {
        callbacks.playRent(rentCard.id, color);
        return;
      }
    }

    // Priority 5: Play Debt Collector
    const debtCollector = player.hand.find(c => c.actionType === 'debt_collector');
    if (debtCollector && state.turnPlaysRemaining > 0) {
      const target = chooseRichestOpponent(state, computerId);
      if (target) {
        callbacks.playDebtCollector(debtCollector.id, target.id);
        return;
      }
    }

    // Priority 6: Play Birthday
    const birthday = player.hand.find(c => c.actionType === 'birthday');
    if (birthday && state.turnPlaysRemaining > 0) {
      callbacks.playBirthday(birthday.id);
      return;
    }

    // Priority 7: Bank money cards
    const moneyCard = player.hand.find(c => c.type === 'money');
    if (moneyCard && state.turnPlaysRemaining > 0) {
      callbacks.bankCard(moneyCard.id);
      return;
    }

    // Priority 8: Bank any remaining action cards
    const bankableAction = player.hand.find(c =>
      c.type === 'action' && c.value > 0 &&
      c.actionType !== 'just_say_no' // keep Just Say No for defense
    );
    if (bankableAction && state.turnPlaysRemaining > 0) {
      callbacks.bankCard(bankableAction.id);
      return;
    }

    // No more useful plays, end turn
    callbacks.endTurn();
  }

  // ── Response handling ─────────────────────────────────────────────────

  async function handleResponse(state, computerId, callbacks) {
    const pending = state.pendingAction;
    if (!pending) return;

    await delay(ACTION_DELAY);

    // Check if we're the responder
    if (pending.currentResponder === computerId && state.phase === 'respond') {
      // Basic strategy: always accept (don't use Just Say No for now)
      callbacks.respondAccept();
      return;
    }

    // Check if we need to pay
    if (state.phase === 'pay' && pending.currentPayer === computerId) {
      handlePayment(state, computerId, callbacks);
      return;
    }
  }

  function handlePayment(state, computerId, callbacks) {
    const pending = state.pendingAction;
    const player = state.players.find(p => p.id === computerId);
    const target = pending.targets.find(t => t.playerId === computerId);
    if (!target || !player) return;

    const amount = target.amount;
    const bankTotal = player.bank.reduce((s, c) => s + c.value, 0);
    const propTotal = player.properties.reduce((s, c) => s + c.value, 0);
    const totalAssets = bankTotal + propTotal;
    const requiredPayment = Math.min(amount, totalAssets);

    // Sort bank cards by value (ascending) - pay with smallest first
    const sortedBank = [...player.bank].sort((a, b) => a.value - b.value);
    // Sort properties by value (ascending) - sacrifice cheapest first
    const sortedProps = [...player.properties].sort((a, b) => a.value - b.value);

    const bankIds = [];
    const propIds = [];
    let paid = 0;

    // First try to pay with bank cards
    for (const card of sortedBank) {
      if (paid >= requiredPayment) break;
      bankIds.push(card.id);
      paid += card.value;
    }

    // If bank isn't enough, use properties
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

    // Discard lowest-value cards first
    const sorted = [...player.hand].sort((a, b) => a.value - b.value);
    const discardIds = sorted.slice(0, excess).map(c => c.id);
    callbacks.endTurn(discardIds);
  }

  // ── Helper functions ──────────────────────────────────────────────────

  function chooseBestColorForWild(player, wildCard) {
    if (wildCard.colors[0] === 'all') {
      // Rainbow wild: place on color closest to completion
      return findColorClosestToCompletion(player);
    }
    // Dual-color wild: choose the color we have more of
    const counts = wildCard.colors.map(c => ({
      color: c,
      count: countPlayerColor(player, c),
    }));
    counts.sort((a, b) => b.count - a.count);
    return counts[0].color;
  }

  function findColorClosestToCompletion(player) {
    const SET_REQS = {
      brown: 2, darkblue: 2, lightblue: 3, pink: 3, orange: 3,
      red: 3, yellow: 3, green: 3, railroad: 4, utility: 2,
    };

    let bestColor = 'brown';
    let bestRatio = -1;

    for (const [color, req] of Object.entries(SET_REQS)) {
      const count = countPlayerColor(player, color);
      // Skip already complete sets
      if (count >= req) continue;
      const ratio = count / req;
      if (ratio > bestRatio || (ratio === bestRatio && req < SET_REQS[bestColor])) {
        bestRatio = ratio;
        bestColor = color;
      }
    }

    return bestColor;
  }

  function chooseBestRentColor(player, rentCard) {
    const RENT_VALUES = {
      brown: [1, 2], darkblue: [3, 8], lightblue: [1, 2, 3],
      pink: [1, 2, 4], orange: [1, 3, 5], red: [2, 3, 6],
      yellow: [2, 4, 6], green: [2, 4, 7], railroad: [1, 2, 3, 4],
      utility: [1, 2],
    };

    let colors;
    if (rentCard.actionType === 'multi_rent') {
      colors = Object.keys(RENT_VALUES);
    } else {
      colors = rentCard.rentColors || [];
    }

    let bestColor = null;
    let bestRent = 0;

    for (const color of colors) {
      const count = countPlayerColor(player, color);
      if (count === 0) continue;
      const table = RENT_VALUES[color];
      const rent = table[Math.min(count, table.length) - 1];
      if (rent > bestRent) {
        bestRent = rent;
        bestColor = color;
      }
    }

    return bestColor;
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

  function countPlayerColor(player, color) {
    let count = 0;
    for (const card of player.properties) {
      if (card.type === 'property' && card.color === color) count++;
      if (card.type === 'wild_property' && card.currentColor === color) count++;
    }
    return count;
  }

  function totalAssets(player) {
    const bank = player.bank.reduce((s, c) => s + c.value, 0);
    const props = player.properties.reduce((s, c) => s + c.value, 0);
    return bank + props;
  }

  return {
    COMPUTER_NAMES,
    ACTION_DELAY,
    takeTurn,
    handleResponse,
  };
})();
