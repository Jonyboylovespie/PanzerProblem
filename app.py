import math
import random
import string

from flask import Flask, flash, redirect, render_template, request, session, url_for
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)
app.secret_key = 'super_secret_key'
socketio = SocketIO(app)

# In-memory storage for active games
games = {}

def generate_game_code(length=6):
    """Generate a random game code"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def generate_random_color():
    """Generate a random color for tanks"""
    H = random.randint(0, 360)
    S = 100
    L = 50
    return f'hsl({H}, {S}%, {L}%)'

def get_random_spawn(maze, cell_size):
    """Return (x, y) at centre of a random cell with ≤2 surrounding walls."""
    height = len(maze)
    width = len(maze[0])
    cx = random.randint(0, width - 1)
    cy = random.randint(0, height - 1)
    return cx * cell_size + cell_size / 2, cy * cell_size + cell_size / 2

@app.route('/')
def home():
    return render_template('home.html')

def generate_maze(width, height):
    """Generate a random maze using depth-first search algorithm"""
    # Initialize grid with walls everywhere
    maze = [[{"top": True, "right": True, "bottom": True, "left": True, "visited": False}
             for _ in range(width)] for _ in range(height)]

    # Stack for backtracking
    stack = []

    # Start at random cell
    x, y = random.randint(0, width-1), random.randint(0, height-1)
    maze[y][x]["visited"] = True
    stack.append((x, y))

    # Directions: right, down, left, up
    directions = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    walls = ["right", "bottom", "left", "top"]
    opposite_walls = ["left", "top", "right", "bottom"]

    # DFS maze generation
    while stack:
        x, y = stack[-1]

        # Find unvisited neighbors
        neighbors = []
        for i, (dx, dy) in enumerate(directions):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and not maze[ny][nx]["visited"]:
                neighbors.append((nx, ny, i))

        if neighbors:
            # Choose random unvisited neighbor
            nx, ny, direction = random.choice(neighbors)

            # Remove walls between current cell and chosen cell
            maze[y][x][walls[direction]] = False
            maze[ny][nx][opposite_walls[direction]] = False

            # Mark as visited and add to stack
            maze[ny][nx]["visited"] = True
            stack.append((nx, ny))
        else:
            # Backtrack
            stack.pop()

    # Clean up visited flags as they're not needed for rendering
    for y in range(height):
        for x in range(width):
            del maze[y][x]["visited"]

    return maze

def generate_empty_maze(width, height):
    """Generate an almost-empty maze for lobby: only border walls."""
    maze = []
    for y in range(height):
        row = []
        for x in range(width):
            cell = {"top": False, "right": False, "bottom": False, "left": False}
            # Add border walls on outer edges
            if y == 0:
                cell["top"] = True
            if y == height - 1:
                cell["bottom"] = True
            if x == 0:
                cell["left"] = True
            if x == width - 1:
                cell["right"] = True
            row.append(cell)
        maze.append(row)
    return maze

@app.route('/create', methods=['POST'])
def create_game():
    host_name = request.form.get('host_name')
    game_code = generate_game_code()

    # Ensure unique code
    while game_code in games:
        game_code = generate_game_code()

    # Lobby phase uses a fixed 5x5 empty maze
    width = 5
    height = 5
    maze = generate_empty_maze(width, height)
    cell_size = 70
    spawn_x, spawn_y = get_random_spawn(maze, cell_size)
    games[game_code] = {
        'host': host_name,
        'players': [host_name],
        'active': True,
        'started': False,
        'maze': maze,
        'cell_size': cell_size,
        'scores': {host_name: 0},
        'tanks': {
            host_name: {
                'x': spawn_x,
                'y': spawn_y,
                'angle': 0,
                'color': generate_random_color()
            }
        },
        'bullets': {}
    }

    session['game_code'] = game_code
    session['player_name'] = host_name

    return redirect(url_for('game', code=game_code))

@app.route('/join', methods=['POST'])
def join_game():
    game_code = request.form.get('game_code').upper()
    player_name = request.form.get('player_name')

    if game_code not in games:
        flash('Game not found!')
        return redirect(url_for('home'))

    if not games[game_code]['active']:
        flash('Game is no longer active!')
        return redirect(url_for('home'))

    if player_name in games[game_code]['players']:
        flash('Player with this name already exists!')
        return redirect(url_for('home'))

    games[game_code]['players'].append(player_name)

    cell_size = games[game_code]['cell_size']
    maze = games[game_code]['maze']
    spawn_x, spawn_y = get_random_spawn(maze, cell_size)

    # Create tank for new player
    if 'tanks' not in games[game_code]:
        games[game_code]['tanks'] = {}

    games[game_code]['tanks'][player_name] = {
        'x': spawn_x,
        'y': spawn_y,
        'angle': 0,
        'color': generate_random_color()
    }

    # Initialize score for new player
    if 'scores' not in games[game_code]:
        games[game_code]['scores'] = {}
    games[game_code]['scores'][player_name] = 0

    session['game_code'] = game_code
    session['player_name'] = player_name

    return redirect(url_for('game', code=game_code))

@app.route('/game/<code>')
def game(code):
    player = session.get('player_name')
    if code not in games or player not in games[code]['players']:
        flash('Please try rejoining!')
        return redirect(url_for('home'))

    return render_template('game.html',
                           game_code=code,
                           game_data=games[code],
                           player_name=player)

@socketio.on('join')
def on_join(data):
    game_code = data.get('game_code')
    player_name = data.get('player_name')

    if game_code and game_code in games:
        join_room(game_code)
        emit('player_join', {
            'player_name': player_name,
            'game_data': games[game_code]
        }, room=game_code)

@socketio.on('start_game')
def on_start_game(data):
    game_code = data.get('game_code')
    player_name = data.get('player_name')

    if not (game_code and game_code in games):
        return

    game = games[game_code]

    # Only host can start, and only once, and require 2+ players
    if game.get('started') or game.get('host') != player_name:
        return
    if len(game.get('players', [])) < 2:
        return

    # Generate a new random maze for the real game
    width = int(10 * random.random() + 5)
    height = int(10 * random.random() + 5)
    maze = generate_maze(width, height)
    game['maze'] = maze

    cell_size = game['cell_size']

    # Respawn all players at random maze positions
    for name in game['players']:
        spawn_x, spawn_y = get_random_spawn(maze, cell_size)
        existing = game['tanks'].get(name, {})
        game['tanks'][name] = {
            'x': spawn_x,
            'y': spawn_y,
            'angle': 0,
            'color': existing.get('color', generate_random_color())
        }

    # Clear bullets and mark started
    game['bullets'] = {}
    game['started'] = True

    # Send new maze and tank positions to all clients
    socketio.emit('maze_data', {
        'maze': game['maze'],
        'cell_size': game['cell_size']
    }, room=game_code)

    socketio.emit('update_tanks', game['tanks'], room=game_code)
    socketio.emit('game_started', {'started': True}, room=game_code)

@socketio.on('tank_move')
def on_tank_move(data):
    game_code = data.get('game_code')
    player_name = data.get('player_name')

    if game_code and game_code in games and player_name in games[game_code]['tanks']:
        # Update tank position
        games[game_code]['tanks'][player_name]['x'] = data.get('x')
        games[game_code]['tanks'][player_name]['y'] = data.get('y')
        games[game_code]['tanks'][player_name]['angle'] = data.get('angle')

        # Broadcast new positions to all players
        emit('update_tanks', games[game_code]['tanks'], room=game_code)

@socketio.on('bullet_state')
def on_bullet_state(data):
    game_code = data.get('game_code')
    bullet_id = data.get('bullet_id')
    bullet = data.get('bullet')  # {x,y,vx,vy,shooter,lifetime}

    if not (game_code and bullet_id and bullet):
        return

    if game_code in games and games[game_code].get('started'):
        # Accept client authoritative bullet state
        games[game_code]['bullets'][bullet_id] = bullet
        # Broadcast to all clients
        emit('update_bullets', games[game_code]['bullets'], room=game_code)

@socketio.on('shoot')
def on_shoot(data):
    game_code = data.get('game_code')
    player_name = data.get('player_name')

    if game_code and game_code in games and player_name in games[game_code]['tanks']:
        if not games[game_code].get('started'):
            # No shooting in lobby
            return
        # Enforce one active bullet per shooter
        for b_id, b in games[game_code]['bullets'].items():
            if b.get('shooter') == player_name:
                # Already has an active bullet; ignore shoot request
                return

        tank = games[game_code]['tanks'][player_name]
        bullet_speed = 300

        bullet_id = f"{player_name}_{len(games[game_code]['bullets'])}"

        # Create bullet at tank cannon position
        games[game_code]['bullets'][bullet_id] = {
            'x': tank['x'] + 20 * math.cos(tank['angle']),
            'y': tank['y'] + 20 * math.sin(tank['angle']),
            'vx': bullet_speed * math.cos(tank['angle']),
            'vy': bullet_speed * math.sin(tank['angle']),
            'shooter': player_name,
            'lifetime': 10.0
        }

        # Broadcast new bullet to all players
        emit('update_bullets', games[game_code]['bullets'], room=game_code)

@socketio.on('bullet_hit_tank')
def on_bullet_hit_tank(data):
    game_code = data.get('game_code')
    bullet_id = data.get('bullet_id')
    victim_name = data.get('victim_name')

    if game_code and game_code in games and victim_name in games[game_code]['players']:
        if not games[game_code].get('started'):
            # Ignore hits while in lobby
            return
        # Remove the bullet
        if bullet_id in games[game_code]['bullets']:
            del games[game_code]['bullets'][bullet_id]

        # Respawn the victim
        cell_size = games[game_code]['cell_size']
        maze = games[game_code]['maze']
        spawn_x, spawn_y = get_random_spawn(maze, cell_size)

        games[game_code]['tanks'][victim_name] = {
            'x': spawn_x,
            'y': spawn_y,
            'angle': games[game_code]['tanks'][victim_name]['angle'],
            'color': games[game_code]['tanks'][victim_name]['color']
        }

        # Broadcast updates
        emit('update_bullets', games[game_code]['bullets'], room=game_code)
        emit('update_tanks', games[game_code]['tanks'], room=game_code)

@socketio.on('disconnect')
def on_disconnect():
    player_name = session.get('player_name')
    game_code = session.get('game_code')

    if game_code and game_code in games and player_name in games[game_code]['players']:
        # Remove player from game
        games[game_code]['players'].remove(player_name)

        # Remove player's tank
        if 'tanks' in games[game_code] and player_name in games[game_code]['tanks']:
            del games[game_code]['tanks'][player_name]

        # Remove player's score if present
        if 'scores' in games[game_code] and player_name in games[game_code]['scores']:
            del games[game_code]['scores'][player_name]

        # If the host left, either end game or assign new host
        if player_name == games[game_code]['host'] and games[game_code]['players']:
            games[game_code]['host'] = games[game_code]['players'][0]

        # If no players left, remove the game
        if not games[game_code]['players']:
            games[game_code]['active'] = False

        # Notify remaining players
        emit('player_left', {
            'player_name': player_name,
            'game_data': games[game_code]
        }, room=game_code)

@socketio.on('request_maze')
def on_request_maze(data):
    game_code = data.get('game_code')

    if game_code and game_code in games and 'maze' in games[game_code]:
        emit('maze_data', {
            'maze': games[game_code]['maze'],
            'cell_size': games[game_code]['cell_size']
        })

@socketio.on('bullet_remove')
def on_bullet_remove(data):
    game_code = data.get('game_code')
    bullet_id = data.get('bullet_id')
    if not (game_code and bullet_id):
        return
    if game_code in games:
        if bullet_id in games[game_code]['bullets']:
            del games[game_code]['bullets'][bullet_id]
        emit('update_bullets', games[game_code]['bullets'], room=game_code)

if __name__ == '__main__':
    socketio.run(app, debug=True)