(function () {
    'use strict';

    // ---------- Bludiště ----------
    // # zeď, . tečka, o velká tečka, - dvířka domečku, G domeček, P start hráče
    var MAZE = [
        '###################',
        '#........#........#',
        '#o##.###.#.###.##o#',
        '#.................#',
        '#.##.#.#####.#.##.#',
        '#....#...#...#....#',
        '####.### # ###.####',
        '   #.#       #.#   ',
        '####.# ##-## #.####',
        '    .  #GGG#  .    ',
        '####.# ##### #.####',
        '   #.#       #.#   ',
        '####.# ##### #.####',
        '#........#........#',
        '#.##.###.#.###.##.#',
        '#o.#.....P.....#.o#',
        '##.#.#.#####.#.#.##',
        '#....#...#...#....#',
        '#.######.#.######.#',
        '#.................#',
        '###################'
    ];
    var COLS = 19, ROWS = 21, TUNNEL_ROW = 9;
    var T = 32, OY = 48;
    var CW = COLS * T, CH = 760;

    // směry: 0 nahoru, 1 vlevo, 2 dolů, 3 vpravo
    var DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
    var EPS = 1e-6;

    var cv = document.getElementById('game');
    var g = cv.getContext('2d');

    // ---------- Zvuk ----------
    var audio = null, muted = false, wakaToggle = false;
    try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { audio = new AC(); }
    } catch (e) { audio = null; }

    function beep(freq, dur, type, vol, slideTo) {
        if (!audio || muted) { return; }
        try {
            var o = audio.createOscillator(), gn = audio.createGain();
            o.type = type || 'square';
            o.frequency.setValueAtTime(freq, audio.currentTime);
            if (slideTo) { o.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + dur); }
            gn.gain.setValueAtTime(vol || 0.04, audio.currentTime);
            gn.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
            o.connect(gn); gn.connect(audio.destination);
            o.start(); o.stop(audio.currentTime + dur);
        } catch (e) { /* ignorovat */ }
    }

    // ---------- Stav hry ----------
    var maze, dotsLeft, dotsEaten, score, lives, level, hi = 0, nextLife;
    var pac, ghosts, fruit, popups;
    var mode, modeTimer, modeIdx, chase, frightTimer, ghostChain, playClock;
    var state = 'title', stateTimer = 0, blink = 0;
    var wallCanvas = null, wallFlash = null;
    var homeDist = null;

    try { hi = parseInt(localStorage.getItem('pacman.hi'), 10) || 0; } catch (e) { hi = 0; }

    var SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity];
    var FRUITS = ['🍒', '🍓', '🍊', '🍎', '🍇', '🔔', '🔑'];

    function wallAt(x, y) {
        if (x < 0 || x >= COLS) { return y !== TUNNEL_ROW; }
        if (y < 0 || y >= ROWS) { return true; }
        return maze[y][x] === '#';
    }

    function charAt(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) { return ' '; }
        return maze[y][x];
    }

    function buildMaze() {
        maze = [];
        dotsLeft = 0;
        for (var y = 0; y < ROWS; y++) {
            var row = [];
            for (var x = 0; x < COLS; x++) {
                var c = MAZE[y].charAt(x);
                if (c === 'P') { c = ' '; }
                if (c === '.' || c === 'o') { dotsLeft++; }
                row.push(c);
            }
            maze.push(row);
        }
        dotsEaten = 0;
        wallCanvas = renderWalls('#2121ff');
        wallFlash = renderWalls('#ffffff');
        homeDist = computeHomeDist();
    }

    // BFS vzdálenost od středu domečku (pro vracející se duchy)
    function computeHomeDist() {
        var d = [];
        for (var y = 0; y < ROWS; y++) { d.push(new Array(COLS).fill(-1)); }
        var q = [[9, 9]];
        d[9][9] = 0;
        for (var i = 0; i < q.length; i++) {
            var p = q[i];
            for (var k = 0; k < 4; k++) {
                var nx = p[0] + DX[k], ny = p[1] + DY[k];
                if (nx < 0) { nx = COLS - 1; } else if (nx >= COLS) { nx = 0; }
                if (ny < 0 || ny >= ROWS || MAZE[ny].charAt(nx) === '#') { continue; }
                if (d[ny][nx] !== -1) { continue; }
                d[ny][nx] = d[p[1]][p[0]] + 1;
                q.push([nx, ny]);
            }
        }
        return d;
    }

    function startLevel() {
        buildMaze();
        fruit = null;
        resetActors();
        state = 'ready';
        stateTimer = 2.2;
    }

    function newGame() {
        score = 0; lives = 3; level = 0; nextLife = 10000;
        startLevel();
    }

    function ghostSpeed() { return 5.8 + 0.25 * Math.min(level, 8); }
    function frightTime() { return Math.max(2, 8 - level * 1.2); }

    function resetActors() {
        pac = { x: 9, y: 15, dir: -1, want: 1, face: 1, dist: 0, dead: 0 };
        ghosts = [
            mkGhost('red', '#ff2a2a', 9, 7, 'out', 0, [17, 0]),
            mkGhost('pink', '#ffb8ff', 9, 9, 'house', 1.5, [1, 0]),
            mkGhost('cyan', '#2ee6e6', 8, 9, 'house', 5, [17, 20]),
            mkGhost('orange', '#ffb852', 10, 9, 'house', 9, [1, 20])
        ];
        ghosts[0].dir = 1;
        modeIdx = 0; modeTimer = SCHEDULE[0]; chase = false;
        frightTimer = 0; ghostChain = 0; playClock = 0;
        popups = [];
    }

    function mkGhost(name, color, x, y, st, release, scatter) {
        return { name: name, color: color, x: x, y: y, dir: -1, state: st, fright: false, release: release, scatter: scatter, dist: 0 };
    }

    // ---------- Pohyb ----------
    function atCenter(e) {
        return Math.abs(e.x - Math.round(e.x)) < EPS && Math.abs(e.y - Math.round(e.y)) < EPS;
    }

    function tileX(e) { return ((Math.round(e.x) % COLS) + COLS) % COLS; }
    function tileY(e) { return Math.round(e.y); }

    function advance(e, dist, decide) {
        var guard = 0;
        while (dist > 1e-7 && guard++ < 8) {
            if (atCenter(e)) {
                e.x = Math.round(e.x); e.y = Math.round(e.y);
                decide(e);
                if (e.dir < 0) { return; }
            }
            var d = e.dir, dx = DX[d], dy = DY[d], dd;
            if (dx !== 0) {
                dd = dx > 0 ? Math.floor(e.x + EPS) + 1 - e.x : e.x - (Math.ceil(e.x - EPS) - 1);
            } else {
                dd = dy > 0 ? Math.floor(e.y + EPS) + 1 - e.y : e.y - (Math.ceil(e.y - EPS) - 1);
            }
            var m = Math.min(dd, dist);
            e.x += dx * m; e.y += dy * m;
            dist -= m;
            e.dist += m;
            if (m >= dd - 1e-9) { e.x = Math.round(e.x); e.y = Math.round(e.y); }
            if (e.x < -0.5) { e.x += COLS; }
            else if (e.x > COLS - 0.5) { e.x -= COLS; }
        }
    }

    function canPac(x, y) {
        if (x < 0) { x = COLS - 1; } else if (x >= COLS) { x = 0; }
        if (y < 0 || y >= ROWS) { return false; }
        var c = MAZE[y].charAt(x);
        return c !== '#' && c !== '-' && c !== 'G';
    }

    function pacDecide(p) {
        eatAt();
        var tx = tileX(p), ty = tileY(p);
        if (p.want >= 0 && canPac(tx + DX[p.want], ty + DY[p.want])) { p.dir = p.want; }
        if (p.dir >= 0 && !canPac(tx + DX[p.dir], ty + DY[p.dir])) { p.dir = -1; }
        if (p.dir >= 0) { p.face = p.dir; }
    }

    function updatePac(dt) {
        // otočení o 180° je možné kdykoli
        if (pac.dir >= 0 && pac.want >= 0 && pac.want === (pac.dir + 2) % 4) {
            pac.dir = pac.want;
            pac.face = pac.dir;
        }
        advance(pac, 6.8 * dt, pacDecide);
    }

    function eatAt() {
        if (!atCenter(pac)) { return; }
        var tx = tileX(pac), ty = tileY(pac);
        var c = maze[ty][tx];
        if (c === '.') {
            maze[ty][tx] = ' ';
            addScore(10);
            dotsLeft--; dotsEaten++;
            wakaToggle = !wakaToggle;
            beep(wakaToggle ? 300 : 420, 0.05, 'triangle', 0.05);
            onDot();
        } else if (c === 'o') {
            maze[ty][tx] = ' ';
            addScore(50);
            dotsLeft--; dotsEaten++;
            beep(180, 0.2, 'sawtooth', 0.05, 520);
            startFright();
            onDot();
        }
    }

    function onDot() {
        if (dotsEaten === 70 || dotsEaten === 120) {
            fruit = { x: 9, y: 11, t: 9.5 };
        }
        if (dotsLeft <= 0) {
            state = 'clear';
            stateTimer = 2.2;
        }
    }

    function addScore(n) {
        score += n;
        if (score > hi) {
            hi = score;
            try { localStorage.setItem('pacman.hi', String(hi)); } catch (e) { /* ignorovat */ }
        }
        if (score >= nextLife) { lives = Math.min(lives + 1, 5); nextLife += 10000; beep(880, 0.3, 'square', 0.05, 1320); }
    }

    // ---------- Duchové ----------
    function startFright() {
        frightTimer = frightTime();
        ghostChain = 0;
        ghosts.forEach(function (gh) {
            if (gh.state === 'out') {
                gh.fright = true;
                if (gh.dir >= 0) { gh.dir = (gh.dir + 2) % 4; }
            }
        });
    }

    function canGhost(gh, x, y) {
        if (x < 0) { x = COLS - 1; } else if (x >= COLS) { x = 0; }
        if (y < 0 || y >= ROWS) { return false; }
        var c = MAZE[y].charAt(x);
        if (c === '#') { return false; }
        if (c === '-' || c === 'G') { return gh.state === 'leaving' || gh.state === 'eaten'; }
        return true;
    }

    function pacTile() { return [tileX(pac), tileY(pac)]; }

    function chaseTarget(gh) {
        var p = pacTile(), f = pac.face;
        switch (gh.name) {
            case 'red': return p;
            case 'pink': return [p[0] + 4 * DX[f], p[1] + 4 * DY[f]];
            case 'cyan':
                var r = ghosts[0];
                var ax = p[0] + 2 * DX[f], ay = p[1] + 2 * DY[f];
                return [2 * ax - tileX(r), 2 * ay - tileY(r)];
            default:
                var dx = tileX(gh) - p[0], dy = tileY(gh) - p[1];
                return dx * dx + dy * dy > 64 ? p : gh.scatter;
        }
    }

    function ghostDecide(gh) {
        var tx = tileX(gh), ty = tileY(gh);

        if (gh.state === 'leaving' && tx === 9 && ty === 7) {
            gh.state = 'out';
            gh.dir = -1;
        }
        if (gh.state === 'eaten' && tx === 9 && ty === 9) {
            gh.state = 'leaving';
            gh.fright = false;
            gh.dir = -1;
        }

        var cands = [], order = [0, 1, 2, 3], i, d;
        for (i = 0; i < 4; i++) {
            d = order[i];
            if (gh.dir >= 0 && gh.state !== 'eaten' && d === (gh.dir + 2) % 4) { continue; }
            if (canGhost(gh, tx + DX[d], ty + DY[d])) { cands.push(d); }
        }
        if (!cands.length) {
            d = gh.dir >= 0 ? (gh.dir + 2) % 4 : 0;
            if (canGhost(gh, tx + DX[d], ty + DY[d])) { cands.push(d); }
            else { gh.dir = -1; return; }
        }

        var best = cands[0];
        if (gh.state === 'out' && gh.fright) {
            best = cands[Math.floor(Math.random() * cands.length)];
        } else if (gh.state === 'eaten') {
            var bd = 1e9;
            cands.forEach(function (c) {
                var nx = tx + DX[c], ny = ty + DY[c];
                if (nx < 0) { nx = COLS - 1; } else if (nx >= COLS) { nx = 0; }
                var hd = homeDist[ny][nx];
                if (hd >= 0 && hd < bd) { bd = hd; best = c; }
            });
        } else {
            var target = gh.state === 'leaving' ? [9, 7] : (chase ? chaseTarget(gh) : gh.scatter);
            var bs = 1e9;
            cands.forEach(function (c) {
                var nx = tx + DX[c] - target[0], ny = ty + DY[c] - target[1];
                var ds = nx * nx + ny * ny;
                if (ds < bs) { bs = ds; best = c; }
            });
        }
        gh.dir = best;
    }

    function ghostSpeedNow(gh) {
        if (gh.state === 'eaten') { return 12; }
        if (gh.state === 'leaving') { return 4.5; }
        var tx = tileX(gh);
        if (gh.y === TUNNEL_ROW && (tx <= 3 || tx >= COLS - 4)) { return 3.4; }
        if (gh.fright) { return 3.6; }
        return ghostSpeed();
    }

    function updateGhosts(dt) {
        // změna módu scatter/chase
        if (frightTimer > 0) {
            frightTimer -= dt;
            if (frightTimer <= 0) {
                ghosts.forEach(function (gh) { gh.fright = false; });
            }
        } else if (modeTimer !== Infinity) {
            modeTimer -= dt;
            if (modeTimer <= 0) {
                modeIdx++;
                modeTimer = SCHEDULE[Math.min(modeIdx, SCHEDULE.length - 1)];
                chase = !chase;
                ghosts.forEach(function (gh) {
                    if (gh.state === 'out' && gh.dir >= 0) { gh.dir = (gh.dir + 2) % 4; }
                });
            }
        }

        ghosts.forEach(function (gh) {
            if (gh.state === 'house') {
                if (playClock >= gh.release) { gh.state = 'leaving'; gh.dir = -1; }
                return;
            }
            advance(gh, ghostSpeedNow(gh) * dt, ghostDecide);
        });
    }

    function checkCollisions() {
        for (var i = 0; i < ghosts.length; i++) {
            var gh = ghosts[i];
            if (gh.state === 'house' || gh.state === 'eaten') { continue; }
            var dx = gh.x - pac.x, dy = gh.y - pac.y;
            if (dx * dx + dy * dy < 0.36) {
                if (gh.state === 'out' && gh.fright) {
                    gh.state = 'eaten';
                    gh.fright = false;
                    var pts = 200 * Math.pow(2, Math.min(ghostChain, 3));
                    ghostChain++;
                    addScore(pts);
                    popups.push({ x: gh.x, y: gh.y, text: String(pts), t: 1 });
                    beep(300, 0.25, 'square', 0.05, 900);
                } else {
                    die();
                    return;
                }
            }
        }
        if (fruit && Math.abs(fruit.x - pac.x) < 0.6 && Math.abs(fruit.y - pac.y) < 0.6) {
            var fp = 100 * (level + 1);
            addScore(fp);
            popups.push({ x: fruit.x, y: fruit.y, text: String(fp), t: 1 });
            fruit = null;
            beep(600, 0.2, 'sine', 0.06, 1200);
        }
    }

    function die() {
        state = 'dying';
        stateTimer = 1.8;
        pac.dead = 0;
        beep(500, 1.2, 'sawtooth', 0.05, 60);
    }

    // ---------- Aktualizace ----------
    function update(dt) {
        blink += dt;
        popups = (popups || []).filter(function (p) { p.t -= dt; return p.t > 0; });

        switch (state) {
            case 'ready':
                stateTimer -= dt;
                if (stateTimer <= 0) { state = 'play'; }
                break;
            case 'play':
                playClock += dt;
                if (fruit) { fruit.t -= dt; if (fruit.t <= 0) { fruit = null; } }
                updatePac(dt);
                if (state !== 'play') { break; }
                updateGhosts(dt);
                checkCollisions();
                break;
            case 'dying':
                pac.dead += dt;
                stateTimer -= dt;
                if (stateTimer <= 0) {
                    lives--;
                    if (lives < 0) {
                        state = 'over';
                    } else {
                        resetActors();
                        state = 'ready';
                        stateTimer = 2;
                    }
                }
                break;
            case 'clear':
                stateTimer -= dt;
                if (stateTimer <= 0) { level++; startLevel(); }
                break;
        }
    }

    // ---------- Kreslení ----------
    function renderWalls(color) {
        var c = document.createElement('canvas');
        c.width = CW; c.height = ROWS * T;
        var x = c.getContext('2d');
        x.lineCap = 'round';
        x.lineJoin = 'round';

        function paint(width, col) {
            x.strokeStyle = col;
            x.lineWidth = width;
            x.beginPath();
            for (var yy = 0; yy < ROWS; yy++) {
                for (var xx = 0; xx < COLS; xx++) {
                    if (MAZE[yy].charAt(xx) !== '#') { continue; }
                    var cx = xx * T + T / 2, cy = yy * T + T / 2;
                    x.moveTo(cx, cy); x.lineTo(cx + 0.01, cy);
                    if (xx + 1 < COLS && MAZE[yy].charAt(xx + 1) === '#') { x.moveTo(cx, cy); x.lineTo(cx + T, cy); }
                    if (yy + 1 < ROWS && MAZE[yy + 1].charAt(xx) === '#') { x.moveTo(cx, cy); x.lineTo(cx, cy + T); }
                }
            }
            x.stroke();
        }
        paint(T * 0.62, color);
        paint(T * 0.36, '#000');
        // dvířka domečku
        x.fillStyle = '#ffb8ff';
        for (var yy = 0; yy < ROWS; yy++) {
            for (var xx = 0; xx < COLS; xx++) {
                if (MAZE[yy].charAt(xx) === '-') { x.fillRect(xx * T, yy * T + T / 2 - 3, T, 6); }
            }
        }
        return c;
    }

    function px(x) { return x * T + T / 2; }
    function py(y) { return y * T + T / 2 + OY; }

    function drawPac() {
        var cx = px(pac.x), cy = py(pac.y);
        var open;
        if (state === 'dying') {
            open = Math.min(1, pac.dead / 1.5) * Math.PI;
        } else {
            open = (Math.abs(Math.sin(pac.dist * 2.2)) * 0.28 + 0.02) * Math.PI;
            if (pac.dir < 0 && state !== 'ready') { open = 0.25 * Math.PI; }
            if (state === 'ready' || state === 'title') { open = 0.28 * Math.PI; }
        }
        var rot = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][pac.face];
        g.fillStyle = '#ffe600';
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, T * 0.46, rot + open, rot + Math.PI * 2 - open);
        g.closePath();
        g.fill();
    }

    function drawGhost(gh) {
        var cx = px(gh.x), cy = py(gh.y) + (gh.state === 'house' ? Math.sin(blink * 8 + gh.release) * 3 : 0);
        var r = T * 0.46;

        if (gh.state !== 'eaten') {
            var col = gh.color;
            if (gh.fright) {
                var flash = frightTimer < 2 && Math.floor(frightTimer * 6) % 2 === 0;
                col = flash ? '#ffffff' : '#2121ff';
            }
            g.fillStyle = col;
            g.beginPath();
            g.arc(cx, cy - 2, r, Math.PI, 0);
            g.lineTo(cx + r, cy + r - 2);
            var legs = 3, w = (2 * r) / legs, wob = Math.floor(blink * 8) % 2 ? 3 : -3;
            for (var i = 0; i < legs; i++) {
                var x0 = cx + r - i * w;
                g.lineTo(x0 - w / 2, cy + r - 2 + wob * (i % 2 ? 1 : -1));
                g.lineTo(x0 - w, cy + r - 2);
            }
            g.closePath();
            g.fill();
        }

        if (gh.fright && gh.state !== 'eaten') {
            g.fillStyle = (frightTimer < 2 && Math.floor(frightTimer * 6) % 2 === 0) ? '#ff2a2a' : '#ffb8ae';
            g.fillRect(cx - 7, cy - 6, 4, 4);
            g.fillRect(cx + 3, cy - 6, 4, 4);
            g.strokeStyle = g.fillStyle;
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(cx - 9, cy + 6);
            for (var k = 0; k < 4; k++) { g.lineTo(cx - 9 + (k + 1) * 4.5, cy + (k % 2 ? 6 : 3)); }
            g.stroke();
        } else {
            var f = gh.dir >= 0 ? gh.dir : 1;
            var ox = DX[f] * 3, oy = DY[f] * 3;
            [-6, 6].forEach(function (ex) {
                g.fillStyle = '#fff';
                g.beginPath(); g.ellipse(cx + ex, cy - 5, 4.5, 6, 0, 0, Math.PI * 2); g.fill();
                g.fillStyle = '#1a2cff';
                g.beginPath(); g.arc(cx + ex + ox, cy - 5 + oy, 2.6, 0, Math.PI * 2); g.fill();
            });
        }
    }

    function text(str, x, y, size, color, align) {
        g.font = 'bold ' + size + 'px "Courier New", monospace';
        g.fillStyle = color || '#fff';
        g.textAlign = align || 'left';
        g.textBaseline = 'alphabetic';
        g.fillText(str, x, y);
    }

    function drawHud() {
        text('SKÓRE', 16, 18, 16, '#fff');
        text(String(score), 16, 40, 22, '#fff');
        text('REKORD', CW / 2, 18, 16, '#fff', 'center');
        text(String(hi), CW / 2, 40, 22, '#fff', 'center');
        text('LEVEL ' + (level + 1), CW - 16, 30, 20, '#ffd479', 'right');

        // životy a ovoce dole
        var by = OY + ROWS * T + 24;
        for (var i = 0; i < Math.max(0, lives); i++) {
            var cx = 30 + i * 36;
            g.fillStyle = '#ffe600';
            g.beginPath();
            g.moveTo(cx, by);
            g.arc(cx, by, 12, Math.PI + 0.7, Math.PI - 0.7);
            g.closePath();
            g.fill();
        }
        g.font = '24px sans-serif';
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.fillStyle = '#fff';
        for (var j = 0; j <= Math.min(level, 5); j++) {
            g.fillText(FRUITS[j % FRUITS.length], CW - 16 - (Math.min(level, 5) - j) * 34, by);
        }
    }

    function draw() {
        g.fillStyle = '#000';
        g.fillRect(0, 0, CW, CH);

        if (state === 'title') { drawTitle(); return; }

        var flash = state === 'clear' && Math.floor(stateTimer * 5) % 2 === 0;
        g.drawImage(flash ? wallFlash : wallCanvas, 0, OY);

        // tečky
        for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
                var c = maze[y][x];
                if (c === '.') {
                    g.fillStyle = '#ffb8ae';
                    g.fillRect(px(x) - 3, py(y) - 3, 6, 6);
                } else if (c === 'o' && Math.floor(blink * 3) % 2 === 0) {
                    g.fillStyle = '#ffb8ae';
                    g.beginPath(); g.arc(px(x), py(y), 9, 0, Math.PI * 2); g.fill();
                }
            }
        }

        if (fruit) {
            g.font = '26px sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillStyle = '#fff';
            g.fillText(FRUITS[level % FRUITS.length], px(fruit.x), py(fruit.y));
        }

        if (state !== 'dying' || pac.dead < 0.4) {
            ghosts.forEach(drawGhost);
        }
        drawPac();

        (popups || []).forEach(function (p) {
            text(p.text, px(p.x), py(p.y) - (1 - p.t) * 16, 18, '#2ee6e6', 'center');
        });

        drawHud();

        if (state === 'ready') { text('PŘIPRAV SE!', CW / 2, py(11) + 8, 26, '#ffe600', 'center'); }
        if (state === 'paused') { overlay('PAUZA', 'Enter – pokračovat'); }
        if (state === 'over') { overlay('KONEC HRY', 'Skóre ' + score + ' · Enter – nová hra'); }
    }

    function overlay(title, sub) {
        g.fillStyle = 'rgba(0,0,0,0.72)';
        g.fillRect(0, OY, CW, ROWS * T);
        text(title, CW / 2, CH / 2 - 10, 52, '#ffe600', 'center');
        text(sub, CW / 2, CH / 2 + 34, 20, '#fff', 'center');
    }

    function drawTitle() {
        text('PACMAN', CW / 2, 220, 84, '#ffe600', 'center');
        var cx = CW / 2, cy = 330, open = (Math.abs(Math.sin(blink * 7)) * 0.28 + 0.03) * Math.PI;
        g.fillStyle = '#ffe600';
        g.beginPath(); g.moveTo(cx - 90, cy); g.arc(cx - 90, cy, 28, open, Math.PI * 2 - open); g.closePath(); g.fill();
        ['#ff2a2a', '#ffb8ff', '#2ee6e6', '#ffb852'].forEach(function (col, i) {
            var gx = cx - 10 + i * 56;
            g.fillStyle = col;
            g.beginPath(); g.arc(gx, cy - 2, 24, Math.PI, 0); g.lineTo(gx + 24, cy + 24);
            g.lineTo(gx + 12, cy + 18); g.lineTo(gx, cy + 24); g.lineTo(gx - 12, cy + 18); g.lineTo(gx - 24, cy + 24);
            g.closePath(); g.fill();
            g.fillStyle = '#fff';
            g.beginPath(); g.arc(gx - 8, cy - 5, 6, 0, Math.PI * 2); g.arc(gx + 8, cy - 5, 6, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#1a2cff';
            g.beginPath(); g.arc(gx - 6, cy - 5, 3, 0, Math.PI * 2); g.arc(gx + 10, cy - 5, 3, 0, Math.PI * 2); g.fill();
        });
        text('REKORD ' + hi, CW / 2, 440, 28, '#fff', 'center');
        if (Math.floor(blink * 2) % 2 === 0) { text('Stiskni Enter nebo klepni', CW / 2, 540, 26, '#ffd479', 'center'); }
        text('Seber všechny tečky a vyhni se duchům.', CW / 2, 620, 18, '#8a8a99', 'center');
        text('Velké tečky umožní duchy sníst.', CW / 2, 648, 18, '#8a8a99', 'center');
    }

    // ---------- Vstup ----------
    var KEYS = { 38: 0, 87: 0, 37: 1, 65: 1, 40: 2, 83: 2, 39: 3, 68: 3 };

    function startOrToggle() {
        if (audio && audio.state === 'suspended') { try { audio.resume(); } catch (e) { /* ignorovat */ } }
        if (state === 'title' || state === 'over') { newGame(); }
        else if (state === 'play') { state = 'paused'; }
        else if (state === 'paused') { state = 'play'; }
    }

    document.addEventListener('keydown', function (e) {
        var k = e.keyCode;
        if (KEYS[k] !== undefined) {
            e.preventDefault();
            if (pac) { pac.want = KEYS[k]; }
            if (state === 'title' || state === 'over') { startOrToggle(); }
        } else if (k === 13 || k === 32) {
            e.preventDefault();
            startOrToggle();
        } else if (k === 80 || k === 10252) {
            if (state === 'play' || state === 'paused') { startOrToggle(); }
        } else if (k === 77) {
            muted = !muted;
        }
    });

    var touch = null;
    cv.addEventListener('touchstart', function (e) {
        var t = e.changedTouches[0];
        touch = { x: t.clientX, y: t.clientY };
        e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
        if (!touch) { return; }
        var t = e.changedTouches[0];
        var dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 24 && pac) {
            pac.want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : (dy > 0 ? 2 : 0);
            touch = { x: t.clientX, y: t.clientY };
        }
        e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', function (e) {
        if (touch && (state === 'title' || state === 'over' || state === 'paused')) { startOrToggle(); }
        touch = null;
        e.preventDefault();
    }, { passive: false });
    cv.addEventListener('click', function () {
        if (state === 'title' || state === 'over' || state === 'paused') { startOrToggle(); }
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden && state === 'play') { state = 'paused'; }
    });

    // ---------- Smyčka ----------
    var last = 0;
    function frame(ts) {
        var dt = Math.min(0.05, (ts - last) / 1000 || 0);
        last = ts;
        if (!pac) { blink += dt; } else { update(dt); }
        draw();
        requestAnimationFrame(frame);
    }

    // titulní obrazovka potřebuje jen jednoduché prostředí
    buildMaze();
    resetActors();
    score = 0; lives = 3; level = 0; nextLife = 10000;
    requestAnimationFrame(frame);
})();
