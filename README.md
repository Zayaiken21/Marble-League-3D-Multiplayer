# Marble League 3D — Render HTML Rebuild

Flat Render/GitHub format:

- README.md
- index.html
- package.json
- render.yaml
- server.js

## What this rebuild fixes

- Single HTML game client, still Render-ready.
- No loading freeze: the engine catches errors and shows them.
- Real Socket.IO multiplayer rooms.
- Host does not see their own lobby in open lobby list.
- Started games disappear from open lobby list.
- Create/join first, then host opens map voting.
- If players choose different maps, a wheel spins.
- If everyone chooses the same map, the race starts directly.
- Multiplayer gems collect, disappear, and sync immediately.
- First finisher starts a 15-second timer.
- Final results show placements, progress, and gems.
- Finish menu: Race Again, Pick New Map, Shop, Home / End Room.
- Joystick: left moves left, right moves right.
- Wider tracks for multiplayer.
- 20 map names with unique visual themes.
- 20+ ball skins with unlock shop.
- Sonic-style loop camera pulls back and returns.

## Local run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Render

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```
