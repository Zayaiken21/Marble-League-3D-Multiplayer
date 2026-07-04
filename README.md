# Marble League 3D — Perfected Render Version

Flat GitHub/Render format:

- README.md
- index.html
- package.json
- render.yaml
- server.js

## Flow

### Main Menu
Choose Offline or Multiplayer first.

### Offline
Pick map after choosing Offline. Race AI, collect gems, and use gems in the shop for upgrades/designs.

### Multiplayer
Create or join a lobby first. No map voting appears until you are inside a lobby and the host opens map voting.

Multiplayer flow:
1. Create/join lobby.
2. Host opens map voting.
3. Everyone chooses a map.
4. Everyone readies up.
5. If all maps are the same, the game starts directly.
6. If maps are different, the wheel spins through selected maps and lands upright on the chosen map.
7. Race starts synced.

## Render

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```
