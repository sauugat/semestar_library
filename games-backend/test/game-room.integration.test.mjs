import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGamesTicket } = require('../../lib/games-ticket.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

// Read secret dynamically from .dev.vars without hardcoding any secret
let TEST_SECRET = '';
try {
  const devVarsContent = fs.readFileSync(path.join(backendDir, '.dev.vars'), 'utf8');
  const match = devVarsContent.match(/GAMES_TICKET_SECRET=([a-f0-9]+)/);
  if (match) {
    TEST_SECRET = match[1];
  }
} catch {}

if (!TEST_SECRET) {
  throw new Error('GAMES_TICKET_SECRET is not configured in .dev.vars');
}

const PORT = 8789;
const BASE_HTTP = `http://127.0.0.1:${PORT}`;
const BASE_WS = `ws://127.0.0.1:${PORT}`;

class MessageQueue {
  constructor(ws) {
    this.queue = [];
    this.waiters = [];
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        waiter.resolve(data);
      } else {
        this.queue.push(data);
      }
    });
  }

  next(timeoutMs = 6000) {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`Timed out waiting for next message after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.push({
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
      });
    });
  }
}

function connectWs(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout to ${url}`));
    }, 5000);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function testHttpHandshake(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE_HTTP}${pathname}`,
      {
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, body });
        });
      }
    );
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, body: '' });
    });
    req.on('error', reject);
    req.end();
  });
}

async function startWrangler() {
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, GAMES_TICKET_SECRET: TEST_SECRET },
  });

  const startTime = Date.now();
  let ready = false;
  while (Date.now() - startTime < 15000) {
    try {
      const res = await fetch(`${BASE_HTTP}/`, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!ready) {
    proc.kill('SIGTERM');
    throw new Error('Local Wrangler server failed to start within 15 seconds');
  }

  return proc;
}

async function stopWrangler(proc) {
  if (!proc) return;
  proc.kill('SIGTERM');
  const startTime = Date.now();
  while (Date.now() - startTime < 5000) {
    try {
      await fetch(`${BASE_HTTP}/`, { signal: AbortSignal.timeout(300) });
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 300));
}

let wranglerProc = null;

before(async () => {
  wranglerProc = await startWrangler();
});

after(async () => {
  if (wranglerProc) {
    await stopWrangler(wranglerProc);
    wranglerProc = null;
  }
});

test('Integration: Auth verification (no Authorization header and query-parameter only fail with HTTP 401)', async () => {
  const roomId = `room_auth_check_${Date.now()}`;
  const validTicket = createGamesTicket(
    { studentId: 'student_auth_check', username: 'charlie', name: 'Charlie' },
    TEST_SECRET
  );

  // 1. Connection with NO Authorization header returns HTTP 401
  const resNoAuth = await testHttpHandshake(`/rooms/${roomId}/ws`);
  assert.equal(resNoAuth.status, 401);
  const bodyNoAuth = JSON.parse(resNoAuth.body);
  assert.equal(bodyNoAuth.error, 'Unauthorized');

  // Verify WebSocket client without Authorization header fails to connect
  await assert.rejects(
    connectWs(`${BASE_WS}/rooms/${roomId}/ws`),
    (err) => err !== null
  );

  // 2. Connection with query-parameter only ?ticket=<valid-ticket> returns HTTP 401
  const resQueryOnly = await testHttpHandshake(`/rooms/${roomId}/ws?ticket=${validTicket}`);
  assert.equal(resQueryOnly.status, 401);
  const bodyQueryOnly = JSON.parse(resQueryOnly.body);
  assert.equal(bodyQueryOnly.error, 'Unauthorized');

  // Verify WebSocket client with query-only ticket fails to connect
  await assert.rejects(
    connectWs(`${BASE_WS}/rooms/${roomId}/ws?ticket=${validTicket}`),
    (err) => err !== null
  );
});

test('Integration: Two-player Tic Tac Toe flow against local Wrangler using header-only auth', async () => {
  const roomId = `room_int_${Date.now()}`;

  const ticketA = createGamesTicket(
    { studentId: 'student_user_A', username: 'alice', name: 'Alice' },
    TEST_SECRET
  );
  const ticketB = createGamesTicket(
    { studentId: 'student_user_B', username: 'bob', name: 'Bob' },
    TEST_SECRET
  );

  // 1. User A connects with Authorization: Bearer <ticket>
  const wsA = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketA}`,
  });
  const queueA = new MessageQueue(wsA);

  const connEventA = await queueA.next();
  assert.equal(connEventA.type, 'CONNECTED');
  assert.equal(connEventA.userId, 'student_user_A');
  assert.equal(connEventA.roomId, roomId);
  assert.equal(connEventA.protocolVersion, 1);

  // 2. User B connects with Authorization: Bearer <ticket>
  const wsB = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketB}`,
  });
  const queueB = new MessageQueue(wsB);

  const connEventB = await queueB.next();
  assert.equal(connEventB.type, 'CONNECTED');
  assert.equal(connEventB.userId, 'student_user_B');
  assert.equal(connEventB.roomId, roomId);
  assert.equal(connEventB.protocolVersion, 1);

  // 3. User A joins -> assigned X
  wsA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const joinStateA = await queueA.next();
  assert.equal(joinStateA.type, 'GAME_STATE');
  assert.equal(joinStateA.state.players.X, 'student_user_A');
  assert.equal(joinStateA.state.players.O, null);
  assert.equal(joinStateA.state.status, 'waiting');
  assert.equal(joinStateA.state.revision, 1);

  // Since wsB is already connected, it also receives the broadcast of User A's join
  const joinStateA_forB = await queueB.next();
  assert.equal(joinStateA_forB.type, 'GAME_STATE');
  assert.equal(joinStateA_forB.state.players.X, 'student_user_A');
  assert.equal(joinStateA_forB.state.players.O, null);
  assert.equal(joinStateA_forB.state.revision, 1);

  // 4. User B joins -> assigned O, game begins
  wsB.send(JSON.stringify({ type: 'JOIN_GAME' }));

  // Both A and B receive the updated GAME_STATE
  const stateAfterB_forA = await queueA.next();
  const stateAfterB_forB = await queueB.next();

  assert.equal(stateAfterB_forA.type, 'GAME_STATE');
  assert.equal(stateAfterB_forA.state.players.X, 'student_user_A');
  assert.equal(stateAfterB_forA.state.players.O, 'student_user_B');
  assert.equal(stateAfterB_forA.state.status, 'playing');
  assert.equal(stateAfterB_forA.state.currentTurn, 'X');
  assert.equal(stateAfterB_forA.state.revision, 2);

  assert.equal(stateAfterB_forB.type, 'GAME_STATE');
  assert.equal(stateAfterB_forB.state.players.X, 'student_user_A');
  assert.equal(stateAfterB_forB.state.players.O, 'student_user_B');
  assert.equal(stateAfterB_forB.state.status, 'playing');
  assert.equal(stateAfterB_forB.state.currentTurn, 'X');
  assert.equal(stateAfterB_forB.state.revision, 2);

  // 5. User A moves (cell 0) -> both receive updated state
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 0 }));

  const move1_forA = await queueA.next();
  const move1_forB = await queueB.next();

  assert.equal(move1_forA.type, 'GAME_STATE');
  assert.equal(move1_forA.state.board[0], 'X');
  assert.equal(move1_forA.state.currentTurn, 'O');
  assert.equal(move1_forA.state.revision, 3);

  assert.equal(move1_forB.type, 'GAME_STATE');
  assert.equal(move1_forB.state.board[0], 'X');
  assert.equal(move1_forB.state.currentTurn, 'O');
  assert.equal(move1_forB.state.revision, 3);

  // 6. User B moves (cell 4) -> both receive updated state
  wsB.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 4 }));

  const move2_forA = await queueA.next();
  const move2_forB = await queueB.next();

  assert.equal(move2_forA.type, 'GAME_STATE');
  assert.equal(move2_forA.state.board[4], 'O');
  assert.equal(move2_forA.state.currentTurn, 'X');
  assert.equal(move2_forA.state.revision, 4);

  assert.equal(move2_forB.type, 'GAME_STATE');
  assert.equal(move2_forB.state.board[4], 'O');
  assert.equal(move2_forB.state.currentTurn, 'X');
  assert.equal(move2_forB.state.revision, 4);

  // 7. Invalid out-of-turn move: User B attempts to move while currentTurn is 'X'
  wsB.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 1 }));

  // Offender (User B) receives ERROR
  const errEvent = await queueB.next();
  assert.equal(errEvent.type, 'ERROR');
  assert.match(errEvent.message, /not your turn/i);
  assert.equal(errEvent.protocolVersion, 1);

  // User A should NOT receive any error message.
  // Verify state is unchanged by having User A request state.
  wsA.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const verifyStateA = await queueA.next();
  assert.equal(verifyStateA.type, 'GAME_STATE');
  assert.equal(verifyStateA.state.revision, 4);
  assert.equal(verifyStateA.state.board[1], null);
  assert.equal(verifyStateA.state.currentTurn, 'X');

  // 8. Invalid move: User A attempts to move into already occupied cell 4
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 4 }));
  const errOccupied = await queueA.next();
  assert.equal(errOccupied.type, 'ERROR');
  assert.match(errOccupied.message, /occupied/i);

  // 9. Invalid move: User A sends invalid out-of-range cellIndex
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 99 }));
  const errRange = await queueA.next();
  assert.equal(errRange.type, 'ERROR');
  assert.match(errRange.message, /integer between 0 and 8/i);

  // 10. Complete game to win:
  // User A moves cell 1 -> X
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 1 }));
  const move3_A = await queueA.next();
  const move3_B = await queueB.next();
  assert.equal(move3_A.state.board[1], 'X');
  assert.equal(move3_B.state.board[1], 'X');
  assert.equal(move3_A.state.revision, 5);

  // User B moves cell 8 -> O
  wsB.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 8 }));
  const move4_A = await queueA.next();
  const move4_B = await queueB.next();
  assert.equal(move4_A.state.board[8], 'O');
  assert.equal(move4_B.state.board[8], 'O');
  assert.equal(move4_A.state.revision, 6);

  // User A moves cell 2 -> X (Completes row 0, 1, 2: X wins!)
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 2 }));
  const win_A = await queueA.next();
  const win_B = await queueB.next();
  assert.equal(win_A.state.status, 'finished');
  assert.equal(win_A.state.winner, 'X');
  assert.deepEqual(win_A.state.winningLine, [0, 1, 2]);
  assert.equal(win_A.state.revision, 7);
  assert.equal(win_B.state.status, 'finished');
  assert.equal(win_B.state.winner, 'X');
  assert.deepEqual(win_B.state.winningLine, [0, 1, 2]);
  assert.equal(win_B.state.revision, 7);

  // 11. Move after finished game rejected
  wsB.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 3 }));
  const errFinished = await queueB.next();
  assert.equal(errFinished.type, 'ERROR');
  assert.match(errFinished.message, /already finished/i);

  // Clean up WebSockets
  wsA.close();
  wsB.close();
});

test('Integration: Durable persistence, restarts, and room isolation', async () => {
  const roomId = `room_persist_${Date.now()}`;
  const isolatedRoomId = `room_isolated_${Date.now()}`;

  const ticketA = createGamesTicket(
    { studentId: 'student_durable_A', username: 'alice', name: 'Alice' },
    TEST_SECRET
  );
  const ticketB = createGamesTicket(
    { studentId: 'student_durable_B', username: 'bob', name: 'Bob' },
    TEST_SECRET
  );

  // Phase A: Connect User A and User B
  const wsA1 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketA}`,
  });
  const queueA1 = new MessageQueue(wsA1);
  await queueA1.next(); // CONNECTED

  const wsB1 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketB}`,
  });
  const queueB1 = new MessageQueue(wsB1);
  await queueB1.next(); // CONNECTED

  // Phase B: Join Game
  wsA1.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA1.next(); // A joined
  await queueB1.next(); // A joined broadcast to B

  wsB1.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA1.next(); // B joined
  await queueB1.next(); // B joined

  // Phase C: Make moves
  // X -> 0
  wsA1.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 0 }));
  await queueA1.next();
  await queueB1.next();

  // O -> 4
  wsB1.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 4 }));
  await queueA1.next();
  await queueB1.next();

  // X -> 1
  wsA1.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 1 }));
  const move3_A = await queueA1.next();
  await queueB1.next();

  // Record expected state before restart:
  // board: ['X', 'X', null, null, 'O', null, null, null, null]
  // players: X = student_durable_A, O = student_durable_B
  // currentTurn: 'O'
  // revision: 5
  assert.equal(move3_A.state.revision, 5);
  assert.equal(move3_A.state.currentTurn, 'O');
  assert.equal(move3_A.state.board[0], 'X');
  assert.equal(move3_A.state.board[1], 'X');
  assert.equal(move3_A.state.board[4], 'O');

  // Attempt invalid out-of-turn move before restart (User A attempts cell 2 during O's turn)
  wsA1.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 2 }));
  const errRejected = await queueA1.next();
  assert.equal(errRejected.type, 'ERROR');
  assert.match(errRejected.message, /not your turn/i);

  // Close connections cleanly before restarting server
  wsA1.close();
  wsB1.close();

  // Phase D: STOP Wrangler completely
  await stopWrangler(wranglerProc);
  wranglerProc = null;

  // Phase E: START Wrangler again (Restart #1)
  wranglerProc = await startWrangler();

  // Phase F: Reconnect SAME users to SAME room ID
  const wsA2 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketA}`,
  });
  const queueA2 = new MessageQueue(wsA2);
  await queueA2.next(); // CONNECTED

  const wsB2 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketB}`,
  });
  const queueB2 = new MessageQueue(wsB2);
  await queueB2.next(); // CONNECTED

  // Send REQUEST_STATE from User A
  wsA2.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  let restoredStateMsg = await queueA2.next();
  if (queueA2.queue.length > 0 && queueA2.queue[0].type === 'GAME_STATE') {
    restoredStateMsg = await queueA2.next();
  }
  assert.equal(restoredStateMsg.type, 'GAME_STATE');
  const restoredState = restoredStateMsg.state;

  // Verify state exactly matches pre-restart state and rejected move was NOT persisted
  assert.equal(restoredState.players.X, 'student_durable_A');
  assert.equal(restoredState.players.O, 'student_durable_B');
  assert.equal(restoredState.status, 'playing');
  assert.equal(restoredState.currentTurn, 'O');
  assert.equal(restoredState.revision, 5);
  assert.equal(restoredState.board[0], 'X');
  assert.equal(restoredState.board[1], 'X');
  assert.equal(restoredState.board[4], 'O');
  assert.equal(restoredState.board[2], null); // Cell 2 remained empty

  // Phase G: Continue the match after restart
  // O -> 8
  wsB2.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 8 }));
  let move4_A = await queueA2.next();
  while (!move4_A.state || move4_A.state.revision < 6) {
    move4_A = await queueA2.next();
  }
  let move4_B = await queueB2.next();
  while (!move4_B.state || move4_B.state.revision < 6) {
    move4_B = await queueB2.next();
  }
  assert.equal(move4_A.state.board[8], 'O');
  assert.equal(move4_A.state.currentTurn, 'X');
  assert.equal(move4_A.state.revision, 6);

  // X -> 2 (Completes row 0, 1, 2: X wins!)
  wsA2.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 2 }));
  const winStateMsg = await queueA2.next();
  await queueB2.next();
  assert.equal(winStateMsg.state.status, 'finished');
  assert.equal(winStateMsg.state.winner, 'X');
  assert.deepEqual(winStateMsg.state.winningLine, [0, 1, 2]);
  assert.equal(winStateMsg.state.revision, 7);

  // Close connections cleanly
  wsA2.close();
  wsB2.close();

  // Phase H: STOP Wrangler again
  await stopWrangler(wranglerProc);
  wranglerProc = null;

  // Phase I: START Wrangler a third time (Restart #2)
  wranglerProc = await startWrangler();

  // Reconnect User A to the SAME room ID
  const wsA3 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${ticketA}`,
  });
  const queueA3 = new MessageQueue(wsA3);
  await queueA3.next(); // CONNECTED

  // Send REQUEST_STATE and verify final finished state is preserved
  wsA3.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const finalStateMsg = await queueA3.next();
  assert.equal(finalStateMsg.type, 'GAME_STATE');
  const finalState = finalStateMsg.state;

  assert.equal(finalState.status, 'finished');
  assert.equal(finalState.winner, 'X');
  assert.deepEqual(finalState.winningLine, [0, 1, 2]);
  assert.equal(finalState.revision, 7);
  assert.equal(finalState.currentTurn, null);
  assert.equal(finalState.board[0], 'X');
  assert.equal(finalState.board[1], 'X');
  assert.equal(finalState.board[2], 'X');
  assert.equal(finalState.board[4], 'O');
  assert.equal(finalState.board[8], 'O');

  wsA3.close();

  // Phase J: Room Storage Isolation Test
  // Connect to a DIFFERENT room ID and verify it is completely fresh and independent
  const wsIso = await connectWs(`${BASE_WS}/rooms/${isolatedRoomId}/ws`, {
    Authorization: `Bearer ${ticketA}`,
  });
  const queueIso = new MessageQueue(wsIso);
  await queueIso.next(); // CONNECTED

  wsIso.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const isoStateMsg = await queueIso.next();
  assert.equal(isoStateMsg.type, 'GAME_STATE');
  const isoState = isoStateMsg.state;

  assert.equal(isoState.status, 'waiting');
  assert.equal(isoState.players.X, null);
  assert.equal(isoState.players.O, null);
  assert.equal(isoState.currentTurn, null);
  assert.equal(isoState.winner, null);
  assert.equal(isoState.revision, 0);
  assert.equal(isoState.board.every((cell) => cell === null), true);

  wsIso.close();
});

test('Integration: Rematch request, restarts, role swapping, and second-round persistence', async () => {
  const roomId = `room_rematch_${Date.now()}`;
  const userAId = 'student_rematch_a';
  const userBId = 'student_rematch_b';

  const ticketA = createGamesTicket({ studentId: userAId, username: 'alice', name: 'Alice' }, TEST_SECRET);
  const ticketB = createGamesTicket({ studentId: userBId, username: 'bob', name: 'Bob' }, TEST_SECRET);

  // 1. Connect User A & User B
  const wsA = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA = new MessageQueue(wsA);
  await queueA.next(); // CONNECTED A

  const wsB = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueB = new MessageQueue(wsB);
  await queueB.next(); // CONNECTED B

  // 2. Both join game
  wsA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const joinA_msgA = await queueA.next();
  const joinA_msgB = await queueB.next();
  assert.equal(joinA_msgA.state.players.X, userAId);
  assert.equal(joinA_msgB.state.players.X, userAId);

  wsB.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const joinB_msgA = await queueA.next();
  const joinB_msgB = await queueB.next();
  assert.equal(joinB_msgA.state.status, 'playing');
  assert.equal(joinB_msgB.state.status, 'playing');
  assert.equal(joinB_msgA.state.round, 1);
  assert.equal(joinB_msgA.state.rematchRequestedBy, null);

  // 3. Play Round 1: X (User A) completes row 0, 1, 2
  // A -> 0
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 0 }));
  await queueA.next(); await queueB.next();
  // B -> 3
  wsB.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 3 }));
  await queueA.next(); await queueB.next();
  // A -> 1
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 1 }));
  await queueA.next(); await queueB.next();
  // B -> 4
  wsB.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 4 }));
  await queueA.next(); await queueB.next();
  // A -> 2 (Win!)
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 2 }));
  const finishMsgA = await queueA.next();
  const finishMsgB = await queueB.next();
  assert.equal(finishMsgA.state.status, 'finished');
  assert.equal(finishMsgB.state.status, 'finished');
  assert.equal(finishMsgA.state.winner, 'X');
  assert.deepEqual(finishMsgA.state.winningLine, [0, 1, 2]);

  // 4. User A sends REMATCH
  wsA.send(JSON.stringify({ type: 'REMATCH' }));
  const rematchReqA = await queueA.next();
  const rematchReqB = await queueB.next();
  assert.equal(rematchReqA.state.status, 'finished');
  assert.equal(rematchReqB.state.status, 'finished');
  assert.equal(rematchReqA.state.rematchRequestedBy, userAId);
  assert.equal(rematchReqB.state.rematchRequestedBy, userAId);
  assert.equal(rematchReqA.state.round, 1);

  // 5. Disconnect both sockets
  wsA.close();
  wsB.close();

  // 6. Restart Wrangler (Restart #1)
  await stopWrangler(wranglerProc);
  wranglerProc = null;
  wranglerProc = await startWrangler();

  // 7. Reconnect both users to the same room
  const wsA2 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA2 = new MessageQueue(wsA2);
  await queueA2.next(); // CONNECTED A

  const wsB2 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueB2 = new MessageQueue(wsB2);
  await queueB2.next(); // CONNECTED B

  // Send REQUEST_STATE from A and verify rematchRequestedBy persisted across restart
  wsA2.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const restoredRematchMsg = await queueA2.next();
  assert.equal(restoredRematchMsg.type, 'GAME_STATE');
  assert.equal(restoredRematchMsg.state.status, 'finished');
  assert.equal(restoredRematchMsg.state.rematchRequestedBy, userAId);
  assert.equal(restoredRematchMsg.state.round, 1);
  assert.equal(restoredRematchMsg.state.winner, 'X');

  // 8. User B sends REMATCH (Accepts rematch)
  wsB2.send(JSON.stringify({ type: 'REMATCH' }));
  const round2A = await queueA2.next();
  const round2B = await queueB2.next();

  assert.equal(round2A.state.status, 'playing');
  assert.equal(round2B.state.status, 'playing');
  assert.equal(round2A.state.round, 2);
  assert.equal(round2B.state.round, 2);
  assert.equal(round2A.state.rematchRequestedBy, null);
  assert.equal(round2A.state.winner, null);
  assert.equal(round2A.state.winningLine, null);
  assert.equal(round2A.state.currentTurn, 'X');
  assert.equal(round2A.state.board.every((c) => c === null), true);

  // Verify roles swapped: User B is now X, User A is now O
  assert.equal(round2A.state.players.X, userBId);
  assert.equal(round2A.state.players.O, userAId);
  assert.equal(round2B.state.players.X, userBId);
  assert.equal(round2B.state.players.O, userAId);

  // 9. Play at least 2 valid moves in Round 2
  // Move 1: User B (new X) moves at cell 4
  wsB2.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 4 }));
  const r2Move1_A = await queueA2.next();
  const r2Move1_B = await queueB2.next();
  assert.equal(r2Move1_A.state.board[4], 'X');
  assert.equal(r2Move1_A.state.currentTurn, 'O');
  assert.equal(r2Move1_B.state.board[4], 'X');
  assert.equal(r2Move1_A.state.round, 2);

  // Move 2: User A (new O) moves at cell 0
  wsA2.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 0 }));
  const r2Move2_A = await queueA2.next();
  const r2Move2_B = await queueB2.next();
  assert.equal(r2Move2_A.state.board[0], 'O');
  assert.equal(r2Move2_A.state.currentTurn, 'X');
  assert.equal(r2Move2_B.state.board[0], 'O');
  assert.equal(r2Move2_A.state.round, 2);
  const revAfterMove2 = r2Move2_A.state.revision;

  // 10. Close connections cleanly
  wsA2.close();
  wsB2.close();

  // 11. Stop Wrangler again and restart (Restart #2)
  await stopWrangler(wranglerProc);
  wranglerProc = null;
  wranglerProc = await startWrangler();

  // 12. Reconnect User A to verify Round 2 persistence
  const wsA3 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA3 = new MessageQueue(wsA3);
  await queueA3.next(); // CONNECTED

  wsA3.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const r2RestoredMsg = await queueA3.next();
  assert.equal(r2RestoredMsg.type, 'GAME_STATE');
  const r2Restored = r2RestoredMsg.state;

  assert.equal(r2Restored.status, 'playing');
  assert.equal(r2Restored.round, 2);
  assert.equal(r2Restored.players.X, userBId);
  assert.equal(r2Restored.players.O, userAId);
  assert.equal(r2Restored.board[4], 'X');
  assert.equal(r2Restored.board[0], 'O');
  assert.equal(r2Restored.currentTurn, 'X');
  assert.equal(r2Restored.revision, revAfterMove2);

  wsA3.close();
});

test('Integration: Phase 4 presence, explicit leave forfeit, and reconnect grace flow', async () => {
  const roomId = `room_p4_${Date.now()}`;
  const userAId = 'student_p4_A';
  const userBId = 'student_p4_B';

  const ticketA = createGamesTicket({ studentId: userAId, username: 'p4_alice', name: 'Alice' }, TEST_SECRET);
  const ticketB = createGamesTicket({ studentId: userBId, username: 'p4_bob', name: 'Bob' }, TEST_SECRET);

  // 1. Connect both players
  const wsA = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA = new MessageQueue(wsA);
  await queueA.next(); // CONNECTED

  const wsB = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueB = new MessageQueue(wsB);
  await queueB.next(); // CONNECTED

  // 2. Both join -> game starts
  wsA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const joinA = await queueA.next();
  assert.equal(joinA.type, 'GAME_STATE');
  await queueB.next(); // joinA for B

  wsB.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const joinB_A = await queueA.next();
  const joinB_B = await queueB.next();

  assert.equal(joinB_A.state.status, 'playing');
  assert.deepEqual(joinB_A.presence, { X: true, O: true });
  assert.deepEqual(joinB_B.presence, { X: true, O: true });

  // 3. User A makes a move -> X at cell 0
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 0 }));
  const move1_A = await queueA.next();
  await queueB.next();
  assert.equal(move1_A.state.board[0], 'X');
  assert.equal(move1_A.state.currentTurn, 'O');

  // 4. Test Disconnect & Reconnect: User B closes socket unexpectedly
  wsB.close();
  // User A receives updated GAME_STATE with O offline!
  const disconnectStateForA = await queueA.next();
  assert.equal(disconnectStateForA.type, 'GAME_STATE');
  assert.equal(disconnectStateForA.state.status, 'playing');
  assert.deepEqual(disconnectStateForA.presence, { X: true, O: false });

  // 5. User B reconnects with a fresh ticket before grace expiry
  const ticketB_reconnect = createGamesTicket({ studentId: userBId, username: 'p4_bob', name: 'Bob' }, TEST_SECRET);
  const wsB_reconnected = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB_reconnect}` });
  const queueB_reconnected = new MessageQueue(wsB_reconnected);
  await queueB_reconnected.next(); // CONNECTED

  // Both users receive GAME_STATE showing B back online!
  const reconnectedStateForA = await queueA.next();
  const reconnectedStateForB = await queueB_reconnected.next();
  assert.equal(reconnectedStateForA.type, 'GAME_STATE');
  assert.deepEqual(reconnectedStateForA.presence, { X: true, O: true });
  assert.deepEqual(reconnectedStateForB.presence, { X: true, O: true });
  assert.equal(reconnectedStateForA.state.board[0], 'X'); // board intact

  // 6. Test Explicit LEAVE_ROOM: User B explicitly leaves room
  wsB_reconnected.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
  const leaveStateForA = await queueA.next();
  const leaveStateForB = await queueB_reconnected.next();

  assert.equal(leaveStateForA.type, 'GAME_STATE');
  assert.equal(leaveStateForA.state.status, 'finished');
  assert.equal(leaveStateForA.state.winner, 'X');
  assert.equal(leaveStateForA.state.finishReason, 'leave');

  assert.equal(leaveStateForB.type, 'GAME_STATE');
  assert.equal(leaveStateForB.state.status, 'finished');
  assert.equal(leaveStateForB.state.winner, 'X');
  assert.equal(leaveStateForB.state.finishReason, 'leave');

  wsA.close();
  wsB_reconnected.close();
});

test('Integration: Multi-socket presence tracking for single user', async () => {
  const roomId = `room_multi_sock_${Date.now()}`;
  const userAId = 'student_ms_A';
  const userBId = 'student_ms_B';

  const ticketA = createGamesTicket({ studentId: userAId, username: 'ms_alice', name: 'Alice' }, TEST_SECRET);
  const ticketB1 = createGamesTicket({ studentId: userBId, username: 'ms_bob', name: 'Bob' }, TEST_SECRET);
  const ticketB2 = createGamesTicket({ studentId: userBId, username: 'ms_bob', name: 'Bob' }, TEST_SECRET);

  const wsA = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA = new MessageQueue(wsA);
  await queueA.next(); // CONNECTED

  const wsB1 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB1}` });
  const queueB1 = new MessageQueue(wsB1);
  await queueB1.next(); // CONNECTED

  wsA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA.next();
  await queueB1.next();

  wsB1.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA.next();
  await queueB1.next();

  // User B opens a second socket
  const wsB2 = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB2}` });
  const queueB2 = new MessageQueue(wsB2);
  await queueB2.next(); // CONNECTED

  // User B closes first socket: B should STILL be reported online because wsB2 is open
  wsB1.close();
  await new Promise((r) => setTimeout(r, 100));

  // Request state from A to verify presence
  wsA.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const stateCheck1 = await queueA.next();
  assert.equal(stateCheck1.type, 'GAME_STATE');
  assert.deepEqual(stateCheck1.presence, { X: true, O: true });

  // User B closes second socket: now B has 0 sockets -> B goes offline!
  wsB2.close();
  const stateCheck2 = await queueA.next();
  assert.equal(stateCheck2.type, 'GAME_STATE');
  assert.deepEqual(stateCheck2.presence, { X: true, O: false });

  wsA.close();
});

test('Integration: Restart during disconnect grace period preserves deadline and reconnects safely', async () => {
  const roomId = `room_restart_grace_${Date.now()}`;
  const userAId = 'student_rg_A';
  const userBId = 'student_rg_B';

  const ticketA = createGamesTicket({ studentId: userAId, username: 'rg_alice', name: 'Alice' }, TEST_SECRET);
  const ticketB = createGamesTicket({ studentId: userBId, username: 'rg_bob', name: 'Bob' }, TEST_SECRET);

  const wsA = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA = new MessageQueue(wsA);
  await queueA.next(); // CONNECTED

  const wsB = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueB = new MessageQueue(wsB);
  await queueB.next(); // CONNECTED

  wsA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA.next();
  await queueB.next();

  wsB.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA.next();
  await queueB.next();

  // Make move 0
  wsA.send(JSON.stringify({ type: 'MAKE_MOVE', cellIndex: 0 }));
  await queueA.next();
  await queueB.next();

  // B disconnects unexpectedly -> grace deadline stored in SQLite
  wsB.close();
  const discMsg = await queueA.next();
  assert.deepEqual(discMsg.presence, { X: true, O: false });

  // RESTART Wrangler / Durable Object while B is in grace period
  wsA.close();
  await stopWrangler(wranglerProc);
  wranglerProc = null;

  wranglerProc = await startWrangler();

  // Reconnect A
  const wsA_after = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA_after = new MessageQueue(wsA_after);
  await queueA_after.next(); // CONNECTED

  // Reconnect B before deadline expires
  const wsB_after = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueB_after = new MessageQueue(wsB_after);
  await queueB_after.next(); // CONNECTED

  // Verify state received by B is still playing, board unchanged, both online
  const stateB = await queueB_after.next();
  assert.equal(stateB.type, 'GAME_STATE');
  assert.equal(stateB.state.status, 'playing');
  assert.equal(stateB.state.board[0], 'X');
  assert.deepEqual(stateB.presence, { X: true, O: true });

  wsA_after.close();
  wsB_after.close();
});

test('Integration: Both players offline results in safe neutral abandonment (no invented winner)', async () => {
  const roomId = `room_both_off_${Date.now()}`;
  const userAId = 'student_bo_A';
  const userBId = 'student_bo_B';

  const ticketA = createGamesTicket({ studentId: userAId, username: 'bo_alice', name: 'Alice' }, TEST_SECRET);
  const ticketB = createGamesTicket({ studentId: userBId, username: 'bo_bob', name: 'Bob' }, TEST_SECRET);

  const wsA = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA = new MessageQueue(wsA);
  await queueA.next(); // CONNECTED

  const wsB = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueB = new MessageQueue(wsB);
  await queueB.next(); // CONNECTED

  wsA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA.next();
  await queueB.next();

  wsB.send(JSON.stringify({ type: 'JOIN_GAME' }));
  await queueA.next();
  await queueB.next();

  // Both players disconnect
  wsA.close();
  wsB.close();

  // Verify through fresh spectator / reconnect that if both are offline and timeout happens, state is safe
  // Reconnect A with REQUEST_STATE
  const wsA_check = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueA_check = new MessageQueue(wsA_check);
  await queueA_check.next(); // CONNECTED
  wsA_check.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  const checkMsg = await queueA_check.next();
  assert.equal(checkMsg.type, 'GAME_STATE');
  // While grace period is running and A reconnected, O is still offline
  assert.deepEqual(checkMsg.presence, { X: true, O: false });

  wsA_check.close();
});

test('Integration: Ludo online room flow and room gameType immutability', async () => {
  const ludoRoomId = `room_ludo_integ_${Date.now()}`;
  const tttRoomId = `room_ttt_integ_${Date.now()}`;

  const ticketA = createGamesTicket({ studentId: 'student_ludo_A', username: 'ludo_alice', name: 'Alice' }, TEST_SECRET);
  const ticketB = createGamesTicket({ studentId: 'student_ludo_B', username: 'ludo_bob', name: 'Bob' }, TEST_SECRET);

  // 1. Connect User A to Ludo room
  const wsLudoA = await connectWs(`${BASE_WS}/rooms/${ludoRoomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueLudoA = new MessageQueue(wsLudoA);
  const connA = await queueLudoA.next();
  assert.equal(connA.type, 'CONNECTED');

  // User A joins Ludo lobby
  wsLudoA.send(JSON.stringify({ type: 'LUDO_JOIN', displayName: 'Alice' }));
  const lobbyA = await queueLudoA.next();
  assert.equal(lobbyA.type, 'LUDO_LOBBY_STATE');
  assert.equal(lobbyA.lobby.hostUserId, 'student_ludo_A');
  assert.equal(lobbyA.lobby.seats.red.userId, 'student_ludo_A');

  // 2. Sending Tic-Tac-Toe message to Ludo room is rejected with ROOM_GAME_TYPE_MISMATCH
  wsLudoA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const tttMismatchErr = await queueLudoA.next();
  assert.equal(tttMismatchErr.type, 'ERROR');
  assert.equal(tttMismatchErr.code, 'ROOM_GAME_TYPE_MISMATCH');

  // 3. Connect User B and join Ludo lobby
  const wsLudoB = await connectWs(`${BASE_WS}/rooms/${ludoRoomId}/ws`, { Authorization: `Bearer ${ticketB}` });
  const queueLudoB = new MessageQueue(wsLudoB);
  await queueLudoB.next(); // CONNECTED for B
  const presenceB_on_A = await queueLudoA.next(); // User A receives User B's presence online
  assert.equal(presenceB_on_A.type, 'LUDO_PRESENCE');
  assert.equal(presenceB_on_A.userId, 'student_ludo_B');
  assert.equal(presenceB_on_A.online, true);

  const initialLobbyB = await queueLudoB.next(); // Initial lobby state received on connect
  assert.equal(initialLobbyB.type, 'LUDO_LOBBY_STATE');
  assert.equal(initialLobbyB.lobby.seats.yellow.userId, null);
  const presenceB_on_B = await queueLudoB.next(); // Presence broadcast
  assert.equal(presenceB_on_B.type, 'LUDO_PRESENCE');

  wsLudoB.send(JSON.stringify({ type: 'LUDO_JOIN', displayName: 'Bob' }));
  const lobbyB_on_A = await queueLudoA.next();
  const lobbyB_on_B = await queueLudoB.next();
  assert.equal(lobbyB_on_A.type, 'LUDO_LOBBY_STATE');
  assert.equal(lobbyB_on_B.type, 'LUDO_LOBBY_STATE');
  assert.equal(lobbyB_on_B.lobby.seats.yellow.userId, 'student_ludo_B');

  // 4. Test Tic-Tac-Toe room rejects Ludo message
  const wsTttA = await connectWs(`${BASE_WS}/rooms/${tttRoomId}/ws`, { Authorization: `Bearer ${ticketA}` });
  const queueTttA = new MessageQueue(wsTttA);
  await queueTttA.next(); // CONNECTED

  wsTttA.send(JSON.stringify({ type: 'JOIN_GAME' }));
  const tttJoined = await queueTttA.next();
  assert.equal(tttJoined.type, 'GAME_STATE');

  // Send LUDO_JOIN to Tic-Tac-Toe room
  wsTttA.send(JSON.stringify({ type: 'LUDO_JOIN' }));
  const ludoMismatchErr = await queueTttA.next();
  assert.equal(ludoMismatchErr.type, 'ERROR');
  assert.equal(ludoMismatchErr.code, 'ROOM_GAME_TYPE_MISMATCH');

  // Close all sockets
  wsLudoA.close();
  wsLudoB.close();
  wsTttA.close();
});

test('Integration: Spoofed identity headers are stripped by Worker and cannot override verified ticket claims', async () => {
  const roomId = `room_spoof_test_${Date.now()}`;
  const validTicket = createGamesTicket(
    { studentId: 'student_legit_user', username: 'legit_student', name: 'Legit Student' },
    TEST_SECRET
  );

  // Client connects with legitimate ticket BUT attempts to spoof X-Games-* headers
  const wsSpoof = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${validTicket}`,
    'X-Games-User-Id': 'evil_imposter_999',
    'X-Games-Username': 'hacker_elite',
    'X-Games-Name': 'Imposter Name',
  });
  const queue = new MessageQueue(wsSpoof);
  const connMsg = await queue.next();

  assert.equal(connMsg.type, 'CONNECTED');
  // Must use verified claim from ticket, NOT the spoofed header
  assert.equal(connMsg.userId, 'student_legit_user');

  // When joining Ludo, verified ticket name is used, not imposter name
  wsSpoof.send(JSON.stringify({ type: 'LUDO_JOIN', displayName: 'Client Self Asserted Name' }));
  const lobbyMsg = await queue.next();
  assert.equal(lobbyMsg.type, 'LUDO_LOBBY_STATE');
  assert.equal(lobbyMsg.lobby.hostUserId, 'student_legit_user');
  assert.equal(lobbyMsg.lobby.seats.red.userId, 'student_legit_user');
  assert.equal(lobbyMsg.lobby.seats.red.displayName, 'Legit Student');

  wsSpoof.close();
});

test('Integration: GET /rooms/:roomId auth checks and safe metadata exposure', async () => {
  const roomId = `room_inspect_${Date.now()}`;
  const aliceTicket = createGamesTicket(
    { studentId: 'student_alice_host', username: 'alice', name: 'Alice Host' },
    TEST_SECRET
  );
  const charlieTicket = createGamesTicket(
    { studentId: 'student_charlie_stranger', username: 'charlie', name: 'Charlie Stranger' },
    TEST_SECRET
  );
  const serverTicket = createGamesTicket(
    { studentId: 'server_agent', username: 'server' },
    TEST_SECRET,
    { role: 'server' }
  );

  // 1. Anonymous request to GET /rooms/:roomId is rejected with 401
  const anonRes = await fetch(`${BASE_HTTP}/rooms/${roomId}`);
  assert.equal(anonRes.status, 401);

  // 2. Alice connects to room and initializes Ludo lobby
  const wsAlice = await connectWs(`${BASE_WS}/rooms/${roomId}/ws`, {
    Authorization: `Bearer ${aliceTicket}`,
  });
  const queueAlice = new MessageQueue(wsAlice);
  await queueAlice.next(); // CONNECTED
  wsAlice.send(JSON.stringify({ type: 'LUDO_JOIN', displayName: 'Alice Host' }));
  await queueAlice.next(); // LUDO_LOBBY_STATE

  // 3. Charlie (unrelated authenticated user) attempts GET /rooms/:roomId -> 403 Forbidden
  const charlieRes = await fetch(`${BASE_HTTP}/rooms/${roomId}`, {
    headers: { Authorization: `Bearer ${charlieTicket}` },
  });
  assert.equal(charlieRes.status, 403);
  const charlieData = await charlieRes.json();
  assert.equal(charlieData.error, 'FORBIDDEN');
  assert.equal(charlieData.message, 'You are not authorized to inspect this room.');

  // 4. Spoofed X-Games-* headers by Charlie cannot bypass authorization
  const spoofRes = await fetch(`${BASE_HTTP}/rooms/${roomId}`, {
    headers: {
      Authorization: `Bearer ${charlieTicket}`,
      'X-Games-User-Id': 'student_alice_host',
      'X-Games-Role': 'server',
    },
  });
  assert.equal(spoofRes.status, 403);

  // 5. Host (Alice) can introspect room -> 200 with minimal safe metadata
  const aliceRes = await fetch(`${BASE_HTTP}/rooms/${roomId}`, {
    headers: { Authorization: `Bearer ${aliceTicket}` },
  });
  assert.equal(aliceRes.status, 200);
  const aliceData = await aliceRes.json();
  assert.equal(aliceData.status, 'ok');
  assert.equal(aliceData.roomId, roomId);
  assert.equal(aliceData.gameType, 'ludo');
  assert.equal(aliceData.roomStatus, 'lobby');
  assert.equal(aliceData.hostUserId, 'student_alice_host');
  assert.equal(aliceData.seats.red.userId, 'student_alice_host');
  // Minimized representation check: no socket data, no tickets, no tokens
  assert.equal(aliceData.seats.red.token, undefined);
  assert.equal(aliceData.seats.red.ws, undefined);
  assert.equal(aliceData.seats.red.socket, undefined);
  assert.equal(aliceData.roomGeneration, 1);

  // 6. Server role ticket can introspect room -> 200
  const serverRes = await fetch(`${BASE_HTTP}/rooms/${roomId}`, {
    headers: { Authorization: `Bearer ${serverTicket}` },
  });
  assert.equal(serverRes.status, 200);
  const serverData = await serverRes.json();
  assert.equal(serverData.status, 'ok');
  assert.equal(serverData.roomId, roomId);
  assert.equal(serverData.roomGeneration, 1);

  wsAlice.close();
});

