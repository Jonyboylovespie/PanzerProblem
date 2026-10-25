import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { addEventListener() {} };
const { STATE } = await import("../static/js/state.js");
const { createBulletManager } = await import("../static/js/bullets.js");

test("hit reports include the victim's moving frag position for automatic detonation", () => {
  Object.assign(STATE, {
    gameCode: "TEST", playerName: "Attacker", isHost: false, bots: [], wallRects: [],
    tanks: { Victim: { x: 100, y: 100, alive: true } },
    bullets: {
      hit: { x: 85, y: 100, vx: 300, vy: 0, shooter: "Attacker", weapon_type: "default", lifetime: 10 },
      frag: { x: 200, y: 220, vx: 150, vy: 0, shooter: "Victim", weapon_type: "frag", lifetime: 10 },
    },
  });
  const events = [];
  createBulletManager({ emit: (name, data) => events.push({ name, data }) }).update(1 / 60);
  const hit = events.find((event) => event.name === "bullet_hit_tank");
  assert.deepEqual(hit.data, {
    game_code: "TEST", bullet_id: "hit", victim_name: "Victim", frag_x: 200, frag_y: 220,
  });
});
