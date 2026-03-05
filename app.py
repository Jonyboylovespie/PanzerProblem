import math
import random
import string
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, flash, redirect, render_template, request, session, url_for
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)
app.secret_key = "super_secret_key"
socketio = SocketIO(app)

# In-memory storage for active games
games: Dict[str, Dict[str, Any]] = {}

CELL_SIZE = 70
LOBBY_MAZE_SIZE = (5, 5)
MIN_PLAYERS_TO_START = 2
BULLET_SPEED = 300
BULLET_LIFETIME_SECONDS = 10.0
TANK_BARREL_OFFSET = 25

WEAPONS = {
    "default": {"speed": BULLET_SPEED, "lifetime": BULLET_LIFETIME_SECONDS},
    "frag": {"speed": BULLET_SPEED / 2, "lifetime": BULLET_LIFETIME_SECONDS},
    "laser": {"speed": BULLET_SPEED * 5, "lifetime": BULLET_LIFETIME_SECONDS / 5},
}

WEAPON_SPAWN_TIME_MIN = 3.0
WEAPON_SPAWN_TIME_MAX = 8.0


@dataclass(frozen=True)
class Tank:
    x: float
    y: float
    angle: float
    color: str
    weapon: str = "default"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "angle": self.angle,
            "color": self.color,
            "weapon": self.weapon,
        }


def generate_game_code(length: int = 6) -> str:
    # Generate a random game code.
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


def generate_random_color() -> str:
    # Generate a random HSL color for tanks.
    hue = random.randint(0, 360)
    return f"hsl({hue}, 100%, 50%)"


def get_random_spawn(
    maze: List[List[Dict[str, Any]]], cell_size: int
) -> Tuple[float, float]:
    # Return (x, y) at centre of a random cell.
    height = len(maze)
    width = len(maze[0])
    cx = random.randint(0, width - 1)
    cy = random.randint(0, height - 1)
    return cx * cell_size + cell_size / 2, cy * cell_size + cell_size / 2


def get_session_player_and_game() -> Tuple[Optional[str], Optional[str]]:
    # Read session player/game identifiers.
    return session.get("player_name"), session.get("game_code")


def get_game_or_none(game_code: Optional[str]) -> Optional[Dict[str, Any]]:
    # Return game dict if it exists.
    if not game_code:
        return None
    return games.get(game_code)


def require_game(game_code: Optional[str]) -> Optional[Dict[str, Any]]:
    # Return game dict when present; otherwise None.
    return get_game_or_none(game_code)


def ensure_game_code_unique() -> str:
    # Generate a unique game code.
    game_code = generate_game_code()
    while game_code in games:
        game_code = generate_game_code()
    return game_code


def ensure_dict(game: Dict[str, Any], key: str) -> Dict[str, Any]:
    # Ensure a game sub-dict exists and return it.
    if key not in game or game[key] is None:
        game[key] = {}
    return game[key]


def ensure_list(game: Dict[str, Any], key: str) -> List[Any]:
    # Ensure a game list exists and return it.
    if key not in game or game[key] is None:
        game[key] = []
    return game[key]


def spawn_random_pickup(game_code: str) -> None:
    # Spawn a random weapon pickup at a random location.
    game = games.get(game_code)
    if not game or not game.get("started"):
        return
    maze = game.get("maze", [])
    if not maze:
        return
    h, w = len(maze), len(maze[0])
    pickups = ensure_list(game, "pickups")
    available_weapons = [k for k in WEAPONS.keys() if k != "default"]
    if not available_weapons:
        return
    pickups.append(
        {
            "id": f"p_{int(time.time() * 1000)}",
            "x": random.randint(0, w - 1) * CELL_SIZE + CELL_SIZE / 2,
            "y": random.randint(0, h - 1) * CELL_SIZE + CELL_SIZE / 2,
            "type": random.choice(available_weapons),
        }
    )
    socketio.emit("update_pickups", pickups, room=game_code)


def weapon_spawner_loop(game_code: str) -> None:
    # Periodically spawn weapons while the game is active.
    while game_code in games and games[game_code].get("active"):
        socketio.sleep(random.uniform(WEAPON_SPAWN_TIME_MIN, WEAPON_SPAWN_TIME_MAX))
        spawn_random_pickup(game_code)


def init_player_score(game: Dict[str, Any], player_name: str) -> None:
    # Initialize player score if missing.
    scores = ensure_dict(game, "scores")
    scores.setdefault(player_name, 0)


def is_player_alive(game: Dict[str, Any], player_name: str) -> bool:
    # Return whether a player is alive based on tank state.
    tanks = ensure_dict(game, "tanks")
    if not player_name or player_name not in tanks:
        return False
    return bool(tanks[player_name].get("alive", True))


def set_player_alive(game: Dict[str, Any], player_name: str, is_alive: bool) -> None:
    # Set alive status on the player's tank.
    tank = ensure_dict(game, "tanks").get(player_name)
    if not tank:
        return
    tank["alive"] = bool(is_alive)


def alive_players(game: Dict[str, Any]) -> List[str]:
    # Return list of alive players.
    return [p for p in game.get("players", []) if is_player_alive(game, p)]


def ensure_game_round(game: Dict[str, Any]) -> Dict[str, Any]:
    # Ensure the round state sub-dict exists and return it.
    return ensure_dict(game, "round")


def get_round_id(game: Dict[str, Any]) -> int:
    # Return the current round id.
    return int(ensure_game_round(game).get("id", 0))


def bump_round_id(game: Dict[str, Any]) -> int:
    # Increment round id and return it.
    round_state = ensure_game_round(game)
    round_state["id"] = get_round_id(game) + 1
    return int(round_state["id"])


def mark_round_win_pending(game: Dict[str, Any], winner: str) -> None:
    # Mark that a win is pending for a winner.
    round_state = ensure_game_round(game)
    round_state["win_pending"] = True
    round_state["winner"] = winner


def clear_round_win_pending(game: Dict[str, Any]) -> None:
    # Clear any pending win state.
    round_state = ensure_game_round(game)
    round_state["win_pending"] = False
    round_state["winner"] = None


def start_new_round(game: Dict[str, Any]) -> None:
    # Start a new round: new maze, respawn everyone, mark alive, clear bullets.
    bump_round_id(game)
    clear_round_win_pending(game)

    width = int(10 * random.random() + 5)
    height = int(10 * random.random() + 5)
    game["maze"] = generate_maze(width, height)

    for name in game.get("players", []):
        respawn_player(game, name)
        tank = ensure_dict(game, "tanks").get(name)
        if tank:
            tank["angle"] = 0
            tank["alive"] = True
            tank["weapon"] = "default"
    game["bullets"] = {}
    game["pickups"] = []


def set_player_tank(
    game: Dict[str, Any],
    player_name: str,
    x: float,
    y: float,
    angle: float = 0,
    color: Optional[str] = None,
) -> None:
    # Set tank state for a player.
    tanks = ensure_dict(game, "tanks")
    existing = tanks.get(player_name, {})
    if color is None:
        color = existing.get("color") or generate_random_color()
    weapon = existing.get("weapon") or "default"
    tanks[player_name] = Tank(
        x=x, y=y, angle=angle, color=color, weapon=weapon
    ).to_dict()


def respawn_player(game: Dict[str, Any], player_name: str) -> None:
    # Respawn a player at a random location, keeping their color.
    maze = game["maze"]
    cell_size = game["cell_size"]
    spawn_x, spawn_y = get_random_spawn(maze, cell_size)
    existing = ensure_dict(game, "tanks").get(player_name, {})
    set_player_tank(
        game,
        player_name,
        spawn_x,
        spawn_y,
        angle=existing.get("angle", 0),
        color=existing.get("color"),
    )


def can_start_game(game: Dict[str, Any], player_name: str) -> bool:
    # Enforce start conditions.
    if game.get("started"):
        return False
    if game.get("host") != player_name:
        return False
    return len(game.get("players", [])) >= MIN_PLAYERS_TO_START


def broadcast_game_state(game_code: str, game: Dict[str, Any]) -> None:
    # Broadcast maze + tanks to all players.
    socketio.emit(
        "maze_data",
        {"maze": game["maze"], "cell_size": game["cell_size"]},
        room=game_code,
    )
    socketio.emit("update_tanks", game["tanks"], room=game_code)
    socketio.emit("update_pickups", game.get("pickups", []), room=game_code)


@app.route("/")
def home():
    return render_template("home.html")


def generate_maze(width: int, height: int) -> List[List[Dict[str, Any]]]:
    # Generate a random maze using DFS/backtracking.
    maze: List[List[Dict[str, Any]]] = [
        [
            {"top": True, "right": True, "bottom": True, "left": True, "visited": False}
            for _ in range(width)
        ]
        for _ in range(height)
    ]

    stack: List[Tuple[int, int]] = []
    x, y = random.randint(0, width - 1), random.randint(0, height - 1)
    maze[y][x]["visited"] = True
    stack.append((x, y))

    dirs = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    walls = ["right", "bottom", "left", "top"]
    opposite = ["left", "top", "right", "bottom"]

    while stack:
        x, y = stack[-1]
        neighbors: List[Tuple[int, int, int]] = []

        for i, (dx, dy) in enumerate(dirs):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and not maze[ny][nx]["visited"]:
                neighbors.append((nx, ny, i))

        if not neighbors:
            stack.pop()
            continue

        nx, ny, direction = random.choice(neighbors)
        maze[y][x][walls[direction]] = False
        maze[ny][nx][opposite[direction]] = False
        maze[ny][nx]["visited"] = True
        stack.append((nx, ny))

    for yy in range(height):
        for xx in range(width):
            del maze[yy][xx]["visited"]

    return maze


def generate_empty_maze(width: int, height: int) -> List[List[Dict[str, bool]]]:
    # Generate a lobby maze with only border walls.
    maze: List[List[Dict[str, bool]]] = []
    for y in range(height):
        row: List[Dict[str, bool]] = []
        for x in range(width):
            cell = {
                "top": y == 0,
                "bottom": y == height - 1,
                "left": x == 0,
                "right": x == width - 1,
            }
            row.append(cell)
        maze.append(row)
    return maze


@app.route("/create", methods=["POST"])
def create_game():
    # Create a new lobby game and redirect host into it.
    host_name = request.form.get("host_name")
    if not host_name:
        return redirect(url_for("home"))
    game_code = ensure_game_code_unique()

    width, height = LOBBY_MAZE_SIZE
    maze = generate_empty_maze(width, height)
    spawn_x, spawn_y = get_random_spawn(maze, CELL_SIZE)

    games[game_code] = {
        "host": host_name,
        "players": [host_name],
        "active": True,
        "started": False,
        "maze": maze,
        "cell_size": CELL_SIZE,
        "scores": {host_name: 0},
        "tanks": {},
        "bullets": {},
    }
    set_player_tank(
        games[game_code],
        host_name,
        spawn_x,
        spawn_y,
        angle=0,
        color=generate_random_color(),
    )
    ensure_dict(games[game_code], "tanks")[host_name]["alive"] = True

    session["game_code"] = game_code
    session["player_name"] = host_name
    return redirect(url_for("game", code=game_code))


@app.route("/join", methods=["POST"])
def join_game():
    # Join an existing active game as a new player.
    game_code = (request.form.get("game_code") or "").upper()
    player_name = request.form.get("player_name")
    if not game_code or not player_name:
        return redirect(url_for("home"))

    game = require_game(game_code)
    if not game:
        flash("Game not found!")
        return redirect(url_for("home"))

    if not game.get("active"):
        flash("Game is no longer active!")
        return redirect(url_for("home"))

    players = ensure_list(game, "players")
    if player_name in players:
        flash("Player with this name already exists!")
        return redirect(url_for("home"))

    players.append(player_name)
    spawn_x, spawn_y = get_random_spawn(game["maze"], game["cell_size"])
    set_player_tank(
        game, player_name, spawn_x, spawn_y, angle=0, color=generate_random_color()
    )
    init_player_score(game, player_name)
    ensure_dict(game, "tanks")[player_name]["alive"] = True

    session["game_code"] = game_code
    session["player_name"] = player_name
    return redirect(url_for("game", code=game_code))


@app.route("/game/<code>")
def game(code):
    player = session.get("player_name")
    if code not in games or player not in games[code]["players"]:
        flash("Please try rejoining!")
        return redirect(url_for("home"))

    return render_template(
        "game.html", game_code=code, game_data=games[code], player_name=player
    )


@socketio.on("join")
def on_join(data):
    game_code = data.get("game_code")
    player_name = data.get("player_name")

    if game_code and game_code in games:
        join_room(game_code)
        emit(
            "player_join",
            {"player_name": player_name, "game_data": games[game_code]},
            room=game_code,
        )


@socketio.on("start_game")
def on_start_game(data):
    # Start the real game (host-only) and broadcast fresh state.
    game_code = data.get("game_code")
    player_name = data.get("player_name")

    game = require_game(game_code)
    if not game or not can_start_game(game, player_name):
        return

    start_new_round(game)
    game["started"] = True

    socketio.start_background_task(weapon_spawner_loop, game_code)
    broadcast_game_state(game_code, game)
    socketio.emit("game_started", {"started": True}, room=game_code)


@socketio.on("tank_move")
def on_tank_move(data):
    # Update a player's tank state and broadcast it.
    game_code = data.get("game_code")
    player_name = data.get("player_name")

    game = require_game(game_code)
    if not game:
        return
    if not is_player_alive(game, player_name):
        return

    tanks = ensure_dict(game, "tanks")
    if player_name not in tanks:
        return

    tanks[player_name]["x"] = data.get("x")
    tanks[player_name]["y"] = data.get("y")
    tanks[player_name]["angle"] = data.get("angle")
    emit("update_tanks", tanks, room=game_code)


@socketio.on("shoot")
def on_shoot(data):
    # Handle shooting and detonations.
    game_code, player_name = data.get("game_code"), data.get("player_name")
    game = require_game(game_code)
    if not game or not game.get("started") or not is_player_alive(game, player_name):
        return

    tanks, bullets = ensure_dict(game, "tanks"), ensure_dict(game, "bullets")
    tank = tanks.get(player_name)
    if not tank:
        return

    weapon_type = tank.get("weapon", "default")

    # Detonate existing frag if present
    if weapon_type == "frag":
        frag_id = next(
            (
                k
                for k, v in bullets.items()
                if v.get("shooter") == player_name and v.get("weapon_type") == "frag"
            ),
            None,
        )
        if frag_id:
            b = bullets.pop(frag_id)
            tank["weapon"] = "default"
            fx, fy = data.get("frag_x", b["x"]), data.get("frag_y", b["y"])
            for i in range(random.randint(15, 30)):
                ang = random.uniform(0, 2 * math.pi)
                bullets[f"{player_name}_f_{int(time.time() * 1000)}_{i}"] = {
                    "x": fx,
                    "y": fy,
                    "vx": BULLET_SPEED * math.cos(ang),
                    "vy": BULLET_SPEED * math.sin(ang),
                    "shooter": player_name,
                    "lifetime": 1.5,
                    "weapon_type": "fragment",
                }
            emit("update_tanks", tanks, room=game_code)
            emit("update_bullets", bullets, room=game_code)
            return

    # Standard shooting: one bullet per weapon type active
    if any(
        v.get("shooter") == player_name
        and v.get("weapon_type", "default") == weapon_type
        for v in bullets.values()
    ):
        return

    weapon, angle = WEAPONS.get(weapon_type, WEAPONS["default"]), tank["angle"]
    bullets[f"{player_name}_{int(time.time() * 1000)}"] = {
        "x": tank["x"] + TANK_BARREL_OFFSET * math.cos(angle),
        "y": tank["y"] + TANK_BARREL_OFFSET * math.sin(angle),
        "vx": weapon["speed"] * math.cos(angle),
        "vy": weapon["speed"] * math.sin(angle),
        "shooter": player_name,
        "lifetime": weapon["lifetime"],
        "weapon_type": weapon_type,
    }
    if weapon_type != "frag":
        tank["weapon"] = "default"
        emit("update_tanks", tanks, room=game_code)
    emit("update_bullets", bullets, room=game_code)


@socketio.on("claim_pickup")
def on_claim_pickup(data):
    # Remove a pickup and assign its weapon to the player.
    game_code, player_name, pickup_id = (
        data.get("game_code"),
        data.get("player_name"),
        data.get("pickup_id"),
    )
    game = require_game(game_code)
    if not game:
        return
    tanks, pickups = ensure_dict(game, "tanks"), ensure_list(game, "pickups")
    pickup = next((p for p in pickups if p["id"] == pickup_id), None)
    if pickup and player_name in tanks:
        tanks[player_name]["weapon"] = pickup["type"]
        game["pickups"] = [p for p in pickups if p["id"] != pickup_id]
        emit("update_tanks", tanks, room=game_code)
        emit("update_pickups", game["pickups"], room=game_code)


@socketio.on("bullet_hit_tank")
def on_bullet_hit_tank(data):
    # Handle bullet hit: eliminate victim until one alive remains, then award and reset.
    game_code = data.get("game_code")
    bullet_id = data.get("bullet_id")
    victim_name = data.get("victim_name")

    game = require_game(game_code)
    if not game or not game.get("started"):
        return

    if victim_name not in game.get("players", []):
        return
    if not is_player_alive(game, victim_name):
        return

    bullets = ensure_dict(game, "bullets")
    if bullet_id in bullets:
        bullet = bullets.pop(bullet_id)
        if bullet.get("weapon_type") == "frag":
            shooter = bullet.get("shooter")
            tanks = ensure_dict(game, "tanks")
            if shooter in tanks and tanks[shooter].get("weapon") == "frag":
                tanks[shooter]["weapon"] = "default"

    set_player_alive(game, victim_name, False)

    emit("update_bullets", bullets, room=game_code)
    emit("update_tanks", game["tanks"], room=game_code)

    living = alive_players(game)
    if len(living) == 1:
        schedule_win_if_survives(game_code, living[0])


def schedule_win_if_survives(game_code: str, winner: str) -> None:
    # Start (or replace) a background 5s survival check for the current round.
    game = require_game(game_code)
    if not game or not game.get("started"):
        return

    if not is_player_alive(game, winner):
        return

    mark_round_win_pending(game, winner)
    round_id = get_round_id(game)
    socketio.start_background_task(check_win_survival, game_code, winner, round_id)


def check_win_survival(game_code: str, winner: str, round_id: int) -> None:
    # Poll up to 5s; if winner dies, reset immediately; if survives, award + reset.
    deadline = time.time() + 5.0
    while time.time() < deadline:
        game = require_game(game_code)
        if not game or not game.get("started"):
            return

        if get_round_id(game) != round_id:
            return

        current_winner = ensure_game_round(game).get("winner")
        if current_winner != winner:
            return

        if not is_player_alive(game, winner):
            start_new_round(game)
            broadcast_game_state(game_code, game)
            socketio.emit("update_scores", ensure_dict(game, "scores"), room=game_code)
            return

        time.sleep(0.1)

    game = require_game(game_code)
    if not game or not game.get("started"):
        return

    if get_round_id(game) != round_id:
        return

    current_winner = ensure_game_round(game).get("winner")
    if current_winner != winner:
        return

    if not is_player_alive(game, winner):
        start_new_round(game)
        broadcast_game_state(game_code, game)
        socketio.emit("update_scores", ensure_dict(game, "scores"), room=game_code)
        return

    add_score(game_code, winner, 1)
    start_new_round(game)
    broadcast_game_state(game_code, game)
    socketio.emit("update_scores", ensure_dict(game, "scores"), room=game_code)


def add_score(game_code: str, player: str, amount: int) -> None:
    # Add points to a player's score and broadcast the scoreboard.
    game = require_game(game_code)
    if not game:
        return
    scores = ensure_dict(game, "scores")
    scores[player] = scores.get(player, 0) + amount
    socketio.emit("update_scores", scores, room=game_code)


@socketio.on("disconnect")
def on_disconnect():
    # Remove disconnecting player and update remaining clients.
    player_name, game_code = get_session_player_and_game()
    game = require_game(game_code)

    if not game or not player_name:
        return

    players = ensure_list(game, "players")
    if player_name not in players:
        return

    players.remove(player_name)

    tanks = ensure_dict(game, "tanks")
    tanks.pop(player_name, None)

    scores = ensure_dict(game, "scores")
    scores.pop(player_name, None)

    if player_name == game.get("host") and players:
        game["host"] = players[0]

    if not players:
        game["active"] = False

    emit(
        "player_left",
        {"player_name": player_name, "game_data": game},
        room=game_code,
    )


@socketio.on("request_maze")
def on_request_maze(data):
    game_code = data.get("game_code")

    if game_code and game_code in games and "maze" in games[game_code]:
        emit(
            "maze_data",
            {
                "maze": games[game_code]["maze"],
                "cell_size": games[game_code]["cell_size"],
            },
        )


@socketio.on("bullet_remove")
def on_bullet_remove(data):
    game_code = data.get("game_code")
    bullet_id = data.get("bullet_id")
    if not (game_code and bullet_id):
        return
    if game_code in games:
        game = games[game_code]
        bullets = ensure_dict(game, "bullets")
        if bullet_id in bullets:
            bullet = bullets.pop(bullet_id)
            if bullet.get("weapon_type") == "frag":
                shooter = bullet.get("shooter")
                tanks = ensure_dict(game, "tanks")
                if shooter in tanks and tanks[shooter].get("weapon") == "frag":
                    tanks[shooter]["weapon"] = "default"
                    emit("update_tanks", tanks, room=game_code)
        emit("update_bullets", bullets, room=game_code)


if __name__ == "__main__":
    socketio.run(app, debug=True)
