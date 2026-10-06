import test from 'node:test';
import assert from 'node:assert/strict';
import { TicTacToeEngine } from '../src/games/tic-tac-toe.ts';

test('TicTacToeEngine: first user assigned X, second assigned O', () => {
  const engine = new TicTacToeEngine();

  const join1 = engine.join('user_1');
  assert.equal(join1.success, true);
  assert.equal(join1.symbol, 'X');
  assert.equal(join1.isNewJoin, true);

  const state1 = engine.getState();
  assert.equal(state1.players.X, 'user_1');
  assert.equal(state1.players.O, null);
  assert.equal(state1.status, 'waiting');
  assert.equal(state1.currentTurn, null);
  assert.equal(state1.revision, 1);

  const join2 = engine.join('user_2');
  assert.equal(join2.success, true);
  assert.equal(join2.symbol, 'O');
  assert.equal(join2.isNewJoin, true);

  const state2 = engine.getState();
  assert.equal(state2.players.X, 'user_1');
  assert.equal(state2.players.O, 'user_2');
  assert.equal(state2.status, 'playing');
  assert.equal(state2.currentTurn, 'X');
  assert.equal(state2.revision, 2);
});

test('TicTacToeEngine: third unique user is rejected', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_1');
  engine.join('user_2');

  const join3 = engine.join('user_3');
  assert.equal(join3.success, false);
  assert.match(join3.error, /full/i);

  const state = engine.getState();
  assert.equal(state.players.X, 'user_1');
  assert.equal(state.players.O, 'user_2');
  assert.equal(state.revision, 2); // Unchanged
});

test('TicTacToeEngine: duplicate join from same user does not create another slot', () => {
  const engine = new TicTacToeEngine();
  const join1 = engine.join('user_1');
  assert.equal(join1.symbol, 'X');

  const joinAgain = engine.join('user_1');
  assert.equal(joinAgain.success, true);
  assert.equal(joinAgain.symbol, 'X');
  assert.equal(joinAgain.isNewJoin, false);

  const state = engine.getState();
  assert.equal(state.players.X, 'user_1');
  assert.equal(state.players.O, null);
  assert.equal(state.status, 'waiting');
  assert.equal(state.revision, 1); // Not incremented on re-join
});

test('TicTacToeEngine: game starts after second player joins and X goes first', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_A');
  assert.equal(engine.getState().status, 'waiting');
  assert.equal(engine.getState().currentTurn, null);

  engine.join('user_B');
  assert.equal(engine.getState().status, 'playing');
  assert.equal(engine.getState().currentTurn, 'X');
});

test('TicTacToeEngine: move before second player joins is rejected', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_1');

  const move = engine.makeMove('user_1', 0);
  assert.equal(move.success, false);
  assert.match(move.error, /waiting/i);
});

test('TicTacToeEngine: non-player cannot move', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_1');
  engine.join('user_2');

  const move = engine.makeMove('user_impostor', 0);
  assert.equal(move.success, false);
  assert.match(move.error, /not a player/i);
});

test('TicTacToeEngine: X cannot move twice and O cannot move out of turn', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  // O tries to move first
  const moveOFirst = engine.makeMove('user_O', 0);
  assert.equal(moveOFirst.success, false);
  assert.match(moveOFirst.error, /not your turn/i);

  // X moves legally
  const moveX1 = engine.makeMove('user_X', 0);
  assert.equal(moveX1.success, true);
  assert.equal(engine.getState().currentTurn, 'O');

  // X tries to move again immediately
  const moveXAgain = engine.makeMove('user_X', 1);
  assert.equal(moveXAgain.success, false);
  assert.match(moveXAgain.error, /not your turn/i);
});

test('TicTacToeEngine: invalid cell indices are rejected', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  const invalidIndices = [-1, 9, 100, 3.5, NaN, null, undefined, '0'];
  for (const idx of invalidIndices) {
    const move = engine.makeMove('user_X', idx);
    assert.equal(move.success, false, `Expected index ${idx} to be rejected`);
    assert.match(move.error, /integer between 0 and 8/i);
  }
});

test('TicTacToeEngine: occupied cell cannot be overwritten', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  // X occupies cell 4 (center)
  const moveX = engine.makeMove('user_X', 4);
  assert.equal(moveX.success, true);

  // O tries to take cell 4
  const moveO = engine.makeMove('user_O', 4);
  assert.equal(moveO.success, false);
  assert.match(moveO.error, /occupied/i);

  // Board still has X at cell 4, turn is still O
  const state = engine.getState();
  assert.equal(state.board[4], 'X');
  assert.equal(state.currentTurn, 'O');
});

test('TicTacToeEngine: X win detected (row 0, 1, 2)', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  // X: 0, O: 3
  // X: 1, O: 4
  // X: 2 -> X wins!
  assert.equal(engine.makeMove('user_X', 0).success, true);
  assert.equal(engine.makeMove('user_O', 3).success, true);
  assert.equal(engine.makeMove('user_X', 1).success, true);
  assert.equal(engine.makeMove('user_O', 4).success, true);
  const winMove = engine.makeMove('user_X', 2);

  assert.equal(winMove.success, true);
  assert.equal(winMove.winner, 'X');
  assert.deepEqual(winMove.winningLine, [0, 1, 2]);

  const state = engine.getState();
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'X');
  assert.deepEqual(state.winningLine, [0, 1, 2]);
  assert.equal(state.currentTurn, null);
});

test('TicTacToeEngine: O win detected (diagonal 2, 4, 6)', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  // X: 0, O: 2
  // X: 1, O: 4
  // X: 8, O: 6 -> O wins!
  assert.equal(engine.makeMove('user_X', 0).success, true);
  assert.equal(engine.makeMove('user_O', 2).success, true);
  assert.equal(engine.makeMove('user_X', 1).success, true);
  assert.equal(engine.makeMove('user_O', 4).success, true);
  assert.equal(engine.makeMove('user_X', 8).success, true);
  const winMove = engine.makeMove('user_O', 6);

  assert.equal(winMove.success, true);
  assert.equal(winMove.winner, 'O');
  assert.deepEqual(winMove.winningLine, [2, 4, 6]);

  const state = engine.getState();
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'O');
  assert.deepEqual(state.winningLine, [2, 4, 6]);
  assert.equal(state.currentTurn, null);
});

test('TicTacToeEngine: draw detected when board is full without winner', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  // Board layout for draw:
  // X O X
  // X X O
  // O X O
  // Moves:
  // X: 0, O: 1
  // X: 2, O: 5
  // X: 3, O: 6
  // X: 4, O: 8
  // X: 7
  assert.equal(engine.makeMove('user_X', 0).success, true);
  assert.equal(engine.makeMove('user_O', 1).success, true);
  assert.equal(engine.makeMove('user_X', 2).success, true);
  assert.equal(engine.makeMove('user_O', 5).success, true);
  assert.equal(engine.makeMove('user_X', 3).success, true);
  assert.equal(engine.makeMove('user_O', 6).success, true);
  assert.equal(engine.makeMove('user_X', 4).success, true);
  assert.equal(engine.makeMove('user_O', 8).success, true);
  const lastMove = engine.makeMove('user_X', 7);

  assert.equal(lastMove.success, true);
  assert.equal(lastMove.winner, 'draw');
  assert.equal(lastMove.winningLine, null);

  const state = engine.getState();
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'draw');
  assert.equal(state.winningLine, null);
  assert.equal(state.currentTurn, null);
  assert.equal(state.board.every((cell) => cell !== null), true);
});

test('TicTacToeEngine: moves rejected after game is finished', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_X');
  engine.join('user_O');

  // X wins quickly (0, 1, 2)
  engine.makeMove('user_X', 0);
  engine.makeMove('user_O', 3);
  engine.makeMove('user_X', 1);
  engine.makeMove('user_O', 4);
  engine.makeMove('user_X', 2); // Finished!

  const postFinishMoveO = engine.makeMove('user_O', 5);
  assert.equal(postFinishMoveO.success, false);
  assert.match(postFinishMoveO.error, /already finished/i);

  const postFinishMoveX = engine.makeMove('user_X', 6);
  assert.equal(postFinishMoveX.success, false);
  assert.match(postFinishMoveX.error, /already finished/i);
});

test('TicTacToeEngine: state revision increments correctly', () => {
  const engine = new TicTacToeEngine();
  assert.equal(engine.getState().revision, 0);

  engine.join('user_X'); // revision 1
  assert.equal(engine.getState().revision, 1);

  engine.join('user_X'); // duplicate join: revision remains 1
  assert.equal(engine.getState().revision, 1);

  engine.join('user_O'); // revision 2
  assert.equal(engine.getState().revision, 2);

  // Rejected move: revision unchanged
  engine.makeMove('user_O', 0);
  assert.equal(engine.getState().revision, 2);

  // Valid move 1: revision 3
  engine.makeMove('user_X', 0);
  assert.equal(engine.getState().revision, 3);

  // Valid move 2: revision 4
  engine.makeMove('user_O', 4);
  assert.equal(engine.getState().revision, 4);
});
