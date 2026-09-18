import assert from "node:assert/strict";
import test from "node:test";
import {
  createTankMoveSender, mergeTankSnapshot, interpolateRemoteTanks,
} from "../static/js/tank-sync.js";

const tank = (x, overrides = {}) => ({ x, y: 0, angle: 0, alive: true, ...overrides });

function senderFixture() {
  const sent = [];
  const socket = {
    connected: true,
    io: { engine: { transport: { writable: true } } },
    emit: (event, data) => sent.push({ event, data, reliable: true }),
    volatile: { emit: (event, data) => sent.push({ event, data, reliable: false }) },
  };
  return { socket, sent, send: createTankMoveSender(socket, { player_name: "Me" }) };
}

test("movement traffic is capped on high refresh displays and stops are reliable", () => {
  const { send, sent } = senderFixture();
  for (let frame = 0; frame < 144; frame++) send(tank(frame), true, frame * 1000 / 144);
  assert.ok(sent.length <= 30);
  assert.ok(sent.length >= 25);
  assert.ok(sent.every((message) => !message.reliable));
  send(tank(144), false, 1000);
  assert.equal(sent.at(-1).reliable, true);
  assert.equal(sent.at(-1).data.stopped, true);
  assert.equal(sent.at(-1).data.x, 144);
  const count = sent.length;
  send(tank(144), false, 1100);
  assert.equal(sent.length, count);
});

test("congestion and disconnection never queue obsolete movement", () => {
  const { socket, send, sent } = senderFixture();
  socket.io.engine.transport.writable = false;
  for (let now = 0; now < 1000; now += 10) send(tank(now), true, now);
  assert.equal(sent.length, 0);
  socket.connected = false;
  send(tank(1000), false, 1000);
  assert.equal(sent.length, 0);
  socket.connected = true;
  send(tank(1000), false, 1100);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.x, 1000);
  assert.equal(sent[0].reliable, true);
});

test("remote motion reaches the snapshot within one network interval without overshoot", () => {
  const tanks = mergeTankSnapshot({ Other: tank(0) }, { Other: tank(10) }, "Me");
  interpolateRemoteTanks(tanks, "Me", 1 / 60);
  assert.equal(tanks.Other.x, 5);
  interpolateRemoteTanks(tanks, "Me", 1 / 60);
  assert.equal(tanks.Other.x, 10);
  interpolateRemoteTanks(tanks, "Me", 2);
  assert.equal(tanks.Other.x, 10);
});

test("duplicate snapshots do not restart interpolation", () => {
  let tanks = mergeTankSnapshot({ Other: tank(0) }, { Other: tank(10) }, "Me");
  interpolateRemoteTanks(tanks, "Me", 1 / 60);
  tanks = mergeTankSnapshot(tanks, { Other: tank(10) }, "Me");
  interpolateRemoteTanks(tanks, "Me", 1 / 60);
  assert.equal(tanks.Other.x, 10);
});

test("rotation takes the shortest path across the angle boundary", () => {
  const tanks = mergeTankSnapshot(
    { Other: tank(0, { angle: Math.PI - 0.1 }) },
    { Other: tank(0, { angle: -Math.PI + 0.1 }) }, "Me",
  );
  interpolateRemoteTanks(tanks, "Me", 1 / 60);
  assert.ok(Math.abs(tanks.Other.angle - Math.PI) < 1e-10);
});

test("local prediction preserves movement but applies death and weapon changes", () => {
  const tanks = mergeTankSnapshot(
    { Me: tank(20) }, { Me: tank(10, { weapon: "frag" }) }, "Me",
  );
  assert.equal(tanks.Me.x, 20);
  assert.equal(tanks.Me.weapon, "frag");
  const dead = mergeTankSnapshot(tanks, { Me: tank(10, { alive: false }) }, "Me");
  assert.equal(dead.Me.x, 10);
  assert.equal(dead.Me.alive, false);
});

test("stops, teleports, respawns and round resets apply immediately", () => {
  for (const snapshot of [tank(10, { stopped: true }), tank(200)]) {
    const tanks = mergeTankSnapshot({ Other: tank(0) }, { Other: snapshot }, "Me");
    assert.equal(tanks.Other.x, snapshot.x);
    assert.equal(tanks.Other.motion, undefined);
  }
  const respawn = mergeTankSnapshot({ Other: tank(0, { alive: false }) }, { Other: tank(10) }, "Me");
  assert.equal(respawn.Other.x, 10);
  const reset = mergeTankSnapshot({ Me: tank(20), Other: tank(20) }, { Me: tank(10), Other: tank(10) }, "Me", true);
  assert.equal(reset.Me.x, 10);
  assert.equal(reset.Other.x, 10);
});
