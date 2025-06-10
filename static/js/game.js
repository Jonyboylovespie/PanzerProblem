document.addEventListener('DOMContentLoaded', function() {
    // Connect to Socket.IO server
    const socket = io();
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // Game state
    let gameData = {};
    let tanks = {};
    let maze = [];
    let cellSize = 0;

    // Track key presses
    const keys = {
        ArrowUp: false,
        ArrowLeft: false,
        ArrowDown: false,
        ArrowRight: false,
        w: false,
        a: false,
        s: false,
        d: false
    };

    // Get game code and player name from the server-rendered page
    const gameCode = document.getElementById('game-code').textContent;
    const playerName = document.getElementById('player-name').textContent;

    // Join game room
    socket.emit('join', {
        game_code: gameCode,
        player_name: playerName
    });

    socket.emit('request_maze', {
        game_code: gameCode
    });

    socket.on('maze_data', function(data) {
        maze = data.maze;
        cellSize = data.cell_size;

        // adjust canvas dimensions to match maze
        canvas.width  = maze[0].length * cellSize;
        canvas.height = maze.length      * cellSize;
    });

    // Socket event listeners
    socket.on('update_players', function(data) {
        updatePlayersList(data);
        gameData = data;
        tanks = data.tanks || {};
    });

    socket.on('update_tanks', function(tanksData) {
        tanks = tanksData;
    });

    socket.on('player_left', function(data) {
        updatePlayersList(data.game_data);
        tanks = data.game_data.tanks || {};
    });

    socket.on('player_join', function(data) {
        updatePlayersList(data.game_data);
        tanks = data.game_data.tanks || {};
    });

    // Function to update players list
    function updatePlayersList(gameData) {
        const playersList = document.getElementById('players-list');
        playersList.innerHTML = '';

        gameData.players.forEach(function(player) {
            const li = document.createElement('li');
            li.textContent = player;
            if (player === gameData.host) {
                li.textContent += ' (Host)';
            }
            playersList.appendChild(li);
        });
    }

    // Add event listeners for keyboard
    window.addEventListener('keydown', (e) => {
        if (keys.hasOwnProperty(e.key)) {
            keys[e.key] = true;
        }
        if (keys.hasOwnProperty(e.key.toUpperCase())) {
            keys[e.key.toUpperCase()] = true;
        }
    });

    window.addEventListener('keyup', (e) => {
        if (keys.hasOwnProperty(e.key)) {
            keys[e.key] = false;
        }
        if (keys.hasOwnProperty(e.key.toUpperCase())) {
            keys[e.key.toUpperCase()] = false;
        }
    });

    // Draw tank function
    function drawTank(x, y, angle, color, name) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        // Tank body
        ctx.fillStyle = color;
        ctx.fillRect(-15, -10, 30, 20);

        // Tank turret/gun
        ctx.fillRect(0, -3, 20, 6);

        // Player name
        ctx.rotate(-angle);  // Reset rotation for text
        ctx.fillStyle = '#000';
        ctx.font = '12px Arial';
        ctx.fillText(name, -15, -15);

        ctx.restore();
    }

    let mazeCorners = [];
    let wallSegments = [];

    function drawMaze() {
        if (!maze.length) return;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        wallSegments = [];
        const corners = [];
        const h = maze.length, w = maze[0].length;

        // collect wall segments
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const cell = maze[y][x];
                const sx = x * cellSize, sy = y * cellSize;
                const ex = sx + cellSize, ey = sy + cellSize;
                if (cell.top)    wallSegments.push({x1: sx, y1: sy, x2: ex, y2: sy});
                if (cell.right)  wallSegments.push({x1: ex, y1: sy, x2: ex, y2: ey});
                if (cell.bottom) wallSegments.push({x1: sx, y1: ey, x2: ex, y2: ey});
                if (cell.left)   wallSegments.push({x1: sx, y1: sy, x2: sx, y2: ey});
                if (cell.top)    corners.push({x: sx, y: sy}, {x: ex, y: sy});
                if (cell.right)  corners.push({x: ex, y: sy}, {x: ex, y: ey});
                if (cell.bottom) corners.push({x: sx, y: ey}, {x: ex, y: ey});
                if (cell.left)   corners.push({x: sx, y: sy}, {x: sx, y: ey});
            }
        }
        mazeCorners = corners;

        // draw walls
        for (const seg of wallSegments) {
            ctx.beginPath();
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
            ctx.stroke();
        }
    }

    function getTankCorners(tank) {
        const dx = [-15, 15, 15, -15], dy = [-10, -10, 10, 10];
        const cos = Math.cos(tank.angle), sin = Math.sin(tank.angle);
        return dx.map((offX, i) => ({
            x: tank.x + offX * cos - dy[i] * sin,
            y: tank.y + offX * sin + dy[i] * cos
        }));
    }

    function pointToSegmentDist(px, py, x1, y1, x2, y2) {
        const l2 = (x2-x1)**2 + (y2-y1)**2;
        if (l2 === 0) return Math.hypot(px-x1, py-y1);
        let t = ((px-x1)*(x2-x1)+(py-y1)*(y2-y1)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 + t*(x2-x1), projY = y1 + t*(y2-y1);
        return Math.hypot(px-projX, py-projY);
    }

    function pointInPoly(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi>pt.y) !== (yj>pt.y)) &&
                (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    let timePreviousLoop = Date.now();

    // Game loop
    function gameLoop() {
        // Calculate delta time
        const currentTime = Date.now()
        const deltaTimeMillis = currentTime - timePreviousLoop
        const deltaTimeSecs = deltaTimeMillis / 1000.0
        timePreviousLoop = currentTime;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawMaze();

        let moved = false;

        // Handle my tank movement
        if (tanks[playerName]) {
            const speed = 150 * deltaTimeSecs;
            const rotateSpeed = 3 * deltaTimeSecs;

            let originalX = tanks[playerName].x;
            let originalY = tanks[playerName].y;
            let originalAngle = tanks[playerName].angle;

            if (keys.w || keys.ArrowUp) {
                tanks[playerName].x += Math.cos(tanks[playerName].angle) * speed;
                tanks[playerName].y += Math.sin(tanks[playerName].angle) * speed;
                moved = true;
            }
            if (keys.s || keys.ArrowDown) {
                tanks[playerName].x -= Math.cos(tanks[playerName].angle) * (speed / 2);
                tanks[playerName].y -= Math.sin(tanks[playerName].angle) * (speed / 2);
                moved = true;
            }

            if (keys.a || keys.ArrowLeft) {
                tanks[playerName].angle -= rotateSpeed;
                moved = true;
            }
            if (keys.d || keys.ArrowRight) {
                tanks[playerName].angle += rotateSpeed;
                moved = true;
            }


            // Send position update if moved
            if (moved) {
                const tank = tanks[playerName];
                const newCorners = getTankCorners(tank);
                let collision = false;

                // tank corners vs wall segments
                for (const c of newCorners) {
                    for (const seg of wallSegments) {
                        if (pointToSegmentDist(c.x, c.y, seg.x1, seg.y1, seg.x2, seg.y2) < ctx.lineWidth) {
                            collision = true;
                            break;
                        }
                    }
                    if (collision) break;
                }

                // wall corners vs tank polygon
                if (!collision) {
                    for (const wc of mazeCorners) {
                        if (pointInPoly(wc, newCorners)) {
                            collision = true;
                            break;
                        }
                    }
                }

                if (collision) {
                    // revert to original position & angle
                    tank.x = originalX;
                    tank.y = originalY;
                    tank.angle = originalAngle;
                } else {
                    // send update if no collision
                    socket.emit('tank_move', {
                        game_code: gameCode,
                        player_name: playerName,
                        x: tank.x,
                        y: tank.y,
                        angle: tank.angle
                    });
                }
            }
        }

        // debug: draw all corners
        ctx.fillStyle = 'blue';
        Object.values(tanks).forEach(tank => {
            getTankCorners(tank).forEach(c => {
                ctx.beginPath();
                ctx.arc(c.x, c.y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });
        });

        ctx.fillStyle = 'red';
        mazeCorners.forEach(c => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, 3, 0, 2 * Math.PI);
            ctx.fill();
        });

        // Draw all tanks
        for (const [playerName, tank] of Object.entries(tanks)) {
            drawTank(tank.x, tank.y, tank.angle, tank.color, playerName);
        }

        requestAnimationFrame(gameLoop);
    }

    // Start game loop
    gameLoop();

    // Handle leave game button
    document.getElementById('leave-button').addEventListener('click', function() {
        if (confirm('Are you sure you want to leave the game?')) {
            window.location.href = '/';
        }
    });
});