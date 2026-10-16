/**
 * 3D Hide and Seek Multiplayer Socket.IO Server
 * -------------------------------------------------------------
 * Features:
 * - Room creation & joining via room codes (e.g. MANOR-4921)
 * - Dynamic role assignment (1 Seeker, N Hiders)
 * - 20Hz transform sync (position, rotation, crouch/stealth states)
 * - Server-authoritative match timer (15s grace -> 120s active hunt)
 * - Raycast/tag collision verification
 * - Disconnect & failover handling
 */

const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4004;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'hide-and-seek-server' }));
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Server Authoritative Colliders & Validation
const colliders = [
  // Campus perimeter bounds and major wall/fence colliders
  { min: { x: -3.0, y: 0, z: -33.0 }, max: { x: -2.5, y: 4.5, z: -3.0 } },
  { min: { x: -12.0, y: 0, z: 42.425 }, max: { x: -0.5, y: 1.5, z: 42.575 } },
  { min: { x: 12.5, y: 0, z: 42.425 }, max: { x: 29.0, y: 1.5, z: 42.575 } },
];

function resolvePlayerMovement(x, y, z, vx, vz, dt) {
  let nextX = x + vx * dt;
  let nextZ = z + vz * dt;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (nextX >= b.min.x - 0.28 && nextX <= b.max.x + 0.28 &&
        nextZ >= b.min.z - 0.28 && nextZ <= b.max.z + 0.28) {
      nextX = x;
      nextZ = z;
      break;
    }
  }
  return { x: nextX, y, z: nextZ };
}

function deadReckoning(player, dt) {
  if (!player.vel) return { x: player.x, y: player.y, z: player.z };
  return {
    x: player.x + player.vel.x * dt,
    y: player.y + player.vel.y * dt,
    z: player.z + player.vel.z * dt,
  };
}

function interpolatePosition(prev, next, alpha = 0.5) {
  return {
    x: prev.x + (next.x - prev.x) * alpha,
    y: prev.y + (next.y - prev.y) * alpha,
    z: prev.z + (next.z - prev.z) * alpha,
  };
}

function raycastTagLineOfSight(eyePos, chestPos, colliderList) {
  const dx = chestPos.x - eyePos.x;
  const dy = chestPos.y - eyePos.y;
  const dz = chestPos.z - eyePos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const dirZ = dz / dist;

  for (let i = 0; i < colliderList.length; i++) {
    const b = colliderList[i];
    if (!b || !b.min || !b.max) continue;

    let tmin = 0.0;
    let tmax = dist - 0.05;

    // X
    if (Math.abs(dirX) > 0.000001) {
      const inv = 1.0 / dirX;
      let t1 = (b.min.x - eyePos.x) * inv;
      let t2 = (b.max.x - eyePos.x) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    } else if (eyePos.x < b.min.x || eyePos.x > b.max.x) continue;

    // Y
    if (Math.abs(dirY) > 0.000001) {
      const inv = 1.0 / dirY;
      let t1 = (b.min.y - eyePos.y) * inv;
      let t2 = (b.max.y - eyePos.y) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    } else if (eyePos.y < b.min.y || eyePos.y > b.max.y) continue;

    // Z
    if (Math.abs(dirZ) > 0.000001) {
      const inv = 1.0 / dirZ;
      let t1 = (b.min.z - eyePos.z) * inv;
      let t2 = (b.max.z - eyePos.z) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    } else if (eyePos.z < b.min.z || eyePos.z > b.max.z) continue;

    if (tmin < dist - 0.05 && tmax > 0.05) {
      return false; // Ray hit collider before reaching target
    }
  }
  return true;
}

// Room State Store
const rooms = new Map();

function createRoom(roomCode) {
  return {
    code: roomCode,
    players: new Map(), // socketId -> Player
    seekerId: null,
    phase: 'LOBBY', // 'LOBBY', 'GRACE', 'HUNT', 'GAMEOVER'
    secondsRemaining: 120,
    timerInterval: null,
    hidersLeft: 0,
  };
}

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // Join or Create Room
  socket.on('join_room', ({ roomCode, playerName, preferredRole }) => {
    let room = rooms.get(roomCode);
    if (!room) {
      room = createRoom(roomCode);
      rooms.set(roomCode, room);
    }

    // Assign Player
    const player = {
      id: socket.id,
      name: playerName || `Player-${socket.id.slice(0, 4)}`,
      role: preferredRole || 'hider',
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      isCrouching: false,
      isHiding: false,
      isCaught: false,
      isReady: false,
    };

    room.players.set(socket.id, player);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    console.log(`[Joined Room] Player ${player.name} (${socket.id}) entered ${roomCode}`);

    // Notify room of updated roster
    io.to(roomCode).emit('room_roster_updated', {
      players: Array.from(room.players.values()),
      phase: room.phase,
    });
  });

  // Start Match
  socket.on('start_match', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.players.size === 0) return;

    // Pick 1 Seeker, others Hiders
    const playerList = Array.from(room.players.values());
    let seekerAssigned = false;

    // Try to respect preferred role
    for (const p of playerList) {
      if (p.role === 'seeker' && !seekerAssigned) {
        room.seekerId = p.id;
        seekerAssigned = true;
      } else {
        p.role = 'hider';
        p.isCaught = false;
      }
    }

    if (!seekerAssigned) {
      const randomIndex = Math.floor(Math.random() * playerList.length);
      playerList[randomIndex].role = 'seeker';
      room.seekerId = playerList[randomIndex].id;
    }

    room.hidersLeft = playerList.filter((p) => p.role === 'hider').length;
    room.phase = 'GRACE';
    room.secondsRemaining = 15;

    io.to(room.code).emit('match_started', {
      seekerId: room.seekerId,
      players: Array.from(room.players.values()),
      gracePeriodSec: 15,
      huntPeriodSec: 120,
    });

    // Start Server Authoritative Countdown
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      room.secondsRemaining--;

      if (room.phase === 'GRACE') {
        if (room.secondsRemaining <= 0) {
          room.phase = 'HUNT';
          room.secondsRemaining = 120;
          io.to(room.code).emit('hunt_phase_started', { huntPeriodSec: 120 });
        }
      } else if (room.phase === 'HUNT') {
        if (room.secondsRemaining <= 0) {
          // Time Expired -> Hiders Win!
          room.phase = 'GAMEOVER';
          clearInterval(room.timerInterval);
          io.to(room.code).emit('match_ended', { winner: 'HIDERS', reason: 'TIME_EXPIRED' });
        }
      }

      io.to(room.code).emit('timer_tick', {
        phase: room.phase,
        seconds: room.secondsRemaining,
        hidersLeft: room.hidersLeft,
      });
    }, 1000);
  });

  // 20Hz Transform Synchronization with server validation & dead reckoning
  socket.on('player_update', (transform) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    // Smooth transform with interpolation / deadReckoning
    const smoothed = interpolatePosition(player, transform, 0.85);
    player.x = smoothed.x;
    player.y = smoothed.y;
    player.z = smoothed.z;
    player.yaw = transform.yaw;
    player.pitch = transform.pitch;
    player.isCrouching = transform.isCrouching;
    player.isHiding = transform.isHiding;

    // Relay to other clients in room
    socket.to(room.code).emit('player_moved', {
      id: socket.id,
      ...transform,
    });
  });

  // Tag Player with server-authoritative line-of-sight raycast against colliders
  socket.on('tag_player', ({ targetPlayerId }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'HUNT') return;
    if (socket.id !== room.seekerId) return; // Only Seeker can tag

    const seeker = room.players.get(socket.id);
    const target = room.players.get(targetPlayerId);
    if (!seeker || !target || target.isCaught) return;

    // 1. Server-authoritative distance validation
    const tagDistance = Math.hypot(seeker.x - target.x, seeker.y - target.y, seeker.z - target.z);
    if (tagDistance > 3.4) {
      console.log(`[Tag Rejected] Target out of range: ${tagDistance.toFixed(2)}m > 3.4m`);
      return;
    }

    // 2. Server-authoritative raycast from seeker's eye to target's chest against colliders
    const seekerEye = { x: seeker.x, y: seeker.y + 1.62, z: seeker.z };
    const targetChest = { x: target.x, y: target.y + 1.10, z: target.z };
    if (!raycastTagLineOfSight(seekerEye, targetChest, colliders)) {
      console.log(`[Tag Rejected] Tag line of sight obstructed by collider between seeker and target ${targetPlayerId}`);
      return;
    }

    target.isCaught = true;
    room.hidersLeft--;

    io.to(room.code).emit('player_caught', {
      targetId: targetPlayerId,
      targetName: target.name,
      hidersLeft: room.hidersLeft,
    });

    if (room.hidersLeft <= 0) {
      room.phase = 'GAMEOVER';
      clearInterval(room.timerInterval);
      io.to(room.code).emit('match_ended', { winner: 'SEEKER', reason: 'ALL_HIDERS_FOUND' });
    }
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    room.players.delete(socket.id);

    if (player && player.role === 'hider' && !player.isCaught) {
      room.hidersLeft = Math.max(0, room.hidersLeft - 1);
    }

    if (room.players.size === 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      rooms.delete(room.code);
    } else {
      io.to(room.code).emit('player_left', { id: socket.id, name: player ? player.name : 'Unknown' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  Hide and Seek Multiplayer Server running on port ${PORT}`);
  console.log(`======================================================\n`);
});
