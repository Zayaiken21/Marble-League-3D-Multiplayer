const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

const MAPS = [
  "Crystal Coast XL",
  "Neon Metro Mega",
  "Sky Factory GP",
  "Jungle Loopway",
  "Volcano Velocity",
  "Arctic Aurora"
];

const COLORS = ["red", "blue", "green", "gold", "purple", "black", "rainbow", "lightning"];
const TRACK_LENGTH = 6200;
const MAX_PLAYERS = 8;
const rooms = new Map();

app.use(express.static(__dirname));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

function makeCode() {
  let code = Math.random().toString(36).slice(2, 7).toUpperCase();
  while (rooms.has(code)) code = Math.random().toString(36).slice(2, 7).toUpperCase();
  return code;
}

function makeRoom(code) {
  return {
    code,
    status: "lobby", // lobby -> voting -> wheel -> racing -> finished
    createdAt: Date.now(),
    votingOpen: false,
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
    mapChoice: null,
    input: { steer: 0, throttle: 1, boost: false },
    s: 0,
    lane: 0,
    laneVel: 0,
    speed: 0,
    boost: 100,
    cooldown: 0,
    gems: 0,
    finished: false,
    place: 1,
    checkpoint: 0
  };
}

function roomPublic(room) {
  return {
    code: room.code,
    status: room.status,
    votingOpen: room.votingOpen,
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
    .filter(r => (r.status === "lobby" || r.status === "voting") && r.players.size > 0)
    .map(r => ({
      code: r.code,
      status: r.status,
      votingOpen: r.votingOpen,
      players: r.players.size,
      maxPlayers: MAX_PLAYERS,
      host: [...r.players.values()].find(p => p.host)?.name || "Host"
    }));
}

function emitRoom(room) {
  io.to(room.code).emit("roomUpdate", roomPublic(room));
  io.emit("lobbyList", lobbyList());
}

function allHaveMaps(room) {
  return room.players.size > 0 && [...room.players.values()].every(p => MAPS.includes(p.mapChoice));
}

function everyoneReady(room) {
  return room.players.size > 0 && [...room.players.values()].every(p => p.ready && MAPS.includes(p.mapChoice));
}

function chosenMaps(room) {
  return [...new Set([...room.players.values()].map(p => p.mapChoice).filter(Boolean))];
}

function beginRaceDirect(room, selectedMap) {
  room.status = "racing";
  room.selectedMap = selectedMap;
  room.wheel = null;

  const arr = [...room.players.values()];
  arr.forEach((p, i) => {
    p.s = Math.max(0, -i * 14);
    p.lane = (i - (arr.length - 1) / 2) * 1.05;
    p.laneVel = 0;
    p.speed = 25;
    p.boost = 100;
    p.cooldown = 0;
    p.gems = 0;
    p.finished = false;
    p.place = 1;
    p.checkpoint = 0;
  });

  io.to(room.code).emit("raceStarted", {
    room: roomPublic(room),
    trackLength: TRACK_LENGTH,
    selectedMap
  });

  io.emit("lobbyList", lobbyList());
}

function startMapSelection(room) {
  if (room.status !== "voting" || !room.votingOpen) return false;
  if (!everyoneReady(room)) return false;

  const options = chosenMaps(room);
  const selectedMap = options[Math.floor(Math.random() * options.length)];

  if (options.length === 1) {
    io.to(room.code).emit("mapChosenDirect", { selectedMap });
    setTimeout(() => beginRaceDirect(room, selectedMap), 800);
    return true;
  }

  room.status = "wheel";
  room.selectedMap = selectedMap;
  room.wheel = { options, selectedMap, startedAt: Date.now(), durationMs: 4300 };

  io.to(room.code).emit("wheelStarted", roomPublic(room));
  io.emit("lobbyList", lobbyList());

  setTimeout(() => beginRaceDirect(room, selectedMap), room.wheel.durationMs + 650);
  return true;
}

function applyBoost(room, p) {
  if (p.boost < 100 || p.cooldown > 0 || p.finished) return;
  p.boost = 0;
  p.cooldown = 2.4;
  p.speed += 24;

  for (const other of room.players.values()) {
    if (other.id === p.id || other.finished) continue;
    if (Math.abs(other.s - p.s) < 40 && Math.abs(other.lane - p.lane) < 5.8) {
      other.laneVel += (other.lane >= p.lane ? 1 : -1) * 26;
      other.speed *= 0.62;
    }
  }
}

function simulate(room, dt) {
  if (room.status !== "racing") return;

  for (const p of room.players.values()) {
    if (p.finished) continue;

    p.cooldown = Math.max(0, p.cooldown - dt);
    p.boost = Math.min(100, p.boost + 9 * dt);

    const steer = Math.max(-1, Math.min(1, Number(p.input.steer || 0)));
    const throttle = Math.max(0.5, Math.min(1.25, Number(p.input.throttle || 1)));

    p.laneVel += steer * 11.5 * dt;
    p.laneVel *= Math.pow(0.82, dt * 8);
    p.lane += p.laneVel * dt;

    if (Math.abs(p.lane) > 7.8) {
      p.lane = Math.sign(p.lane) * 2.6;
      p.laneVel = 0;
      p.speed = 22;
    }

    p.speed += 27 * throttle * dt;
    p.speed *= Math.pow(0.989, dt * 60);
    p.speed = Math.max(18, Math.min(55, p.speed));

    if (p.input.boost) {
      applyBoost(room, p);
      p.input.boost = false;
    }

    p.s += p.speed * dt;
    p.checkpoint = Math.floor((p.s / TRACK_LENGTH) * 12);

    // deterministic server-side gem collection by progress bands
    const gemBand = Math.floor(p.s / 220);
    if (gemBand > (p.lastGemBand || 0) && gemBand % 3 === 0) {
      p.gems += 1;
      p.lastGemBand = gemBand;
    }

    if (p.s >= TRACK_LENGTH) {
      p.s = TRACK_LENGTH;
      p.finished = true;
    }
  }

  const sorted = [...room.players.values()].sort((a, b) => b.s - a.s);
  sorted.forEach((p, i) => p.place = i + 1);

  if (room.players.size > 0 && [...room.players.values()].every(p => p.finished)) {
    room.status = "finished";
  }
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;

  for (const room of rooms.values()) {
    simulate(room, dt);

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
          gems: p.gems,
          finished: p.finished,
          place: p.place,
          checkpoint: p.checkpoint
        }))
      });
    }
  }
}, 1000 / 30);

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0 || now - room.createdAt > 1000 * 60 * 60 * 4) rooms.delete(code);
  }
  io.emit("lobbyList", lobbyList());
}, 20000);

io.on("connection", socket => {
  socket.emit("lobbyList", lobbyList());

  socket.on("requestLobbies", () => socket.emit("lobbyList", lobbyList()));

  socket.on("createRoom", data => {
    const room = makeRoom(makeCode());
    room.players.set(socket.id, makePlayer(socket, data || {}, true));
    rooms.set(room.code, room);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit("joinedRoom", { selfId: socket.id, room: roomPublic(room) });
    emitRoom(room);
  });

  socket.on("joinRoom", data => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMessage", "Room not found.");
    if (!(room.status === "lobby" || room.status === "voting")) return socket.emit("errorMessage", "This race already started.");
    if (room.players.size >= MAX_PLAYERS) return socket.emit("errorMessage", "Room is full.");

    room.players.set(socket.id, makePlayer(socket, data || {}, false));
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joinedRoom", { selfId: socket.id, room: roomPublic(room) });
    emitRoom(room);
  });

  socket.on("openMapVote", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "lobby") return;
    const p = room.players.get(socket.id);
    if (!p || !p.host) return socket.emit("errorMessage", "Only the host can open map voting.");

    room.status = "voting";
    room.votingOpen = true;
    for (const player of room.players.values()) {
      player.ready = false;
      player.mapChoice = null;
    }
    emitRoom(room);
  });

  socket.on("setMapChoice", mapChoice => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "voting" || !room.votingOpen) return;
    const p = room.players.get(socket.id);
    if (!p || !MAPS.includes(mapChoice)) return;
    p.mapChoice = mapChoice;
    p.ready = false;
    emitRoom(room);
  });

  socket.on("setReady", ready => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "voting" || !room.votingOpen) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    if (!MAPS.includes(p.mapChoice)) return socket.emit("errorMessage", "Pick a map before readying up.");
    p.ready = !!ready;
    emitRoom(room);
  });

  socket.on("startWheel", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p || !p.host) return socket.emit("errorMessage", "Only the host can start.");
    if (!allHaveMaps(room)) return socket.emit("errorMessage", "Every player must pick a map first.");
    if (!everyoneReady(room)) return socket.emit("errorMessage", "Every player must ready up first.");
    startMapSelection(room);
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

    if (room.players.size === 0) rooms.delete(room.code);
    else {
      if (wasHost) {
        const next = room.players.values().next().value;
        if (next) next.host = true;
      }
      emitRoom(room);
    }

    io.emit("lobbyList", lobbyList());
  });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
server.listen(PORT, () => console.log(`Marble League perfected running on port ${PORT}`));
