import { STATE } from "./state.js";

export let canvas = null;
export let ctx = null;

let arenaInk = "#d4deec";

function updateRenderTheme() {
  arenaInk = getComputedStyle(document.documentElement).getPropertyValue("--arena-ink").trim();
}

window.addEventListener("themechange", updateRenderTheme);
const WALL_THICKNESS = 5;

const TANK_BODY = { w: 30, h: 20, x: -15, y: -10 };
const TANK_BARREL = { w: 20, h: 6, x: 0, y: -3 };
const LABEL = { font: "12px Arial", x: -10, y: -15 };

const BULLET = { radius: 4 };
const PICKUP = { radius: 10, color: "#FFD700" };

export function initRender() {
  updateRenderTheme();
  canvas = document.getElementById("game-canvas");
  ctx = canvas ? canvas.getContext("2d") : null;
}

function withContext(transformFn, drawFn) {
  // Save/restore canvas state around a transformed draw.
  if (!ctx) return;
  ctx.save();
  transformFn();
  drawFn();
  ctx.restore();
}

function configureWallsStyle() {
  // Apply consistent wall stroke configuration.
  if (!ctx) return;
  ctx.strokeStyle = arenaInk;
  ctx.lineWidth = WALL_THICKNESS;
}

function drawWallSegment(seg) {
  // Draw a single wall segment.
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
}

export function drawMaze() {
  if (!ctx || !STATE.wallsReady) return;
  configureWallsStyle();
  for (const seg of STATE.wallSegments) drawWallSegment(seg);
}

export function drawTank(x, y, angle, color, name, weapon = "default") {
  // Draw the tank with highlights if a special weapon is active.
  if (!ctx) return;
  withContext(
    () => {
      ctx.translate(x, y);
      ctx.rotate(angle);
    },
    () => {
      ctx.fillStyle = color;
      ctx.fillRect(TANK_BODY.x, TANK_BODY.y, TANK_BODY.w, TANK_BODY.h);
      if (weapon !== "default") {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(TANK_BODY.x, TANK_BODY.y, TANK_BODY.w, TANK_BODY.h);
        ctx.fillStyle = "white";
      }
      ctx.fillRect(TANK_BARREL.x, TANK_BARREL.y, TANK_BARREL.w, TANK_BARREL.h);
    },
  );
  drawTankLabel(x, y, name, weapon);
}

function drawTankLabel(x, y, name, weapon = "default") {
  // Draw player label and weapon status above the tank.
  if (!ctx) return;
  ctx.fillStyle = arenaInk;
  ctx.font = LABEL.font;
  const label = weapon === "default" ? name : `${name} [${weapon}]`;
  ctx.fillText(label, x + LABEL.x, y + LABEL.y);
}

export function drawBullet(x, y, type = "default") {
  // Draw bullet with distinct visuals for Frag, Laser, and other special weapons.
  if (!ctx) return;
  const isSpecial = type !== "default";
  ctx.fillStyle =
    type === "laser" ? "#F00" : isSpecial ? "#FFD700" : arenaInk;
  ctx.beginPath();
  const radius =
    type === "frag"
      ? BULLET.radius + 2
      : isSpecial && type !== "laser"
        ? BULLET.radius + 1
        : BULLET.radius;
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  if (isSpecial) {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function drawLaserTrail(trail) {
  // Draw a fading red trail for the laser.
  if (!ctx || !trail || trail.length < 2) return;
  ctx.strokeStyle = "#F00";
  ctx.lineWidth = BULLET.radius * 2;
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
  ctx.stroke();
}

export function drawPickups() {
  // Draw all weapon pickups in the maze.
  if (!ctx || !STATE.pickups) return;
  for (const p of STATE.pickups) drawPickup(p);
}

function drawPickup(p) {
  // Draw a single pickup item.
  withContext(
    () => {},
    () => {
      ctx.fillStyle = PICKUP.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PICKUP.radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "10px Arial";
      ctx.textAlign = "center";
      ctx.fillText(p.type.toUpperCase(), p.x, p.y + 4);
    },
  );
}
