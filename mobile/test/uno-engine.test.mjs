import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateUnoDeck,
  createInitialUnoGame,
  canPlayCard,
  playCard,
  drawCard,
  callUno,
  challengeUno,
  computeBotMove,
  getNextPlayerIndex,
} from '../components/games/uno/uno-engine.ts';

describe('Nepali UNO Game Engine (UNO: Ek Patta)', () => {
  test('1. Generates complete 108-card deck with correct Nepali themes', () => {
    const deck = generateUnoDeck();
    assert.strictEqual(deck.length, 108, 'Should have exactly 108 cards');

    // 4 colors x (1 zero + 18 numbers + 2 skip + 2 reverse + 2 draw2) = 4 x 25 = 100
    // + 4 Wild + 4 Wild4 = 108
    const rato = deck.filter(c => c.color === 'rato');
    const nilo = deck.filter(c => c.color === 'nilo');
    const hariyo = deck.filter(c => c.color === 'hariyo');
    const pahelo = deck.filter(c => c.color === 'pahelo');
    const wild = deck.filter(c => c.color === 'wild');

    assert.strictEqual(rato.length, 25);
    assert.strictEqual(nilo.length, 25);
    assert.strictEqual(hariyo.length, 25);
    assert.strictEqual(pahelo.length, 25);
    assert.strictEqual(wild.length, 8);

    const zeroes = deck.filter(c => c.type === 'number' && c.value === 0);
    assert.strictEqual(zeroes.length, 4, 'One 0 per color');
    assert.strictEqual(zeroes[0].nepaliDigit, '०');

    const skips = deck.filter(c => c.type === 'skip');
    assert.strictEqual(skips.length, 8);
    assert.ok(skips[0].nepaliLabel.includes('छेक'));

    const reverses = deck.filter(c => c.type === 'reverse');
    assert.strictEqual(reverses.length, 8);
    assert.ok(reverses[0].nepaliLabel.includes('फर्क'));

    const draw2s = deck.filter(c => c.type === 'draw2');
    assert.strictEqual(draw2s.length, 8);
    assert.ok(draw2s[0].nepaliLabel.includes('+२ तान'));

    const wild4s = deck.filter(c => c.type === 'wild4');
    assert.strictEqual(wild4s.length, 4);
    assert.ok(wild4s[0].nepaliLabel.includes('+४'));
  });

  test('2. Initializes game with 4 players, 7 cards each, and clean number start discard', () => {
    const game = createInitialUnoGame('bots', 'Saugat', 'सौगात');
    assert.strictEqual(game.players.length, 4);
    assert.strictEqual(game.players[0].name, 'Saugat');
    assert.strictEqual(game.players[0].nepaliName, 'सौगात');

    for (const p of game.players) {
      assert.strictEqual(p.cards.length, 7, 'Each player must receive 7 cards');
    }

    assert.strictEqual(game.discardPile.length, 1);
    const topCard = game.discardPile[0];
    assert.strictEqual(topCard.type, 'number', 'First card must be a number card');
    assert.strictEqual(game.activeColor, topCard.color);
    assert.strictEqual(game.currentPlayerIndex, 0);
    assert.strictEqual(game.direction, 'clockwise');
    assert.strictEqual(game.status, 'playing');
  });

  test('3. Card validity check (canPlayCard)', () => {
    const topCard = { id: 'top', color: 'rato', type: 'number', value: 5, nepaliLabel: 'रातो ५', englishLabel: 'Red 5', scoreValue: 5 };

    // Same color
    assert.ok(canPlayCard({ id: 'c1', color: 'rato', type: 'number', value: 2 }, topCard, 'rato'));
    // Same number, different color
    assert.ok(canPlayCard({ id: 'c2', color: 'nilo', type: 'number', value: 5 }, topCard, 'rato'));
    // Same action type, different color
    const skipTop = { id: 'top_skip', color: 'rato', type: 'skip' };
    assert.ok(canPlayCard({ id: 'c3', color: 'hariyo', type: 'skip' }, skipTop, 'rato'));
    // Wild card always valid
    assert.ok(canPlayCard({ id: 'c4', color: 'wild', type: 'wild' }, topCard, 'rato'));
    assert.ok(canPlayCard({ id: 'c5', color: 'wild', type: 'wild4' }, topCard, 'rato'));
    // Invalid card (different color, different number)
    assert.strictEqual(canPlayCard({ id: 'c6', color: 'pahelo', type: 'number', value: 3 }, topCard, 'rato'), false);
  });

  test('4. Turn progression and Direction: Clockwise and Counter-Clockwise', () => {
    assert.strictEqual(getNextPlayerIndex(0, 4, 'clockwise', 1), 1);
    assert.strictEqual(getNextPlayerIndex(3, 4, 'clockwise', 1), 0);
    assert.strictEqual(getNextPlayerIndex(0, 4, 'counter_clockwise', 1), 3);
    assert.strictEqual(getNextPlayerIndex(2, 4, 'counter_clockwise', 1), 1);
    assert.strictEqual(getNextPlayerIndex(0, 4, 'clockwise', 2), 2); // Skip
  });

  test('5. Action: Reverse card inverts play direction', () => {
    const game = createInitialUnoGame('bots');
    const reverseCard = { id: 'test_rev', color: game.activeColor, type: 'reverse', nepaliLabel: 'फर्क', englishLabel: 'Reverse', scoreValue: 20 };
    game.players[0].cards.push(reverseCard);

    const { nextState, event } = playCard(game, 'p_0', 'test_rev');
    assert.strictEqual(event, 'play');
    assert.strictEqual(nextState.direction, 'counter_clockwise');
    assert.strictEqual(nextState.currentPlayerIndex, 3, 'In 4 players, reversing from 0 clockwise goes to 3');
  });

  test('6. Action: Skip card skips the next player', () => {
    const game = createInitialUnoGame('bots');
    const skipCard = { id: 'test_skip', color: game.activeColor, type: 'skip', nepaliLabel: 'छेक', englishLabel: 'Skip', scoreValue: 20 };
    game.players[0].cards.push(skipCard);

    const { nextState, event } = playCard(game, 'p_0', 'test_skip');
    assert.strictEqual(event, 'play');
    assert.strictEqual(nextState.currentPlayerIndex, 2, 'Player 1 was skipped, turn goes to Player 2');
  });

  test('7. Action: Draw 2 adds 2 cards to victim and skips their turn', () => {
    const game = createInitialUnoGame('bots');
    const draw2Card = { id: 'test_draw2', color: game.activeColor, type: 'draw2', nepaliLabel: '+२ तान', englishLabel: '+2', scoreValue: 20 };
    game.players[0].cards.push(draw2Card);
    const p1CardCountBefore = game.players[1].cards.length;

    const { nextState, event } = playCard(game, 'p_0', 'test_draw2');
    assert.strictEqual(event, 'play');
    assert.strictEqual(nextState.players[1].cards.length, p1CardCountBefore + 2, 'Victim received 2 cards');
    assert.strictEqual(nextState.currentPlayerIndex, 2, 'Victim was skipped, turn goes to Player 2');
  });

  test('8. Action: Wild +4 prompts color, adds 4 cards to victim, and skips them', () => {
    const game = createInitialUnoGame('bots');
    const wild4Card = { id: 'test_w4', color: 'wild', type: 'wild4', nepaliLabel: '+४ तान', englishLabel: 'Wild +4', scoreValue: 50 };
    game.players[0].cards.push(wild4Card);
    const p1CardCountBefore = game.players[1].cards.length;

    // Playing with chosenColor 'hariyo'
    const { nextState, event } = playCard(game, 'p_0', 'test_w4', 'hariyo');
    assert.strictEqual(event, 'play');
    assert.strictEqual(nextState.activeColor, 'hariyo');
    assert.strictEqual(nextState.players[1].cards.length, p1CardCountBefore + 4, 'Victim received 4 cards');
    assert.strictEqual(nextState.currentPlayerIndex, 2, 'Victim was skipped');
  });

  test('9. Drawing a card adds to hand and passes if not playable', () => {
    const game = createInitialUnoGame('bots');
    game.drawPile = [
      { id: 'drawn_unplayable', color: 'pahelo', type: 'number', value: 9, nepaliLabel: 'पहेँलो ९', englishLabel: 'Yellow 9', scoreValue: 9 }
    ];
    // Active discard is Rato 5
    game.discardPile = [{ id: 'd_top', color: 'rato', type: 'number', value: 5, nepaliLabel: 'रातो ५', englishLabel: 'Red 5', scoreValue: 5 }];
    game.activeColor = 'rato';

    const p0Count = game.players[0].cards.length;
    const nextState = drawCard(game, 'p_0');
    assert.strictEqual(nextState.players[0].cards.length, p0Count + 1);
    assert.strictEqual(nextState.currentPlayerIndex, 1, 'Turn passed because drawn card is not playable');
  });

  test('10. Calling UNO and catching an opponent who forgot to say UNO', () => {
    const game = createInitialUnoGame('bots');
    // Player 1 has 1 card but hasn't called UNO
    game.players[1].cards = [{ id: 'last_c', color: 'rato', type: 'number', value: 1, nepaliLabel: 'रातो १', englishLabel: 'Red 1', scoreValue: 1 }];
    game.players[1].hasCalledUno = false;

    // Player 0 catches Player 1
    const caughtState = challengeUno(game, 'p_0', 'p_1');
    assert.strictEqual(caughtState.players[1].cards.length, 3, 'Player 1 penalized with 2 cards');
    assert.ok(caughtState.lastActionNepaliMessage.includes('जरिवाना'));

    // Now test calling UNO legitimately when player has <= 2 cards
    game.players[0].cards = [
      { id: 'u1', color: 'rato', type: 'number', value: 1 },
      { id: 'u2', color: 'rato', type: 'number', value: 2 },
    ];
    const unoCalledState = callUno(game, 'p_0');
    assert.strictEqual(unoCalledState.players[0].hasCalledUno, true);
  });

  test('11. Bot AI computes legal, smart move', () => {
    const game = createInitialUnoGame('bots');
    game.currentPlayerIndex = 1;
    game.activeColor = 'nilo';
    game.discardPile = [{ id: 'top_d', color: 'nilo', type: 'number', value: 3, nepaliLabel: 'नीलो ३', englishLabel: 'Blue 3', scoreValue: 3 }];
    game.players[1].cards = [
      { id: 'b_1', color: 'rato', type: 'number', value: 7 },
      { id: 'b_2', color: 'nilo', type: 'number', value: 8 }, // Legal!
      { id: 'b_3', color: 'hariyo', type: 'number', value: 1 }
    ];

    const move = computeBotMove(game, 'p_1');
    assert.strictEqual(move.action, 'play');
    assert.strictEqual(move.cardId, 'b_2');
  });

  test('12. Victory condition: Player emptying hand wins the game', () => {
    const game = createInitialUnoGame('bots');
    const winningCard = { id: 'win_c', color: game.activeColor, type: 'number', value: 4, nepaliLabel: '४', englishLabel: '4', scoreValue: 4 };
    game.players[0].cards = [winningCard];

    const { nextState, event } = playCard(game, 'p_0', 'win_c');
    assert.strictEqual(event, 'win');
    assert.strictEqual(nextState.status, 'game_over');
    assert.strictEqual(nextState.winner.id, 'p_0');
    assert.ok(nextState.lastActionNepaliMessage.includes('जित्यो'));
  });

  test('13. Pass & Play mode initializes all 4 players as human (not bots)', () => {
    const game = createInitialUnoGame('pass_and_play', 'अविनाश', 'अविनाश');
    assert.strictEqual(game.mode, 'pass_and_play');
    assert.strictEqual(game.players.length, 4);
    assert.strictEqual(game.players.every(p => p.isBot === false), true);
    assert.strictEqual(game.players[0].name, 'अविनाश');
  });
});
