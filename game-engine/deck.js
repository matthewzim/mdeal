// Monopoly Deal - Deck Definition
// All card definitions for the game

const COLORS = {
  BROWN: 'brown',
  DARK_BLUE: 'darkblue',
  LIGHT_BLUE: 'lightblue',
  PINK: 'pink',
  ORANGE: 'orange',
  RED: 'red',
  YELLOW: 'yellow',
  GREEN: 'green',
  RAILROAD: 'railroad',
  UTILITY: 'utility',
};

const SET_REQUIREMENTS = {
  [COLORS.BROWN]: 2,
  [COLORS.DARK_BLUE]: 2,
  [COLORS.LIGHT_BLUE]: 3,
  [COLORS.PINK]: 3,
  [COLORS.ORANGE]: 3,
  [COLORS.RED]: 3,
  [COLORS.YELLOW]: 3,
  [COLORS.GREEN]: 3,
  [COLORS.RAILROAD]: 4,
  [COLORS.UTILITY]: 2,
};

const RENT_VALUES = {
  [COLORS.BROWN]:      [1, 2],
  [COLORS.DARK_BLUE]:  [3, 8],
  [COLORS.LIGHT_BLUE]: [1, 2, 3],
  [COLORS.PINK]:       [1, 2, 4],
  [COLORS.ORANGE]:     [1, 3, 5],
  [COLORS.RED]:        [2, 3, 6],
  [COLORS.YELLOW]:     [2, 4, 6],
  [COLORS.GREEN]:      [2, 4, 7],
  [COLORS.RAILROAD]:   [1, 2, 3, 4],
  [COLORS.UTILITY]:    [1, 2],
};

const CARD_TYPE = {
  PROPERTY: 'property',
  WILD_PROPERTY: 'wild_property',
  MONEY: 'money',
  ACTION: 'action',
};

const ACTION_TYPE = {
  PASS_GO: 'pass_go',
  RENT: 'rent',
  MULTI_RENT: 'multi_rent',
  DOUBLE_RENT: 'double_rent',
  DEBT_COLLECTOR: 'debt_collector',
  BIRTHDAY: 'birthday',
  SLY_DEAL: 'sly_deal',
  FORCED_DEAL: 'forced_deal',
  DEAL_BREAKER: 'deal_breaker',
  JUST_SAY_NO: 'just_say_no',
};

let _cardIdCounter = 0;
function nextCardId() {
  return 'card_' + (++_cardIdCounter);
}
function resetCardIds() {
  _cardIdCounter = 0;
}

function createPropertyCard(color, name, value) {
  return {
    id: nextCardId(),
    type: CARD_TYPE.PROPERTY,
    color,
    name,
    value,
  };
}

function createWildPropertyCard(colors, name, value) {
  return {
    id: nextCardId(),
    type: CARD_TYPE.WILD_PROPERTY,
    colors, // array of 2 colors (or 'all' for rainbow wild)
    name,
    value,
    currentColor: colors[0],
  };
}

function createMoneyCard(value) {
  return {
    id: nextCardId(),
    type: CARD_TYPE.MONEY,
    name: value + 'M',
    value,
  };
}

function createActionCard(actionType, name, value) {
  return {
    id: nextCardId(),
    type: CARD_TYPE.ACTION,
    actionType,
    name,
    value,
  };
}

function createRentCard(colors, value) {
  const colorNames = colors.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join('/');
  return {
    id: nextCardId(),
    type: CARD_TYPE.ACTION,
    actionType: ACTION_TYPE.RENT,
    rentColors: colors,
    name: 'Rent: ' + colorNames,
    value,
  };
}

function createMultiRentCard(value) {
  return {
    id: nextCardId(),
    type: CARD_TYPE.ACTION,
    actionType: ACTION_TYPE.MULTI_RENT,
    name: 'Multi Rent (Wild)',
    value,
  };
}

function buildFullDeck() {
  resetCardIds();
  const deck = [];

  // === PROPERTY CARDS ===
  // Brown (2 cards)
  deck.push(createPropertyCard(COLORS.BROWN, 'Mediterranean Ave', 1));
  deck.push(createPropertyCard(COLORS.BROWN, 'Baltic Ave', 1));

  // Dark Blue (2 cards)
  deck.push(createPropertyCard(COLORS.DARK_BLUE, 'Park Place', 4));
  deck.push(createPropertyCard(COLORS.DARK_BLUE, 'Boardwalk', 4));

  // Light Blue (3 cards)
  deck.push(createPropertyCard(COLORS.LIGHT_BLUE, 'Oriental Ave', 1));
  deck.push(createPropertyCard(COLORS.LIGHT_BLUE, 'Vermont Ave', 1));
  deck.push(createPropertyCard(COLORS.LIGHT_BLUE, 'Connecticut Ave', 1));

  // Pink (3 cards)
  deck.push(createPropertyCard(COLORS.PINK, 'St. Charles Place', 2));
  deck.push(createPropertyCard(COLORS.PINK, 'Virginia Ave', 2));
  deck.push(createPropertyCard(COLORS.PINK, 'States Ave', 2));

  // Orange (3 cards)
  deck.push(createPropertyCard(COLORS.ORANGE, 'St. James Place', 2));
  deck.push(createPropertyCard(COLORS.ORANGE, 'Tennessee Ave', 2));
  deck.push(createPropertyCard(COLORS.ORANGE, 'New York Ave', 2));

  // Red (3 cards)
  deck.push(createPropertyCard(COLORS.RED, 'Kentucky Ave', 3));
  deck.push(createPropertyCard(COLORS.RED, 'Indiana Ave', 3));
  deck.push(createPropertyCard(COLORS.RED, 'Illinois Ave', 3));

  // Yellow (3 cards)
  deck.push(createPropertyCard(COLORS.YELLOW, 'Atlantic Ave', 3));
  deck.push(createPropertyCard(COLORS.YELLOW, 'Ventnor Ave', 3));
  deck.push(createPropertyCard(COLORS.YELLOW, 'Marvin Gardens', 3));

  // Green (3 cards)
  deck.push(createPropertyCard(COLORS.GREEN, 'Pacific Ave', 4));
  deck.push(createPropertyCard(COLORS.GREEN, 'North Carolina Ave', 4));
  deck.push(createPropertyCard(COLORS.GREEN, 'Pennsylvania Ave', 4));

  // Railroads (4 cards)
  deck.push(createPropertyCard(COLORS.RAILROAD, 'Reading Railroad', 2));
  deck.push(createPropertyCard(COLORS.RAILROAD, 'Pennsylvania Railroad', 2));
  deck.push(createPropertyCard(COLORS.RAILROAD, 'B&O Railroad', 2));
  deck.push(createPropertyCard(COLORS.RAILROAD, 'Short Line', 2));

  // Utilities (2 cards)
  deck.push(createPropertyCard(COLORS.UTILITY, 'Electric Company', 2));
  deck.push(createPropertyCard(COLORS.UTILITY, 'Water Works', 2));

  // === WILD PROPERTY CARDS ===
  // Dual-color wilds
  deck.push(createWildPropertyCard([COLORS.BROWN, COLORS.LIGHT_BLUE], 'Wild: Brown/Light Blue', 1));
  deck.push(createWildPropertyCard([COLORS.DARK_BLUE, COLORS.GREEN], 'Wild: Dark Blue/Green', 4));
  deck.push(createWildPropertyCard([COLORS.LIGHT_BLUE, COLORS.RAILROAD], 'Wild: Light Blue/Railroad', 4));
  deck.push(createWildPropertyCard([COLORS.PINK, COLORS.ORANGE], 'Wild: Pink/Orange', 2));
  deck.push(createWildPropertyCard([COLORS.RAILROAD, COLORS.UTILITY], 'Wild: Railroad/Utility', 2));
  deck.push(createWildPropertyCard([COLORS.RAILROAD, COLORS.GREEN], 'Wild: Railroad/Green', 4));
  deck.push(createWildPropertyCard([COLORS.RED, COLORS.YELLOW], 'Wild: Red/Yellow', 3));
  deck.push(createWildPropertyCard([COLORS.RED, COLORS.YELLOW], 'Wild: Red/Yellow', 3));

  // Rainbow wilds (can be any color, value 0)
  deck.push(createWildPropertyCard(['all'], 'Wild Property', 0));
  deck.push(createWildPropertyCard(['all'], 'Wild Property', 0));

  // === MONEY CARDS ===
  // 1M x 6
  for (let i = 0; i < 6; i++) deck.push(createMoneyCard(1));
  // 2M x 5
  for (let i = 0; i < 5; i++) deck.push(createMoneyCard(2));
  // 3M x 3
  for (let i = 0; i < 3; i++) deck.push(createMoneyCard(3));
  // 4M x 3
  for (let i = 0; i < 3; i++) deck.push(createMoneyCard(4));
  // 5M x 2
  for (let i = 0; i < 2; i++) deck.push(createMoneyCard(5));
  // 10M x 1
  deck.push(createMoneyCard(10));

  // === ACTION CARDS ===
  // Pass Go x 10
  for (let i = 0; i < 10; i++) {
    deck.push(createActionCard(ACTION_TYPE.PASS_GO, 'Pass Go', 1));
  }

  // Debt Collector x 3
  for (let i = 0; i < 3; i++) {
    deck.push(createActionCard(ACTION_TYPE.DEBT_COLLECTOR, 'Debt Collector', 3));
  }

  // It's My Birthday x 3
  for (let i = 0; i < 3; i++) {
    deck.push(createActionCard(ACTION_TYPE.BIRTHDAY, "It's My Birthday", 2));
  }

  // Double The Rent x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createActionCard(ACTION_TYPE.DOUBLE_RENT, 'Double The Rent', 1));
  }

  // Sly Deal x 3
  for (let i = 0; i < 3; i++) {
    deck.push(createActionCard(ACTION_TYPE.SLY_DEAL, 'Sly Deal', 3));
  }

  // Forced Deal x 4
  for (let i = 0; i < 4; i++) {
    deck.push(createActionCard(ACTION_TYPE.FORCED_DEAL, 'Forced Deal', 3));
  }

  // Deal Breaker x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createActionCard(ACTION_TYPE.DEAL_BREAKER, 'Deal Breaker', 5));
  }

  // Just Say No x 3
  for (let i = 0; i < 3; i++) {
    deck.push(createActionCard(ACTION_TYPE.JUST_SAY_NO, 'Just Say No', 4));
  }

  // === RENT CARDS ===
  // Brown/Light Blue rent x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createRentCard([COLORS.BROWN, COLORS.LIGHT_BLUE], 1));
  }
  // Pink/Orange rent x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createRentCard([COLORS.PINK, COLORS.ORANGE], 1));
  }
  // Red/Yellow rent x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createRentCard([COLORS.RED, COLORS.YELLOW], 1));
  }
  // Dark Blue/Green rent x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createRentCard([COLORS.DARK_BLUE, COLORS.GREEN], 1));
  }
  // Railroad/Utility rent x 2
  for (let i = 0; i < 2; i++) {
    deck.push(createRentCard([COLORS.RAILROAD, COLORS.UTILITY], 1));
  }
  // Multi-color rent x 3
  for (let i = 0; i < 3; i++) {
    deck.push(createMultiRentCard(3));
  }

  return deck;
}

function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Module export for both Node (Edge Functions) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLORS, SET_REQUIREMENTS, RENT_VALUES, CARD_TYPE, ACTION_TYPE,
    buildFullDeck, shuffleDeck, resetCardIds,
  };
}
