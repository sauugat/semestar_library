import type {
  UnoCard,
  UnoColor,
  UnoColorMeta,
  UnoDirection,
  UnoGameMode,
  UnoGameState,
  UnoPlayer,
} from './types.ts';
import {
  NEPALI_DIGITS,
  NEPALI_DIGIT_NAMES,
  COLOR_METAS,
} from './types.ts';

const STANDARD_COLORS: UnoColor[] = ['rato', 'nilo', 'hariyo', 'pahelo'];

/**
 * Generates an authentic 108-card Nepali themed UNO deck.
 */
export function generateUnoDeck(): UnoCard[] {
  const cards: UnoCard[] = [];
  let nextId = 1;

  for (const color of STANDARD_COLORS) {
    const meta = COLOR_METAS[color];

    // One '0' card per color
    cards.push({
      id: `c_${nextId++}`,
      color,
      type: 'number',
      value: 0,
      nepaliDigit: NEPALI_DIGITS[0],
      nepaliLabel: `${meta.nameNp} ${NEPALI_DIGITS[0]} (${NEPALI_DIGIT_NAMES[0]})`,
      englishLabel: `${meta.nameEn} 0`,
      scoreValue: 0,
    });

    // Two of each 1 to 9 per color
    for (let val = 1; val <= 9; val++) {
      for (let copy = 0; copy < 2; copy++) {
        cards.push({
          id: `c_${nextId++}`,
          color,
          type: 'number',
          value: val,
          nepaliDigit: NEPALI_DIGITS[val],
          nepaliLabel: `${meta.nameNp} ${NEPALI_DIGITS[val]} (${NEPALI_DIGIT_NAMES[val]})`,
          englishLabel: `${meta.nameEn} ${val}`,
          scoreValue: val,
        });
      }
    }

    // Two 'skip' (छेक) cards per color
    for (let copy = 0; copy < 2; copy++) {
      cards.push({
        id: `c_${nextId++}`,
        color,
        type: 'skip',
        nepaliLabel: `${meta.nameNp} छेक (Skip)`,
        englishLabel: `${meta.nameEn} Skip`,
        scoreValue: 20,
      });
    }

    // Two 'reverse' (फर्क) cards per color
    for (let copy = 0; copy < 2; copy++) {
      cards.push({
        id: `c_${nextId++}`,
        color,
        type: 'reverse',
        nepaliLabel: `${meta.nameNp} फर्क (Reverse)`,
        englishLabel: `${meta.nameEn} Reverse`,
        scoreValue: 20,
      });
    }

    // Two '+2' (दुई पत्ता तान) cards per color
    for (let copy = 0; copy < 2; copy++) {
      cards.push({
        id: `c_${nextId++}`,
        color,
        type: 'draw2',
        nepaliLabel: `${meta.nameNp} +२ तान (+2 Draw)`,
        englishLabel: `${meta.nameEn} +2 Draw`,
        scoreValue: 20,
      });
    }
  }

  // Four 'Wild' (इन्द्रेणी) cards
  for (let copy = 0; copy < 4; copy++) {
    cards.push({
      id: `c_${nextId++}`,
      color: 'wild',
      type: 'wild',
      nepaliLabel: 'इन्द्रेणी रङ्ग छान (Wild)',
      englishLabel: 'Wild Card',
      scoreValue: 50,
    });
  }

  // Four 'Wild +4' (+४ तान) cards
  for (let copy = 0; copy < 4; copy++) {
    cards.push({
      id: `c_${nextId++}`,
      color: 'wild',
      type: 'wild4',
      nepaliLabel: '+४ चार पत्ता तान (Wild +4)',
      englishLabel: 'Wild +4 Draw',
      scoreValue: 50,
    });
  }

  return cards;
}

/**
 * Fisher-Yates array shuffling
 */
export function shuffleDeck<T>(items: T[]): T[] {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

export const NEPALI_BOT_NAMES = [
  { name: 'Tanuja', nepaliName: 'तनुजा', avatar: 'tanuja' },
  { name: 'Harsh', nepaliName: 'हर्ष', avatar: 'harsh' },
  { name: 'Shubho', nepaliName: 'शुभो', avatar: 'shubho' },
  { name: 'Maya', nepaliName: 'माया', avatar: 'sparkles-outline' },
];

/**
 * Creates a fresh, ready-to-play UNO game state.
 */
export function createInitialUnoGame(
  mode: UnoGameMode = 'bots',
  userName = 'Gust',
  userNepaliName = 'Gust'
): UnoGameState {
  const fullDeck = shuffleDeck(generateUnoDeck());

  const players: UnoPlayer[] = [
    {
      id: 'p_0',
      name: userName,
      nepaliName: userNepaliName,
      isBot: false,
      avatarIcon: 'gust',
      cards: [],
      hasCalledUno: false,
    },
    {
      id: 'p_1',
      name: NEPALI_BOT_NAMES[0].name,
      nepaliName: NEPALI_BOT_NAMES[0].nepaliName,
      isBot: mode === 'bots',
      avatarIcon: NEPALI_BOT_NAMES[0].avatar,
      cards: [],
      hasCalledUno: false,
    },
    {
      id: 'p_2',
      name: NEPALI_BOT_NAMES[1].name,
      nepaliName: NEPALI_BOT_NAMES[1].nepaliName,
      isBot: mode === 'bots',
      avatarIcon: NEPALI_BOT_NAMES[1].avatar,
      cards: [],
      hasCalledUno: false,
    },
    {
      id: 'p_3',
      name: NEPALI_BOT_NAMES[2].name,
      nepaliName: NEPALI_BOT_NAMES[2].nepaliName,
      isBot: mode === 'bots',
      avatarIcon: NEPALI_BOT_NAMES[2].avatar,
      cards: [],
      hasCalledUno: false,
    },
  ];

  // Deal 7 cards to each of the 4 players
  let deckIndex = 0;
  for (let round = 0; round < 7; round++) {
    for (const player of players) {
      player.cards.push(fullDeck[deckIndex++]);
    }
  }

  // Find a clean number card to start the discard pile (not wild or action)
  let topDiscardIndex = deckIndex++;
  while (topDiscardIndex < fullDeck.length && fullDeck[topDiscardIndex].type !== 'number') {
    // Put action card to back of deck and pick next
    fullDeck.push(fullDeck[topDiscardIndex]);
    topDiscardIndex = deckIndex++;
  }

  const firstCard = fullDeck[topDiscardIndex];
  const drawPile = fullDeck.slice(deckIndex);
  const discardPile = [firstCard];

  return {
    gameId: `uno_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    mode,
    players,
    currentPlayerIndex: 0,
    direction: 'clockwise',
    drawPile,
    discardPile,
    activeColor: firstCard.color,
    status: 'playing',
    winner: null,
    pendingColorChoiceCard: null,
    lastActionMessage: `Game started with ${firstCard.englishLabel}!`,
    lastActionNepaliMessage: `खेल सुरु भयो! पहिलो पत्ता: ${firstCard.nepaliLabel}`,
    consecutiveDrawCount: 0,
    soundEnabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Checks whether a given card can legally be played on the active discard.
 */
export function canPlayCard(
  card: UnoCard,
  topDiscard: UnoCard,
  activeColor: UnoColor
): boolean {
  if (card.color === 'wild') return true;
  if (card.color === activeColor) return true;
  if (card.type === 'number' && topDiscard.type === 'number' && card.value === topDiscard.value) {
    return true;
  }
  if (card.type !== 'number' && card.type === topDiscard.type) {
    return true;
  }
  return false;
}

/**
 * Returns the index of the next player given direction and steps.
 */
export function getNextPlayerIndex(
  currentIndex: number,
  playerCount: number,
  direction: UnoDirection,
  steps = 1
): number {
  const delta = direction === 'clockwise' ? steps : -steps;
  const mod = (currentIndex + delta) % playerCount;
  return mod < 0 ? mod + playerCount : mod;
}

/**
 * Refills draw pile from discard pile if draw pile runs dry.
 */
function ensureDrawPile(state: UnoGameState): { drawPile: UnoCard[]; discardPile: UnoCard[] } {
  if (state.drawPile.length > 0) {
    return { drawPile: state.drawPile, discardPile: state.discardPile };
  }

  const topCard = state.discardPile[state.discardPile.length - 1];
  const rest = state.discardPile.slice(0, state.discardPile.length - 1);
  const recycled = shuffleDeck(rest);

  return {
    drawPile: recycled,
    discardPile: [topCard],
  };
}

/**
 * Executes a card play from a player.
 */
export function playCard(
  state: UnoGameState,
  playerId: string,
  cardId: string,
  chosenColor?: UnoColor
): { nextState: UnoGameState; event: 'play' | 'win' | 'wait_color' | 'invalid' } {
  if (state.status !== 'playing' && state.status !== 'waiting_color_choice') {
    return { nextState: state, event: 'invalid' };
  }

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    return { nextState: state, event: 'invalid' };
  }

  const cardIndex = currentPlayer.cards.findIndex(c => c.id === cardId);
  if (cardIndex === -1) {
    return { nextState: state, event: 'invalid' };
  }

  const card = currentPlayer.cards[cardIndex];
  const topDiscard = state.discardPile[state.discardPile.length - 1];

  if (!canPlayCard(card, topDiscard, state.activeColor)) {
    return { nextState: state, event: 'invalid' };
  }

  // If playing wild and color has not been selected yet
  if (card.color === 'wild' && !chosenColor) {
    return {
      nextState: {
        ...state,
        status: 'waiting_color_choice',
        pendingColorChoiceCard: card,
        lastActionMessage: `${currentPlayer.name} played ${card.englishLabel}. Choosing color...`,
        lastActionNepaliMessage: `${currentPlayer.nepaliName}ले ${card.nepaliLabel} फाल्यो। रङ्ग रोज्दै...`,
      },
      event: 'wait_color',
    };
  }

  // Clone player and hand
  const nextPlayers = state.players.map((p, idx) => {
    if (idx !== state.currentPlayerIndex) return p;
    const nextCards = [...p.cards];
    nextCards.splice(cardIndex, 1);
    return {
      ...p,
      cards: nextCards,
      hasCalledUno: nextCards.length === 1 ? p.hasCalledUno : false,
      unoCallWindowExpiresAt: nextCards.length === 1 ? Date.now() + 3500 : undefined,
    };
  });

  const remainingCardsCount = nextPlayers[state.currentPlayerIndex].cards.length;

  // Check victory
  if (remainingCardsCount === 0) {
    const winner = nextPlayers[state.currentPlayerIndex];
    return {
      nextState: {
        ...state,
        players: nextPlayers,
        discardPile: [...state.discardPile, card],
        activeColor: chosenColor || card.color,
        status: 'game_over',
        winner,
        lastActionMessage: `🏆 ${winner.name} wins the match!`,
        lastActionNepaliMessage: `🏆 ${winner.nepaliName}ले खेल जित्यो! बधाई छ!`,
        updatedAt: Date.now(),
      },
      event: 'win',
    };
  }

  // Next direction and step resolution
  let nextDirection = state.direction;
  let steps = 1;
  let actionTextEn = `${currentPlayer.name} played ${card.englishLabel}`;
  let actionTextNp = `${currentPlayer.nepaliName}ले ${card.nepaliLabel} फाल्यो`;
  let drawCountForNext = 0;

  if (card.type === 'reverse') {
    nextDirection = state.direction === 'clockwise' ? 'counter_clockwise' : 'clockwise';
    actionTextEn += ` (Reversed play direction)`;
    actionTextNp += ` (दिशा उल्टियो: ${nextDirection === 'clockwise' ? 'सुल्टो ↻' : 'उल्टो ↺'})`;
  } else if (card.type === 'skip') {
    steps = 2; // Skips next player
    const skippedPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length, nextDirection, 1);
    const skipped = state.players[skippedPlayerIndex];
    actionTextEn += ` (${skipped.name} was skipped!)`;
    actionTextNp += ` (${skipped.nepaliName}को पालो रोकियो!)`;
  } else if (card.type === 'draw2') {
    drawCountForNext = 2;
    steps = 2; // In standard UNO, drawing 2 also skips their turn
  } else if (card.type === 'wild4') {
    drawCountForNext = 4;
    steps = 2; // In standard UNO, wild 4 skips their turn
  }

  const nextActiveColor = chosenColor || (card.color !== 'wild' ? card.color : state.activeColor);
  if (chosenColor) {
    const colorMeta = COLOR_METAS[chosenColor];
    actionTextEn += ` -> Color set to ${colorMeta.nameEn}`;
    actionTextNp += ` -> रङ्ग: ${colorMeta.nameNp}`;
  }

  let workingDrawPile = [...state.drawPile];
  let workingDiscardPile = [...state.discardPile, card];

  // Apply draw cards penalty if +2 or +4
  if (drawCountForNext > 0) {
    const victimIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length, nextDirection, 1);
    const victim = nextPlayers[victimIndex];
    const drawnCards: UnoCard[] = [];

    for (let i = 0; i < drawCountForNext; i++) {
      if (workingDrawPile.length === 0) {
        const refilled = ensureDrawPile({ ...state, drawPile: workingDrawPile, discardPile: workingDiscardPile });
        workingDrawPile = refilled.drawPile;
        workingDiscardPile = refilled.discardPile;
      }
      if (workingDrawPile.length > 0) {
        drawnCards.push(workingDrawPile.shift()!);
      }
    }

    nextPlayers[victimIndex] = {
      ...victim,
      cards: [...victim.cards, ...drawnCards],
      hasCalledUno: false,
    };

    actionTextEn += `! ${victim.name} draws ${drawCountForNext} cards and misses a turn!`;
    actionTextNp += `! ${victim.nepaliName}ले ${drawCountForNext} पत्ता तान्यो र पालो गुमायो!`;
  }

  const nextPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length, nextDirection, steps);

  return {
    nextState: {
      ...state,
      players: nextPlayers,
      drawPile: workingDrawPile,
      discardPile: workingDiscardPile,
      activeColor: nextActiveColor,
      direction: nextDirection,
      currentPlayerIndex: nextPlayerIndex,
      status: 'playing',
      pendingColorChoiceCard: null,
      lastActionMessage: actionTextEn,
      lastActionNepaliMessage: actionTextNp,
      updatedAt: Date.now(),
    },
    event: 'play',
  };
}

/**
 * Handles drawing a card from the deck for the current player.
 */
export function drawCard(state: UnoGameState, playerId: string): UnoGameState {
  if (state.status !== 'playing') return state;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.id !== playerId) return state;

  let { drawPile, discardPile } = ensureDrawPile(state);
  if (drawPile.length === 0) return state;

  const drawnCard = drawPile.shift()!;
  const nextPlayers = state.players.map((p, idx) => {
    if (idx !== state.currentPlayerIndex) return p;
    return {
      ...p,
      cards: [...p.cards, drawnCard],
      hasCalledUno: false, // Drawing resets UNO claim
    };
  });

  const topDiscard = discardPile[discardPile.length - 1];
  const canPlayDrawn = canPlayCard(drawnCard, topDiscard, state.activeColor);

  // If the drawn card cannot be played, turn immediately advances to next player
  if (!canPlayDrawn) {
    const nextPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length, state.direction, 1);
    return {
      ...state,
      players: nextPlayers,
      drawPile,
      discardPile,
      currentPlayerIndex: nextPlayerIndex,
      lastActionMessage: `${currentPlayer.name} drew a card and passed.`,
      lastActionNepaliMessage: `${currentPlayer.nepaliName}ले पत्ता तान्यो तर खेल्न मिलेन, पालो सर्‍यो।`,
      updatedAt: Date.now(),
    };
  }

  // If the drawn card CAN be played, keep it the current player's turn so they can choose to play it or keep it
  return {
    ...state,
    players: nextPlayers,
    drawPile,
    discardPile,
    lastActionMessage: `${currentPlayer.name} drew a card. Can be played!`,
    lastActionNepaliMessage: `${currentPlayer.nepaliName}ले पत्ता तान्यो। खेल्न सकिन्छ!`,
    updatedAt: Date.now(),
  };
}

/**
 * Pass turn after drawing a playable card.
 */
export function passTurn(state: UnoGameState, playerId: string): UnoGameState {
  if (state.status !== 'playing') return state;
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.id !== playerId) return state;

  const nextPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length, state.direction, 1);
  return {
    ...state,
    currentPlayerIndex: nextPlayerIndex,
    lastActionMessage: `${currentPlayer.name} passed.`,
    lastActionNepaliMessage: `${currentPlayer.nepaliName}ले पालो छोड्यो।`,
    updatedAt: Date.now(),
  };
}

/**
 * Calling UNO / 'एक पत्ता!'
 */
export function callUno(state: UnoGameState, playerId: string): UnoGameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.cards.length > 2) return state;

  const nextPlayers = state.players.map(p => {
    if (p.id !== playerId) return p;
    return {
      ...p,
      hasCalledUno: true,
      lastReaction: 'एक पत्ता! (UNO!)',
    };
  });

  return {
    ...state,
    players: nextPlayers,
    lastActionMessage: `🔔 ${player.name} shouted "UNO / एक पत्ता!"`,
    lastActionNepaliMessage: `🔔 ${player.nepaliName}ले "एक पत्ता!" भन्यो!`,
    updatedAt: Date.now(),
  };
}

/**
 * Catching an opponent who failed to say UNO with 1 card remaining.
 */
export function challengeUno(
  state: UnoGameState,
  challengerId: string,
  targetId: string
): UnoGameState {
  const challenger = state.players.find(p => p.id === challengerId);
  const target = state.players.find(p => p.id === targetId);
  if (!challenger || !target) return state;

  // Target must have exactly 1 card and has NOT called UNO
  if (target.cards.length !== 1 || target.hasCalledUno) {
    return state;
  }

  // Draw 2 penalty cards for target
  let { drawPile, discardPile } = ensureDrawPile(state);
  const penaltyCards: UnoCard[] = [];
  for (let i = 0; i < 2; i++) {
    if (drawPile.length === 0) {
      const refilled = ensureDrawPile({ ...state, drawPile, discardPile });
      drawPile = refilled.drawPile;
      discardPile = refilled.discardPile;
    }
    if (drawPile.length > 0) penaltyCards.push(drawPile.shift()!);
  }

  const nextPlayers = state.players.map(p => {
    if (p.id !== targetId) return p;
    return {
      ...p,
      cards: [...p.cards, ...penaltyCards],
      hasCalledUno: false,
    };
  });

  return {
    ...state,
    players: nextPlayers,
    drawPile,
    discardPile,
    lastActionMessage: `⚠️ ${challenger.name} caught ${target.name} not saying UNO! +2 penalty cards!`,
    lastActionNepaliMessage: `⚠️ ${challenger.nepaliName}ले ${target.nepaliName}लाई एक पत्ता नभनेकोमा समात्यो! +२ जरिवाना पत्ता!`,
    updatedAt: Date.now(),
  };
}

/**
 * AI Bot Logic: Picks the smartest legal move for a bot player.
 */
export function computeBotMove(state: UnoGameState, botId: string): {
  action: 'play' | 'draw' | 'pass';
  cardId?: string;
  chosenColor?: UnoColor;
} {
  const bot = state.players.find(p => p.id === botId);
  if (!bot) return { action: 'draw' };

  const topDiscard = state.discardPile[state.discardPile.length - 1];
  const validCards = bot.cards.filter(c => canPlayCard(c, topDiscard, state.activeColor));

  if (validCards.length === 0) {
    return { action: 'draw' };
  }

  // Compute bot's most frequent color to pick when playing Wild or prioritizing moves
  const colorCounts: Record<UnoColor, number> = { rato: 0, nilo: 0, hariyo: 0, pahelo: 0, wild: 0 };
  bot.cards.forEach(c => { colorCounts[c.color]++; });
  const bestColor: UnoColor = (Object.keys(colorCounts) as UnoColor[])
    .filter(c => c !== 'wild')
    .reduce((a, b) => (colorCounts[a] >= colorCounts[b] ? a : b), 'rato');

  // Strategy Priority:
  // 1. If opponent after bot has <= 2 cards, hit them with +4, +2, or Skip!
  const nextPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length, state.direction, 1);
  const nextOpponent = state.players[nextPlayerIndex];
  const nextIsDangerous = nextOpponent.cards.length <= 2;

  if (nextIsDangerous) {
    const attackCard = validCards.find(c => c.type === 'wild4' || c.type === 'draw2' || c.type === 'skip');
    if (attackCard) {
      return {
        action: 'play',
        cardId: attackCard.id,
        chosenColor: attackCard.color === 'wild' ? bestColor : undefined,
      };
    }
  }

  // 2. Play non-wild action cards (+2, Skip, Reverse)
  const actionCard = validCards.find(c => c.type === 'draw2' || c.type === 'skip' || c.type === 'reverse');
  if (actionCard) {
    return { action: 'play', cardId: actionCard.id };
  }

  // 3. Play matching number card in best color
  const bestColorMatch = validCards.find(c => c.color === bestColor && c.type === 'number');
  if (bestColorMatch) {
    return { action: 'play', cardId: bestColorMatch.id };
  }

  // 4. Any matching number card
  const anyNumber = validCards.find(c => c.type === 'number');
  if (anyNumber) {
    return { action: 'play', cardId: anyNumber.id };
  }

  // 5. Fallback to Wild cards
  const wildCard = validCards.find(c => c.color === 'wild');
  if (wildCard) {
    return {
      action: 'play',
      cardId: wildCard.id,
      chosenColor: bestColor,
    };
  }

  // 6. Just play first valid card
  const fallback = validCards[0];
  return {
    action: 'play',
    cardId: fallback.id,
    chosenColor: fallback.color === 'wild' ? bestColor : undefined,
  };
}
