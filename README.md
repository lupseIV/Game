# 🕷 Emerald Canopy — Multiplayer Jungle Parkour

A browser-based multiplayer 3D parkour game set in a jungle. Leap across the canopy,
fight spiders with your machete, and survive **the Broodmother** — a giant spider that
hunts anything that *moves* or *makes a sound*.

## Features

- **Multiplayer** — everyone on the server shares one jungle. See other explorers,
  their name tags, and who's talking.
- **Proximity voice chat** — WebRTC voice with 3D positional audio. The closer a
  player is, the louder you hear them (full volume within ~2 m, silent past ~32 m).
- **One jungle level, 3 checkpoints** — each parkour section is harder than the last:
  smaller platforms, bigger gaps, higher stakes, and **moving platforms** in
  sections 2 and 3.
- **Spider mobs that scale** — each zone's spiders are faster and hit harder
  (zone 1: 2.2 m/s, 8 dmg → zone 3: 3.8 m/s, 20 dmg).
- **The Broodmother** — touching a checkpoint wakes a giant boss spider. She only
  senses **movement** and **voices**: freeze and stay silent and she loses you.
  Talking in voice chat near her *will* get you killed. Each checkpoint's guardian
  is tougher (260 → 520 HP, 22 → 45 dmg).
- **Combat** — machete melee, mob HP bars, hit markers, kill feed.
- **Checkpoint respawns** — fall into the swamp or die and you return to your last
  activated totem.

## Run it (browser)

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a couple of browser tabs (or share your LAN IP
with friends). Chrome/Edge/Firefox, desktop, mouse + keyboard.

> Note: microphone access requires a secure context. `localhost` works out of the
> box; over the network you'll need HTTPS (or a tunnel like `ngrok`) for voice chat.

## Run it (desktop app — the Steam build)

```bash
npm install
npm run app
```

The desktop app opens a launcher menu:

- **Host expedition** — starts the game server inside the app (port 27960) and
  drops you into the jungle. The menu shows the address friends use to join.
- **Join** — enter a friend's `ip:port`. The game page always loads from
  `localhost` (a secure context), so voice chat works even when joining a
  remote host.

Desktop and browser players share the same servers — a browser player can join a
desktop host at `http://<host-ip>:27960`.

## Shipping on Steam

The desktop build is a standard Electron game, which Steam fully supports.
One-time setup on [Steamworks](https://partner.steamgames.com):

1. Register as a Steamworks partner and pay the $100 app fee. You'll get an
   **App ID** and (under *SteamPipe → Depots*) a **Depot ID**.
2. In *Installation → General*, add a launch option pointing to
   `Emerald Canopy.exe` (Windows depot).

Then for every release:

```bash
# 1. produce the unpacked game folder (dist/win-unpacked)
npm run dist:win        # run on Windows; or dist:linux / dist:mac per platform

# 2. edit steam/app_build.vdf + steam/depot_windows.vdf with your IDs (first time only)

# 3. upload with SteamCMD (part of the Steamworks SDK)
steamcmd +login <builder_account> +run_app_build ../steam/app_build.vdf +quit

# 4. in the Steamworks dashboard: SteamPipe → Builds → set the build live on a branch
```

Steam is the installer — you upload the **unpacked** folder (`dist/win-unpacked`),
not an installer. Add Linux/mac depots the same way with `dist/linux-unpacked` /
`dist/mac` if you want more platforms.

### Optional Steamworks API (Steam names, overlay, future achievements)

```bash
npm i steamworks.js
```

With that installed and Steam running, the launcher signs the player in with
their Steam persona name automatically (`desktop/steam.js`). For local testing
put a `steam_appid.txt` containing your App ID (or `480`, Valve's test app)
next to the executable. The game runs fine without any of this — Steamworks is
strictly optional.

### Multiplayer notes for the Steam release

Networking is direct IP host/join (plus LAN). That's fine for a demo or
friends-only playtest builds; before a wide release you'd typically add Steam
lobbies + Steam Datagram Relay via `steamworks.js` so players can join through
the friends list without port forwarding.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Space | Jump |
| Shift | Sprint |
| Left click | Machete attack |
| V | Enable voice chat |
| M | Mute / unmute |

## How it works

- `server/index.js` — Node + `ws` authoritative server: spider & boss AI, health,
  damage, checkpoints, respawns, and WebRTC signaling relay for voice.
- `shared/level.json` — the level definition (platforms, checkpoints, mob zones,
  boss stats) used by both server and client.
- `public/js/` — Three.js client: first-person parkour physics (with moving-platform
  carry), procedural jungle, procedurally animated spiders, HUD, and mesh WebRTC
  proximity voice with Web Audio HRTF panning.
