// =============================================================================
//  app.js  —  AdaptiveEngine Controller v4.2
//  - Fully integrated with C++ backend (http://localhost:8080)
//  - Zero-lag high-speed auto-play simulation
//  - Reliable drag-and-drop pawn promotion interface (left & right click supported)
//  - Deep real-time analysis: Win Probability, Threat Radar, Ups & Downs Chart
//  - Chess.com style interactive Post-Game Review Screen centered on board
//  - Deep-thinking Omega Engine Console with PV lines, NPS, cutoffs, and breakdown
// =============================================================================

// ── Core State ──────────────────────────────────────────────────────────────
// Rating of the human opponent, used in AdaptiveEngine's Elo update (set on the Play tab, remembered)
function humanElo() {
    const v = parseInt($('#human-elo').val(), 10);
    return Number.isFinite(v) ? Math.max(100, Math.min(3000, v)) : 800;
}
let board            = null;
let reviewBoard      = null;
const game           = new Chess();
const learningSystem = new LearningSystem();
let gameData         = learningSystem.load();
let analyzer         = new PositionAnalyzer(new Evaluator());   // live analysis always uses full knowledge

// ── Worker & Backend State ──────────────────────────────────────────────────
let engineWorker     = null;
let pendingSearchId  = 0;
let pendingResolve   = null;
let searchIdCounter  = 0;

let cppBackendUrl    = null;
let useCppBackend    = false;

// ── Play State ──────────────────────────────────────────────────────────────
let isAutoPlay       = false;
let sparringBot      = null;   // { key, name, level, elo, jsBot }
let autoPlaySpeed    = 600;    // ms between auto-train moves (Normal)
let animateMoves     = true;

// Sparring opponents (replaced by the C++ server's measured table when it connects)
let SPARRING_PRESETS = [
    { key: 'beginner',    name: 'Beginner',    level: 1,  elo: 400 },
    { key: 'novice',      name: 'Novice',      level: 3,  elo: 1010 },
    { key: 'club',        name: 'Club',        level: 5,  elo: 1600 },
    { key: 'expert',      name: 'Expert',      level: 10, elo: 1940 },
    { key: 'master',      name: 'Master',      level: 15, elo: 2110 },
    { key: 'grandmaster', name: 'Grandmaster', level: 20, elo: 2200 }
];
function renderSparringOptions() {
    const $sel = $('#sparring-elo');
    const current = $sel.val() || 'club';
    $sel.empty();
    SPARRING_PRESETS.forEach(p => {
        const depth = Math.max(1, 1 + Math.floor(p.level / 5));
        $sel.append(`<option value="${p.key}">${p.name} — ${Math.round(p.elo)} bot-Elo (level ${p.level}, ${depth}-ply)</option>`);
    });
    $sel.val(SPARRING_PRESETS.some(p => p.key === current) ? current : 'club');
}
function selectedSparring() {
    const key = $('#sparring-elo').val();
    return SPARRING_PRESETS.find(p => p.key === key) || SPARRING_PRESETS[2];
}
// One sparring move: the C++ engine at the preset's level, or the simple browser bot offline
async function sparringMove() {
    if (useCppBackend) {
        try {
            const resp = await fetch(`${cppBackendUrl}/move`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fen: game.fen(), level: sparringBot.level })
            });
            const d = await resp.json();
            if (d && d.move) return d;
        } catch (e) {}
    }
    if (!sparringBot.jsBot) sparringBot.jsBot = new SparringBot(sparringBot.elo);
    return sparringBot.jsBot.chooseBestMove(game, null, false);
}
// The bot's real search depth (the browser-only engine is capped lower for speed)
function botDepth() { return depthFromSkill(gameData.skill); }
let trainGamesLeft   = 0;
let clickSource      = null;
let redoHistory      = [];

function clearRedoHistory() {
    redoHistory = [];
}

let analysisTimeout  = null;
let evalHistoryData  = [];   // array of { moveNum, moveStr, evalCp }

// ── Saved Games ─────────────────────────────────────────────────────────────
let savedGames          = JSON.parse(localStorage.getItem('omegaChessSavedGames') || '[]');
let selectedSavedGameId = null;

// ── DOM Shortcuts ───────────────────────────────────────────────────────────
const $status      = $('#status');
const $moveHistory = $('#move-history');
const $evalFill    = $('#eval-fill');
const $evalText    = $('#eval-text');

const sfxMove    = document.getElementById('sfx-move');
const sfxCapture = document.getElementById('sfx-capture');
const sfxCheck   = document.getElementById('sfx-check');
const sfxEnd     = document.getElementById('sfx-end');

// ── Charts Setup ────────────────────────────────────────────────────────────
Chart.defaults.color = '#9c9a9e';

const CHART_BASE = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
        x: { ticks: { font: { size: 9 } }, grid: { color: '#2a2a2a' } },
        y: { grid: { color: '#2a2a2a' } }
    }
};

const miniEloChart = new Chart(
    document.getElementById('miniEloChart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#81B64C', backgroundColor: 'rgba(129,182,76,0.15)', borderWidth: 2, pointRadius: 2, fill: true, tension: 0.3 }] },
    options: { ...CHART_BASE, scales: { x: { display: false }, y: { display: false } } }
});

const trainChart = new Chart(
    document.getElementById('trainChart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [
        { label: 'Elo', data: [], yAxisID: 'y', borderColor: '#d39afb', backgroundColor: 'rgba(211,154,251,0.15)', borderWidth: 2, pointRadius: 2, fill: true, tension: 0.3 },
        { label: 'ACPL (lower is better)', data: [], yAxisID: 'y2', borderColor: '#ebcb8b', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 1.5, fill: false, tension: 0.3, spanGaps: true }
    ] },
    options: {
        ...CHART_BASE,
        plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 9 } } } },
        scales: {
            x:  { ticks: { font: { size: 9 } }, grid: { color: '#2a2a2a' } },
            y:  { position: 'left',  title: { display: true, text: 'Elo', font: { size: 9 } }, grid: { color: '#2a2a2a' } },
            y2: { position: 'right', title: { display: true, text: 'ACPL', font: { size: 9 } }, grid: { display: false }, beginAtZero: true }
        }
    }
});

// ── Moves Advantage Flow (Ups & Downs Chart) ────────────────────────────────
const evalHistoryChart = new Chart(
    document.getElementById('evalHistoryChart').getContext('2d'), {
    type: 'line',
    data: {
        labels: ['Start'],
        datasets: [{
            label: 'Eval Advantage',
            data: [0],
            borderColor: '#81b64c',
            backgroundColor: ctx => {
                const chart = ctx.chart;
                const { ctx: c, chartArea } = chart;
                if (!chartArea) return 'transparent';
                const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                gradient.addColorStop(0, 'rgba(129,182,76,0.38)');
                gradient.addColorStop(0.5, 'rgba(129,182,76,0.05)');
                gradient.addColorStop(1, 'rgba(201,92,92,0.38)');
                return gradient;
            },
            borderWidth: 2,
            pointRadius: 2.5,
            fill: true,
            tension: 0.25
        }]
    },
    options: {
        ...CHART_BASE,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: ctx => {
                        const val = ctx.raw;
                        const sign = val >= 0 ? '+' : '';
                        const adv = val > 0.5 ? 'White advantage' : val < -0.5 ? 'Black advantage' : 'Equal position';
                        return `Eval: ${sign}${val.toFixed(2)} (${adv})`;
                    }
                }
            }
        },
        scales: {
            x: { ticks: { font: { size: 8 }, maxTicksLimit: 12 }, grid: { color: '#222' } },
            y: {
                min: -8,
                max: 8,
                grid: { color: '#262626' },
                ticks: { font: { size: 8 }, callback: v => (v >= 0 ? '+' : '') + v.toFixed(0) }
            }
        }
    }
});

// ── Review Eval Chart (Post-Game Review Modal) ──────────────────────────────
const reviewEvalChart = new Chart(
    document.getElementById('reviewEvalChart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{
        data: [],
        borderColor: '#81b64c',
        backgroundColor: ctx => {
            const chart = ctx.chart;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return 'transparent';
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(129,182,76,0.45)');
            gradient.addColorStop(0.5, 'rgba(100,100,100,0.05)');
            gradient.addColorStop(1, 'rgba(201,92,92,0.45)');
            return gradient;
        },
        borderWidth: 2, fill: true, tension: 0.25, pointRadius: 2
    }] },
    options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { display: false },
            y: {
                min: -8, max: 8,
                grid: { color: '#222' },
                ticks: { font: { size: 8 }, callback: v => (v >= 0 ? '+' : '') + v.toFixed(0) }
            }
        },
        onClick: (evt, items) => {
            if (items.length > 0) {
                jumpToReviewMove(items[0].index);
            }
        }
    }
});

// ── Web Worker Initialisation ───────────────────────────────────────────────
function initWorker() {
    try {
        engineWorker = new Worker('js/engine_worker.js');
        engineWorker.onmessage = handleWorkerMessage;
        engineWorker.onerror = err => {
            logTerminal('⚠ Worker error: ' + err.message, 'warn');
            engineWorker = null;
        };
    } catch (e) {
        engineWorker = null;
    }
}

function handleWorkerMessage(e) {
    const d = e.data;
    if (d.id !== pendingSearchId) return;

    if (d.type === 'progress') {
        if (!isAutoPlay) logConsoleProgress(d);
    } else if (d.type === 'result' && pendingResolve) {
        const res = pendingResolve;
        pendingResolve = null;
        res(d);
    }
}

function workerSearch() {
    const losses = gameData.consecutiveLosses || 0;
    if (!engineWorker) {
        return engine.chooseBestMove(game, null, !isAutoPlay, losses);
    }
    return new Promise(resolve => {
        const id = ++searchIdCounter;
        pendingSearchId = id;
        pendingResolve  = resolve;
        try {
            engineWorker.postMessage({
                fen:               game.fen(),
                history:           game.history(),
                depth:             engine.depth,
                weights:           workerWeights(gameData.weights),
                consecutiveLosses: losses,
                id
            });
        } catch (e) {
            engineWorker = null;
            resolve(engine.chooseBestMove(game, null, !isAutoPlay, losses));
        }
    });
}

// The worker's evaluator has its own raw scales: map the stat weights onto them.
function workerWeights(w) {
    const g = k => (w && typeof w[k] === 'number' ? w[k] : SKILL_START / SKILL_MASTER);
    return {
        material:          1.0,
        pieceSquare:       0.20 * g('piecePlacement'),
        centerControl:     0.20 * g('centerControl'),
        mobility:          0.15 * g('mobility'),
        kingSafety:        0.25 * g('kingSafety'),
        pawnStructure:     0.20 * g('pawnStructure'),
        pieceCoordination: 0.22 * (g('bishopPair') + g('rookActivity') + g('knightOutposts')) / 3,
        tacticalSafety:    0.25 * g('threatAwareness')
    };
}

// ── C++ Backend Detection & Integration ─────────────────────────────────────
async function detectCppBackend(silent = false) {
    try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 1200);
        const resp = await fetch('http://localhost:8080/state', { signal: ctrl.signal });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error('bad response');
        const state = await resp.json();

        if (!useCppBackend) {
            cppBackendUrl = 'http://localhost:8080';
            useCppBackend = true;
            window.useCppBackend = true;
            $('#terminal-header span:first').html('<i class="fas fa-terminal"></i> ADAPTIVEENGINE CONSOLE <span style="color:#d39afb;font-size:10px;margin-left:6px;">[C++ NATIVE ENGINE]</span>');
        logTerminal('<span class="term-line cpp">★ ADAPTIVEENGINE C++ BACKEND CONNECTED at localhost:8080</span>');
            logTerminal(`  Native Elo: ${Math.round(state.elo)} | Games: ${state.games}`, 'info');
        }
        if (state.weights) {
            applyCppState(state);
        }
        updateStatsUI();
        return true;
    } catch {
        if (useCppBackend) {
            useCppBackend = false;
            window.useCppBackend = false;
            $('#terminal-header span:first').html('<i class="fas fa-terminal"></i> ADAPTIVEENGINE CONSOLE');
            logTerminal('⚠ C++ backend disconnected. Switched to JS Worker engine.', 'warn');
        } else if (!silent) {
            logTerminal('→ C++ backend offline. Using JavaScript Web Worker engine.', 'info');
            logTerminal('  To use C++ engine, run <em>engine_server\\start.bat</em>', 'info');
        }
        return false;
    }
}

setInterval(() => {
    if (!isAutoPlay) detectCppBackend(true);
}, 4000);

async function cppSearch() {
    try {
        const resp = await fetch(`${cppBackendUrl}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen: game.fen(), depth: engine.depth })
        });
        const data = await resp.json();
        if (!isAutoPlay) {
            logConsoleCpp(data);
        }
        return data;
    } catch (err) {
        useCppBackend = false;
        logTerminal('⚠ C++ backend call failed. Falling back to local engine.', 'warn');
        if (engineWorker) return workerSearch();
        return engine.chooseBestMove(game, null, !isAutoPlay);
    }
}

// ── Search depth comes from the Calculation stat ───────────────────────────
const engine = new ChessEngine(jsEvalWeights(gameData.weights), depthFromSkill(gameData.skill));

function syncEngineFromSkill() {
    gameData.weights = weightsFromSkill(gameData.skill);
    engine.depth = offlineDepth(gameData.skill);
    engine.evaluator.weights = new Evaluator(jsEvalWeights(gameData.weights)).weights;
}

let lastReachedDepth = null;   // depth the C++ search actually finished on its last move (2 s limit)
function updateDynamicDepth() {
    engine.depth = offlineDepth(gameData.skill);
    const d = botDepth();
    const icons = { 1: '🐣', 2: '⚡', 3: '🧠', 4: '👑' };
    const reached = (lastReachedDepth && lastReachedDepth < d) ? ` · reached ${lastReachedDepth}` : '';
    $('#bot-depth-badge')
        .text(`Lvl ${d} (${d}-ply${reached}) ${icons[d] || '🚀'}`)
        .attr('title', `Calculation level ${skillLevel(gameData.skill, 'calculation').toFixed(1)} · aims for 1 ply + 1 per 5 levels; each move has 2 s, so deep searches stop at the deepest finished ply`)
        .css('background', d >= 4 ? '#b48ead' : d === 3 ? '#81b64c' : d === 2 ? '#5e81ac' : '#8a6d3b');
}

// ── Learning helpers ────────────────────────────────────────────────────────
// Copy the C++ engine's learning state into the page
function applyCppState(state) {
    if (Array.isArray(state.presets) && state.presets.length) {
        const changed = JSON.stringify(state.presets) !== JSON.stringify(SPARRING_PRESETS);
        SPARRING_PRESETS = state.presets;
        if (changed && !isAutoPlay) renderSparringOptions();
    }
    if (state.skill) gameData.skill = { ...state.skill };
    gameData.elo = state.elo;
    gameData.games = state.games;
    if (state.wins !== undefined) gameData.wins = state.wins;
    if (state.losses !== undefined) gameData.losses = state.losses;
    if (state.draws !== undefined) gameData.draws = state.draws;
    if (state.consecutiveLosses !== undefined) gameData.consecutiveLosses = state.consecutiveLosses;
    if (state.lastStep) gameData.lastStep = state.lastStep;
    gameData.search = { depth: state.depth, quiescence: state.quiescence, noise: state.noise };
    syncEngineFromSkill();
    learningSystem.save(gameData);
}

// Start position + all moves of the current game in UCI (what the C++ coach reviews)
function currentGameMoves(pgn = game.pgn()) {
    const out = {
        startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        finalFen: null,
        moves: []
    };
    try {
        const c = new Chess();
        if (!c.load_pgn(pgn)) return out;
        const hist = c.history({ verbose: true });
        out.finalFen = c.fen();
        while (c.undo()) {}
        out.startFen = c.fen();
        out.moves = hist.map(m => m.from + m.to + (m.promotion || ''));
    } catch (e) {}
    return out;
}

// Stats sorted by points gained (largest first)
function topGains(points, n = 3) {
    return Object.entries(points || {})
        .filter(([, v]) => v >= 0.05)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}
function gainsText(points, n = 3) {
    const g = topGains(points, n);
    return g.length ? g.map(([k, v]) => `+${v.toFixed(1)} ${STAT_LABELS[k] || k}`).join(', ') : 'no points';
}

let lastLearnedGameKey = null;
// A new or loaded game must always be learnable, even if it repeats an earlier game move for move
['reset', 'load', 'load_pgn', 'clear'].forEach(fn => {
    if (typeof game[fn] !== 'function') return;
    const original = game[fn].bind(game);
    game[fn] = function (...args) { lastLearnedGameKey = null; return original(...args); };
});

// Review and learn from a finished game exactly once. Uses the C++ engine when connected.
async function learnFromFinishedGame(result, oppElo, pgn) {
    const key = pgn;
    if (key === lastLearnedGameKey) return gameData.lastStep;
    lastLearnedGameKey = key;
    const reviewedGame = currentGameMoves(pgn);

    let step = null;
    if (useCppBackend) {
        if (!isAutoPlay) logTerminal('⟳ AdaptiveEngine is reviewing every move of the game…', 'info');
        try {
            const g = reviewedGame;
            const resp = await fetch(`${cppBackendUrl}/learn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ result, opp_elo: oppElo, engine_color: 'b', start_fen: g.startFen, moves: g.moves.join(' ') })
            });
            const state = await resp.json();
            if (state.skill) {
                applyCppState(state);
                step = state.lastStep || null;
                if (step) {
                    step.review = state.review || null;
                    gameData.history.unshift({
                        game: state.games,
                        result: step.result || result,
                        pgn,
                        eloChange: step.eloDelta,
                        eloAfter: state.elo,
                        depth: state.depth,
                        acpl: step.acpl,
                        accuracy: step.accuracy,
                        inaccuracies: step.inaccuracies,
                        mistakes: step.mistakes,
                        blunders: step.blunders,
                        points: step.points || {},
                        practice: step.practice,
                        notice: step.notice || ''
                    });
                    if (gameData.history.length > 200) gameData.history.pop();
                    learningSystem.save(gameData);
                }
            }
        } catch (e) {
            logTerminal('⚠ Could not reach the C++ engine to review this game.', 'warn');
        }
    }
    if (!step) {
        step = learningSystem.learn(result, gameData, oppElo, reviewedGame.finalFen || game.fen(), pgn);
    }

    syncEngineFromSkill();
    updateStatsUI();
    renderBrainLog();

    const col = result === 'win' ? '#81b64c' : result === 'loss' ? '#c95c5c' : '#ebcb8b';
    const sign = step.eloDelta >= 0 ? '+' : '';
    logTerminal(
        `<span style="color:${col};font-weight:bold;">■ Game ${gameData.games} [${result.toUpperCase()}] — Elo: ${Math.round(gameData.elo)} (${sign}${step.eloDelta.toFixed(1)}) Depth: Level ${botDepth()}</span>`,
        'eval'
    );
    if (step.notice) logTerminal(`  <span style="color:#d39afb;">[Review]</span> ${step.notice}`, 'info');
    return step;
}

// ── Engine Evolution card (after each game) ─────────────────────────────────
let evoToastTimeout = null;
function showEngineEvolutionToast(step) {
    if (!step) return;
    const $toast = $('#engine-evolution-card');
    $('#evo-game-num').text(`Game #${gameData.games}`);

    const sign = step.eloDelta >= 0 ? '+' : '';
    $('#evo-elo-change').text(`${sign}${step.eloDelta.toFixed(1)} Elo`)
        .css('color', step.eloDelta >= 0 ? '#81b64c' : '#c95c5c');
    $('#evo-elo-range').text(`(${step.eloBefore.toFixed(1)} → ${step.eloAfter.toFixed(1)})`);

    const res = (step.result || 'draw').toLowerCase();
    $('#evo-result-pill').removeClass('win loss draw').addClass(res)
        .text(res === 'win' ? 'BOT WON' : res === 'loss' ? 'BOT LOST' : 'DRAW');

    if (step.offline) {
        $('#evo-weights-detail').text(step.notice);
    } else {
        const reviewLine = `Accuracy ${Math.round(step.accuracy)}% · ACPL ${Math.round(step.acpl)} · ` +
            `${step.mistakes} mistake${step.mistakes === 1 ? '' : 's'} · ${step.blunders} blunder${step.blunders === 1 ? '' : 's'}`;
        const total = typeof step.pointsTotal === 'number' ? ` (${step.pointsTotal.toFixed(1)})` : '';
        $('#evo-weights-detail').html(`${reviewLine}<br><strong>${step.practice ? 'Practice points' : 'Stat points'}${total}:</strong> ${gainsText(step.points, 3)}`);
    }

    // Depth unlocked?
    const before = step.levelsBefore ? depthFromSkill(step.levelsBefore) : botDepth();
    const after = step.levelsAfter ? depthFromSkill(step.levelsAfter) : botDepth();
    if (after > before) {
        $('#evo-milestone-alert').show().css('color', '#81b64c')
            .text(`🎉 Calculation level ${step.levelsAfter.calculation.toFixed(1)}: now looks ${after} moves ahead!`);
    } else {
        $('#evo-milestone-alert').hide();
    }

    $toast.stop(true, true).fadeIn(250);
    if (evoToastTimeout) clearTimeout(evoToastTimeout);
    evoToastTimeout = setTimeout(() => $toast.fadeOut(400), 7000);
}

// ── Learning Evidence panel (only measured values) ──────────────────────────
function updateProofUI() {
    const elo = Math.round(gameData.elo);
    const depth = botDepth();
    const calc = skillLevel(gameData.skill, 'calculation');
    const nextAt = (Math.floor(calc / 5) + 1) * 5;

    $('#proof-depth-text').text(`Level ${depth} (${depth}-ply${calc >= 3 ? ' + captures' : ''})`);
    $('#proof-depth-sub').text(`Calculation ${calc.toFixed(1)} · ${depth + 1}-ply at ${nextAt}`);

    const ls = gameData.lastStep;
    if (ls && !ls.offline && ls.acpl !== undefined) {
        $('#proof-blunder-text').text(`${Math.round(ls.accuracy)}% (ACPL ${Math.round(ls.acpl)})`);
        $('#proof-blunder-sub').text(`${ls.inaccuracies} inacc. · ${ls.mistakes} mistakes · ${ls.blunders} blunders`);
        const g = topGains(ls.points, 1)[0];
        $('#proof-defense-text').text(g ? `+${g[1].toFixed(1)} ${STAT_LABELS[g[0]]}` : '—');
        $('#proof-defense-sub').text((ls.practice ? 'Clean game: practice points' : 'Where it lacked most') + ` · next game ${pointsForGame(gameData.games || 0).toFixed(1)} pts`);
    } else {
        $('#proof-blunder-text').text('—');
        $('#proof-blunder-sub').text(ls && ls.offline ? 'No review while offline' : 'Appears after the first game');
        $('#proof-defense-text').text('—');
        $('#proof-defense-sub').text(`${pointsForGame(gameData.games || 0).toFixed(1)} points next game`);
    }

    const avg = skillAverage(gameData.skill);
    $('#proof-decay-text').text(`${avg.toFixed(1)}`);
    $('#proof-decay-sub').text(avg >= SKILL_MASTER ? 'Past full knowledge (10) · no maximum' : `Full knowledge at ${SKILL_MASTER} · no maximum`);

    if (useCppBackend) {
        $('#proof-early-badge').text('Learning: C++ engine').css('background', 'rgba(129,182,76,0.2)').css('color', '#81b64c');
    } else {
        $('#proof-early-badge').text('C++ offline: learning paused').css('background', 'rgba(224,108,117,0.2)').css('color', '#e06c75');
    }

    const presetElo = k => (SPARRING_PRESETS.find(p => p.key === k) || {}).elo || Infinity;
    $('#badge-400').toggleClass('unlocked', elo >= presetElo('beginner'));
    $('#badge-520').toggleClass('unlocked', elo >= presetElo('novice'));
    $('#badge-750').toggleClass('unlocked', elo >= presetElo('club'));
    $('#badge-1100').toggleClass('unlocked', elo >= presetElo('expert'));

    const gain = elo - 400;
    $('#proof-comparison-gain').text(`${gain >= 0 ? '+' : ''}${gain} Elo`);
    $('#proof-comparison-current').text(`${elo} Elo | Level ${depth}`);
}

// ── Skill stats (open-ended levels) ────────────────────────────────────────
function renderSkills(containerId) {
    const $c = $(`#${containerId}`).empty();
    const pts = (gameData.lastStep && gameData.lastStep.points) || {};
    const top = Math.max(...STAT_KEYS.map(k => skillLevel(gameData.skill, k)));
    const scale = Math.max(50, Math.ceil(top / 10) * 10);       // full bar = 50 (grows if a stat passes 50)
    const markPct = (SKILL_MASTER / scale) * 100;
    STAT_KEYS.forEach(k => {
        const v = skillLevel(gameData.skill, k);
        const pct = Math.min(100, (v / scale) * 100);
        const gain = pts[k] >= 0.05 ? `<span class="skill-gain">+${pts[k].toFixed(1)}</span>` : '';
        const master = v >= SKILL_MASTER ? ' master' : '';
        const tip = k === 'calculation'
            ? `Calculation level ${v.toFixed(2)}: ${depthFromSkill(gameData.skill)}-ply search (1 ply + 1 per 5 levels)`
            : `${STAT_LABELS[k]} level ${v.toFixed(2)} → weight ${weightFromLevel(v).toFixed(2)} (10 = full knowledge = 1.00)`;
        $c.append(`
            <div class="weight-row${k === 'calculation' ? ' calc-row' : ''}" title="${tip}">
                <div class="weight-name">${STAT_LABELS[k]}</div>
                <div class="weight-bar-bg"><div class="weight-bar-fill${master}" style="width:${pct.toFixed(1)}%"></div>${k === 'calculation' ? '' : `<div class="weight-bar-mark" style="left:${markPct.toFixed(1)}%"></div>`}</div>
                <div class="weight-val">${v.toFixed(1)} ${gain}</div>
            </div>`);
    });
    const g = gameData.games || 0;
    $c.append(`<div class="skill-note">No maximum level · <strong>${pointsForGame(g).toFixed(1)} stat points next game</strong> (4 per game for the first 50 games, then fewer and fewer, never below 1) · mark = full knowledge (10) · bar scale 0–${scale} · Calculation: 1 ply + 1 per 5 levels</div>`);
}

function updateCharts() {
    const chrono = [...gameData.history].reverse();
    const labels = chrono.map(h => 'G' + h.game);
    trainChart.data.labels = labels;
    trainChart.data.datasets[0].data = chrono.map(h => Math.round(h.eloAfter));
    trainChart.data.datasets[1].data = chrono.map(h => (typeof h.acpl === 'number' ? Math.round(h.acpl) : null));
    trainChart.update();

    const elos = chrono.map(h => Math.round(h.eloAfter));
    miniEloChart.data.labels = labels.slice(-30);
    miniEloChart.data.datasets[0].data = elos.slice(-30);
    miniEloChart.update();
}

function updateStatsUI() {
    const elo = Math.round(gameData.elo);
    $('#stat-elo-play').text(elo);
    $('#engine-elo-tag').text(elo);
    $('#stat-games-play').text(gameData.games);
    $('#stat-wld-play').text(`${gameData.wins} / ${gameData.losses} / ${gameData.draws}`);
    $('#stat-wins-train').text(gameData.wins);
    $('#stat-losses-train').text(gameData.losses);
    $('#stat-draws-train').text(gameData.draws);
    $('#score-bot').text(gameData.wins);
    $('#score-you').text(gameData.losses);

    renderSkills('weights-display');
    renderSkills('weights-display-train');
    updateDynamicDepth();
    updateProofUI();
    updateCharts();
}

function renderBrainLog() {
    if (!gameData.history || !gameData.history.length) {
        $('#dev-logs-play').html('<div class="log-item">No games played yet. The bot starts as a beginner (all stats level 1).</div>');
        return;
    }
    const html = gameData.history.slice(0, 30).map(log => {
        const sign = log.eloChange >= 0 ? '+' : '';
        const col  = log.result === 'win' ? '#81b64c' : log.result === 'loss' ? '#c95c5c' : '#ebcb8b';
        const eloColor = log.eloChange >= 0 ? '#81b64c' : '#c95c5c';
        const what = log.offline || typeof log.acpl !== 'number'
            ? 'C++ offline: no review'
            : `Accuracy ${Math.round(log.accuracy)}% · ACPL ${Math.round(log.acpl)} · ${gainsText(log.points, 2)}`;
        return `<div class="log-item">
            <strong style="color:${col}">G${log.game} [${log.result.toUpperCase()}]</strong>
            <span style="float:right;color:${eloColor};font-weight:bold;">${sign}${log.eloChange.toFixed(0)} Elo</span><br>
            <span style="font-size:0.85em;color:var(--text-muted);">Elo ${Math.round(log.eloAfter)} | Lvl ${log.depth || 1} | ${what}</span>
        </div>`;
    }).join('');
    $('#dev-logs-play').html(html);
}

// ── Tab Navigation ──────────────────────────────────────────────────────────
window.switchMainTab = function (tab) {
    $('.nav-link').removeClass('active');
    $('#nav-' + tab).addClass('active');

    $('#left-play-view, #left-analysis-view, #left-train-view, #left-saved-view').hide();
    $('#right-play-view, #right-analysis-view, #right-train-view, #right-saved-view').hide();
    clearBoardArrows();

    if (tab === 'play') {
        $('#left-panel-title').html('<i class="fas fa-chess"></i> Active Game');
        $('#left-play-view, #right-play-view').show();
    } else if (tab === 'analysis') {
        $('#left-panel-title').html('<i class="fas fa-chart-bar"></i> Analysis Studio');
        $('#left-analysis-view').css('display', 'flex');
        $('#right-analysis-view').css('display', 'flex');
        renderAnalysisGameList();
        scheduleAnalysis(20);
    } else if (tab === 'train') {
        $('#left-panel-title').html('<i class="fas fa-dumbbell"></i> Auto-Training');
        $('#left-train-view, #right-train-view').show();
    } else if (tab === 'saved') {
        $('#left-panel-title').html('<i class="fas fa-save"></i> Saved Games');
        $('#left-saved-view').show();
        $('#right-saved-view').css('display', 'flex');
        renderSavedGamesTab();
    }
    if (board) setTimeout(() => board.resize(), 50);
};

window.toggleAnalysisGameList = function () {
    const $l = $('#analysis-game-list'), $c = $('#game-list-chevron');
    if ($l.is(':visible')) {
        $l.hide(); $c.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
        $l.show(); $c.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }
};

// ── Saved Games Management ─────────────────────────────────────────────────
$('#save-game-btn').on('click', () => {
    if (!game.history().length) {
        alert("Cannot save an empty game. Make some moves first!");
        return;
    }
    $('#save-modal').css('display', 'flex');
});

window.confirmSaveGame = function () {
    const name = $('#save-game-name').val().trim() || `Game ${new Date().toLocaleDateString()}`;
    savedGames.push({ id: Date.now(), name, pgn: game.pgn(), fen: game.fen(), date: new Date().toISOString() });
    localStorage.setItem('omegaChessSavedGames', JSON.stringify(savedGames));
    closeSaveModal();
    logTerminal(`✓ Game saved: "${name}"`, 'info');
};

window.closeSaveModal = function () {
    $('#save-modal').hide();
    $('#save-game-name').val('');
};

function renderSavedGamesTab() {
    const $list = $('#saved-games-list').empty();
    if (!savedGames.length) {
        $list.html('<div style="padding:15px;color:var(--text-muted);text-align:center;">No saved games yet.</div>');
        return;
    }
    savedGames.forEach(g => {
        const d = new Date(g.date).toLocaleString();
        $list.append(`
            <div class="game-row ${selectedSavedGameId === g.id ? 'active' : ''}" onclick="selectSavedGame(${g.id})">
                <i class="fas fa-chess-board" style="color:var(--accent);"></i>
                <div style="flex:1;">
                    <div style="font-weight:bold;">${g.name}</div>
                    <div style="font-size:10px;color:var(--text-muted);">${d}</div>
                </div>
            </div>`);
    });
}

window.selectSavedGame = function (id) {
    selectedSavedGameId = id;
    renderSavedGamesTab();
    const g = savedGames.find(x => x.id === id);
    if (!g) return;
    $('#saved-game-info').html(`<strong style="color:var(--text-main);">${g.name}</strong><br>Saved: ${new Date(g.date).toLocaleString()}<br><br><em style="font-size:10px;color:var(--text-muted);">${g.fen}</em>`);
    const moves = g.pgn.split(' ').map(t => t.match(/^\d+\./) ? `<span class="move-row-num">${t}</span>` : t ? `<span class="move-cell">${t}</span>` : '').join(' ');
    $('#saved-game-moves').html(`<div style="display:grid;grid-template-columns:36px 1fr 1fr;gap:4px;">${moves}</div>`);
};

window.loadSelectedSavedGame = function () {
    const g = savedGames.find(x => x.id === selectedSavedGameId);
    if (!g) return;
    try { game.load_pgn(g.pgn); } catch { game.load(g.fen); }
    clearRedoHistory();
    board.position(game.fen());
    updateStatus();
    switchMainTab('play');
};

window.deleteSelectedSavedGame = function () {
    if (!selectedSavedGameId || !confirm('Delete this saved game?')) return;
    savedGames = savedGames.filter(x => x.id !== selectedSavedGameId);
    localStorage.setItem('omegaChessSavedGames', JSON.stringify(savedGames));
    selectedSavedGameId = null;
    renderSavedGamesTab();
    $('#saved-game-info').html('Select a saved game from the left panel.');
    $('#saved-game-moves').empty();
};

window.clearAllSavedGames = function () {
    if (!confirm('Delete ALL saved games?')) return;
    savedGames = [];
    localStorage.setItem('omegaChessSavedGames', JSON.stringify(savedGames));
    selectedSavedGameId = null;
    renderSavedGamesTab();
};

// ── Board SVG Arrows ─────────────────────────────────────────────────────────
function clearBoardArrows() {
    $('#board-arrows-svg').empty();
}

function clearReviewBoardArrows() {
    $('#review-board-arrows-svg').empty();
}

function squareToCoords(sq, orientationBoard = board) {
    if (!sq || sq.length < 2) return null;
    const isFlipped = orientationBoard && orientationBoard.orientation && orientationBoard.orientation() === 'black';
    let col = sq.charCodeAt(0) - 97;
    let row = 8 - parseInt(sq[1]);
    if (isFlipped) { col = 7 - col; row = 7 - row; }
    const sqSize = 480 / 8;
    return {
        x: col * sqSize + sqSize / 2,
        y: row * sqSize + sqSize / 2
    };
}

function drawBoardArrow(fromSq, toSq, color, id, opacity = 0.88, svgId = 'board-arrows-svg', orientationBoard = board) {
    const from = squareToCoords(fromSq, orientationBoard);
    const to   = squareToCoords(toSq, orientationBoard);
    if (!from || !to) return;

    const svg = document.getElementById(svgId);
    if (!svg) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    const dist = Math.sqrt(dx * dx + dy * dy);

    const endDist = Math.max(0, dist - 18);
    const ex = from.x + Math.cos(angle) * endDist;
    const ey = from.y + Math.sin(angle) * endDist;

    const headLen = 16;
    const headAngle = Math.PI / 6;
    const x1 = to.x - headLen * Math.cos(angle - headAngle);
    const y1 = to.y - headLen * Math.sin(angle - headAngle);
    const x2 = to.x - headLen * Math.cos(angle + headAngle);
    const y2 = to.y - headLen * Math.sin(angle + headAngle);

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('id', id);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', ex);
    line.setAttribute('y2', ey);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '8');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', opacity);

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', `${to.x},${to.y} ${x1},${y1} ${x2},${y2}`);
    poly.setAttribute('fill', color);
    poly.setAttribute('opacity', opacity);

    group.appendChild(line);
    group.appendChild(poly);
    svg.appendChild(group);
}

// ── Move Evaluation Ups & Downs Bar ─────────────────────────────────────────
function pushEvalToChart(evalCp, moveLabel) {
    const val = parseFloat(Math.max(-8, Math.min(8, evalCp / 100)).toFixed(2));
    evalHistoryChart.data.labels.push(moveLabel);
    evalHistoryChart.data.datasets[0].data.push(val);

    if (evalHistoryChart.data.labels.length > 70) {
        evalHistoryChart.data.labels.shift();
        evalHistoryChart.data.datasets[0].data.shift();
    }
    evalHistoryChart.update();

    const sign = val >= 0 ? '+' : '';
    $('#eval-chart-stat').text(`${sign}${val.toFixed(2)}`).css('color', val > 0.5 ? '#81b64c' : val < -0.5 ? '#c95c5c' : '#ebcb8b');
}

function resetEvalChart() {
    evalHistoryChart.data.labels = ['Start'];
    evalHistoryChart.data.datasets[0].data = [0];
    evalHistoryChart.update();
    $('#eval-chart-stat').text('+0.00').css('color', '#9c9a9e');
}

// ── Real-Time Analysis Studio ───────────────────────────────────────────────
function scheduleAnalysis(delay = 100) {
    if (analysisTimeout) clearTimeout(analysisTimeout);
    analysisTimeout = setTimeout(analyzeCurrentPosition, delay);
}

async function analyzeCurrentPosition() {
    if (isAutoPlay || !$('#right-analysis-view').is(':visible')) {
        clearBoardArrows();
        return;
    }

    let res = null;

    if (useCppBackend) {
        try {
            const resp = await fetch(`${cppBackendUrl}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fen: game.fen() })
            });
            const data = await resp.json();
            if (data.status === 'ok') {
                res = {
                    engineEvalCp: data.engineEvalCp,
                    winProb:      data.winProb,
                    numBest:      data.numBest,
                    numInaccuracies: data.numMeh || 0,
                    numMistakes:  0,
                    numBlunders:  data.numBlunders,
                    total:        data.total,
                    moves: data.moves.map(m => ({
                        san: m.san,
                        from: m.uci.substr(0, 2),
                        to:   m.uci.substr(2, 2),
                        playerScore: m.score,
                        sfLoss: m.sfLoss,
                        humanProb: m.humanProb,
                        category: m.category,
                        evalLoss: Math.abs(m.sfLoss) * 100
                    }))
                };
                res.top4 = res.moves.slice(0, 4);
                res.bestHumanMove = res.moves.reduce((a, b) => (b.humanProb > a.humanProb ? b : a), res.moves[0]);
            }
        } catch {}
    }

    if (!res) {
        res = analyzer.analyzePosition(game);
    }

    if (!res || !res.moves.length) {
        $('#an-summary').html('<span style="color:var(--text-muted);">Game concluded or no legal moves available.</span>');
        clearBoardArrows();
        return;
    }

    renderRealTimeAnalysis(res);
}

function renderRealTimeAnalysis(res) {
    const isWhite = game.turn() === 'w';
    const evalCp = res.engineEvalCp;
    const winPct = res.winProb;

    // 1. Dynamic Win Rate Bar
    const whiteWin = Math.max(3, Math.min(97, winPct));
    const blackWin = 100 - whiteWin;
    $('#an-white-bar').css('width', whiteWin + '%');
    $('#an-black-bar').css('width', blackWin + '%');
    $('#an-white-pct').text(`White ${whiteWin.toFixed(0)}%`);
    $('#an-black-pct').text(`Black ${blackWin.toFixed(0)}%`);

    const evSign = evalCp >= 0 ? '+' : '';
    const evFormatted = evSign + (evalCp / 100).toFixed(2);
    $('#an-eval-num').text(evFormatted).css('color', evalCp > 50 ? '#81b64c' : evalCp < -50 ? '#c95c5c' : '#ebcb8b');

    // 2. Tactical Threat Radar
    const threats = [];
    const legalMoves = res.moves;
    const checkMoves = legalMoves.filter(m => m.isCheck || m.san.includes('+'));
    const captureMoves = legalMoves.filter(m => m.isCapture || m.san.includes('x'));

    if (checkMoves.length > 0) {
        threats.push(`<span class="threat-chip check"><i class="fas fa-bolt"></i> ${checkMoves.length} Check${checkMoves.length > 1 ? 's' : ''} (${checkMoves.slice(0,2).map(m=>m.san).join(', ')})</span>`);
    }
    if (captureMoves.length > 0) {
        threats.push(`<span class="threat-chip capture"><i class="fas fa-crosshairs"></i> ${captureMoves.length} Capture${captureMoves.length > 1 ? 's' : ''} available</span>`);
    }
    if (res.top4[0] && res.top4[0].evalLoss === 0 && res.top4[0].playerScore > 200) {
        threats.push(`<span class="threat-chip win"><i class="fas fa-star"></i> Strong Advantage (${res.top4[0].san})</span>`);
    }
    if (res.numBlunders > 0) {
        threats.push(`<span class="threat-chip blunder"><i class="fas fa-exclamation-triangle"></i> ${res.numBlunders} Blunder Trap${res.numBlunders > 1 ? 's' : ''}</span>`);
    }
    if (!threats.length) {
        threats.push(`<span class="threat-chip safe"><i class="fas fa-shield-alt"></i> Symmetrical & Balanced</span>`);
    }
    $('#an-threat-radar').html(threats.join(' '));

    // Summary description
    const turnStr = isWhite ? 'White' : 'Black';
    $('#an-summary').html(`
        <strong style="color:var(--text-main);">${turnStr} to move.</strong> Position evaluation: <span style="color:#81b64c;font-weight:bold;">${evFormatted}</span>.
        Threat radar and move quality summary are based on the current position.
    `);

    // 4. Move Quality Bars
    const tot = res.total || 1;
    const setBar = (id, count) => {
        $(`#${id}`).css('width', (count / tot * 100) + '%');
        $(`#${id}-label`).text(count);
    };
    setBar('cat-best-bar', res.numBest || 0);
    setBar('cat-inaccuracy-bar', res.numInaccuracies || 0);
    setBar('cat-mistake-bar', res.numMistakes || 0);
    setBar('cat-blunder-bar', res.numBlunders || 0);

    // Live analysis presents its guidance in the threat and evaluation panels.
    clearBoardArrows();
}

function renderAnalysisGameList() {
    const $l = $('#analysis-game-list').empty();
    if (!gameData.history.length) {
        $l.html('<div style="padding:10px;color:var(--text-muted);">No history yet.</div>');
        return;
    }
    gameData.history.slice(0, 25).forEach(g => {
        const col = g.result === 'win' ? '#81b64c' : g.result === 'loss' ? '#c95c5c' : '#ebcb8b';
        const res = g.result === 'win' ? '1-0' : g.result === 'loss' ? '0-1' : '½-½';
        const eloStr = g.eloChange >= 0 ? `+${g.eloChange.toFixed(0)}` : g.eloChange.toFixed(0);
        $l.append(`<div class="game-row" onclick="viewReplay('${g.fen}', ${g.game})">
            <span style="color:var(--text-muted);width:24px;">${g.game}</span>
            <span style="flex:1;">Game ${g.game}</span>
            <span style="color:${col};font-weight:bold;">${res}</span>
            <span style="color:${g.eloChange>=0?'#81b64c':'#c95c5c'};font-size:10px;margin-left:4px;">${eloStr}</span>
        </div>`);
    });
}

window.loadPGNorFEN = function () {
    const txt = $('#pgn-input').val().trim();
    if (!txt) return;
    const ok = txt.includes('/') ? game.load(txt) : game.load_pgn(txt);
    if (!ok) { alert('Invalid PGN or FEN string.'); return; }
    clearRedoHistory();
    board.position(game.fen());
    scheduleAnalysis(10);
};

window.viewReplay = function (fen, num) {
    if (!fen || fen === 'null') return;
    $('#replay-overlay').css('display', 'flex');
    $('#replay-title').text('End position of Game ' + num);
    board.position(fen, false);
};
$('#close-replay-btn').on('click', () => {
    $('#replay-overlay').hide();
    board.position(game.fen(), false);
});

// ── Chess.com Style Post-Game Review ────────────────────────────────────────
let reviewData = null;
let reviewCurrentIdx = -1;
let reviewRequestId = 0;

async function showGameReview(pgn, review = null) {
    if (!pgn) return;
    const requestId = ++reviewRequestId;
    let result = review;
    if (!result && useCppBackend) {
        logTerminal('⟳ Coach is reviewing the game…', 'info');
        try {
            const g = currentGameMoves(pgn);
            const resp = await fetch(`${cppBackendUrl}/review`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start_fen: g.startFen, moves: g.moves.join(' ') })
            });
            result = (await resp.json()).review || null;
        } catch (e) { result = null; }
    }
    if (!result) {
        logTerminal('⟳ Quick review (browser engine)…', 'info');
        result = analyzer.analyzeGame(pgn);
    }
    if (requestId !== reviewRequestId || !result || !result.moves || !result.moves.length) return;

    const reviewedGame = new Chess();
    try { reviewedGame.load_pgn(pgn); } catch (e) {}

    reviewData = result;
    const moves = result.moves;

    // Accuracy Scores: You (White) vs AdaptiveEngine (Black)
    $('#rv-white-accuracy').text(result.whiteAccuracy + '%');
    $('#rv-black-accuracy').text(result.blackAccuracy + '%');
    $('#rv-white-perf').text(`Perf: ${result.whitePerf ?? '—'}`);
    $('#rv-black-perf').text(`Perf: ${result.blackPerf ?? '—'}`);
    if (typeof result.whiteAcpl === 'number') {
        $('#rv-white-acpl').text(`ACPL: ${Math.round(result.whiteAcpl)}`);
        $('#rv-black-acpl').text(`ACPL: ${Math.round(result.blackAcpl)}`);
    } else {
        $('#rv-white-acpl').text('Quick review');
        $('#rv-black-acpl').text('Quick review');
    }

    // Counts for White (You) and Black (AdaptiveEngine)
    const count = (color, cat) => moves.filter(m => m.color === color && m.classification === cat).length;

    $('#rv-you-brilliant').text(count('w', 'brilliant'));
    $('#rv-bot-brilliant').text(count('b', 'brilliant'));
    $('#rv-you-best').text(count('w', 'best'));
    $('#rv-bot-best').text(count('b', 'best'));
    $('#rv-you-good').text(count('w', 'good'));
    $('#rv-bot-good').text(count('b', 'good'));
    $('#rv-you-inaccuracies').text(count('w', 'inaccuracy'));
    $('#rv-bot-inaccuracies').text(count('b', 'inaccuracy'));
    $('#rv-you-mistakes').text(count('w', 'mistake'));
    $('#rv-bot-mistakes').text(count('b', 'mistake'));
    $('#rv-you-missed').text(count('w', 'missed_win'));
    $('#rv-bot-missed').text(count('b', 'missed_win'));
    $('#rv-you-blunders').text(count('w', 'blunder'));
    $('#rv-bot-blunders').text(count('b', 'blunder'));

    // Key Moments / Decisive Swings
    let kmHtml = '';
    if (result.keyMoments && result.keyMoments.length) {
        result.keyMoments.forEach(km => {
            const icon = km.classification === 'blunder' ? '❌' : km.classification === 'missed_win' ? '⚡' : '💎';
            const col = km.color === 'w' ? 'W' : 'B';
            kmHtml += `
                <div class="rv-km-chip ${km.classification}" onclick="jumpToReviewMove(${km.moveIndex})" title="Move ${km.moveNum} (${col}: ${km.san}) — Loss ${km.evalLoss}cp. Recommended: ${km.bestMoveSan}">
                    <span>${icon} ${km.moveNum}.${col} ${km.san}</span>
                    <span style="opacity:0.75;font-size:9px;">(-${(km.evalLoss/100).toFixed(1)})</span>
                </div>`;
        });
    } else {
        kmHtml = '<span style="font-size:10px;color:var(--text-muted);padding:2px 4px;">Balanced game without major blunders.</span>';
    }
    $('#rv-key-moments').html(kmHtml);

    // Outcome Title & Banner
    if (reviewedGame.in_checkmate()) {
        const loser = reviewedGame.turn();
        if (loser === 'b') {
            $('#rv-outcome-title').text('🏆 VICTORY!').css('color', '#81b64c');
            $('#rv-outcome-desc').text('You checkmated AdaptiveEngine in ' + Math.ceil(moves.length / 2) + ' moves.');
        } else {
            $('#rv-outcome-title').text('DEFEAT — AdaptiveEngine Won').css('color', '#c95c5c');
            $('#rv-outcome-desc').text('AdaptiveEngine checkmated you in ' + Math.ceil(moves.length / 2) + ' moves.');
        }
    } else {
        $('#rv-outcome-title').text('½ DRAW').css('color', '#ebcb8b');
        $('#rv-outcome-desc').text('Game ended in a draw (' + (reviewedGame.in_stalemate() ? 'Stalemate' : 'Draw rule') + ').');
    }

    // Ups & Downs Timeline Chart in Modal
    const evalLabels = moves.map(m => (m.color === 'w' ? `${m.moveNum}.` : `${m.moveNum}...`));
    const evalValues = moves.map(m => Math.max(-8, Math.min(8, m.evalCp / 100)));

    reviewEvalChart.data.labels = evalLabels;
    reviewEvalChart.data.datasets[0].data = evalValues;
    reviewEvalChart.update();
    $('#rv-chart-move-count').text(moves.length + ' half-moves');

    // Chart click to jump directly to move
    $('#reviewEvalChart').off('click').on('click', function(evt) {
        if (!reviewData || !reviewData.moves || !reviewData.moves.length) return;
        const elements = reviewEvalChart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
        if (elements && elements.length) {
            jumpToReviewMove(elements[0].index);
        }
    });

    // Keyboard navigation for review
    $(document).off('keydown.review').on('keydown.review', function(e) {
        if ($('#game-review-overlay').is(':visible')) {
            if (e.key === 'ArrowLeft') { e.preventDefault(); reviewNavPrev(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); reviewNavNext(); }
            else if (e.key === ' ') { e.preventDefault(); toggleReviewAutoPlay(); }
            else if (e.key === 'Escape') { e.preventDefault(); closeGameReview(); }
        }
    });

    // Build Move Chips
    const iconMap = {
        'brilliant': { symbol: '💎', cls: 'brilliant', text: 'Brilliant' },
        'best':      { symbol: '★',  cls: 'best',      text: 'Best Move' },
        'good':      { symbol: '✓',  cls: 'good',      text: 'Excellent' },
        'book':      { symbol: '📖', cls: 'book',      text: 'Book' },
        'inaccuracy':{ symbol: '❓', cls: 'inaccuracy',text: 'Inaccuracy' },
        'mistake':   { symbol: '⚠️', cls: 'mistake',   text: 'Mistake' },
        'missed_win':{ symbol: '⚡', cls: 'missed',    text: 'Missed Win' },
        'blunder':   { symbol: '❌', cls: 'blunder',   text: 'Blunder' }
    };

    let chipsHtml = '';
    moves.forEach((m, idx) => {
        const meta = iconMap[m.classification] || iconMap['good'];
        const prefix = m.color === 'w' ? `${m.moveNum}.` : '';
        chipsHtml += `
            <span class="rv-chip ${meta.cls}" data-idx="${idx}" onclick="jumpToReviewMove(${idx})" title="${meta.text}: loss ${m.evalLoss}cp">
                ${prefix}${m.san} ${meta.symbol}
            </span>`;
    });
    $('#rv-moves-list').html(chipsHtml);

    $('#game-review-overlay').css('display', 'flex').hide().fadeIn(250, () => {
        if (requestId === reviewRequestId && reviewBoard) reviewBoard.resize();
    });
    jumpToReviewMove(moves.length - 1);
}

window.jumpToReviewMove = function (idx) {
    if (!reviewData || idx < 0 || idx >= reviewData.moves.length) return;
    reviewCurrentIdx = idx;
    const m = reviewData.moves[idx];

    // Replay on the board inside the review page; leave the live game board intact.
    if (reviewBoard) reviewBoard.position(m.fen, false);
    $('#rv-board-move-caption').text(`${m.moveNum}${m.color === 'b' ? '…' : '.'} ${m.san} · ${m.classification.replace('_', ' ')}`);

    const iconMap = {
        'brilliant': { symbol: '💎 Brilliant Move', color: '#26c2a3' },
        'best':      { symbol: '★ Best Move', color: '#81b64c' },
        'good':      { symbol: '✓ Excellent', color: '#5e81ac' },
        'book':      { symbol: '📖 Book Move', color: '#888888' },
        'inaccuracy':{ symbol: '❓ Inaccuracy', color: '#ebcb8b' },
        'mistake':   { symbol: '⚠️ Mistake', color: '#d08770' },
        'missed_win':{ symbol: '⚡ Missed Win', color: '#ff6b6b' },
        'blunder':   { symbol: '❌ Blunder', color: '#c95c5c' }
    };
    const meta = iconMap[m.classification] || iconMap['good'];
    const side = m.color === 'w' ? 'You (White)' : 'AdaptiveEngine (Black)';
    const evStr = (m.evalCp >= 0 ? '+' : '') + (m.evalCp / 100).toFixed(2);

    let advice = '';
    if (m.classification === 'blunder' || m.classification === 'mistake' || m.classification === 'missed_win') {
        advice = `
            <div style="margin-top:3px;font-size:11px;color:#d8dee9;">
                <span style="color:#c95c5c;font-weight:bold;">❌ Played: ${m.san}</span> (Lost ${(m.evalLoss / 100).toFixed(2)} pawns).
                <span style="color:#81b64c;font-weight:bold;margin-left:6px;">★ Recommended: ${m.bestMoveSan}</span>
            </div>`;
    } else if (m.classification === 'brilliant') {
        advice = `<div style="margin-top:3px;font-size:11px;color:#26c2a3;font-weight:bold;">💎 Brilliant sacrifice turning the evaluation!</div>`;
    } else if (m.classification === 'best') {
        advice = `<div style="margin-top:3px;font-size:11px;color:#81b64c;">★ Found the optimal engine move! (Eval: <strong>${evStr}</strong>)</div>`;
    } else {
        advice = `<div style="margin-top:3px;font-size:11px;color:#a0a0a0;">Position advantage: <strong>${evStr}</strong>.</div>`;
    }

    $('#rv-move-detail').html(`
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
                <strong style="color:${meta.color};font-size:13px;">${meta.symbol}</strong>
                <span style="font-weight:bold;margin-left:6px;font-family:monospace;font-size:14px;">${m.san}</span>
            </div>
            <span style="font-size:10px;color:var(--text-muted);">${side} — Move ${m.moveNum}</span>
        </div>
        ${advice}
    `);

    $('.rv-chip').removeClass('active');
    const $activeChip = $(`.rv-chip[data-idx="${idx}"]`).addClass('active');
    if ($activeChip.length) $activeChip[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });

    // Draw Dual Board Arrows:
    clearReviewBoardArrows();
    // 1. Arrow for played move
    if (m.from && m.to) {
        drawBoardArrow(m.from, m.to, meta.color, 'rv-move-arrow', 0.95, 'review-board-arrows-svg', reviewBoard);
    }
    // 2. If it was a blunder/mistake, also draw green arrow for best move!
    if ((m.classification === 'blunder' || m.classification === 'mistake' || m.classification === 'missed_win') &&
        m.bestMoveFrom && m.bestMoveTo && (m.bestMoveFrom !== m.from || m.bestMoveTo !== m.to)) {
        drawBoardArrow(m.bestMoveFrom, m.bestMoveTo, '#81b64c', 'rv-best-arrow', 0.88, 'review-board-arrows-svg', reviewBoard);
    }
};

let reviewPlayInterval = null;
window.toggleReviewAutoPlay = function () {
    if (reviewPlayInterval) {
        clearInterval(reviewPlayInterval);
        reviewPlayInterval = null;
        $('#rv-autoplay-btn').html('<i class="fas fa-play"></i> Auto Walkthrough');
    } else {
        // The review opens on the final position. Starting the walkthrough
        // there would stop immediately, so restart at the first reviewed move.
        if (reviewData && reviewCurrentIdx >= reviewData.moves.length - 1) {
            jumpToReviewMove(0);
        }
        $('#rv-autoplay-btn').html('<i class="fas fa-pause"></i> Pause');
        reviewPlayInterval = setInterval(() => {
            if (!reviewData || reviewCurrentIdx >= reviewData.moves.length - 1) {
                clearInterval(reviewPlayInterval);
                reviewPlayInterval = null;
                $('#rv-autoplay-btn').html('<i class="fas fa-play"></i> Auto Walkthrough');
                return;
            }
            jumpToReviewMove(reviewCurrentIdx + 1);
        }, 1300);
    }
};

window.reviewNavPrev = function () {
    if (reviewCurrentIdx > 0) jumpToReviewMove(reviewCurrentIdx - 1);
};
window.reviewNavNext = function () {
    if (reviewData && reviewCurrentIdx < reviewData.moves.length - 1) jumpToReviewMove(reviewCurrentIdx + 1);
};
window.closeGameReview = function () {
    reviewRequestId++;
    if (reviewPlayInterval) { clearInterval(reviewPlayInterval); reviewPlayInterval = null; }
    $('#rv-autoplay-btn').html('<i class="fas fa-play"></i> Auto Walkthrough');
    $('#game-review-overlay').fadeOut(200);
    board.position(game.fen(), false);
    clearReviewBoardArrows();
};
window.startNewGameFromReview = function () {
    if (reviewPlayInterval) { clearInterval(reviewPlayInterval); reviewPlayInterval = null; }
    closeGameReview();
    $('#new-game-btn').click();
};

// ── Upgraded Omega Engine Console ───────────────────────────────────────────
function logTerminal(msg, type = '') {
    const $o = $('#terminal-output');
    const ts = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $o.append(`<div class="term-line ${type}"><span class="term-ts">[${ts}]</span> ${msg}</div>`);
    const kids = $o.children();
    if (kids.length > 350) kids.first().remove();
    $o[0].scrollTop = $o[0].scrollHeight;
}

function logConsoleProgress(d) {
    if (!d || isAutoPlay) return;
    const ev = (d.score / 100);
    const evStr = (ev >= 0 ? '+' : '') + ev.toFixed(2);
    const evCol = ev > 0.5 ? '#81b64c' : ev < -0.5 ? '#c95c5c' : '#ebcb8b';
    const nps = d.nps ? ` ${(d.nps / 1000).toFixed(1)}k nps` : '';
    const cutPct = d.nodes > 0 ? ` (${((d.cutoffs / d.nodes) * 100).toFixed(0)}% cuts)` : '';

    logTerminal(
        `<span class="term-badge search">SEARCH</span> ` +
        `<span style="color:#888;">D${d.depth}</span> ` +
        `<span style="color:var(--accent-hover);font-weight:bold;">${d.bestMove}</span> ` +
        `<span style="color:${evCol};font-weight:bold;">${evStr}</span> ` +
        `<span style="color:#666;">${d.nodes}n${cutPct}${nps} [${d.timeMs}ms]</span>`,
        'eval'
    );
}

function logConsoleCpp(d) {
    if (isAutoPlay) return;
    const ev = (d.score / 100);
    const isMate = Math.abs(d.score) >= 90000;
    const mateIn = isMate ? Math.ceil((99000 - Math.abs(d.score)) / 2) : 0;
    const evStr = isMate ? `${d.score > 0 ? '+' : '-'}M${mateIn}` : (ev >= 0 ? '+' : '') + ev.toFixed(2);
    const evCol = ev > 0.5 ? '#81b64c' : ev < -0.5 ? '#c95c5c' : '#ebcb8b';
    const npsStr = d.nps ? `${(d.nps / 1000).toFixed(1)}k nps` : '';
    const pvStr = (d.pv && d.pv.length) ? d.pv.slice(0, 5).join(' ') : d.san || d.move;

    logTerminal(
        `<span class="term-badge cpp">C++</span> ` +
        `<span style="color:#888;">D${d.depth}</span> ` +
        `<strong style="color:var(--accent-hover);">▶ ${d.san || d.move}</strong> ` +
        `<span style="color:${evCol};font-weight:bold;">${evStr}</span> ` +
        `<span style="color:#888;">${d.nodes || 0}n ${npsStr} (${d.time_ms || 0}ms)</span>`,
        'eval'
    );

    if (pvStr) {
        logTerminal(`  <span style="color:#555;">PV:</span> <span class="term-line pv">${pvStr}</span>`);
    }

    if (d.breakdown) {
        const b = d.breakdown;
        logTerminal(
            `  <span style="color:#555;">Breakdown:</span> ` +
            `<span style="color:#777;">mat:<span style="color:#81b64c;">${b.material}</span>` +
            ` cen:${b.center} pst:${b.pst} mob:${b.mobility}` +
            ` ks:<span style="color:#5e81ac;">${b.kingSafety}</span></span>`,
            'info'
        );
    }
}

function logConsoleFinal(d) {
    if (!d || isAutoPlay) return;
    if (d.isBook) {
        logTerminal(
            `<span class="term-badge cpp" style="background:#5e81ac;color:#fff;">BOOK</span> ` +
            `<strong style="color:var(--accent-hover);">▶ ${d.san || d.move}</strong> ` +
            `<span style="color:#81b64c;font-weight:bold;">(Master Opening Line)</span> ` +
            `<span style="color:#666;">[5ms]</span>`,
            'move'
        );
        return;
    }
    const ev = (d.score / 100);
    const evStr = (ev >= 0 ? '+' : '') + ev.toFixed(2);
    const evCol = ev > 0.5 ? '#81b64c' : ev < -0.5 ? '#c95c5c' : '#ebcb8b';
    const cutRate = d.nodes > 0 ? `${((d.cutoffs / d.nodes) * 100).toFixed(0)}%` : 'N/A';
    const npsStr = d.nps ? `${(d.nps / 1000).toFixed(1)}k nps` : '';

    logTerminal(
        `<span class="term-badge move">MOVE</span> ` +
        `<strong style="color:var(--accent-hover);">▶ ${d.san || d.move}</strong> ` +
        `<span style="color:${evCol};font-weight:bold;">(${evStr})</span> ` +
        `<span style="color:#666;">D${d.depth || engine.depth} ${d.nodes || 0}n ${npsStr} cuts:${cutRate} [${d.timeMs || d.time_ms || 0}ms]</span>`,
        'move'
    );

    if (d.pv && d.pv.length > 1) {
        logTerminal(`  <span style="color:#555;">Continuation:</span> <span style="color:#88c0d0;">${d.pv.slice(1, 5).join(' ')}</span>`);
    }

    if (d.breakdown) {
        const b = d.breakdown;
        logTerminal(
            `  <span style="color:#666;">Eval Breakdown:</span> ` +
            `<span style="color:#81b64c;">Mat:${b.material||0}</span> ` +
            `<span style="color:#5e81ac;">KS:${b.kingSafety||0}</span> ` +
            `<span style="color:#d39afb;">PS:${b.pawnStructure||0}</span> ` +
            `<span style="color:#ebcb8b;">Cen:${b.center||0}</span> ` +
            `<span style="color:#88c0d0;">Coord:${b.coordination||0}</span>`,
            'info'
        );
    }
}

window.toggleTerminal = function (show) {
    if (show) { $('#engine-terminal').show(); $('#terminal-fab').hide(); }
    else       { $('#engine-terminal').hide(); $('#terminal-fab').show(); }
    try { localStorage.setItem('omegaConsoleOpen', show ? '1' : '0'); } catch (e) {}
};
// The console floats over the right-hand panels: start minimised unless the user opened it last time
try { toggleTerminal(localStorage.getItem('omegaConsoleOpen') === '1'); } catch (e) { toggleTerminal(false); }

$('#terminal-header').on('dblclick', () => {
    $('#terminal-output').empty();
    logTerminal('Console cleared.', 'info');
});

// Terminal dragging
let termDrag = false, tox = 0, toy = 0;
$('#terminal-header').on('mousedown', e => {
    if ($(e.target).closest('span, i').length) return;
    termDrag = true;
    tox = e.clientX - $('#engine-terminal').offset().left;
    toy = e.clientY - $('#engine-terminal').offset().top;
});
$(document)
    .on('mousemove', e => {
        if (termDrag) {
            $('#engine-terminal').css({
                left: e.clientX - tox,
                top: e.clientY - toy,
                bottom: 'auto',
                right: 'auto'
            });
        }
    })
    .on('mouseup', () => { termDrag = false; });

// ── Speed Slider ────────────────────────────────────────────────────────────
$('#speed-slider').on('input', function () {
    const v = parseInt($(this).val());
    if (v === 1) { autoPlaySpeed = 1200; animateMoves = true;  $('#speed-label').text('Slow'); }
    if (v === 2) { autoPlaySpeed =  600; animateMoves = true;  $('#speed-label').text('Normal'); }
    if (v === 3) { autoPlaySpeed =  150; animateMoves = true;  $('#speed-label').text('Fast'); }
    if (v === 4) { autoPlaySpeed =    0; animateMoves = false; $('#speed-label').text('Instant ⚡ (no animation)'); }
});

// ── Move Application Helper ──────────────────────────────────────────────────
function applyEngineMoveSafely(moveData) {
    if (!moveData) return null;
    let moveStr = typeof moveData === 'string' ? moveData : (moveData.move || moveData.san);
    let sanStr = typeof moveData === 'object' ? moveData.san : null;

    if (sanStr) {
        try { const m = game.move(sanStr); if (m) return m; } catch (e) {}
    }
    if (moveStr) {
        try { const m = game.move(moveStr); if (m) return m; } catch (e) {}
    }
    if (typeof moveStr === 'string' && moveStr.length >= 4) {
        const from = moveStr.substring(0, 2);
        const to = moveStr.substring(2, 4);
        const promo = moveStr.length > 4 ? moveStr[4].toLowerCase() : 'q';
        try { const m = game.move({ from, to, promotion: promo }); if (m) return m; } catch (e) {}
    }
    if (typeof moveData === 'object' && moveData.from && moveData.to) {
        try { const m = game.move({ from: moveData.from, to: moveData.to, promotion: moveData.promotion || 'q' }); if (m) return m; } catch (e) {}
    }
    const legals = game.moves();
    if (legals.length > 0) {
        return game.move(legals[0]);
    }
    return null;
}

// ── Zero-Lag Auto-Play Engine Loop ──────────────────────────────────────────
let autoPlayTimer = null;
let isStepInProgress = false;

async function makeEngineMove() {
    if (game.game_over()) return;
    if (!isAutoPlay && game.turn() !== 'b') return;
    const searchFen = game.fen();
    const searchWasAutoPlay = isAutoPlay;
    if (!isAutoPlay) $status.text('AdaptiveEngine is thinking…');

    let result = null;
    if (useCppBackend) {
        result = await cppSearch();
        if (result && typeof result.depth === 'number') { lastReachedDepth = result.depth; updateDynamicDepth(); }
    } else if (engineWorker) {
        result = await workerSearch();
    } else {
        result = await engine.chooseBestMove(game, null, !isAutoPlay, gameData.consecutiveLosses || 0);
    }

    // Never apply a result computed for a position that has since changed.
    if (game.fen() !== searchFen || isAutoPlay !== searchWasAutoPlay ||
        (!isAutoPlay && game.turn() !== 'b')) return;

    if (!result) {
        const legals = game.moves();
        if (legals.length) result = { move: legals[0], score: 0 };
    }

    const moveInfo = applyEngineMoveSafely(result);
    if (!moveInfo) { updateStatus(); return; }

    const anim = !isAutoPlay ? true : animateMoves;
    board.position(game.fen(), anim);
    if (!isAutoPlay || anim) playMoveSound(moveInfo);
    updateEvalBar(result?.score || 0);

    const hist = game.history();
    const label = `${Math.ceil(hist.length / 2)}b`;
    pushEvalToChart(result?.score || 0, label);

    if (!isAutoPlay && !useCppBackend) logConsoleFinal(result);
    updateStatus();
}

let autoPlaySessionId = 0;

async function runAutoPlayStep() {
    if (!isAutoPlay || isStepInProgress) return;
    isStepInProgress = true;
    const currentSession = autoPlaySessionId;

    try {
        const batchLimit = autoPlaySpeed === 0 ? 2 : 1;

        for (let step = 0; step < batchLimit; step++) {
            if (!isAutoPlay || autoPlaySessionId !== currentSession) break;

            if (game.game_over()) {
                const loser = game.turn();
                const isAdaptiveEngineLoss = loser === 'b';
                const result = game.in_checkmate() ? (isAdaptiveEngineLoss ? 'loss' : 'win') : 'draw';
                const oppElo = sparringBot?.elo || 800;
                if (animateMoves) { board.position(game.fen(), true); await new Promise(r => setTimeout(r, 1200)); }
                const pgn = game.pgn();

                // Learn from this completed game (C++ weakness analysis when connected)
                const stepResult = await learnFromFinishedGame(result, oppElo, pgn);
                if (!isAutoPlay || autoPlaySessionId !== currentSession) break;

                const eloNow = Math.round(gameData.elo);
                const eloChange = stepResult ? stepResult.eloDelta : 0;
                const eloSign = eloChange >= 0 ? '+' : '';
                const col = result === 'win' ? '#81b64c' : result === 'loss' ? '#c95c5c' : '#ebcb8b';
                const acplTxt = stepResult && typeof stepResult.acpl === 'number' ? ` | ACPL ${Math.round(stepResult.acpl)} | ${gainsText(stepResult.points, 2)}` : '';
                appendTrainLog(`<span style="color:${col};font-weight:bold;">G${gameData.games}: ${result.toUpperCase()} | Elo: ${eloNow} (${eloSign}${eloChange.toFixed(0)}) Lvl ${botDepth()}${acplTxt}</span>`);

                if (trainGamesLeft > 1) {
                    trainGamesLeft--;
                    $('#brain-scanner').html(`> ${trainGamesLeft} games left… (Bot: ${eloNow} Elo)`);
                    game.reset();
                    board.position('start', false);
                    $evalFill.css('height', '50%');
                    $evalText.text('0.0');
                    break;
                } else {
                    stopAutoPlay();
                    return;
                }
            }

            const turn = game.turn();
            if (turn === 'w') {
                let res = await sparringMove();
                if (!isAutoPlay || autoPlaySessionId !== currentSession) break;
                if (!res) {
                    const legals = game.moves();
                    if (legals.length) res = { move: legals[0], score: 0 };
                }
                const mv = applyEngineMoveSafely(res);
                if (animateMoves && mv) { playMoveSound(mv); updateMoveHistory(); }
            } else {
                let res = null;
                if (useCppBackend) {
                    res = await cppSearch();
                } else if (engineWorker && autoPlaySpeed > 0) {
                    res = await workerSearch();
                } else {
                    res = await engine.chooseBestMove(game, null, false, gameData.consecutiveLosses || 0);
                }
                if (!isAutoPlay || autoPlaySessionId !== currentSession) break;
                if (!res) {
                    const legals = game.moves();
                    if (legals.length) res = { move: legals[0], score: 0 };
                }
                const mv = applyEngineMoveSafely(res);
                if (animateMoves && mv) {
                    playMoveSound(mv);
                    updateMoveHistory();
                    if (res && typeof res.score === 'number') updateEvalBar(res.score);
                }
            }
        }

        if (isAutoPlay && autoPlaySessionId === currentSession) {
            board.position(game.fen(), animateMoves);
            const color = game.turn() === 'w' ? `White (${sparringBot.name})` : 'Black (AdaptiveEngine)';
            $status.html(color + ' to move' + (game.in_check() ? ' — <span style="color:var(--accent-red);">CHECK!</span>' : ''));
        }

    } catch (err) {
        console.error('AutoPlay step error:', err);
    } finally {
        isStepInProgress = false;
    }

    if (!isAutoPlay || autoPlaySessionId !== currentSession) return;

    if (autoPlaySpeed === 0) {
        autoPlayTimer = setTimeout(() => {
            if (isAutoPlay && autoPlaySessionId === currentSession) runAutoPlayStep();
        }, 0);
    } else {
        autoPlayTimer = setTimeout(runAutoPlayStep, autoPlaySpeed);
    }
}

// ── Auto-Train Controls ─────────────────────────────────────────────────────
$('#auto-play-btn').on('click', function () {
    if (!isAutoPlay) {
        isAutoPlay = true;
        clearRedoHistory();
        autoPlaySessionId++;
        trainGamesLeft = parseInt($('#train-game-count').val()) || 25;
        $(this).html('<i class="fas fa-stop"></i> Stop Auto-Train').css('background', '#A34E54');
        sparringBot = { ...selectedSparring(), jsBot: null };
        $('#human-tag-name').text(sparringBot.name);
        $('#human-tag-elo').text('(' + Math.round(sparringBot.elo) + ')').show();
        $('#brain-scanner').show().html(`> Running ${trainGamesLeft} auto-train games…`);
        appendTrainLog(`<span style="color:#d39afb;">▶ Auto-Train: ${trainGamesLeft} games vs ${sparringBot.name} (${Math.round(sparringBot.elo)} bot-Elo, level ${sparringBot.level})${useCppBackend ? '' : ' — C++ offline: simple browser bot instead'}</span>`);

        clearBoardArrows();
        if (game.game_over()) {
            game.reset();
            board.position('start', false);
            updateMoveHistory();
            $evalFill.css('height', '50%');
            $evalText.text('0.0');
        }
        runAutoPlayStep();
    } else {
        stopAutoPlay();
    }
});

function stopAutoPlay() {
    isAutoPlay = false;
    trainGamesLeft = 0;
    autoPlaySessionId++;
    if (autoPlayTimer) {
        clearTimeout(autoPlayTimer);
        cancelAnimationFrame(autoPlayTimer);
        autoPlayTimer = null;
    }
    isStepInProgress = false;
    $('#auto-play-btn').html('<i class="fas fa-robot"></i> Start Auto-Train').css('background', '');
    $('#human-tag-name').text('You');
    $('#human-tag-role').text('(Human)');
    $('#human-tag-elo').hide();
    $('#brain-scanner').hide();
    appendTrainLog('<span style="color:#c95c5c;">■ Auto-Train stopped. User play resumed.</span>');

    board.position(game.fen(), false);
    updateStatsUI();
    renderBrainLog();
    updateMoveHistory();
    detectOpening();
    scheduleAnalysis(40);

    if (!game.game_over()) {
        if (game.turn() === 'b') {
            $status.html('Black (AdaptiveEngine) thinking reply…');
            setTimeout(makeEngineMove, 1500);
        } else {
            $status.html('White to move (Your turn!) — drag or click pieces.');
        }
    } else {
        updateStatus();
    }
}

function appendTrainLog(msg) {
    const $tl = $('#train-log');
    $tl.append(`<div>${msg}</div>`);
    if ($tl.children().length > 300) $tl.children().first().remove();
    $tl[0].scrollTop = $tl[0].scrollHeight;
}

// ── Board Drag & Drop & Promotion ───────────────────────────────────────────
function updateEvalBar(scoreCp) {
    const capped = Math.max(-8, Math.min(8, scoreCp / 100));
    $evalFill.css('height', (50 + capped * 6.25) + '%');
    $evalText.text((scoreCp >= 0 ? '+' : '') + (scoreCp / 100).toFixed(1));
}

function removeHighlights() {
    $('#myBoard .square-55d63').css('background', '').removeClass('highlight-selected');
    $('#myBoard .legal-move-hint, #myBoard .legal-move-capture').remove();
}

function showLegalMoves(square) {
    game.moves({ square, verbose: true }).forEach(m => {
        const $sq = $('#myBoard .square-' + m.to);
        $sq.append(game.get(m.to) ? '<div class="legal-move-capture"></div>' : '<div class="legal-move-hint"></div>');
    });
}

// ── Reliable Promotion Interface (Left & Right Click Safe) ───────────────────
let pendingPromotion = null;
let isOpeningPromotion = false;

function isPromotionMove(source, target) {
    if (!source || !target) return false;
    const piece = game.get(source);
    if (!piece || piece.type !== 'p') return false;
    if (piece.color === 'w' && source[1] === '7' && target[1] === '8') {
        return game.moves({ square: source, verbose: true }).some(m => m.to === target && m.promotion);
    }
    if (piece.color === 'b' && source[1] === '2' && target[1] === '1') {
        return game.moves({ square: source, verbose: true }).some(m => m.to === target && m.promotion);
    }
    return false;
}

function showPromotionDialog(from, to, color, callback) {
    pendingPromotion = { from, to, color, callback };
    isOpeningPromotion = true;

    // Guard against instant-click dismissal from drag drop release
    setTimeout(() => { isOpeningPromotion = false; }, 250);

    const prefix = color === 'w' ? 'w' : 'b';
    $('#promo-img-q').attr('src', `assets/img/chesspieces/wikipedia/${prefix}Q.png`);
    $('#promo-img-n').attr('src', `assets/img/chesspieces/wikipedia/${prefix}N.png`);
    $('#promo-img-r').attr('src', `assets/img/chesspieces/wikipedia/${prefix}R.png`);
    $('#promo-img-b').attr('src', `assets/img/chesspieces/wikipedia/${prefix}B.png`);

    const isFlipped = board && board.orientation && board.orientation() === 'black';
    let col = to.charCodeAt(0) - 97;
    let row = 8 - parseInt(to[1]);
    if (isFlipped) { col = 7 - col; row = 7 - row; }

    // Position neatly on the target column, centered horizontally over file
    const left = Math.max(10, Math.min(390, col * 60 - 10));
    const top = row === 0 ? 6 : Math.max(10, 480 - 280);

    $('#promotion-dialog').css({ left: left + 'px', top: top + 'px' }).stop(true, true).fadeIn(150);
}

function hidePromotionDialog() {
    $('#promotion-dialog').hide();
    pendingPromotion = null;
}

function choosePromotionPiece(promoPiece) {
    if (isOpeningPromotion || !pendingPromotion) return;
    const cb = pendingPromotion.callback;
    hidePromotionDialog();
    if (cb) cb(promoPiece);
}

// Support click, mousedown, and contextmenu on promotion piece
$('#promotion-dialog')
    .on('click mousedown touchend', '.promotion-piece', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const promoPiece = $(this).data('piece');
        choosePromotionPiece(promoPiece);
    })
    .on('contextmenu', function (e) {
        e.preventDefault();
        const $target = $(e.target).closest('.promotion-piece');
        if ($target.length) {
            choosePromotionPiece($target.data('piece'));
        }
    });

$('#promotion-cancel-btn').on('click mousedown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    hidePromotionDialog();
    removeHighlights();
    clickSource = null;
    board.position(game.fen(), true);
});

$(document).on('click', function (e) {
    if (isOpeningPromotion) return;
    if ($('#promotion-dialog').is(':visible') && !$(e.target).closest('#promotion-dialog, #myBoard').length) {
        hidePromotionDialog();
        removeHighlights();
        clickSource = null;
        board.position(game.fen(), true);
    }
});

function executePlayerMove(moveObj) {
    const move = game.move(moveObj);
    if (!move) return false;
    clearRedoHistory();
    removeHighlights();
    clickSource = null;
    board.position(game.fen(), true);
    playMoveSound(move);

    const res = analyzer.analyzePosition(game);
    updateEvalBar(res?.engineEvalCp || 0);
    const hist = game.history();
    pushEvalToChart(res?.engineEvalCp || 0, `${Math.ceil(hist.length / 2)}w`);

    updateStatus();
    if (!game.game_over()) setTimeout(makeEngineMove, 1500);
    return true;
}

function onDragStart(source, piece) {
    if (isAutoPlay) stopAutoPlay();
    if (game.game_over() || game.turn() !== 'w' || $('#promotion-dialog').is(':visible')) return false;
    const turn = game.turn();
    const pieceColor = piece.charAt(0);
    if (pieceColor !== turn) return false;

    removeHighlights();
    clickSource = source;
    $('#myBoard .square-' + source).addClass('highlight-selected');
    showLegalMoves(source);
    return true;
}

function onDrop(source, target) {
    if (source === target) {
        clickSource = source;
        $('#myBoard .square-' + source).addClass('highlight-selected');
        showLegalMoves(source);
        return 'snapback';
    }
    removeHighlights();

    // Pawn Promotion via Drag & Drop
    if (isPromotionMove(source, target)) {
        const piece = game.get(source);
        const color = piece ? piece.color : game.turn();
        showPromotionDialog(source, target, color, function (chosenPromo) {
            executePlayerMove({ from: source, to: target, promotion: chosenPromo });
        });
        return 'snapback';
    }

    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (!move) { clickSource = null; return 'snapback'; }
    clearRedoHistory();
    clickSource = null;

    const res = analyzer.analyzePosition(game);
    updateEvalBar(res?.engineEvalCp || 0);
    const hist = game.history();
    pushEvalToChart(res?.engineEvalCp || 0, `${Math.ceil(hist.length / 2)}w`);

    playMoveSound(move);
    updateStatus();
    if (!game.game_over()) setTimeout(makeEngineMove, 1500);
}

function onSnapEnd() {
    board.position(game.fen(), false);
}

// Click-to-Move
$('#myBoard').on('click', '.square-55d63', function (e) {
    if (isAutoPlay) stopAutoPlay();
    if (game.game_over() || game.turn() !== 'w' || $('#promotion-dialog').is(':visible')) return;

    const currentTurn = game.turn();
    const square = $(this).data('square');
    const piece = game.get(square);

    if (piece && piece.color === currentTurn) {
        removeHighlights();
        clickSource = square;
        $(this).addClass('highlight-selected');
        showLegalMoves(square);
        return;
    }

    if (clickSource) {
        if (isPromotionMove(clickSource, square)) {
            const p = game.get(clickSource);
            const color = p ? p.color : currentTurn;
            const fromSq = clickSource;
            showPromotionDialog(fromSq, square, color, function (chosenPromo) {
                executePlayerMove({ from: fromSq, to: square, promotion: chosenPromo });
            });
            return;
        }

        const move = game.move({ from: clickSource, to: square, promotion: 'q' });
        removeHighlights();
        if (move) {
            clearRedoHistory();
            clickSource = null;
            board.position(game.fen(), true);
            const res = analyzer.analyzePosition(game);
            updateEvalBar(res?.engineEvalCp || 0);
            const hist = game.history();
            pushEvalToChart(res?.engineEvalCp || 0, `${Math.ceil(hist.length / 2)}w`);
            playMoveSound(move);
            updateStatus();
            if (!game.game_over()) setTimeout(makeEngineMove, 1500);
        } else {
            clickSource = null;
        }
    }
});

function playMoveSound(move) {
    try {
        if (game.in_check()) { sfxCheck.currentTime = 0; sfxCheck.play(); }
        else if (move.captured) { sfxCapture.currentTime = 0; sfxCapture.play(); }
        else { sfxMove.currentTime = 0; sfxMove.play(); }
    } catch (e) {}
}

// ── Opening Detection & Theoretical ECO Database ───────────────────────────
const OPENINGS = [
    { moves: 'e4 e5 Nf3 Nc6 Bb5 a6', eco: 'C68', name: 'Ruy Lopez: Morphy Defense', desc: 'Spanish Opening classic with ...a6 kicking the bishop.', plan: 'White builds d4 center; Black expands on queenside with ...b5.' },
    { moves: 'e4 e5 Nf3 Nc6 Bb5',    eco: 'C60', name: 'Ruy Lopez (Spanish Opening)', desc: 'Pressures the c6 knight defending e5 to control the center.', plan: 'Rapid kingside castling, pawn structure pressure, d4 breakthrough.' },
    { moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5',eco: 'C50', name: 'Italian Game: Giuoco Piano', desc: 'Classical development targeting the delicate f7 square.', plan: 'Prepare c3 and d4 central strike; Black aims for counter-punches with ...Nf6.' },
    { moves: 'e4 e5 Nf3 Nc6 Bc4',    eco: 'C50', name: 'Italian Game', desc: 'Focuses bishop on the f7 weakness early.', plan: 'Quick piece development, c3-d4 center or d3 quiet Italian.' },
    { moves: 'e4 c5 Nf3 d6 d4',      eco: 'B90', name: 'Sicilian Defense: Open Variation', desc: 'Sharpest tactical clash fighting for d4 and open c-file.', plan: 'Black utilizes the half-open c-file; White attacks kingside.' },
    { moves: 'e4 c5',                eco: 'B20', name: 'Sicilian Defense', desc: 'Asymmetric dynamic counter to 1.e4 fighting for central squares.', plan: 'Counter-attack on the queenside, maintain pawn flexibility.' },
    { moves: 'e4 c6 d4 d5',          eco: 'B12', name: 'Caro-Kann Defense: Main Line', desc: 'Extremely resilient pawn chain supporting d5.', plan: 'Develop light-squared bishop outside pawn chain, solid endgame structure.' },
    { moves: 'e4 c6',                eco: 'B10', name: 'Caro-Kann Defense', desc: 'Solid defensive setup preparing central break ...d5.', plan: 'Pawn structure integrity, counter-play against White extended center.' },
    { moves: 'e4 e6 d4 d5',          eco: 'C02', name: 'French Defense: Classical', desc: 'Closed solid pawn chain e6-d5 testing White center.', plan: 'Black strikes at base of pawn chain with ...c5; White expands on kingside.' },
    { moves: 'e4 e6',                eco: 'C00', name: 'French Defense', desc: 'Solid pawn structure holding back e4 with planned ...d5.', plan: 'Counter-attack White center pawn chain via ...c5 and ...Qb6.' },
    { moves: 'd4 d5 c4 e6',          eco: 'D30', name: "Queen's Gambit Declined", desc: 'Classical bastion holding d5 against White c4 offer.', plan: 'Black solidifies center and develops queenside; White pressure on c-file.' },
    { moves: 'd4 d5 c4',             eco: 'D20', name: "Queen's Gambit", desc: 'White challenges Black central pawn with flank c4.', plan: 'Gain broad center with e4 or open c-file against Black defense.' },
    { moves: 'd4 Nf6 c4 g6 Nc3 Bg7',eco: 'E60', name: "King's Indian Defense", desc: 'Hypermodern setup allowing White space for dynamic kingside attack.', plan: 'Black prepares ...e5 or ...c5 strike, launching f7-f5 kingside assault.' },
    { moves: 'd4 Nf6 c4 e6 Nc3 Bb4',eco: 'E20', name: 'Nimzo-Indian Defense', desc: 'Pins White c3 knight to prevent e4 and double White pawns.', plan: 'Control e4 square, exert positional pressure on White pawn structure.' },
    { moves: 'd4 d5 Bf4',            eco: 'D00', name: 'London System', desc: 'Solid bishop pyramid setup with rapid piece harmony.', plan: 'Strong triangle c3-d4-e3, outpost knight on e5, resilient defense.' },
    { moves: 'e4 d5',                eco: 'B01', name: 'Scandinavian Defense', desc: 'Direct challenge to 1.e4 on move one.', plan: 'Open lines for pieces, queen-side pressure after ...Qa5 or ...Qd6.' },
    { moves: 'e4 e5 Nf3 Nf6',        eco: 'C42', name: 'Petroff (Russian) Defense', desc: 'Symmetrical defense immediately attacking e4.', plan: 'Neutralize White first-move initiative with balanced central counter.' },
    { moves: 'e4 e5 Nf3 Nc6 d4',     eco: 'C45', name: 'Scotch Game', desc: 'Early central explosion opening lines for rooks and bishops.', plan: 'Tactical piece play in open center.' },
    { moves: 'c4',                   eco: 'A10', name: 'English Opening', desc: 'Flank strategy controlling d5 and transposing to rich positions.', plan: 'Queenside fianchetto with g3-Bg2, central expansion.' },
    { moves: 'Nf3',                  eco: 'A04', name: 'Réti Opening', desc: 'Hypermodern flank development controlling center from distance.', plan: 'Fianchetto bishops, undermine Black central pawns.' },
    { moves: 'd4',                   eco: 'A40', name: "Queen's Pawn Opening", desc: 'Classical central occupation with d4.', plan: 'Develop knights to f3/c3, control e4 and c4.' },
    { moves: 'e4',                   eco: 'B00', name: "King's Pawn Opening", desc: 'Most popular open game move controlling d5/f5.', plan: 'Rapid piece mobilization, open diagonals for Queen and Bishop.' }
];

function detectOpening() {
    const hist = game.history().join(' ');
    let found = null;
    for (const o of OPENINGS) {
        if (hist.startsWith(o.moves)) { found = o; break; }
    }
    if (found) {
        $('#opening-name').text(found.name);
        $('#opening-desc').text(found.desc);
        $('#an-eco-badge').text(found.eco);
        $('#an-opening-title').text(found.name);
        $('#an-opening-desc').text(found.desc);
        $('#an-opening-plan').text(found.plan);
    } else if (hist.length) {
        $('#opening-name').text('Custom Variation');
        $('#opening-desc').text('Game has branched from standard theoretical lines.');
        $('#an-eco-badge').text('ECO A00');
        $('#an-opening-title').text('Custom Theoretical Branch');
        $('#an-opening-desc').text('The game has ventured into original custom territory.');
        $('#an-opening-plan').text('Evaluate positional strengths: center control, piece coordination, and king safety.');
    } else {
        $('#opening-name').text('Starting Position');
        $('#opening-desc').text('Make moves to detect the opening.');
        $('#an-eco-badge').text('ECO A00');
        $('#an-opening-title').text('Starting Position');
        $('#an-opening-desc').text('Make moves on the board to identify the opening line.');
        $('#an-opening-plan').text('Control central squares e4/d4, develop minor pieces, secure king safety.');
    }
}

// ── Status & Post-Game Learning ─────────────────────────────────────────────
function updateStatus(suppressFinishedEffects = false) {
    if (!isAutoPlay) {
        detectOpening();
        scheduleAnalysis(80);
    }

    if (game.game_over()) {
        let result, msg;
        if (game.in_checkmate()) {
            const loser = game.turn();
            // Human is White, AdaptiveEngine is Black
            const isAdaptiveEngineLoss = loser === 'b';
            msg    = isAdaptiveEngineLoss ? '✓ You win! AdaptiveEngine is checkmated.' : '✗ AdaptiveEngine wins! You are checkmated.';
            result = isAdaptiveEngineLoss ? 'loss' : 'win'; // 'loss' from AdaptiveEngine perspective
        } else {
            msg = '½ Draw — ' + (game.in_stalemate() ? 'stalemate' : 'by draw rule');
            result = 'draw';
        }
        const col = result === 'win' ? '#81b64c' : result === 'loss' ? '#c95c5c' : '#ebcb8b';
        $status.html(msg);

        // Browsing or redoing to the final position must not award learning twice.
        if (suppressFinishedEffects) {
            updateMoveHistory();
            return;
        }

        try {
            if (!isAutoPlay || animateMoves) { sfxEnd.currentTime = 0; sfxEnd.play(); }
        } catch (e) {}

        const oppElo = isAutoPlay ? (sparringBot?.elo ?? 800) : humanElo();
        const pgn = game.pgn();
        const finishedGameReviewId = reviewRequestId;

        if (!isAutoPlay) $status.html(msg + ' <span style="color:var(--text-muted);font-size:0.85em;">— AdaptiveEngine is reviewing the game…</span>');
        learnFromFinishedGame(result, oppElo, pgn).then(step => {
            // Learning may finish after the user has reset or loaded another game.
            // Never open the old game's review over the new game.
            if (finishedGameReviewId !== reviewRequestId || game.pgn() !== pgn) return;
            updateMoveHistory();
            if (!isAutoPlay) $status.html(msg);
            if (step && !isAutoPlay) showEngineEvolutionToast(step);
            // Game review overlay, built from the same coach analysis the bot learned from
            if (!isAutoPlay && game.history().length >= 4) {
                setTimeout(() => {
                    if (finishedGameReviewId === reviewRequestId && game.pgn() === pgn) {
                        showGameReview(pgn, step && step.review);
                    }
                }, 400);
            }
        });

    } else {
        const color = game.turn() === 'w' ? 'White' : 'Black';
        $status.html(color + ' to move' + (game.in_check() ? ' — <span style="color:var(--accent-red);">CHECK!</span>' : ''));
        updateMoveHistory();
    }
}

function updateMoveHistory() {
    const hist = game.history();
    let html = '';
    for (let i = 0; i < hist.length; i += 2) {
        html += `<div class="move-row-num">${(i / 2) + 1}.</div>`;
        html += `<div class="move-cell">${hist[i]}</div>`;
        html += hist[i + 1] ? `<div class="move-cell">${hist[i + 1]}</div>` : '<div></div>';
    }
    $moveHistory.html(html);
    $moveHistory[0].scrollTop = $moveHistory[0].scrollHeight;
}

// ── Navigation Buttons ──────────────────────────────────────────────────────
$('#new-game-btn, #new-game-play-btn').on('click', () => {
    if (isAutoPlay) stopAutoPlay();
    reviewRequestId++;
    $('#game-review-overlay').hide();
    clearRedoHistory();
    game.reset();
    board.start(true);
    $evalFill.css('height', '50%');
    $evalText.text('0.0');
    removeHighlights();
    clickSource = null;
    clearBoardArrows();
    resetEvalChart();
    updateStatus(true);
    logTerminal('▶ New game started.', 'info');
});

function undoOneMove() {
    const move = game.undo();
    if (!move) return false;
    redoHistory.push({ from: move.from, to: move.to, promotion: move.promotion });
    return true;
}

function redoOneMove() {
    const move = redoHistory.pop();
    if (!move) return false;
    const restored = game.move(move);
    if (!restored) {
        clearRedoHistory();
        return false;
    }
    return true;
}

window.navFirst = function () {
    if (isAutoPlay) return;
    while (undoOneMove()) {}
    board.position(game.fen(), true);
    updateStatus(true);
};
window.navBack = function () {
    if (isAutoPlay) return;
    undoOneMove();
    board.position(game.fen(), true);
    updateStatus(true);
};
window.navForward = function () {
    if (isAutoPlay) return;
    redoOneMove();
    board.position(game.fen(), true);
    updateStatus(true);
};
window.navLast = function () {
    if (isAutoPlay) return;
    while (redoOneMove()) {}
    board.position(game.fen(), true);
    updateStatus(true);
};

// ── Export / Import / Wipe ──────────────────────────────────────────────────
// The stats live in the C++ engine (data/learning_data.json). Export asks the engine for
// its current state and adds the browser's game history; Import sends the file to the engine.
async function exportStats() {
    let state = null, historyCsv = null;
    if (useCppBackend) {
        try { state = await (await fetch(`${cppBackendUrl}/state`)).json(); } catch (e) { state = null; }
        try { historyCsv = (await (await fetch(`${cppBackendUrl}/history`)).json()).csv || null; } catch (e) { historyCsv = null; }
    }
    const src = state || gameData;
    const out = {
        format: 'omegachess-stats',
        version: 3,
        exportedAt: new Date().toISOString(),
        source: state ? 'c++ engine' : 'browser copy (C++ engine offline)',
        elo: src.elo, games: src.games, wins: src.wins, losses: src.losses, draws: src.draws,
        consecutiveLosses: src.consecutiveLosses || 0,
        skill: { ...(src.skill || gameData.skill) },
        history: gameData.history || [],             // games played in this browser (with PGNs)
        historyCsv: historyCsv                        // every game the engine has learned from (learning_history.csv)
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `omegabot_stats_elo${Math.round(out.elo)}_g${out.games}_${stamp}.json`
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    logTerminal(`⬇ Exported AdaptiveEngine stats (Elo ${Math.round(out.elo)}, ${out.games} games, ${out.source}).`, 'info');
}

async function importStats(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { alert('That file is not valid JSON.'); return; }
    if (!d || typeof d.skill !== 'object' || d.elo === undefined) {
        alert('This file has no AdaptiveEngine skill stats (expected "skill" and "elo"). Files from before v4 cannot be imported.');
        return;
    }
    if (useCppBackend) {
        try {
            const state = await (await fetch(`${cppBackendUrl}/import`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text
            })).json();
            if (state.status !== 'ok') { alert('The C++ engine rejected the file: ' + (state.error || 'unknown error')); return; }
            applyCppState(state);
        } catch (e) { alert('Could not reach the C++ engine to import the stats.'); return; }
    } else {
        STAT_KEYS.forEach(k => { gameData.skill[k] = skillLevel(d.skill, k); });
        ['elo', 'games', 'wins', 'losses', 'draws', 'consecutiveLosses'].forEach(k => { if (typeof d[k] === 'number') gameData[k] = d[k]; });
        syncEngineFromSkill();
    }
    gameData.history = Array.isArray(d.history) ? d.history.slice(0, 200) : [];
    gameData.lastStep = null;
    learningSystem.save(gameData);
    updateStatsUI();
    renderBrainLog();
    logTerminal(`⬆ Imported AdaptiveEngine stats: Elo ${Math.round(gameData.elo)}, ${gameData.games} games, average level ${skillAverage(gameData.skill).toFixed(1)}${useCppBackend ? ' (saved in the C++ engine)' : ' (browser only — start the C++ engine to make it permanent)'}.`, 'info');
}

$(document).on('click', '#export-btn-play, #export-btn, #export-btn-train', () => exportStats());
$(document).on('click', '#import-btn-play, #import-btn, #import-btn-train', () => $('#import-file').click());
$('#import-file').on('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => importStats(ev.target.result);
    reader.readAsText(file);
    $(this).val('');
});

$('#clear-db-btn, #clear-db-btn-play').on('click', () => {
    if (!confirm('Wipe all learned data? The bot goes back to a beginner (all stats level 1, Elo 400).')) return;
    gameData = learningSystem.reset();
    if (useCppBackend) {
        fetch(`${cppBackendUrl}/reset`, { method: 'POST' })
            .then(r => r.json()).then(state => { applyCppState(state); updateStatsUI(); renderBrainLog(); })
            .catch(() => {});
    }
    syncEngineFromSkill();
    resetEvalChart();
    updateStatsUI();
    renderBrainLog();
    logTerminal('⚠ Memory wiped. AdaptiveEngine is a beginner again (Elo 400, all stats level 1).', 'warn');
});

// ── Initialization ──────────────────────────────────────────────────────────
board = Chessboard('myBoard', {
    draggable: true,
    position: 'start',
    moveSpeed: 380,
    snapbackSpeed: 80,
    snapSpeed: 35,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: 'assets/img/chesspieces/wikipedia/{piece}.png'
});
reviewBoard = Chessboard('reviewBoard', {
    draggable: false,
    position: 'start',
    pieceTheme: 'assets/img/chesspieces/wikipedia/{piece}.png'
});

$(window).resize(() => {
    if (board) board.resize();
    if (reviewBoard && $('#game-review-overlay').is(':visible')) reviewBoard.resize();
});

initWorker();
try { const saved = localStorage.getItem('omegaHumanElo'); if (saved) $('#human-elo').val(saved); } catch (e) {}
$('#human-elo').on('change', function () {
    $(this).val(humanElo());
    try { localStorage.setItem('omegaHumanElo', String(humanElo())); } catch (e) {}
});
renderSparringOptions();
updateStatsUI();
renderBrainLog();
updateStatus();

logTerminal(`AdaptiveEngine v4.2 — Elo: ${Math.round(gameData.elo)} | Games: ${gameData.games} | Avg skill level ${skillAverage(gameData.skill).toFixed(1)}`, 'info');
logTerminal(`Search: Level ${botDepth()} (from Calculation) | Minimax + Alpha-Beta + transposition table + capture search | Learns from a post-game review (C++)`, 'info');
detectCppBackend();
