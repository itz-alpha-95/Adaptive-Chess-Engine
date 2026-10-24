// =============================================================================
//  engine.js  —  OmegaChess Adaptive Self-Learning Engine v6.0 (Piece-Specific Mastery)
//  Modules: Evaluator (piece-by-piece positional stats), OpeningBook,
//           ChessEngine (Minimax+Alpha-Beta+Quiescence+AntiBlunder),
//           SparringBot, LearningSystem (browser-side statistics; weights learn in C++),
//           PositionAnalyzer (2-Ply Tactical Precision & Chess.com Game Review)
// =============================================================================

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

// ── Piece-Specific & Classical Positional Evaluator ─────────────────────────
// Baseline weights around 1.0 = ~800 Elo player standard
class Evaluator {
    constructor(weights = {}) {
        this.weights = {
            // Piece Material Weights (1.0 = 800 Elo standard)
            pawnWeight: weights.pawnWeight ?? 1.0,
            knightWeight: weights.knightWeight ?? 1.0,
            bishopWeight: weights.bishopWeight ?? 1.0,
            rookWeight: weights.rookWeight ?? 1.0,
            queenWeight: weights.queenWeight ?? 1.0,

            // Specific Piece Traits & Tactics
            passedPawnWeight: weights.passedPawnWeight ?? 1.0,
            pawnStructureWeight: weights.pawnStructureWeight ?? 1.0,
            knightOutpostWeight: weights.knightOutpostWeight ?? 1.0,
            bishopPairWeight: weights.bishopPairWeight ?? 1.0,
            rookOpenFileWeight: weights.rookOpenFileWeight ?? 1.0,
            rookSeventhRankWeight: weights.rookSeventhRankWeight ?? 1.0,
            connectedRooksWeight: weights.connectedRooksWeight ?? 1.0,
            queenSafetyWeight: weights.queenSafetyWeight ?? 1.0,

            // King & Tactical Fortress
            kingSafetyWeight: weights.kingSafetyWeight ?? 1.0,
            kingTropismWeight: weights.kingTropismWeight ?? 1.0,
            castlingRewardWeight: weights.castlingRewardWeight ?? 1.0,
            tacticalSafetyWeight: weights.tacticalSafetyWeight ?? 1.0,

            // Board Dynamics & Space
            centerControlWeight: weights.centerControlWeight ?? 1.0,
            spaceAdvantageWeight: weights.spaceAdvantageWeight ?? 1.0,
            pieceSquareWeight: weights.pieceSquareWeight ?? 1.0,
            mobilityWeight: weights.mobilityWeight ?? 1.0
        };

        this.PST = {
            p:[ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
            n:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
            b:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
            r:[ 0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
            q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
            k:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20],
            kEnd:[-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,-30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,-30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-50]
        };
    }

    getPST(type, color, row, col, isEndgame) {
        let key = type;
        if (type === 'k' && isEndgame) key = 'kEnd';
        const t = this.PST[key];
        if (!t) return 0;
        const idx = (color === 'w') ? (row * 8 + col) : ((7 - row) * 8 + col);
        return t[idx];
    }

    isEndgame(board) {
        let q = 0, m = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                if (p.type === 'q') q++;
                if (p.type === 'r' || p.type === 'b' || p.type === 'n') m++;
            }
        }
        return q === 0 || (q <= 2 && m <= 2);
    }

    evaluate(game) {
        if (game.in_checkmate()) {
            return game.turn() === 'w' ? -99000 : 99000;
        }
        if (game.in_draw() || game.in_stalemate()) {
            return 0;
        }

        const board = game.board();
        const w = this.weights;
        const eg = this.isEndgame(board);

        // Piece Counts
        let wP = 0, bP = 0;
        let wN = 0, bN = 0;
        let wB = 0, bB = 0;
        let wR = 0, bR = 0;
        let wQ = 0, bQ = 0;

        let pstScore = 0;
        let centerScore = 0;
        let spaceScore = 0;
        let knightOutpostScore = 0;
        let rookOpenFileScore = 0;
        let rookSeventhRankScore = 0;
        let connectedRookScore = 0;
        let passedPawnScore = 0;
        let pawnStructureScore = 0;
        let kingSafetyScore = 0;
        let kingTropismScore = 0;
        let castlingScore = 0;
        let queenSafetyScore = 0;
        let tacticalSafetyScore = 0;

        let wRooks = [], bRooks = [];
        let wKingPos = null, bKingPos = null;

        const wPawnsByFile = [0, 0, 0, 0, 0, 0, 0, 0];
        const bPawnsByFile = [0, 0, 0, 0, 0, 0, 0, 0];
        const wPawnRanks = Array.from({ length: 8 }, () => []);
        const bPawnRanks = Array.from({ length: 8 }, () => []);

        // 1. First Pass: Piece Counts, PST & File Buckets
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                const s = p.color === 'w' ? 1 : -1;
                pstScore += s * this.getPST(p.type, p.color, r, c, eg);

                switch (p.type) {
                    case 'p':
                        if (p.color === 'w') { wP++; wPawnsByFile[c]++; wPawnRanks[c].push(r); }
                        else { bP++; bPawnsByFile[c]++; bPawnRanks[c].push(r); }
                        break;
                    case 'n':
                        if (p.color === 'w') {
                            wN++;
                        } else {
                            bN++;
                        }
                        break;
                    case 'b':
                        if (p.color === 'w') wB++; else bB++;
                        break;
                    case 'r':
                        if (p.color === 'w') { wR++; wRooks.push({ r, c }); }
                        else { bR++; bRooks.push({ r, c }); }
                        break;
                    case 'q':
                        if (p.color === 'w') {
                            wQ++;
                        } else {
                            bQ++;
                        }
                        break;
                    case 'k':
                        if (p.color === 'w') wKingPos = { r, c }; else bKingPos = { r, c };
                        break;
                }

                // Core Center Control (e4, d4, e5, d5) & Extended Center
                if ((r === 3 || r === 4) && (c === 3 || c === 4)) {
                    centerScore += s * 20;
                } else if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
                    centerScore += s * 10;
                }

                // Space Advantage in opponent territory
                if (p.color === 'w' && r <= 3) spaceScore += 5;
                if (p.color === 'b' && r >= 4) spaceScore -= 5;
            }
        }

        // These features depend on complete material and pawn counts. Calculate them
        // after the first pass so their score cannot vary with board scan order.
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                if (p.type === 'n' && c >= 1 && c <= 6) {
                    if (p.color === 'w' && r >= 2 && r <= 4 &&
                        (wPawnsByFile[c - 1] > 0 || wPawnsByFile[c + 1] > 0)) knightOutpostScore += 26;
                    if (p.color === 'b' && r >= 3 && r <= 5 &&
                        (bPawnsByFile[c - 1] > 0 || bPawnsByFile[c + 1] > 0)) knightOutpostScore -= 26;
                } else if (p.type === 'q') {
                    if (p.color === 'w' && r < 6 && (wN < 2 || wB < 2)) queenSafetyScore -= 18;
                    if (p.color === 'b' && r > 1 && (bN < 2 || bB < 2)) queenSafetyScore += 18;
                }
            }
        }

        // 2. Bishop Pair Bonus
        let bishopPairScore = 0;
        if (wB >= 2) bishopPairScore += 38;
        if (bB >= 2) bishopPairScore -= 38;

        // 3. Pawn Structure Analysis (Passed, Doubled, Isolated, Connected)
        for (let c = 0; c < 8; c++) {
            // Doubled pawns
            if (wPawnsByFile[c] > 1) pawnStructureScore -= (wPawnsByFile[c] - 1) * 16;
            if (bPawnsByFile[c] > 1) pawnStructureScore += (bPawnsByFile[c] - 1) * 16;

            // Isolated pawns
            const wHasAdj = (c > 0 && wPawnsByFile[c - 1] > 0) || (c < 7 && wPawnsByFile[c + 1] > 0);
            if (wPawnsByFile[c] > 0 && !wHasAdj) pawnStructureScore -= 18 * wPawnsByFile[c];

            const bHasAdj = (c > 0 && bPawnsByFile[c - 1] > 0) || (c < 7 && bPawnsByFile[c + 1] > 0);
            if (bPawnsByFile[c] > 0 && !bHasAdj) pawnStructureScore += 18 * bPawnsByFile[c];

            // Passed Pawns (White advancing to row 0)
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
                    const bonus = [0, 10, 20, 36, 68, 125, 210][Math.min(6, advancement)] || 0;
                    passedPawnScore += bonus;
                    if (c > 0 && wPawnRanks[c - 1].some(pr => Math.abs(pr - r) <= 1)) passedPawnScore += 16;
                }
            }

            // Passed Pawns (Black advancing to row 7)
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
                    const bonus = [0, 10, 20, 36, 68, 125, 210][Math.min(6, advancement)] || 0;
                    passedPawnScore -= bonus;
                    if (c > 0 && bPawnRanks[c - 1].some(pr => Math.abs(pr - r) <= 1)) passedPawnScore -= 16;
                }
            }
        }

        // 4. Rook Placement: Open files, 7th rank, Connected rooks
        for (const rk of wRooks) {
            if (wPawnsByFile[rk.c] === 0 && bPawnsByFile[rk.c] === 0) rookOpenFileScore += 30;
            else if (wPawnsByFile[rk.c] === 0) rookOpenFileScore += 16;
            if (rk.r === 1) rookSeventhRankScore += 38;
        }
        for (const rk of bRooks) {
            if (wPawnsByFile[rk.c] === 0 && bPawnsByFile[rk.c] === 0) rookOpenFileScore -= 30;
            else if (bPawnsByFile[rk.c] === 0) rookOpenFileScore -= 16;
            if (rk.r === 6) rookSeventhRankScore -= 38;
        }
        if (wRooks.length >= 2 && (wRooks[0].r === wRooks[1].r || wRooks[0].c === wRooks[1].c)) connectedRookScore += 20;
        if (bRooks.length >= 2 && (bRooks[0].r === bRooks[1].r || bRooks[0].c === bRooks[1].c)) connectedRookScore -= 20;

        // 5. King Safety, Shield Pawns & Tropism
        if (wKingPos && !eg) {
            let shield = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const nr = wKingPos.r + dr, nc = wKingPos.c + dc;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] && board[nr][nc].type === 'p' && board[nr][nc].color === 'w') shield++;
            }
            kingSafetyScore += shield * 14;
            if ((wKingPos.c <= 2 || wKingPos.c >= 6) && wKingPos.r === 7) castlingScore += 28;
            if (wPawnsByFile[wKingPos.c] === 0) kingSafetyScore -= 28;
        }

        if (bKingPos && !eg) {
            let shield = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const nr = bKingPos.r + dr, nc = bKingPos.c + dc;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] && board[nr][nc].type === 'p' && board[nr][nc].color === 'b') shield++;
            }
            kingSafetyScore -= shield * 14;
            if ((bKingPos.c <= 2 || bKingPos.c >= 6) && bKingPos.r === 0) castlingScore -= 28;
            if (bPawnsByFile[bKingPos.c] === 0) kingSafetyScore += 28;
        }

        // King Tropism (Attacking cluster pressure)
        if (!eg && wKingPos && bKingPos) {
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = board[r][c];
                    if (!p || p.type === 'p' || p.type === 'k') continue;
                    if (p.color === 'w') {
                        const dist = Math.max(Math.abs(r - bKingPos.r), Math.abs(c - bKingPos.c));
                        kingTropismScore += (7 - dist) * 3.5;
                    } else {
                        const dist = Math.max(Math.abs(r - wKingPos.r), Math.abs(c - wKingPos.c));
                        kingTropismScore -= (7 - dist) * 3.5;
                    }
                }
            }
        }

        // 6. Mobility
        const mc = game.moves().length;
        const ms = game.turn() === 'w' ? 1 : -1;
        const mobilityScore = ms * mc * 2.5;

        // Composite Evaluation with Explicit Piece & Positional Stats
        return (
            // Piece Material Stats
            (w.pawnWeight * (wP - bP) * 100) +
            (w.knightWeight * (wN - bN) * 320) +
            (w.bishopWeight * (wB - bB) * 330) +
            (w.rookWeight * (wR - bR) * 500) +
            (w.queenWeight * (wQ - bQ) * 900) +

            // Piece Trait Stats
            (w.passedPawnWeight * passedPawnScore) +
            (w.pawnStructureWeight * pawnStructureScore) +
            (w.knightOutpostWeight * knightOutpostScore) +
            (w.bishopPairWeight * bishopPairScore) +
            (w.rookOpenFileWeight * rookOpenFileScore) +
            (w.rookSeventhRankWeight * rookSeventhRankScore) +
            (w.connectedRooksWeight * connectedRookScore) +
            (w.queenSafetyWeight * queenSafetyScore) +

            // King & Tactical Fortress Stats
            (w.kingSafetyWeight * kingSafetyScore) +
            (w.kingTropismWeight * kingTropismScore) +
            (w.castlingRewardWeight * castlingScore) +
            (w.tacticalSafetyWeight * tacticalSafetyScore) +

            // Board Dynamics & Space Stats
            (w.centerControlWeight * centerScore) +
            (w.spaceAdvantageWeight * spaceScore) +
            (w.pieceSquareWeight * pstScore) +
            (w.mobilityWeight * mobilityScore)
        );
    }

    getBreakdown(game) {
        const board = game.board();
        const w = this.weights;
        let wP = 0, bP = 0, wN = 0, bN = 0, wB = 0, bB = 0, wR = 0, bR = 0, wQ = 0, bQ = 0;
        let centerScore = 0, ksScore = 0;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                const s = p.color === 'w' ? 1 : -1;
                if (p.type === 'p') { if (p.color === 'w') wP++; else bP++; }
                else if (p.type === 'n') { if (p.color === 'w') wN++; else bN++; }
                else if (p.type === 'b') { if (p.color === 'w') wB++; else bB++; }
                else if (p.type === 'r') { if (p.color === 'w') wR++; else bR++; }
                else if (p.type === 'q') { if (p.color === 'w') wQ++; else bQ++; }
                if (r >= 2 && r <= 5 && c >= 2 && c <= 5) centerScore += s * 14;
            }
        }

        return {
            pawns: Math.round(w.pawnWeight * (wP - bP) * 100),
            knights: Math.round(w.knightWeight * (wN - bN) * 320),
            bishops: Math.round(w.bishopWeight * (wB - bB) * 330),
            rooks: Math.round(w.rookWeight * (wR - bR) * 500),
            queens: Math.round(w.queenWeight * (wQ - bQ) * 900),
            center: Math.round(w.centerControlWeight * centerScore),
            kingSafety: Math.round(w.kingSafetyWeight * ksScore)
        };
    }
}

// ── Smart Engine with Opening Book & Anti-Blunder Shield ────────────────────
class ChessEngine {
    constructor(weights, depth = 3) {
        this.evaluator = new Evaluator(weights);
        this.depth = Math.max(1, depth);
        this.nodesSearched = 0;
        this.cutoffs = 0;
    }

    getBookMove(game, consecutiveLosses = 0) {
        const hist = game.history();
        if (hist.length > 14) return null;
        const line = hist.join(' ');
        const options = OPENING_BOOK[line];
        if (!options || !options.length) return null;

        if (consecutiveLosses >= 2) {
            if (line === "e4") {
                const solid = options.filter(m => m === "c6" || m === "e6");
                if (solid.length) return solid[Math.floor(Math.random() * solid.length)];
            }
            if (line === "d4") {
                const solid = options.filter(m => m === "d5" || m === "Nf6");
                if (solid.length) return solid[Math.floor(Math.random() * solid.length)];
            }
        }

        const validMoves = game.moves();
        const bookMatches = options.filter(m => validMoves.includes(m));
        if (bookMatches.length > 0) {
            return bookMatches[Math.floor(Math.random() * bookMatches.length)];
        }
        return null;
    }

    quiesce(game, alpha, beta, isMax, qdepth = 0) {
        this.nodesSearched++;
        const standPat = this.evaluator.evaluate(game);
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
            const sc = this.quiesce(game, alpha, beta, !isMax, qdepth + 1);
            game.undo();
            if (isMax) {
                if (sc >= beta) { this.cutoffs++; return beta; }
                if (sc > alpha) alpha = sc;
            } else {
                if (sc <= alpha) { this.cutoffs++; return alpha; }
                if (sc < beta) beta = sc;
            }
        }
        return isMax ? alpha : beta;
    }

    alphaBeta(game, depth, alpha, beta, isMax) {
        this.nodesSearched++;
        if (game.in_checkmate()) return isMax ? -99000 + (this.depth - depth) : 99000 - (this.depth - depth);
        if (game.in_draw() || game.in_stalemate()) return 0;
        if (depth <= 0) return this.quiesce(game, alpha, beta, isMax, 0);

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
                const sc = this.alphaBeta(game, depth - 1, alpha, beta, false);
                game.undo();
                best = Math.max(best, sc);
                alpha = Math.max(alpha, sc);
                if (beta <= alpha) { this.cutoffs++; break; }
            }
            return best;
        } else {
            let best = Infinity;
            for (const m of moves) {
                game.move(m);
                const sc = this.alphaBeta(game, depth - 1, alpha, beta, true);
                game.undo();
                best = Math.min(best, sc);
                beta = Math.min(beta, sc);
                if (beta <= alpha) { this.cutoffs++; break; }
            }
            return best;
        }
    }

    verifyMoveSafety(game, candidateMove) {
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
                const ev = this.evaluator.evaluate(game);
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

    async chooseBestMove(game, onProgress, allowYield, consecutiveLosses = 0) {
        this.nodesSearched = 0;
        this.cutoffs = 0;
        const moves = game.moves();
        if (!moves.length) return null;

        // 1. Opening Book
        const bookMove = this.getBookMove(game, consecutiveLosses);
        if (bookMove) {
            return {
                move: bookMove,
                san: bookMove,
                score: 0,
                nodes: 1,
                cutoffs: 0,
                timeMs: 4,
                nps: 1000,
                depth: this.depth,
                pv: [bookMove],
                isBook: true,
                breakdown: this.evaluator.getBreakdown(game)
            };
        }

        // 2. Alpha-Beta Minimax Search
        const isMax = game.turn() === 'w';
        let bestScore = isMax ? -Infinity : Infinity;
        let bestMove = moves[0];
        const t0 = performance.now();

        const searchDepth = Math.max(1, Math.min(4, this.depth));

        const sortedMoves = [...moves].sort((a, b) => {
            const aScore = (a.includes('#') ? 8 : 0) + (a.includes('+') ? 4 : 0) + (a.includes('x') ? 2 : 0);
            const bScore = (b.includes('#') ? 8 : 0) + (b.includes('+') ? 4 : 0) + (b.includes('x') ? 2 : 0);
            return bScore - aScore;
        });

        for (const move of sortedMoves) {
            const safetyPenalty = this.verifyMoveSafety(game, move);
            if (safetyPenalty <= -5000 && sortedMoves.length > 1) continue;

            game.move(move);
            const score = this.alphaBeta(game, searchDepth - 1, -Infinity, Infinity, !isMax);
            game.undo();

            const finalScore = score + safetyPenalty;

            if (isMax ? (finalScore > bestScore) : (finalScore < bestScore)) {
                bestScore = finalScore;
                bestMove = move;
            }

            if (onProgress) onProgress(searchDepth, bestScore, bestMove, move, this.nodesSearched, this.cutoffs);
            if (allowYield) await new Promise(r => setTimeout(r, 0));
        }

        const elapsed = Math.max(1, Math.round(performance.now() - t0));
        const nps = Math.round((this.nodesSearched / elapsed) * 1000);

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

        return {
            move: bestMove,
            san: bestMove,
            score: bestScore,
            nodes: this.nodesSearched,
            cutoffs: this.cutoffs,
            timeMs: elapsed,
            nps,
            depth: searchDepth,
            pv: pvLine,
            isBook: false,
            breakdown: this.evaluator.getBreakdown(game)
        };
    }
}

// ── Ultra-Fast Sparring Bot for Zero-Lag Training ───────────────────────────
class SparringBot {
    constructor(elo = 800) {
        this.elo = elo;
        this.evaluator = new Evaluator();
    }

    async chooseBestMove(game, onProgress, allowYield) {
        const moves = game.moves();
        if (!moves.length) return null;

        const hist = game.history();
        if (hist.length <= 10) {
            const line = hist.join(' ');
            const options = OPENING_BOOK[line];
            if (options && options.length) {
                const bookMatches = options.filter(m => moves.includes(m));
                if (bookMatches.length > 0) {
                    const m = bookMatches[Math.floor(Math.random() * bookMatches.length)];
                    return { move: m, san: m, score: 0, nodes: 1, cutoffs: 0, timeMs: 1, nps: 1000, depth: 1, pv: [m], isBook: true };
                }
            }
        }

        let blunderChance = 0;
        if (this.elo <= 400) blunderChance = 0.35;
        else if (this.elo <= 800) blunderChance = 0.14;
        else if (this.elo <= 1200) blunderChance = 0.04;

        if (Math.random() < blunderChance) {
            const m = moves[Math.floor(Math.random() * moves.length)];
            return { move: m, san: m, score: 0, nodes: 1, cutoffs: 0, timeMs: 1, nps: 1000, depth: 1, pv: [m] };
        }

        const isWhite = game.turn() === 'w';
        let bestScore = isWhite ? -Infinity : Infinity;
        let bestMove = moves[0];

        for (const m of moves) {
            game.move(m);
            if (game.in_checkmate()) {
                game.undo();
                return { move: m, san: m, score: isWhite ? 99000 : -99000, nodes: 10, cutoffs: 0, timeMs: 2, nps: 5000, depth: 1, pv: [m] };
            }
            const ev = this.evaluator.evaluate(game);
            game.undo();
            if (isWhite ? (ev > bestScore) : (ev < bestScore)) {
                bestScore = ev;
                bestMove = m;
            }
        }

        return { move: bestMove, san: bestMove, score: bestScore, nodes: moves.length, cutoffs: 0, timeMs: 3, nps: 8000, depth: 1, pv: [bestMove] };
    }
}

// ---------------------------------------------------------------------------
// PositionAnalyzer — 2-Ply Precision Candidate Moves & Game Review
// ---------------------------------------------------------------------------
class PositionAnalyzer {
    constructor(evaluator) {
        this.evaluator = evaluator;
    }

    winProbability(evalCp) {
        return Math.max(1, Math.min(99, 50 + 50 * Math.tanh(evalCp / 300)));
    }

    evaluateMoveTactical(game, mv, isWhite) {
        game.move(mv.san);
        if (game.in_checkmate()) {
            game.undo();
            return isWhite ? 99000 : -99000;
        }
        if (game.in_draw() || game.in_stalemate()) {
            game.undo();
            return 0;
        }

        const oppReplies = game.moves();
        let bestOppScore = isWhite ? Infinity : -Infinity;

        if (!oppReplies.length) {
            bestOppScore = this.evaluator.evaluate(game);
        } else {
            oppReplies.sort((a, b) => {
                const aS = (a.includes('#') ? 8 : 0) + (a.includes('+') ? 4 : 0) + (a.includes('x') ? 2 : 0);
                const bS = (b.includes('#') ? 8 : 0) + (b.includes('+') ? 4 : 0) + (b.includes('x') ? 2 : 0);
                return bS - aS;
            });

            const limit = Math.min(oppReplies.length, 6);
            for (let i = 0; i < limit; i++) {
                game.move(oppReplies[i]);
                const sc = this.evaluator.evaluate(game);
                game.undo();
                if (isWhite) {
                    if (sc < bestOppScore) bestOppScore = sc;
                } else {
                    if (sc > bestOppScore) bestOppScore = sc;
                }
            }
        }

        game.undo();
        return bestOppScore;
    }

    analyzePosition(game) {
        if (game.game_over()) return null;
        const moves = game.moves({ verbose: true });
        if (!moves.length) return null;

        const isWhite = game.turn() === 'w';
        const scored = [];

        moves.forEach(mv => {
            const tacticalScore = this.evaluateMoveTactical(game, mv, isWhite);
            const ps = isWhite ? tacticalScore : -tacticalScore;
            scored.push({
                san: mv.san,
                from: mv.from,
                to: mv.to,
                isCapture: !!mv.captured,
                isCheck: mv.san.includes('+'),
                playerScore: ps,
                piece: mv.piece
            });
        });

        scored.sort((a, b) => b.playerScore - a.playerScore);
        const best = scored[0].playerScore;

        const T = 90;
        const exps = scored.map(m => Math.exp(Math.max(-8, (m.playerScore - best) / T)));
        const expSum = exps.reduce((s, e) => s + e, 0) || 1;

        scored.forEach((m, i) => {
            m.evalLoss = Math.max(0, best - m.playerScore);
            m.humanProb = Math.max(0.5, (exps[i] / expSum) * 100);
            m.sfLoss = -(m.evalLoss / 100);

            if (m.evalLoss <= 18) m.category = 'best';
            else if (m.evalLoss <= 65) m.category = 'inaccuracy';
            else if (m.evalLoss <= 180) m.category = 'mistake';
            else m.category = 'blunder';
        });

        const engineEvalCp = isWhite ? best : -best;
        const top4 = scored.slice(0, 4);

        return {
            moves: scored,
            top4,
            engineEvalCp,
            winProb: this.winProbability(engineEvalCp),
            bestHumanMove: scored.reduce((a, b) => (b.humanProb > a.humanProb ? b : a), scored[0]),
            numBest: scored.filter(m => m.category === 'best').length,
            numInaccuracies: scored.filter(m => m.category === 'inaccuracy').length,
            numMistakes: scored.filter(m => m.category === 'mistake').length,
            numBlunders: scored.filter(m => m.category === 'blunder').length,
            total: scored.length
        };
    }

    getMovesByRating(top4) {
        if (!top4 || !top4.length) return null;
        const ratings = [1000, 1200, 1400, 1600, 1800, 2000];
        const series = top4.map(m => ({ label: m.san, data: [] }));
        const scores = top4.map(m => m.playerScore);
        const mx = Math.max(...scores);

        ratings.forEach(rating => {
            const temp = Math.max(16, 210 - ((rating - 1000) / 1000) * 185);
            const skill = (rating - 900) / 1100;
            const exps = scores.map(s => {
                const loss = mx - s;
                const penalty = loss * (1 + skill * 1.4);
                return Math.exp(-penalty / temp);
            });
            const sum = exps.reduce((a, b) => a + b, 0) || 1;
            series.forEach((ser, i) => {
                const pct = Math.max(1, Math.min(96, (exps[i] / sum) * 100));
                ser.data.push(parseFloat(pct.toFixed(1)));
            });
        });
        return { ratings, series };
    }

    // Comprehensive Post-Game Review (Chess.com Style)
    analyzeGame(pgn) {
        if (!pgn) return null;
        const tempGame = new Chess();
        try { tempGame.load_pgn(pgn); } catch (e) { return null; }
        const history = tempGame.history({ verbose: true });
        if (!history.length) return null;

        // PGNs can start from a custom FEN (for example, a FEN imported by the
        // user). Rewind the parsed game to recover that position before
        // replaying moves; starting from the standard board makes those moves
        // illegal and leaves every review position at the initial board.
        while (tempGame.history().length) tempGame.undo();

        const moveAnalysis = [];
        const replayGame = new Chess();
        if (!replayGame.load(tempGame.fen())) return null;

        let whiteTotalLoss = 0, blackTotalLoss = 0;
        let whiteMoveCount = 0, blackMoveCount = 0;
        const keyMoments = [];

        for (let i = 0; i < history.length; i++) {
            const mv = history[i];
            const isWhiteTurn = replayGame.turn() === 'w';

            const legalMoves = replayGame.moves({ verbose: true });
            let bestEvalForPlayer = -Infinity;
            let bestMoveSan = legalMoves[0]?.san || mv.san;
            let bestMoveFrom = legalMoves[0]?.from || mv.from;
            let bestMoveTo = legalMoves[0]?.to || mv.to;

            legalMoves.forEach(m => {
                const tacticalScore = this.evaluateMoveTactical(replayGame, m, isWhiteTurn);
                const pScore = isWhiteTurn ? tacticalScore : -tacticalScore;
                if (pScore > bestEvalForPlayer) {
                    bestEvalForPlayer = pScore;
                    bestMoveSan = m.san;
                    bestMoveFrom = m.from;
                    bestMoveTo = m.to;
                }
            });

            const actualTactical = this.evaluateMoveTactical(replayGame, mv, isWhiteTurn);
            const actualPlayerEval = isWhiteTurn ? actualTactical : -actualTactical;
            const evalLoss = Math.max(0, bestEvalForPlayer - actualPlayerEval);
            if (!replayGame.move(mv.san)) return null;
            const actualEval = actualTactical;

            if (isWhiteTurn) {
                whiteTotalLoss += evalLoss;
                whiteMoveCount++;
            } else {
                blackTotalLoss += evalLoss;
                blackMoveCount++;
            }

            let classification = 'book';
            if (i >= 4) {
                if (bestEvalForPlayer >= 250 && actualPlayerEval <= 60) {
                    classification = 'missed_win';
                } else if (evalLoss > 260) {
                    classification = 'blunder';
                } else if (evalLoss > 100) {
                    classification = 'mistake';
                } else if (evalLoss > 35) {
                    classification = 'inaccuracy';
                } else if (evalLoss > 12) {
                    classification = 'good';
                } else {
                    if (mv.captured && evalLoss <= 8 && actualPlayerEval > 120) {
                        classification = 'brilliant';
                    } else {
                        classification = 'best';
                    }
                }
            }

            const evalWhitePerspective = actualEval;
            const winProb = this.winProbability(evalWhitePerspective);

            const moveRecord = {
                moveIndex: i,
                moveNum: Math.floor(i / 2) + 1,
                san: mv.san,
                color: mv.color,
                from: mv.from,
                to: mv.to,
                evalCp: evalWhitePerspective,
                evalLoss: Math.round(evalLoss),
                classification,
                winProb,
                bestMoveSan,
                bestMoveFrom,
                bestMoveTo,
                fen: replayGame.fen()
            };

            moveAnalysis.push(moveRecord);

            if (evalLoss >= 180 || classification === 'missed_win' || classification === 'brilliant') {
                keyMoments.push({
                    moveIndex: i,
                    moveNum: moveRecord.moveNum,
                    san: mv.san,
                    color: mv.color,
                    evalLoss: moveRecord.evalLoss,
                    classification,
                    bestMoveSan
                });
            }
        }

        const whiteAvgLoss = whiteMoveCount > 0 ? (whiteTotalLoss / whiteMoveCount) : 35;
        const blackAvgLoss = blackMoveCount > 0 ? (blackTotalLoss / blackMoveCount) : 35;

        const calcAccuracy = (avgLoss) => {
            const acc = 100 * Math.exp(-0.0033 * avgLoss);
            return parseFloat(Math.max(35, Math.min(99.4, acc)).toFixed(1));
        };

        const whiteAccuracy = calcAccuracy(whiteAvgLoss);
        const blackAccuracy = calcAccuracy(blackAvgLoss);

        const whitePerf = Math.round(Math.max(600, Math.min(2600, 750 + (whiteAccuracy - 50) * 35)));
        const blackPerf = Math.round(Math.max(600, Math.min(2600, 750 + (blackAccuracy - 50) * 35)));

        return {
            moves: moveAnalysis,
            whiteAccuracy,
            blackAccuracy,
            whitePerf,
            blackPerf,
            keyMoments: keyMoments.slice(0, 4),
            totalMoves: history.length
        };
    }
}

// ---------------------------------------------------------------------------
// Skill model (mirrors engine_server/src/EvalWeights.h)
//   13 stats. Level 1 = new bot, 10 = full knowledge, no maximum.
//   Knowledge stats: weight = 2L / (L + 10) (diminishing returns, never above 2).
//   Calculation sets search depth: 1 ply + 1 per 5 levels.
//   Learning (post-game review + 3 stat points) runs in the C++ engine; when the
//   C++ server is offline the browser only keeps statistics and Elo.
// ---------------------------------------------------------------------------
const STAT_KEYS = [
    'development', 'centerControl', 'piecePlacement', 'mobility', 'kingSafety',
    'pawnStructure', 'passedPawns', 'bishopPair', 'rookActivity', 'knightOutposts',
    'threatAwareness', 'kingAttack', 'calculation'
];
const STAT_LABELS = {
    development: 'Development', centerControl: 'Center control', piecePlacement: 'Piece placement',
    mobility: 'Mobility', kingSafety: 'King safety', pawnStructure: 'Pawn structure',
    passedPawns: 'Passed pawns', bishopPair: 'Bishop pair', rookActivity: 'Rook activity',
    knightOutposts: 'Knight outposts', threatAwareness: 'Threat awareness', kingAttack: 'King attack',
    calculation: 'Calculation'
};
const SKILL_START = 1, SKILL_MASTER = 10;

function startingSkill() {
    const s = {};
    STAT_KEYS.forEach(k => { s[k] = SKILL_START; });
    return s;
}
function skillLevel(skill, k) {
    const v = skill && typeof skill[k] === 'number' && isFinite(skill[k]) ? skill[k] : SKILL_START;
    return Math.max(0, v);
}
function weightFromLevel(L) { return L <= 0 ? 0 : 2 * L / (L + SKILL_MASTER); }
function weightsFromSkill(skill) {
    const w = { material: 1.0 };
    STAT_KEYS.forEach(k => { if (k !== 'calculation') w[k] = weightFromLevel(skillLevel(skill, k)); });
    return w;
}
function depthFromSkill(skill) {
    return Math.max(1, 1 + Math.floor(skillLevel(skill, 'calculation') / 5));
}
// The browser-only engine is much slower than the C++ one: cap it at 4 plies.
function offlineDepth(skill) { return Math.min(4, depthFromSkill(skill)); }
// Stat points a game is worth (same rule as the C++ engine): 4 for the first 50 games,
// then 1 + 3 x 50 / games (2.5 at game 100, 1.3 at game 500), never below 1.
function pointsForGame(gamesPlayed) {
    return gamesPlayed < 50 ? 4 : 1 + 3 * 50 / gamesPlayed;
}
function skillAverage(skill) {
    return STAT_KEYS.reduce((a, k) => a + skillLevel(skill, k), 0) / STAT_KEYS.length;
}
// Map the stat weights onto the browser engine's own evaluator (offline mode)
function jsEvalWeights(w) {
    const g = k => (w && typeof w[k] === 'number' ? w[k] : weightFromLevel(SKILL_START));
    return {
        pawnWeight: 1, knightWeight: 1, bishopWeight: 1, rookWeight: 1, queenWeight: 1,
        passedPawnWeight: g('passedPawns'), pawnStructureWeight: g('pawnStructure'),
        knightOutpostWeight: g('knightOutposts'), bishopPairWeight: g('bishopPair'),
        rookOpenFileWeight: g('rookActivity'), rookSeventhRankWeight: g('rookActivity'),
        connectedRooksWeight: g('rookActivity'), queenSafetyWeight: g('threatAwareness'),
        kingSafetyWeight: g('kingSafety'), kingTropismWeight: g('kingAttack'),
        castlingRewardWeight: g('development'), tacticalSafetyWeight: g('threatAwareness'),
        centerControlWeight: g('centerControl'), spaceAdvantageWeight: g('centerControl'),
        pieceSquareWeight: g('piecePlacement'), mobilityWeight: g('mobility')
    };
}

class LearningSystem {
    constructor() {
        this.defaultData = {
            version: 3,
            elo: 400,
            games: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            consecutiveLosses: 0,
            skill: startingSkill(),
            weights: weightsFromSkill(startingSkill()),
            history: []
        };
    }

    _clone(o) { return JSON.parse(JSON.stringify(o)); }

    load() {
        try {
            const raw = localStorage.getItem('omegaChessData');
            if (!raw) return this._clone(this.defaultData);
            const d = JSON.parse(raw);
            // Older browser data used a different model: start a fresh beginner
            if (!d || d.version !== 3 || !d.skill) return this._clone(this.defaultData);
            STAT_KEYS.forEach(k => { d.skill[k] = skillLevel(d.skill, k); });
            d.weights = weightsFromSkill(d.skill);
            if (!Array.isArray(d.history)) d.history = [];
            if (d.consecutiveLosses === undefined) d.consecutiveLosses = 0;
            return d;
        } catch (e) {
            return this._clone(this.defaultData);
        }
    }

    save(d) {
        try { localStorage.setItem('omegaChessData', JSON.stringify(d)); } catch (e) {}
    }

    reset() {
        const d = this._clone(this.defaultData);
        this.save(d);
        return d;
    }

    expectedScore(elo, opp) {
        return 1 / (1 + Math.pow(10, (opp - elo) / 400));
    }

    // Offline fallback: standard Elo + statistics only (stats grow in the C++ engine).
    learn(result, data, oppElo = 800, fen = null, pgn = '') {
        const oldElo = data.elo;
        data.consecutiveLosses = result === 'loss' ? (data.consecutiveLosses || 0) + 1 : 0;
        const expected = this.expectedScore(data.elo, oppElo);
        const actual = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5;
        data.elo = parseFloat(Math.max(100, data.elo + 32 * (actual - expected)).toFixed(1));
        if (result === 'win') data.wins++;
        else if (result === 'loss') data.losses++;
        else data.draws++;
        data.games++;

        const lastStep = {
            result,
            eloBefore: oldElo,
            eloAfter: data.elo,
            eloDelta: parseFloat((data.elo - oldElo).toFixed(1)),
            expected,
            depth: depthFromSkill(data.skill),
            consecutiveLosses: data.consecutiveLosses,
            offline: true,
            notice: 'C++ engine offline: Elo updated, no review and no stat points.',
            points: {}
        };
        data.lastStep = lastStep;
        data.history.unshift({
            game: data.games, result, fen, pgn,
            eloChange: lastStep.eloDelta, eloAfter: data.elo,
            depth: lastStep.depth, offline: true, notice: lastStep.notice, points: {}
        });
        if (data.history.length > 200) data.history.pop();
        this.save(data);
        return lastStep;
    }
}
