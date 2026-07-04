const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const MAPS = ["Crystal Coast XL", "Neon Metro Mega", "Sky Factory GP"];
const COLORS = ["red", "blue", "green", "gold", "purple", "black", "rainbow", "lightning"];
const TRACK_LENGTH = 5200;
const MAX_PLAYERS = 8;

const rooms = new Map();

function makeCode() {
  let code = Math.random().toString(36).slice(2, 7).toUpperCase();
  while (rooms.has(code)) code = Math.random().toString(36).slice(2, 7).toUpperCase();
  return code;
}

function makeRoom(code) {
  return {
    code,
    status: "lobby",
    createdAt: Date.now(),
    selectedMap: null,
    wheel: null,
    players: new Map()
  };
}

function makePlayer(socket, data, host) {
  return {
    id: socket.id,
    name: String(data.name || "Player").slice(0, 16),
    color: COLORS.includes(data.color) ? data.color : "blue",
    host,
    ready: false,
    mapChoice: MAPS.includes(data.mapChoice) ? data.mapChoice : MAPS[0],
    input: { steer: 0, throttle: 1, boost: false },
    s: 0,
    lane: 0,
    laneVel: 0,
    speed: 0,
    boost: 100,
    cooldown: 0,
    finished: false,
    place: 1
  };
}

function roomPublic(room) {
  return {
    code: room.code,
    status: room.status,
    selectedMap: room.selectedMap,
    wheel: room.wheel,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      host: p.host,
      ready: p.ready,
      mapChoice: p.mapChoice
    }))
  };
}

function lobbyList() {
  return [...rooms.values()]
    .filter(r => r.status === "lobby" && r.players.size > 0)
    .map(r => ({
      code: r.code,
      players: r.players.size,
      maxPlayers: MAX_PLAYERS,
      host: [...r.players.values()].find(p => p.host)?.name || "Host",
      maps: [...new Set([...r.players.values()].map(p => p.mapChoice))]
    }));
}

function broadcastLobbyList() {
  io.emit("lobbyList", lobbyList());
}

function everyoneReady(room) {
  return room.players.size > 0 && [...room.players.values()].every(p => p.ready);
}

function uniqueChosenMaps(room) {
  return [...new Set([...room.players.values()].map(p => p.mapChoice))];
}

function startWheel(room) {
  if (room.status !== "lobby") return false;
  if (!everyoneReady(room)) return false;

  const options = uniqueChosenMaps(room);
  const selectedMap = options[Math.floor(Math.random() * options.length)];

  room.status = "wheel";
  room.selectedMap = selectedMap;
  room.wheel = {
    options,
    selectedMap,
    startedAt: Date.now(),
    durationMs: 4200
  };

  io.to(room.code).emit("wheelStarted", roomPublic(room));
  broadcastLobbyList();

  setTimeout(() => startRace(room.code), room.wheel.durationMs + 400);
  return true;
}

function startRace(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.status !== "wheel") return;

  const arr = [...room.players.values()];
  arr.forEach((p, i) => {
    p.s = Math.max(0, -i * 10);
    p.lane = (i - (arr.length - 1) / 2) * 0.75;
    p.laneVel = 0;
    p.speed = 24;
    p.boost = 100;
    p.cooldown = 0;
    p.finished = false;
    p.place = 1;
  });

  room.status = "racing";
  io.to(room.code).emit("raceStarted", {
    room: roomPublic(room),
    trackLength: TRACK_LENGTH,
    selectedMap: room.selectedMap
  });
}

function applyBoost(room, p) {
  if (p.boost < 100 || p.cooldown > 0 || p.finished) return;

  p.boost = 0;
  p.cooldown = 2.5;
  p.speed += 19;

  for (const other of room.players.values()) {
    if (other.id === p.id || other.finished) continue;
    const ds = Math.abs(other.s - p.s);
    const dl = Math.abs(other.lane - p.lane);
    if (ds < 30 && dl < 4.8) {
      other.laneVel += (other.lane >= p.lane ? 1 : -1) * 22;
      other.speed *= 0.68;
    }
  }
}

function simulateRoom(room, dt) {
  if (room.status !== "racing") return;

  for (const p of room.players.values()) {
    if (p.finished) continue;

    p.cooldown = Math.max(0, p.cooldown - dt);
    p.boost = Math.min(100, p.boost + 8.5 * dt);

    const steer = Math.max(-1, Math.min(1, Number(p.input.steer || 0)));
    const throttle = Math.max(0.45, Math.min(1.25, Number(p.input.throttle || 1)));

    p.laneVel += steer * 10.5 * dt;
    p.laneVel *= Math.pow(0.82, dt * 8);
    p.lane += p.laneVel * dt;

    if (Math.abs(p.lane) > 8.5) {
      p.lane = Math.sign(p.lane) * 2.25;
      p.laneVel = 0;
      p.speed = 20;
    }

    p.speed += 25 * throttle * dt;
    p.speed *= Math.pow(0.989, dt * 60);
    p.speed = Math.max(17, Math.min(50, p.speed));

    if (p.input.boost) {
      applyBoost(room, p);
      p.input.boost = false;
    }

    p.s += p.speed * dt;

    if (p.s >= TRACK_LENGTH) {
      p.s = TRACK_LENGTH;
      p.finished = true;
    }
  }

  const sorted = [...room.players.values()].sort((a, b) => b.s - a.s);
  sorted.forEach((p, i) => p.place = i + 1);

  const allDone = room.players.size > 0 && [...room.players.values()].every(p => p.finished);
  if (allDone) room.status = "finished";
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;

  for (const room of rooms.values()) {
    simulateRoom(room, dt);

    if (room.status === "racing" || room.status === "finished") {
      io.to(room.code).emit("raceState", {
        status: room.status,
        trackLength: TRACK_LENGTH,
        selectedMap: room.selectedMap,
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

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0 || now - room.createdAt > 1000 * 60 * 60 * 4) {
      rooms.delete(code);
    }
  }
  broadcastLobbyList();
}, 1000 * 20);

io.on("connection", socket => {
  socket.emit("lobbyList", lobbyList());

  socket.on("createRoom", data => {
    const code = makeCode();
    const room = makeRoom(code);
    const player = makePlayer(socket, data || {}, true);
    room.players.set(socket.id, player);
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joinedRoom", { selfId: socket.id, room: roomPublic(room) });
    io.to(code).emit("roomUpdate", roomPublic(room));
    broadcastLobbyList();
  });

  socket.on("joinRoom", data => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return socket.emit("errorMessage", "Room not found.");
    if (room.status !== "lobby") return socket.emit("errorMessage", "This race already started.");
    if (room.players.size >= MAX_PLAYERS) return socket.emit("errorMessage", "Room is full.");

    const player = makePlayer(socket, data || {}, false);
    room.players.set(socket.id, player);

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joinedRoom", { selfId: socket.id, room: roomPublic(room) });
    io.to(code).emit("roomUpdate", roomPublic(room));
    broadcastLobbyList();
  });

  socket.on("setReady", ready => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "lobby") return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !!ready;
    io.to(room.code).emit("roomUpdate", roomPublic(room));
  });

  socket.on("setMapChoice", mapChoice => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "lobby") return;
    const p = room.players.get(socket.id);
    if (!p) return;
    if (!MAPS.includes(mapChoice)) return;
    p.mapChoice = mapChoice;
    p.ready = false;
    io.to(room.code).emit("roomUpdate", roomPublic(room));
    broadcastLobbyList();
  });

  socket.on("startWheel", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p || !p.host) return socket.emit("errorMessage", "Only the host can start the wheel.");
    if (!everyoneReady(room)) return socket.emit("errorMessage", "Every player must ready up first.");
    startWheel(room);
  });

  socket.on("input", input => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "racing") return;
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
    } else if (wasHost) {
      const next = room.players.values().next().value;
      if (next) next.host = true;
      io.to(room.code).emit("roomUpdate", roomPublic(room));
    }

    broadcastLobbyList();
  });
});

server.listen(PORT, () => {
  console.log(`Marble League 3D ready on port ${PORT}`);
});
