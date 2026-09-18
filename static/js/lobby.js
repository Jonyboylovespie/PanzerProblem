const list = document.getElementById("public-games");
const refreshButton = document.getElementById("refresh-games");
const status = document.getElementById("games-status");
let refreshing = false;

async function refreshGames(manual = false) {
  if (refreshing || (!manual && (document.hidden || list.contains(document.activeElement)))) return;
  refreshing = true;
  refreshButton.disabled = true;
  try {
    const response = await fetch(list.dataset.url, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to refresh games");
    const html = await response.text();
    // Server-rendered markup escapes all player-supplied names.
    if (list.innerHTML !== html) list.innerHTML = html;
    status.textContent = manual ? "Game list updated." : "Updates automatically every 10 seconds.";
  } catch (_) {
    status.textContent = "Couldn't refresh games. Try Refresh again.";
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", () => refreshGames(true));
setInterval(() => refreshGames(), 10000);
