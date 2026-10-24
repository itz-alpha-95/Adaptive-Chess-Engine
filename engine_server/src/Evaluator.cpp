#include "Evaluator.h"
#include <cmath>
#include <cstdlib>
#include <algorithm>

const int Evaluator::PAWN_TABLE[64] = {
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
};

const int Evaluator::KNIGHT_TABLE[64] = {
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
};

const int Evaluator::BISHOP_TABLE[64] = {
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
};

const int Evaluator::ROOK_TABLE[64] = {
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
};

const int Evaluator::QUEEN_TABLE[64] = {
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
};

const int Evaluator::KING_TABLE[64] = {
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
};

const int Evaluator::KING_END_TABLE[64] = {
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50
};

Evaluator::Evaluator(const EvalWeights& w) : weights(w) {}

int Evaluator::pieceValue(PieceType pt) {
    switch (pt) {
        case PieceType::Pawn:   return 100;
        case PieceType::Knight: return 320;
        case PieceType::Bishop: return 330;
        case PieceType::Rook:   return 500;
        case PieceType::Queen:  return 900;
        case PieceType::King:   return 20000;
        default: return 0;
    }
}

int Evaluator::getPST(PieceType pt, Color col, int sq, bool endgame) const {
    const int* tbl = nullptr;
    switch (pt) {
        case PieceType::Pawn:   tbl = PAWN_TABLE; break;
        case PieceType::Knight: tbl = KNIGHT_TABLE; break;
        case PieceType::Bishop: tbl = BISHOP_TABLE; break;
        case PieceType::Rook:   tbl = ROOK_TABLE; break;
        case PieceType::Queen:  tbl = QUEEN_TABLE; break;
        case PieceType::King:   tbl = endgame ? KING_END_TABLE : KING_TABLE; break;
        default: return 0;
    }
    int idx = (col == Color::White) ? sq : (63 - sq);
    return tbl[idx];
}

namespace {

// Board: square = row * 8 + col, row 0 = rank 8. White moves toward row 0.
inline bool isPiece(const ChessPosition& pos, int sq, PieceType t, Color c) {
    const Piece& p = pos.board[sq];
    return p.type == t && p.color == c;
}

struct SideInfo {
    int pawnsOnFile[8] = {0};
    int kingSq = -1;
    int bishops = 0;
    int nonPawnMaterial = 0;
    bool hasQueen = false;
};

// ── Development: minor pieces off their home squares, castling, no early queen ──
int developmentFor(const ChessPosition& pos, Color c) {
    const bool white = (c == Color::White);
    const int knightHome[2] = { white ? 57 : 1, white ? 62 : 6 };
    const int bishopHome[2] = { white ? 58 : 2, white ? 61 : 5 };
    int undeveloped = 0;
    for (int i = 0; i < 2; ++i) {
        if (isPiece(pos, knightHome[i], PieceType::Knight, c)) undeveloped++;
        if (isPiece(pos, bishopHome[i], PieceType::Bishop, c)) undeveloped++;
    }
    int score = -12 * undeveloped;

    const int kingHome = white ? 60 : 4;
    int kingSq = -1;
    for (int sq = 0; sq < 64; ++sq) if (isPiece(pos, sq, PieceType::King, c)) { kingSq = sq; break; }
    const int castledShort = white ? 62 : 6, castledLong1 = white ? 58 : 2, castledLong2 = white ? 57 : 1;
    if (kingSq == castledShort || kingSq == castledLong1 || kingSq == castledLong2) score += 25;
    else if (kingSq != kingHome) score -= 15;   // king moved without castling

    const int queenHome = white ? 59 : 3;
    if (!isPiece(pos, queenHome, PieceType::Queen, c) && undeveloped >= 2) score -= 15; // early queen
    return score;
}

// ── King safety: pawn shield, open files near the king, attacked squares around it ──
int kingSafetyFor(const ChessPosition& pos, Color c, const SideInfo& own) {
    if (own.kingSq < 0) return 0;
    const Color opp = (c == Color::White) ? Color::Black : Color::White;
    const int r = own.kingSq / 8, col = own.kingSq % 8;
    const int fwd = (c == Color::White) ? -1 : 1;
    const bool onBackRanks = (c == Color::White) ? (r >= 6) : (r <= 1);

    int score = 0;
    if (!onBackRanks) {
        score -= 30;
    } else {
        for (int dc = -1; dc <= 1; ++dc) {
            int nc = col + dc;
            if (nc < 0 || nc > 7) continue;
            int r1 = r + fwd, r2 = r + 2 * fwd;
            bool p1 = (r1 >= 0 && r1 < 8) && isPiece(pos, r1 * 8 + nc, PieceType::Pawn, c);
            bool p2 = (r2 >= 0 && r2 < 8) && isPiece(pos, r2 * 8 + nc, PieceType::Pawn, c);
            if (p1) score += 12;
            else if (p2) score += 6;
            else if (own.pawnsOnFile[nc] == 0) score -= 15;
            else score -= 5;
        }
    }
    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            int nr = r + dr, nc = col + dc;
            if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
            if (pos.isSquareAttacked(nr * 8 + nc, opp)) score -= 6;
        }
    }
    return score;
}

// ── Pawn structure (doubled, isolated) and passed pawns ──
void pawnsFor(const ChessPosition& pos, Color c, const SideInfo& own, bool endgame,
              int& structure, int& passed) {
    const Color opp = (c == Color::White) ? Color::Black : Color::White;
    structure = 0;
    passed = 0;
    for (int f = 0; f < 8; ++f) if (own.pawnsOnFile[f] > 1) structure -= 15 * (own.pawnsOnFile[f] - 1);
    for (int sq = 0; sq < 64; ++sq) {
        if (!isPiece(pos, sq, PieceType::Pawn, c)) continue;
        const int r = sq / 8, f = sq % 8;
        const bool left  = (f > 0 && own.pawnsOnFile[f - 1] > 0);
        const bool right = (f < 7 && own.pawnsOnFile[f + 1] > 0);
        if (!left && !right) structure -= 12;

        bool isPassed = true;
        for (int df = -1; df <= 1 && isPassed; ++df) {
            int nf = f + df;
            if (nf < 0 || nf > 7) continue;
            for (int rr = 0; rr < 8; ++rr) {
                bool ahead = (c == Color::White) ? (rr < r) : (rr > r);
                if (ahead && isPiece(pos, rr * 8 + nf, PieceType::Pawn, opp)) { isPassed = false; break; }
            }
        }
        if (isPassed) {
            int advance = (c == Color::White) ? (6 - r) : (r - 1);   // 0 on the start rank .. 5 on the 7th
            int bonus = 10 + 8 * advance;
            passed += endgame ? (bonus * 3) / 2 : bonus;
        }
    }
}

// ── Rooks on open / half-open files and on the 7th rank ──
int rookActivityFor(const ChessPosition& pos, Color c, const SideInfo& own, const SideInfo& enemy) {
    int score = 0;
    const int seventhRow = (c == Color::White) ? 1 : 6;
    for (int sq = 0; sq < 64; ++sq) {
        if (!isPiece(pos, sq, PieceType::Rook, c)) continue;
        const int f = sq % 8;
        if (own.pawnsOnFile[f] == 0) score += (enemy.pawnsOnFile[f] == 0) ? 20 : 10;
        if (sq / 8 == seventhRow) score += 20;
    }
    return score;
}

// ── Knights on protected squares in enemy territory that enemy pawns can't attack ──
int knightOutpostsFor(const ChessPosition& pos, Color c) {
    const bool white = (c == Color::White);
    const Color opp = white ? Color::Black : Color::White;
    int score = 0;
    for (int sq = 0; sq < 64; ++sq) {
        if (!isPiece(pos, sq, PieceType::Knight, c)) continue;
        const int r = sq / 8, f = sq % 8;
        if (white ? (r < 2 || r > 4) : (r < 3 || r > 5)) continue;   // relative ranks 4-6
        const int behind = white ? r + 1 : r - 1;
        bool defended = false;
        for (int df : {-1, 1}) {
            int nf = f + df;
            if (nf >= 0 && nf < 8 && isPiece(pos, behind * 8 + nf, PieceType::Pawn, c)) defended = true;
        }
        if (!defended) continue;
        bool attackable = false;
        for (int df : {-1, 1}) {
            int nf = f + df;
            if (nf < 0 || nf > 7) continue;
            for (int rr = 0; rr < 8; ++rr) {
                bool canReach = white ? (rr <= r - 1) : (rr >= r + 1);
                if (canReach && isPiece(pos, rr * 8 + nf, PieceType::Pawn, opp)) { attackable = true; break; }
            }
        }
        if (attackable) continue;
        score += 20 + ((f >= 2 && f <= 5) ? 10 : 0);
    }
    return score;
}

// ── Hanging pieces: attacked by the opponent and not defended ──
int threatsFor(const ChessPosition& pos, Color c) {
    const Color opp = (c == Color::White) ? Color::Black : Color::White;
    int score = 0;
    for (int sq = 0; sq < 64; ++sq) {
        const Piece& p = pos.board[sq];
        if (p.color != c || p.type == PieceType::None || p.type == PieceType::King) continue;
        if (pos.isSquareAttacked(sq, opp) && !pos.isSquareAttacked(sq, c)) {
            score -= Evaluator::pieceValue(p.type) / 5;
        }
    }
    return score;
}

// ── Pieces close to the enemy king ──
int kingAttackFor(const ChessPosition& pos, Color c, const SideInfo& enemy) {
    if (enemy.kingSq < 0) return 0;
    const int kr = enemy.kingSq / 8, kc = enemy.kingSq % 8;
    int score = 0;
    for (int sq = 0; sq < 64; ++sq) {
        const Piece& p = pos.board[sq];
        if (p.color != c) continue;
        int dist = std::max(std::abs(sq / 8 - kr), std::abs(sq % 8 - kc));
        if (dist > 2) continue;
        switch (p.type) {
            case PieceType::Knight:
            case PieceType::Bishop: score += 8; break;
            case PieceType::Rook:   score += 10; break;
            case PieceType::Queen:  score += 15; break;
            default: break;
        }
    }
    return score;
}

} // namespace

EvalFeatures Evaluator::computeFeatures(ChessPosition& pos) const {
    EvalFeatures ft;
    SideInfo side[2];   // 0 = White, 1 = Black

    for (int sq = 0; sq < 64; ++sq) {
        const Piece& p = pos.board[sq];
        if (p.isEmpty()) continue;
        SideInfo& si = side[p.color == Color::White ? 0 : 1];
        switch (p.type) {
            case PieceType::Pawn:   si.pawnsOnFile[sq % 8]++; break;
            case PieceType::King:   si.kingSq = sq; break;
            case PieceType::Bishop: si.bishops++; si.nonPawnMaterial += pieceValue(p.type); break;
            case PieceType::Queen:  si.hasQueen = true; si.nonPawnMaterial += pieceValue(p.type); break;
            default:                si.nonPawnMaterial += pieceValue(p.type); break;
        }
    }
    const int npm = side[0].nonPawnMaterial + side[1].nonPawnMaterial;
    const bool anyQueen = side[0].hasQueen || side[1].hasQueen;
    const bool endgame = (!anyQueen && npm <= 3400) || npm <= 2000;
    const bool opening = npm >= 4600;

    for (int sq = 0; sq < 64; ++sq) {
        const Piece& p = pos.board[sq];
        if (p.isEmpty()) continue;
        const int sign = (p.color == Color::White) ? 1 : -1;
        if (p.type != PieceType::King) ft.material += sign * pieceValue(p.type);
        ft.f[ST_PLACEMENT] += sign * getPST(p.type, p.color, sq, endgame);
        if (p.type == PieceType::Pawn || p.type == PieceType::Knight || p.type == PieceType::Bishop) {
            int r = sq / 8, c = sq % 8;
            if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
                ft.f[ST_CENTER] += sign * 8;
                if ((r == 3 || r == 4) && (c == 3 || c == 4)) ft.f[ST_CENTER] += sign * 6;
            }
        }
    }

    if (opening) {
        ft.f[ST_DEVELOPMENT] = developmentFor(pos, Color::White) - developmentFor(pos, Color::Black);
    }

    ft.f[ST_MOBILITY] = 2 * ((int)pos.generatePseudoMoves(Color::White).size()
                           - (int)pos.generatePseudoMoves(Color::Black).size());

    if (!endgame) {
        ft.f[ST_KING_SAFETY] = kingSafetyFor(pos, Color::White, side[0]) - kingSafetyFor(pos, Color::Black, side[1]);
        ft.f[ST_KING_ATTACK] = kingAttackFor(pos, Color::White, side[1]) - kingAttackFor(pos, Color::Black, side[0]);
    }

    int wStruct, wPassed, bStruct, bPassed;
    pawnsFor(pos, Color::White, side[0], endgame, wStruct, wPassed);
    pawnsFor(pos, Color::Black, side[1], endgame, bStruct, bPassed);
    ft.f[ST_PAWN_STRUCTURE] = wStruct - bStruct;
    ft.f[ST_PASSED_PAWNS]   = wPassed - bPassed;

    ft.f[ST_BISHOP_PAIR] = (side[0].bishops >= 2 ? 40 : 0) - (side[1].bishops >= 2 ? 40 : 0);
    ft.f[ST_ROOK_ACTIVITY] = rookActivityFor(pos, Color::White, side[0], side[1])
                           - rookActivityFor(pos, Color::Black, side[1], side[0]);
    ft.f[ST_KNIGHT_OUTPOSTS] = knightOutpostsFor(pos, Color::White) - knightOutpostsFor(pos, Color::Black);
    ft.f[ST_THREATS] = threatsFor(pos, Color::White) - threatsFor(pos, Color::Black);
    return ft;
}

EvalBreakdown Evaluator::getBreakdown(ChessPosition& pos) {
    EvalBreakdown bd;
    bd.raw = computeFeatures(pos);
    bd.material = (int)(weights.material * bd.raw.material);
    bd.totalScore = bd.material;
    for (int s = 0; s < NUM_EVAL_STATS; ++s) {
        bd.f[s] = (int)std::lround(weights.w[s] * bd.raw.f[s]);
        bd.totalScore += bd.f[s];
    }
    return bd;
}

int Evaluator::evaluate(ChessPosition& pos) {
    return getBreakdown(pos).totalScore;
}
