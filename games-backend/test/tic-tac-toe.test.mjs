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

test('TicTacToeEngine.fromState: valid waiting state can restore', () => {
  const rawState = {
    gameType: 'tic-tac-toe',
    status: 'waiting',
    players: { X: 'user_A', O: null },
    board: Array(9).fill(null),
    currentTurn: null,
    winner: null,
    winningLine: null,
    revision: 1,
  };

  const engine = TicTacToeEngine.fromState(rawState);
  const state = engine.getState();
  assert.equal(state.gameType, 'tic-tac-toe');
  assert.equal(state.status, 'waiting');
  assert.equal(state.players.X, 'user_A');
  assert.equal(state.players.O, null);
  assert.equal(state.currentTurn, null);
  assert.equal(state.revision, 1);
});

test('TicTacToeEngine.fromState: valid playing state can restore and preserve all fields', () => {
  const board = ['X', null, null, null, 'O', null, null, null, null];
  const rawState = {
    gameType: 'tic-tac-toe',
    status: 'playing',
    players: { X: 'user_A', O: 'user_B' },
    board,
    currentTurn: 'X',
    winner: null,
    winningLine: null,
    revision: 4,
  };

  const engine = TicTacToeEngine.fromState(rawState);
  const state = engine.getState();
  assert.equal(state.status, 'playing');
  assert.equal(state.players.X, 'user_A');
  assert.equal(state.players.O, 'user_B');
  assert.deepEqual(state.board, board);
  assert.equal(state.currentTurn, 'X');
  assert.equal(state.winner, null);
  assert.equal(state.winningLine, null);
  assert.equal(state.revision, 4);
});

test('TicTacToeEngine.fromState: valid finished state with winner and winningLine can restore', () => {
  const board = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  const rawState = {
    gameType: 'tic-tac-toe',
    status: 'finished',
    players: { X: 'user_A', O: 'user_B' },
    board,
    currentTurn: null,
    winner: 'X',
    winningLine: [0, 1, 2],
    revision: 7,
  };

  const engine = TicTacToeEngine.fromState(rawState);
  const state = engine.getState();
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'X');
  assert.deepEqual(state.winningLine, [0, 1, 2]);
  assert.equal(state.currentTurn, null);
  assert.equal(state.revision, 7);
});

test('TicTacToeEngine.fromState: invalid gameType rejected', () => {
  const rawState = {
    gameType: 'chess',
    status: 'waiting',
    players: { X: null, O: null },
    board: Array(9).fill(null),
    currentTurn: null,
    winner: null,
    winningLine: null,
    revision: 0,
  };

  assert.throws(() => TicTacToeEngine.fromState(rawState), /Invalid gameType/i);
});

test('TicTacToeEngine.fromState: malformed board rejected', () => {
  // Not array
  assert.throws(
    () =>
      TicTacToeEngine.fromState({
        gameType: 'tic-tac-toe',
        status: 'waiting',
        players: { X: null, O: null },
        board: 'invalid-board',
        currentTurn: null,
        winner: null,
        winningLine: null,
        revision: 0,
      }),
    /board must be an array/i
  );

  // Length !== 9
  assert.throws(
    () =>
      TicTacToeEngine.fromState({
        gameType: 'tic-tac-toe',
        status: 'waiting',
        players: { X: null, O: null },
        board: ['X', 'O'],
        currentTurn: null,
        winner: null,
        winningLine: null,
        revision: 0,
      }),
    /exactly 9 elements/i
  );

  // Invalid cell contents
  assert.throws(
    () =>
      TicTacToeEngine.fromState({
        gameType: 'tic-tac-toe',
        status: 'waiting',
        players: { X: null, O: null },
        board: ['X', 'O', 'Z', null, null, null, null, null, null],
        currentTurn: null,
        winner: null,
        winningLine: null,
        revision: 0,
      }),
    /board\[2\] must be/i
  );
});

test('TicTacToeEngine.fromState: invalid revision rejected', () => {
  const makeState = (rev) => ({
    gameType: 'tic-tac-toe',
    status: 'waiting',
    players: { X: null, O: null },
    board: Array(9).fill(null),
    currentTurn: null,
    winner: null,
    winningLine: null,
    revision: rev,
  });

  assert.throws(() => TicTacToeEngine.fromState(makeState(-1)), /Invalid revision/i);
  assert.throws(() => TicTacToeEngine.fromState(makeState(2.5)), /Invalid revision/i);
  assert.throws(() => TicTacToeEngine.fromState(makeState('5')), /Invalid revision/i);
  assert.throws(() => TicTacToeEngine.fromState(makeState(NaN)), /Invalid revision/i);
});

test('TicTacToeEngine.fromState: invalid player symbol or state invariants rejected', () => {
  // Playing without both players
  assert.throws(
    () =>
      TicTacToeEngine.fromState({
        gameType: 'tic-tac-toe',
        status: 'playing',
        players: { X: 'user_A', O: null },
        board: Array(9).fill(null),
        currentTurn: 'X',
        winner: null,
        winningLine: null,
        revision: 2,
      }),
    /Both players must be assigned/i
  );

  // Same player for X and O
  assert.throws(
    () =>
      TicTacToeEngine.fromState({
        gameType: 'tic-tac-toe',
        status: 'playing',
        players: { X: 'user_A', O: 'user_A' },
        board: Array(9).fill(null),
        currentTurn: 'X',
        winner: null,
        winningLine: null,
        revision: 2,
      }),
    /cannot be the same user/i
  );
});

test('TicTacToeEngine.fromState: restored state continues gameplay correctly', () => {
  const board = ['X', null, null, null, 'O', null, null, null, null];
  const rawState = {
    gameType: 'tic-tac-toe',
    status: 'playing',
    players: { X: 'user_A', O: 'user_B' },
    board,
    currentTurn: 'X',
    winner: null,
    winningLine: null,
    revision: 4,
  };

  const engine = TicTacToeEngine.fromState(rawState);

  // O tries to move when it's X's turn -> rejected
  const moveO = engine.makeMove('user_B', 1);
  assert.equal(moveO.success, false);
  assert.match(moveO.error, /not your turn/i);

  // X makes valid move at cell 1
  const moveX = engine.makeMove('user_A', 1);
  assert.equal(moveX.success, true);
  assert.equal(engine.getState().currentTurn, 'O');
  assert.equal(engine.getState().board[1], 'X');
  assert.equal(engine.getState().revision, 5);
});

test('TicTacToeEngine: fresh game round = 1 and rematchRequestedBy = null', () => {
  const engine = new TicTacToeEngine();
  const state = engine.getState();
  assert.equal(state.round, 1);
  assert.equal(state.rematchRequestedBy, null);
});

test('TicTacToeEngine: rematch cannot be requested before game is finished', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_A');
  engine.join('user_B');

  // status is playing
  assert.equal(engine.getState().status, 'playing');
  const res = engine.requestRematch('user_A');
  assert.equal(res.success, false);
  assert.match(res.error, /not finished/i);
});

test('TicTacToeEngine: non-player cannot request rematch', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_A');
  engine.join('user_B');

  // Complete game with X win: (0, 1, 2)
  engine.makeMove('user_A', 0);
  engine.makeMove('user_B', 3);
  engine.makeMove('user_A', 1);
  engine.makeMove('user_B', 4);
  engine.makeMove('user_A', 2);
  assert.equal(engine.getState().status, 'finished');

  const res = engine.requestRematch('user_Spectator');
  assert.equal(res.success, false);
  assert.match(res.error, /not a player/i);
});

test('TicTacToeEngine: first player rematch request is accepted and increments revision', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_A');
  engine.join('user_B');

  // Complete game with X win: (0, 1, 2)
  engine.makeMove('user_A', 0);
  engine.makeMove('user_B', 3);
  engine.makeMove('user_A', 1);
  engine.makeMove('user_B', 4);
  engine.makeMove('user_A', 2);
  const revBefore = engine.getState().revision;

  const res = engine.requestRematch('user_A');
  assert.equal(res.success, true);
  assert.equal(res.accepted, false);
  assert.equal(res.round, 1);

  const state = engine.getState();
  assert.equal(state.rematchRequestedBy, 'user_A');
  assert.equal(state.revision, revBefore + 1);
});

test('TicTacToeEngine: repeated same-user rematch request is idempotent and does not increment revision', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_A');
  engine.join('user_B');

  engine.makeMove('user_A', 0);
  engine.makeMove('user_B', 3);
  engine.makeMove('user_A', 1);
  engine.makeMove('user_B', 4);
  engine.makeMove('user_A', 2);

  const firstReq = engine.requestRematch('user_A');
  assert.equal(firstReq.success, true);
  const revAfterFirst = engine.getState().revision;

  const secondReq = engine.requestRematch('user_A');
  assert.equal(secondReq.success, true);
  assert.equal(secondReq.isIdempotent, true);
  assert.equal(secondReq.accepted, false);
  assert.equal(engine.getState().revision, revAfterFirst);
  assert.equal(engine.getState().rematchRequestedBy, 'user_A');
});

test('TicTacToeEngine: opponent accepts rematch -> round 2, swapped roles, clean board, X starts', () => {
  const engine = new TicTacToeEngine();
  engine.join('user_A');
  engine.join('user_B');

  // Round 1: user_A is X, user_B is O
  assert.equal(engine.getState().players.X, 'user_A');
  assert.equal(engine.getState().players.O, 'user_B');

  engine.makeMove('user_A', 0);
  engine.makeMove('user_B', 3);
  engine.makeMove('user_A', 1);
  engine.makeMove('user_B', 4);
  engine.makeMove('user_A', 2); // user_A wins

  assert.equal(engine.getState().status, 'finished');
  assert.equal(engine.getState().winner, 'X');
  assert.deepEqual(engine.getState().winningLine, [0, 1, 2]);

  // user_A requests rematch
  const reqA = engine.requestRematch('user_A');
  assert.equal(reqA.success, true);

  const revBeforeAccept = engine.getState().revision;

  // user_B accepts rematch
  const reqB = engine.requestRematch('user_B');
  assert.equal(reqB.success, true);
  assert.equal(reqB.accepted, true);
  assert.equal(reqB.round, 2);

  const stateR2 = engine.getState();
  assert.equal(stateR2.status, 'playing');
  assert.equal(stateR2.round, 2);
  assert.equal(stateR2.rematchRequestedBy, null);
  assert.equal(stateR2.winner, null);
  assert.equal(stateR2.winningLine, null);
  assert.equal(stateR2.currentTurn, 'X');
  assert.deepEqual(stateR2.board, Array(9).fill(null));
  assert.equal(stateR2.revision, revBeforeAccept + 1);

  // Swapped roles: user_B is now X, user_A is now O
  assert.equal(stateR2.players.X, 'user_B');
  assert.equal(stateR2.players.O, 'user_A');

  // Verify user_B (now X) can make the first move of round 2
  const moveR2 = engine.makeMove('user_B', 4);
  assert.equal(moveR2.success, true);
  assert.equal(engine.getState().board[4], 'X');
  assert.equal(engine.getState().currentTurn, 'O');
});

test('TicTacToeEngine.fromState: legacy persisted state without round/rematchRequestedBy migrates safely', () => {
  const legacyPlaying = {
    gameType: 'tic-tac-toe',
    status: 'playing',
    players: { X: 'user_X', O: 'user_O' },
    board: Array(9).fill(null),
    currentTurn: 'X',
    winner: null,
    winningLine: null,
    revision: 3,
  };

  const engine = TicTacToeEngine.fromState(legacyPlaying);
  const state = engine.getState();
  assert.equal(state.round, 1);
  assert.equal(state.rematchRequestedBy, null);
  assert.equal(state.revision, 3);

  const legacyFinished = {
    gameType: 'tic-tac-toe',
    status: 'finished',
    players: { X: 'user_X', O: 'user_O' },
    board: ['X', 'X', 'X', 'O', 'O', null, null, null, null],
    currentTurn: null,
    winner: 'X',
    winningLine: [0, 1, 2],
    revision: 6,
  };

  const engineFinished = TicTacToeEngine.fromState(legacyFinished);
  const stateFinished = engineFinished.getState();
  assert.equal(stateFinished.round, 1);
  assert.equal(stateFinished.rematchRequestedBy, null);

  // Rematch can be requested from migrated finished state
  const rematchRes = engineFinished.requestRematch('user_X');
  assert.equal(rematchRes.success, true);
  assert.equal(engineFinished.getState().rematchRequestedBy, 'user_X');
});

test('TicTacToeEngine.fromState: malformed round or rematchRequestedBy rejected', () => {
  const baseFinished = {
    gameType: 'tic-tac-toe',
    status: 'finished',
    players: { X: 'user_X', O: 'user_O' },
    board: ['X', 'X', 'X', 'O', 'O', null, null, null, null],
    currentTurn: null,
    winner: 'X',
    winningLine: [0, 1, 2],
    revision: 6,
  };

  // Invalid round values
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, round: 0 }), /Invalid round/i);
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, round: -1 }), /Invalid round/i);
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, round: 1.5 }), /Invalid round/i);
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, round: '2' }), /Invalid round/i);

  // Invalid rematchRequestedBy values
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, rematchRequestedBy: 123 }), /rematchRequestedBy must be string/i);
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, rematchRequestedBy: '' }), /empty string/i);
  assert.throws(() => TicTacToeEngine.fromState({ ...baseFinished, rematchRequestedBy: 'user_Stranger' }), /one of the room players/i);

  // Non-null rematchRequestedBy when not finished
  const basePlaying = {
    gameType: 'tic-tac-toe',
    status: 'playing',
    players: { X: 'user_X', O: 'user_O' },
    board: Array(9).fill(null),
    currentTurn: 'X',
    winner: null,
    winningLine: null,
    revision: 2,
  };
  assert.throws(() => TicTacToeEngine.fromState({ ...basePlaying, rematchRequestedBy: 'user_X' }), /rematchRequestedBy must be null/i);
});
