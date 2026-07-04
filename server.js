
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const TRACK_LENGTH = 4200;
const MAX_PLAYERS = 8;
const COLORS = ["red", "blue", "green", "gold", "purple", "black", "rainbow", "lightning"];

function makeRoom(code) {
  return {
    code,
    status: "lobby",
    createdAt: Date.now(),
    players: new Map(),
    countdown: 0,
    startedAt: 0
  };
}

function cleanOldRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 1000 * 60 * 60 * 3 || room.players.size === 0) {
      rooms.delete(code);
    }
  }
}
setInterval(cleanOldRooms, 1000 * 60 * 10);

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, ready: p.ready, host: p.host
    }))
  };
}

function newPlayer(socket, data, host=false) {
  return {
    id: socket.id,
    name: String(data.name || "Player").slice(0, 16),
    color: COLORS.includes(data.color) ? data.color : "blue",
    host,
    ready: false,
    input: { steer: 0, throttle: 1, boost: false },
    s: 0,
    lane: 0,
    laneVel: 0,
    speed: 0,
    boost: 100,
    cooldown: 0,
    gems: 0,
    finished: false,
    finishTime: 0,
    place: 1,
    spawnLane: 0
  };
}

function resetRace(room) {
  const arr = [...room.players.values()];
  arr.forEach((p, i) => {
    p.s = -i * 8;
    p.lane = (i - (arr.length - 1) / 2) * 0.7;
    p.spawnLane = p.lane;
    p.laneVel = 0;
    p.speed = 23 + Math.random() * 2;
    p.boost = 100;
    p.cooldown = 0;
    p.gems = 0;
    p.finished = false;
    p.finishTime = 0;
    p.place = 1;
  });
  room.status = "racing";
  room.startedAt = Date.now();
}

function applyBoost(room, p) {
  if (p.boost < 100 || p.cooldown > 0 || p.finished) return;
  p.boost = 0;
  p.cooldown = 2.4;
  p.speed += 18;

  for (const other of room.players.values()) {
    if (other.id === p.id || other.finished) continue;
    const ds = Math.abs(other.s - p.s);
    const dl = Math.abs(other.lane - p.lane);
    if (ds < 26 && dl < 4.5) {
      other.laneVel += (other.lane >= p.lane ? 1 : -1) * 18;
      other.speed *= 0.72;
    }
  }
}

function simulateRoom(room, dt) {
  if (room.status !== "racing") return;

  for (const p of room.players.values()) {
    if (p.finished) continue;

    p.cooldown = Math.max(0, p.cooldown - dt);
    p.boost = Math.min(100, p.boost + 9 * dt);

    const steer = Math.max(-1, Math.min(1, Number(p.input.steer || 0)));
    const throttle = Math.max(0.45, Math.min(1.2, Number(p.input.throttle || 1)));

    p.laneVel += steer * 10 * dt;
    p.laneVel *= Math.pow(0.82, dt * 8);
    p.lane += p.laneVel * dt;

    if (Math.abs(p.lane) > 8) {
      p.lane = Math.sign(p.lane) * 2.5;
      p.laneVel = 0;
      p.speed = 20;
    }

    p.speed += 26 * throttle * dt;
    p.speed *= Math.pow(0.988, dt * 60);
    p.speed = Math.max(16, Math.min(48, p.speed));

    if (p.input.boost) {
      applyBoost(room, p);
      p.input.boost = false;
    }

    p.s += p.speed * dt;

    if (p.s >= TRACK_LENGTH) {
      p.s = TRACK_LENGTH;
      p.finished = true;
      p.finishTime = Date.now();
    }
  }

  const sorted = [...room.players.values()].sort((a,b) => b.s - a.s);
  sorted.forEach((p, i) => p.place = i + 1);

  const allFinished = [...room.players.values()].length > 0 && [...room.players.values()].every(p => p.finished);
  if (allFinished) room.status = "finished";
}

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  for (const room of rooms.values()) {
    simulateRoom(room, dt);
    if (room.status === "racing" || room.status === "finished") {
      io.to(room.code).emit("state", {
        status: room.status,
        trackLength: TRACK_LENGTH,
        players: [...room.players.values()].map(p => ({
          id: p.id,
          name: p.name,
          color: p.color,
          s: p.s,
          lane: p.lane,
          speed: p.speed,
          boost: p.boost,
          cooldown: p.cooldown,
          finished: p.finished,
          place: p.place
        }))
      });
    }
  }
}, 1000 / 30);

io.on("connection", socket => {
  socket.on("createRoom", data => {
    let code = Math.random().toString(36).slice(2, 7).toUpperCase();
    while (rooms.has(code)) code = Math.random().toString(36).slice(2, 7).toUpperCase();

    const room = makeRoom(code);
    const player = newPlayer(socket, data || {}, true);
    room.players.set(socket.id, player);
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("roomJoined", { room: publicRoom(room), selfId: socket.id });
    io.to(code).emit("roomUpdate", publicRoom(room));
  });

  socket.on("joinRoom", data => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMessage", "Room not found.");
    if (room.status !== "lobby") return socket.emit("errorMessage", "Race already started.");
    if (room.players.size >= MAX_PLAYERS) return socket.emit("errorMessage", "Room is full.");

    const player = newPlayer(socket, data || {}, false);
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("roomJoined", { room: publicRoom(room), selfId: socket.id });
    io.to(code).emit("roomUpdate", publicRoom(room));
  });

  socket.on("ready", ready => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !!ready;
    io.to(room.code).emit("roomUpdate", publicRoom(room));
  });

  socket.on("startRace", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p || !p.host) return socket.emit("errorMessage", "Only the host can start.");
    resetRace(room);
    io.to(room.code).emit("raceStarted", { trackLength: TRACK_LENGTH });
  });

  socket.on("input", input => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.input = {
      steer: Number(input.steer || 0),
      throttle: Number(input.throttle || 1),
      boost: !!input.boost
    };
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const wasHost = room.players.get(socket.id)?.host;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      rooms.delete(room.code);
      return;
    }
    if (wasHost) {
      const next = room.players.values().next().value;
      if (next) next.host = true;
    }
    io.to(room.code).emit("roomUpdate", publicRoom(room));
  });
});

server.listen(PORT, () => {
  console.log(`Marble League 3D running on port ${PORT}`);
});
