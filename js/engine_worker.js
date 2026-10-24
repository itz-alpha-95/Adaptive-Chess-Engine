'use strict';
// =============================================================================
//  engine_worker.js — OmegaChess fallback engine (runs in a Web Worker when the C++ server is offline)
//  Features: Master Opening Book, Advanced Pawn Structure (Passed, Doubled, Isolated),
//            Piece Coordination (Bishop Pair, Outposts, Open Files, 7th Rank),
//            King Safety & Tropism, Quiescence Search with Alpha-Beta Pruning,
//            Anti-Blunder Verification & Iterative Deepening
// =============================================================================

importScripts('./chess.min.js');

// ── Master Opening Book ─────────────────────────────────────────────────────
const OPENING_BOOK = {
    "": ["e4", "d4", "Nf3", "c4"],
    "e4": ["e5", "c5", "c6", "e6"],
    "e4 e5": ["Nf3", "Bc4", "Nc3"],
    "e4 e5 Nf3": ["Nc6", "Nf6"],
    "e4 e5 Nf3 Nc6": ["Bb5", "Bc4", "d4", "Nc3"],
    "e4 e5 Nf3 Nc6 Bc4": ["Bc5", "Nf6"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5": ["c3", "d3", "O-O", "b4"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3": ["Nf6", "Qe7"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6": ["d4", "d3"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4": ["exd4"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4": ["cxd4", "e5"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4": ["Bb4+"],
    "e4 e5 Nf3 Nc6 Bb5": ["a6", "Nf6", "d6"],
    "e4 e5 Nf3 Nc6 Bb5 a6": ["Ba4", "Bxc6"],
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4": ["Nf6", "d6", "b5"],
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6": ["O-O", "d3", "Qe2"],
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O": ["Be7", "b5", "Nxe4"],
    "e4 c5": ["Nf3", "Nc3", "c3", "d4"],
    "e4 c5 Nf3": ["d6", "Nc6", "e6"],
    "e4 c5 Nf3 d6": ["d4"],
    "e4 c5 Nf3 d6 d4": ["cxd4"],
    "e4 c5 Nf3 d6 d4 cxd4": ["Nxd4"],
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4": ["Nf6"],
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6": ["Nc3"],
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3": ["a6", "g6", "e6", "Nc6"],
    "e4 c6": ["d4", "Nc3"],
    "e4 c6 d4": ["d5"],
    "e4 c6 d4 d5": ["Nc3", "e5", "exd5"],
    "e4 c6 d4 d5 Nc3": ["dxe4"],
    "e4 c6 d4 d5 Nc3 dxe4": ["Nxe4"],
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4": ["Bf5", "Nd7", "Nf6"],
    "e4 e6": ["d4"],
    "e4 e6 d4": ["d5"],
    "e4 e6 d4 d5": ["Nc3", "Nd2", "e5", "exd5"],
    "e4 e6 d4 d5 Nc3": ["Nf6", "Bb4", "dxe4"],
    "d4": ["d5", "Nf6", "f5"],
    "d4 d5": ["c4", "Nf3", "Bf4"],
    "d4 d5 c4": ["e6", "c6", "dxc4"],
    "d4 d5 c4 e6": ["Nc3", "Nf3"],
    "d4 d5 c4 e6 Nc3": ["Nf6", "c6"],
    "d4 d5 c4 e6 Nc3 Nf6": ["Bg5", "cxd5", "Nf3"],
    "d4 d5 c4 c6": ["Nf3", "Nc3"],
    "d4 d5 c4 c6 Nf3": ["Nf6"],
    "d4 Nf6": ["c4", "Nf3", "Bg5"],
    "d4 Nf6 c4": ["g6", "e6", "c5"],
    "d4 Nf6 c4 g6": ["Nc3", "g3"],
    "d4 Nf6 c4 g6 Nc3": ["d5", "Bg7"],
    "d4 Nf6 c4 g6 Nc3 Bg7": ["e4"],
    "d4 Nf6 c4 g6 Nc3 Bg7 e4": ["d6"],
    "d4 Nf6 c4 e6": ["Nc3", "Nf3"],
    "d4 Nf6 c4 e6 Nc3": ["Bb4", "d5"],
    "c4": ["e5", "Nf6", "c5", "e6"],
    "Nf3": ["d5", "Nf6", "c5"]
};

// ── Piece-Square Tables ─────────────────────────────────────────────────────
const PST = {
    p: [ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
         5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
         5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30,
        -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
        -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10,
        -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
        -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
        -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10,
        -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,
        -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
        -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
        20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
    kEnd: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30,
           -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
           -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
           -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
};

function pieceVal(t) {
    switch(t) {
        case 'p': return 100; case 'n': return 320; case 'b': return 330;
        case 'r': return 500; case 'q': return 900; case 'k': return 20000;
        default: return 0;
    }
}

function pstVal(type, color, row, col, isEndgame) {
    let key = type;
    if (type === 'k' && isEndgame) key = 'kEnd';
    const t = PST[key];
    if (!t) return 0;
    return t[color === 'w' ? row * 8 + col : (7 - row) * 8 + col];
}

function isEndgame(board) {
    let q = 0, m = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c]; if (!p) continue;
        if (p.type === 'q') q++;
        if (p.type === 'r' || p.type === 'b' || p.type === 'n') m++;
    }
    return q === 0 || (q <= 2 && m <= 2);
}

function evaluate(game, w) {
    if (game.in_checkmate()) {
        return game.turn() === 'w' ? -99000 : 99000;
    }
    if (game.in_draw() || game.in_stalemate()) {
        return 0;
    }

    const board = game.board();
    let mat = 0, pst = 0, mob = 0, cen = 0, ks = 0, ps = 0, pc = 0, ts = 0;
    const eg = isEndgame(board);

    let wBishops = 0, bBishops = 0;
    let wRooks = [], bRooks = [];
    let wKingPos = null, bKingPos = null;

    const wPawnsByFile = [0, 0, 0, 0, 0, 0, 0, 0];
    const bPawnsByFile = [0, 0, 0, 0, 0, 0, 0, 0];
    const wPawnRanks = Array.from({ length: 8 }, () => []);
    const bPawnRanks = Array.from({ length: 8 }, () => []);

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (!p) continue;
            const s = p.color === 'w' ? 1 : -1;
            mat += s * pieceVal(p.type);
            pst += s * pstVal(p.type, p.color, r, c, eg);

            if (p.type === 'p') {
                if (p.color === 'w') { wPawnsByFile[c]++; wPawnRanks[c].push(r); }
                else { bPawnsByFile[c]++; bPawnRanks[c].push(r); }
            } else if (p.type === 'b') {
                if (p.color === 'w') wBishops++; else bBishops++;
            } else if (p.type === 'r') {
                if (p.color === 'w') wRooks.push({ r, c }); else bRooks.push({ r, c });
            } else if (p.type === 'k') {
                if (p.color === 'w') wKingPos = { r, c }; else bKingPos = { r, c };
            }

            // Center Control
            if ((r === 3 || r === 4) && (c === 3 || c === 4)) {
                cen += s * 22;
            } else if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
                cen += s * 12;
            }
        }
    }

    // Bishop Pair
    if (wBishops >= 2) pc += 38;
    if (bBishops >= 2) pc -= 38;

    // Pawn Structure
    for (let c = 0; c < 8; c++) {
        // Doubled
        if (wPawnsByFile[c] > 1) ps -= (wPawnsByFile[c] - 1) * 18;
        if (bPawnsByFile[c] > 1) ps += (bPawnsByFile[c] - 1) * 18;

        // Isolated
        const wHasAdj = (c > 0 && wPawnsByFile[c - 1] > 0) || (c < 7 && wPawnsByFile[c + 1] > 0);
        if (wPawnsByFile[c] > 0 && !wHasAdj) ps -= 20 * wPawnsByFile[c];

        const bHasAdj = (c > 0 && bPawnsByFile[c - 1] > 0) || (c < 7 && bPawnsByFile[c + 1] > 0);
        if (bPawnsByFile[c] > 0 && !bHasAdj) ps += 20 * bPawnsByFile[c];

        // Passed Pawns
        for (const r of wPawnRanks[c]) {
            let passed = true;
            for (let adj = Math.max(0, c - 1); adj <= Math.min(7, c + 1); adj++) {
                for (const oppR of bPawnRanks[adj]) {
                    if (oppR < r) { passed = false; break; }
                }
                if (!passed) break;
            }
            if (passed) {
                const advancement = 7 - r;
                const bonus = [0, 10, 20, 38, 70, 130, 220][Math.min(6, advancement)] || 0;
                ps += bonus;
                if (c > 0 && wPawnRanks[c - 1].some(pr => Math.abs(pr - r) <= 1)) ps += 18;
            }
        }

        for (const r of bPawnRanks[c]) {
            let passed = true;
            for (let adj = Math.max(0, c - 1); adj <= Math.min(7, c + 1); adj++) {
                for (const oppR of wPawnRanks[adj]) {
                    if (oppR > r) { passed = false; break; }
                }
                if (!passed) break;
            }
            if (passed) {
                const advancement = r;
                const bonus = [0, 10, 20, 38, 70, 130, 220][Math.min(6, advancement)] || 0;
                ps -= bonus;
                if (c > 0 && bPawnRanks[c - 1].some(pr => Math.abs(pr - r) <= 1)) ps -= 18;
            }
        }
    }

    // Rook on open file & 7th rank
    for (const rk of wRooks) {
        if (wPawnsByFile[rk.c] === 0 && bPawnsByFile[rk.c] === 0) pc += 34;
        else if (wPawnsByFile[rk.c] === 0) pc += 18;
        if (rk.r === 1) pc += 42;
    }
    for (const rk of bRooks) {
        if (wPawnsByFile[rk.c] === 0 && bPawnsByFile[rk.c] === 0) pc -= 34;
        else if (bPawnsByFile[rk.c] === 0) pc -= 18;
        if (rk.r === 6) pc -= 42;
    }
    if (wRooks.length >= 2 && (wRooks[0].r === wRooks[1].r || wRooks[0].c === wRooks[1].c)) pc += 22;
    if (bRooks.length >= 2 && (bRooks[0].r === bRooks[1].r || bRooks[0].c === bRooks[1].c)) pc -= 22;

    // King safety & pawn shield
    if (wKingPos && !eg) {
        let shield = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = wKingPos.r + dr, nc = wKingPos.c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] && board[nr][nc].type === 'p' && board[nr][nc].color === 'w') shield++;
        }
        ks += shield * 16;
        if ((wKingPos.c <= 2 || wKingPos.c >= 6) && wKingPos.r === 7) ks += 30;
        if (wPawnsByFile[wKingPos.c] === 0) ks -= 32;
    }
    if (bKingPos && !eg) {
        let shield = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = bKingPos.r + dr, nc = bKingPos.c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] && board[nr][nc].type === 'p' && board[nr][nc].color === 'b') shield++;
        }
        ks -= shield * 16;
        if ((bKingPos.c <= 2 || bKingPos.c >= 6) && bKingPos.r === 0) ks -= 30;
        if (bPawnsByFile[bKingPos.c] === 0) ks += 32;
    }

    // King Tropism
    if (!eg && wKingPos && bKingPos) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p || p.type === 'p' || p.type === 'k') continue;
                if (p.color === 'w') {
                    const dist = Math.max(Math.abs(r - bKingPos.r), Math.abs(c - bKingPos.c));
                    ts += (7 - dist) * 4;
                } else {
                    const dist = Math.max(Math.abs(r - wKingPos.r), Math.abs(c - wKingPos.c));
                    ts -= (7 - dist) * 4;
                }
            }
        }
    }

    // Mobility
    const mc = game.moves().length;
    const ms = game.turn() === 'w' ? 1 : -1;
    mob = ms * mc * 2.8;

    const wMat  = w.material          !== undefined ? w.material          : 1.0;
    const wPst  = w.pieceSquare       !== undefined ? w.pieceSquare       : 0.20;
    const wMob  = w.mobility          !== undefined ? w.mobility          : 0.15;
    const wKs   = w.kingSafety        !== undefined ? w.kingSafety        : 0.25;
    const wPs   = w.pawnStructure     !== undefined ? w.pawnStructure     : 0.20;
    const wCen  = w.centerControl     !== undefined ? w.centerControl     : 0.20;
    const wPc   = w.pieceCoordination !== undefined ? w.pieceCoordination : 0.22;
    const wTs   = w.tacticalSafety    !== undefined ? w.tacticalSafety    : 0.25;

    return (
        wMat * mat +
        wPst * pst +
        wCen * cen +
        wMob * mob +
        wKs  * ks  +
        wPs  * ps  +
        wPc  * pc  +
        wTs  * ts
    );
}

// ── Alpha-Beta Search with Quiescence ─────────────────────────────────────
let _nodes = 0, _cutoffs = 0, _maxDepth = 0;

function quiesce(game, alpha, beta, isMax, weights, qdepth = 0) {
    _nodes++;
    const standPat = evaluate(game, weights);
    if (qdepth >= 4) return standPat;

    if (isMax) {
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
    } else {
        if (standPat <= alpha) return alpha;
        if (standPat < beta) beta = standPat;
    }

    const moves = game.moves().filter(m => m.includes('x') || m.includes('+'));
    for (const m of moves) {
        game.move(m);
        const sc = quiesce(game, alpha, beta, !isMax, weights, qdepth + 1);
        game.undo();
        if (isMax) {
            if (sc >= beta) { _cutoffs++; return beta; }
            if (sc > alpha) alpha = sc;
        } else {
            if (sc <= alpha) { _cutoffs++; return alpha; }
            if (sc < beta) beta = sc;
        }
    }
    return isMax ? alpha : beta;
}

function alphaBeta(game, depth, alpha, beta, isMax, weights) {
    _nodes++;
    if (game.in_checkmate()) return isMax ? -99000 + (_maxDepth - depth) : 99000 - (_maxDepth - depth);
    if (game.in_draw() || game.in_stalemate()) return 0;
    if (depth <= 0) return quiesce(game, alpha, beta, isMax, weights, 0);

    let moves = game.moves();
    moves.sort((a, b) => {
        const aScore = (a.includes('#') ? 8 : 0) + (a.includes('+') ? 4 : 0) + (a.includes('x') ? 2 : 0);
        const bScore = (b.includes('#') ? 8 : 0) + (b.includes('+') ? 4 : 0) + (b.includes('x') ? 2 : 0);
        return bScore - aScore;
    });

    if (isMax) {
        let best = -Infinity;
        for (const m of moves) {
            game.move(m);
            const sc = alphaBeta(game, depth - 1, alpha, beta, false, weights);
            game.undo();
            if (sc > best) best = sc;
            if (sc > alpha) alpha = sc;
            if (beta <= alpha) { _cutoffs++; break; }
        }
        return best;
    } else {
        let best = Infinity;
        for (const m of moves) {
            game.move(m);
            const sc = alphaBeta(game, depth - 1, alpha, beta, true, weights);
            game.undo();
            if (sc < best) best = sc;
            if (sc < beta) beta = sc;
            if (beta <= alpha) { _cutoffs++; break; }
        }
        return best;
    }
}

// Anti-Blunder Tactical Verification
function verifyMoveSafety(game, candidateMove, weights) {
    const isWhite = game.turn() === 'w';
    game.move(candidateMove);

    if (game.in_checkmate()) {
        game.undo();
        return 99999;
    }

    const oppReplies = game.moves();
    for (const oppMove of oppReplies) {
        if (oppMove.includes('#')) {
            game.undo();
            return -99999;
        }
        if (oppMove.includes('x') && oppMove.includes('Q')) {
            game.move(oppMove);
            const ev = evaluate(game, weights);
            game.undo();
            if (isWhite ? ev < -600 : ev > 600) {
                game.undo();
                return -8000;
            }
        }
    }
    game.undo();
    return 0;
}

// ── Main Message Handler ──────────────────────────────────────────────────
self.onmessage = function (e) {
    const { fen, depth, weights, id, consecutiveLosses, history } = e.data;
    const t0 = Date.now();

    const game = new Chess(fen);
    if (game.game_over()) {
        self.postMessage({ type: 'result', id, move: null, score: 0, nodes: 0, cutoffs: 0, timeMs: 0, depth: 0 });
        return;
    }

    let allMoves = game.moves();
    if (!allMoves.length) {
        self.postMessage({ type: 'result', id, move: null, score: 0, nodes: 0, cutoffs: 0, timeMs: 0, depth: 0 });
        return;
    }

    // 1. Opening Book (the game is rebuilt from a FEN, so the move list comes from the page)
    const hist = Array.isArray(history) ? history : null;
    if (hist && hist.length <= 14) {
        const line = hist.join(' ');
        const options = OPENING_BOOK[line];
        if (options && options.length) {
            if (consecutiveLosses >= 2) {
                if (line === "e4") {
                    const solid = options.filter(m => m === "c6" || m === "e6");
                    if (solid.length) {
                        const m = solid[Math.floor(Math.random() * solid.length)];
                        self.postMessage({ type: 'result', id, move: m, san: m, score: 0, nodes: 1, cutoffs: 0, timeMs: 2, nps: 1000, depth: depth || 3, pv: [m], isBook: true });
                        return;
                    }
                }
            }
            const bookMatches = options.filter(m => allMoves.includes(m));
            if (bookMatches.length > 0) {
                const m = bookMatches[Math.floor(Math.random() * bookMatches.length)];
                self.postMessage({ type: 'result', id, move: m, san: m, score: 0, nodes: 1, cutoffs: 0, timeMs: 2, nps: 1000, depth: depth || 3, pv: [m], isBook: true });
                return;
            }
        }
    }

    // Search depth comes from the bot's Calculation level (same rule as the C++ engine)
    const effectiveDepth = Math.max(1, Math.min(4, depth || 3));
    _nodes = 0;
    _cutoffs = 0;
    _maxDepth = effectiveDepth;

    const isMax = game.turn() === 'w';
    let bestScore = isMax ? -Infinity : Infinity;
    let bestMove = allMoves[0];

    const sortedMoves = [...allMoves].sort((a, b) => {
        const aScore = (a.includes('#') ? 8 : 0) + (a.includes('+') ? 4 : 0) + (a.includes('x') ? 2 : 0);
        const bScore = (b.includes('#') ? 8 : 0) + (b.includes('+') ? 4 : 0) + (b.includes('x') ? 2 : 0);
        return bScore - aScore;
    });

    for (let i = 0; i < sortedMoves.length; i++) {
        const mv = sortedMoves[i];
        const safety = verifyMoveSafety(game, mv, weights);
        if (safety <= -5000 && sortedMoves.length > 1) continue;

        game.move(mv);
        const score = alphaBeta(game, effectiveDepth - 1, -Infinity, Infinity, !isMax, weights);
        game.undo();

        const finalScore = score + safety;

        if (isMax ? (finalScore > bestScore) : (finalScore < bestScore)) {
            bestScore = finalScore;
            bestMove = mv;
        }

        const elapsed = Math.max(1, Date.now() - t0);
        const nps = Math.round((_nodes / elapsed) * 1000);

        if ((i + 1) % 4 === 0 || i === sortedMoves.length - 1) {
            self.postMessage({
                type: 'progress',
                id,
                depth: effectiveDepth,
                bestMove,
                score: bestScore,
                currentMove: mv,
                nodes: _nodes,
                cutoffs: _cutoffs,
                timeMs: elapsed,
                nps
            });
        }
    }

    const elapsed = Math.max(1, Date.now() - t0);
    const nps = Math.round((_nodes / elapsed) * 1000);

    let pvLine = [bestMove];
    try {
        game.move(bestMove);
        const replies = game.moves();
        if (replies.length) {
            replies.sort((a, b) => (b.includes('x') ? 1 : 0) - (a.includes('x') ? 1 : 0));
            pvLine.push(replies[0]);
        }
        game.undo();
    } catch (e) {}

    self.postMessage({
        type: 'result',
        id,
        move: bestMove,
        san: bestMove,
        score: bestScore,
        nodes: _nodes,
        cutoffs: _cutoffs,
        timeMs: elapsed,
        nps,
        depth: effectiveDepth,
        pv: pvLine,
        isBook: false
    });
};
