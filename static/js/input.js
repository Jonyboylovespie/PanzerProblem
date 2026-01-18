const TRACKED_KEYS = Object.freeze([
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "w",
  "a",
  "s",
  "d",
  "e",
  " ",
]);

export const keys = createKeyState(TRACKED_KEYS);

function createKeyState(trackedKeys) {
  // Create a boolean map keyed by the tracked key strings.
  const state = {};
  for (const key of trackedKeys) state[key] = false;
  return state;
}

function isTrackedKey(key) {
  // Return whether this key is tracked in our key state map.
  return Object.prototype.hasOwnProperty.call(keys, key);
}

function setKeyState(key, isDown) {
  // Mutate tracked key state.
  if (!isTrackedKey(key)) return;
  keys[key] = isDown;
}

export function wasPressed(key) {
  // Consume a key-press edge (true once per press).
  if (!isTrackedKey(key) || !keys[key]) return false;
  keys[key] = false;
  return true;
}

export function initInput() {
  // Wire keydown/up into the shared key state.
  window.addEventListener("keydown", (e) => setKeyState(e.key, true));
  window.addEventListener("keyup", (e) => setKeyState(e.key, false));
}
