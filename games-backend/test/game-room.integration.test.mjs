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
  const restoredStateMsg = await queueA2.next();
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
  const move4_A = await queueA2.next();
  await queueB2.next();
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
