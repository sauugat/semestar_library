import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

let wranglerProc = null;

before(async () => {
  wranglerProc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, GAMES_TICKET_SECRET: TEST_SECRET },
  });

  // Wait for wrangler dev server to be ready by checking root endpoint
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
    wranglerProc.kill('SIGTERM');
    throw new Error('Local Wrangler server failed to start within 15 seconds');
  }
});

after(async () => {
  if (wranglerProc) {
    wranglerProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
  }
});

import http from 'node:http';

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
  assert.equal(verifyStateA.state.revision, 4); // Revision remains 4
  assert.equal(verifyStateA.state.board[1], null); // Cell 1 remains empty
  assert.equal(verifyStateA.state.currentTurn, 'X'); // Still X's turn

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
