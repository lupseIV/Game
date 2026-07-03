// Optional Steamworks integration. If the `steamworks.js` package is installed
// and Steam is running, this activates the overlay-compatible API client and
// exposes the player's persona name. Without it the game runs exactly the
// same, so development builds don't need Steam at all.
//
// To enable: `npm i steamworks.js`, then place a steam_appid.txt containing
// your App ID next to the executable (or use 480, Valve's test app, for dev).
const fs = require('fs');
const path = require('path');

let client = null;

function readAppId() {
  const candidates = [
    path.join(process.cwd(), 'steam_appid.txt'),
    path.join(path.dirname(process.execPath), 'steam_appid.txt'),
  ];
  for (const p of candidates) {
    try {
      const id = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (id) return id;
    } catch { /* not present */ }
  }
  return 480;
}

function init() {
  try {
    const sw = require('steamworks.js');
    client = sw.init(readAppId());
    console.log('Steamworks active as', client.localplayer.getName());
    return client;
  } catch (e) {
    console.log('Steamworks inactive:', e.message);
    client = null;
    return null;
  }
}

function personaName() {
  try { return client ? client.localplayer.getName() : null; } catch { return null; }
}

function isActive() { return !!client; }

module.exports = { init, personaName, isActive };
