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

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a couple of browser tabs (or share your LAN IP
with friends). Chrome/Edge/Firefox, desktop, mouse + keyboard.

> Note: microphone access requires a secure context. `localhost` works out of the
> box; over the network you'll need HTTPS (or a tunnel like `ngrok`) for voice chat.

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
