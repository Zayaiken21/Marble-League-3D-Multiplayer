# Marble League 3D — Render Ready

Flat GitHub/Render format:

- `README.md`
- `index.html`
- `package.json`
- `render.yaml`
- `server.js`

## Local test

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Render deploy

1. Push these files to GitHub.
2. Go to Render.
3. New Web Service.
4. Connect the GitHub repo.
5. Render should detect `render.yaml`.
6. Build command: `npm install`
7. Start command: `npm start`

## Multiplayer flow

1. Player creates a lobby.
2. Other players can see only lobbies that have not started.
3. Every player picks a map.
4. Every player readies up.
5. When everyone is ready, host starts the map wheel.
6. The wheel spins through only the selected map names.
7. The chosen map loads and the race starts.
