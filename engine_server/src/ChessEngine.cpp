// =============================================================================
//  ChessEngine.cpp — Minimax with Alpha-Beta pruning
//    + iterative deepening (depth 1, 2, ... target) with a per-move time limit
//    + transposition table (positions already searched are not searched again)
//    + move ordering: hash move, captures (MVV-LVA), killer moves, history heuristic
//    + quiescence (capture) search at the leaves
//    + optional random wobble at the root (beginner-like play)
// =============================================================================
#include "ChessEngine.h"
#include <algorithm>
#include <iostream>
#include <cstdlib>
#include <cstring>

ChessEngine::ChessEngine(Evaluator& eval, int depth)
    : eval_(eval), defaultDepth_(depth), tt_(TT_SIZE) {
    std::memset(history_, 0, sizeof(history_));
}

bool ChessEngine::timeUp() {
    if (!canAbort_ || timeLimitMs_ <= 0) return false;
    if (aborted_) return true;
    if ((nodes_ & 1023) != 0) return false;
    auto now = std::chrono::high_resolution_clock::now();
    if (std::chrono::duration_cast<std::chrono::milliseconds>(now - start_).count() >= timeLimitMs_) aborted_ = true;
    return aborted_;
}

// Order: hash/previous best move, winning captures (MVV-LVA), promotions, killer moves, history.
void ChessEngine::orderMoves(std::vector<Move>& moves, ChessPosition& pos, const Move* first, int ply) {
    for (auto& m : moves) {
        int priority = 0;
        const Piece& victim = pos.board[m.toSq];
        const Piece& attacker = pos.board[m.fromSq];
        const bool capture = !victim.isEmpty() || (attacker.type == PieceType::Pawn && m.toSq == pos.epSquare);
        if (capture) {
            int v = victim.isEmpty() ? 100 : Evaluator::pieceValue(victim.type);
            priority += 100000 + v * 10 - Evaluator::pieceValue(attacker.type) / 10;
        } else if (ply >= 0 && ply < MAX_PLY) {
            if (m == killers_[ply][0]) priority += 90000;
            else if (m == killers_[ply][1]) priority += 80000;
            else priority += std::min(70000, history_[m.fromSq][m.toSq]);
        }
        if (m.promo == PieceType::Queen) priority += 95000;
        if (first && m == *first) priority += 1000000;
        m.score = priority;
    }
    std::stable_sort(moves.begin(), moves.end(), [](const Move& a, const Move& b) {
        return a.score > b.score;
    });
}

// Quiescence search: keep searching captures/promotions until the position is quiet,
// so the engine never stops in the middle of an exchange.
int ChessEngine::quiesce(ChessPosition& pos, int ply, int qdepth, int alpha, int beta, bool isMax) {
    nodes_++;
    qnodes_++;
    if (timeUp()) return 0;

    const bool inCheck = pos.isInCheck(pos.sideToMove);
    std::vector<Move> moves;

    if (inCheck) {
        moves = pos.generateLegalMoves();
        if (moves.empty()) return isMax ? -MATE_SCORE + ply : MATE_SCORE - ply;
        if (qdepth >= maxQDepth_) return eval_.evaluate(pos);
    } else {
        int standPat = eval_.evaluate(pos);
        if (qdepth >= maxQDepth_) return standPat;
        if (isMax) {
            if (standPat >= beta) return standPat;
            alpha = std::max(alpha, standPat);
        } else {
            if (standPat <= alpha) return standPat;
            beta = std::min(beta, standPat);
        }
        moves = pos.generateLegalTactical();
        if (moves.empty()) return standPat;
    }

    orderMoves(moves, pos);
    int best = inCheck ? (isMax ? -INF : INF) : (isMax ? alpha : beta);

    for (const auto& m : moves) {
        UndoState undo;
        pos.makeMove(m, undo);
        int score = quiesce(pos, ply + 1, qdepth + 1, alpha, beta, !isMax);
        pos.undoMove(m, undo);
        if (aborted_) return 0;

        if (isMax) {
            if (score > best) best = score;
            alpha = std::max(alpha, score);
        } else {
            if (score < best) best = score;
            beta = std::min(beta, score);
        }
        if (beta <= alpha) { cutoffs_++; break; }
    }
    return best;
}

static int scoreToTT(int s, int ply) {
    if (s > ChessEngine::MATE_SCORE - 1000) return s + ply;
    if (s < -ChessEngine::MATE_SCORE + 1000) return s - ply;
    return s;
}
static int scoreFromTT(int s, int ply) {
    if (s > ChessEngine::MATE_SCORE - 1000) return s - ply;
    if (s < -ChessEngine::MATE_SCORE + 1000) return s + ply;
    return s;
}

int ChessEngine::alphaBeta(ChessPosition& pos, int depth, int ply, int alpha, int beta, bool isMax, std::vector<Move>& pv) {
    nodes_++;
    pv.clear();
    if (timeUp()) return 0;

    if (pos.halfmoveClock >= 100 || pos.isInsufficientMaterial()) return 0;

    std::vector<Move> moves = pos.generateLegalMoves();
    if (moves.empty()) {
        if (pos.isInCheck(pos.sideToMove)) return isMax ? -MATE_SCORE + ply : MATE_SCORE - ply;
        return 0; // stalemate
    }

    if (depth <= 0) {
        return quiesce(pos, ply, 0, alpha, beta, isMax);
    }

    // Transposition table probe
    const uint64_t key = pos.hash();
    TTEntry& slot = tt_[key & (TT_SIZE - 1)];
    Move hashMove;
    bool haveHashMove = false;
    if (slot.flag != 0 && slot.key == key) {
        haveHashMove = true;
        hashMove = slot.best;
        if (slot.depth >= depth) {
            const int s = scoreFromTT(slot.score, ply);
            if (slot.flag == 1) { ttHits_++; return s; }
            if (slot.flag == 2) alpha = std::max(alpha, s);
            else if (slot.flag == 3) beta = std::min(beta, s);
            if (alpha >= beta) { ttHits_++; return s; }
        }
    }

    const int alphaOrig = alpha, betaOrig = beta;
    orderMoves(moves, pos, haveHashMove ? &hashMove : nullptr, ply);
    std::vector<Move> childPV;
    int best = isMax ? -INF : INF;
    Move bestMove = moves[0];

    for (const auto& m : moves) {
        UndoState undo;
        const bool quiet = pos.board[m.toSq].isEmpty() && m.promo == PieceType::None;
        pos.makeMove(m, undo);
        int score = alphaBeta(pos, depth - 1, ply + 1, alpha, beta, !isMax, childPV);
        pos.undoMove(m, undo);
        if (aborted_) return 0;

        if (isMax ? (score > best) : (score < best)) {
            best = score;
            bestMove = m;
            pv.clear();
            pv.push_back(m);
            pv.insert(pv.end(), childPV.begin(), childPV.end());
        }
        if (isMax) alpha = std::max(alpha, best);
        else       beta  = std::min(beta, best);
        if (beta <= alpha) {
            cutoffs_++;
            if (quiet && ply < MAX_PLY) {
                if (!(killers_[ply][0] == m)) { killers_[ply][1] = killers_[ply][0]; killers_[ply][0] = m; }
                history_[m.fromSq][m.toSq] += depth * depth;
            }
            break;
        }
    }

    // Store: exact if inside the original window, otherwise a bound
    slot.key = key;
    slot.score = scoreToTT(best, ply);
    slot.depth = (int8_t)std::min(depth, 127);
    slot.flag = (best <= alphaOrig) ? 3 : (best >= betaOrig) ? 2 : 1;
    slot.best = bestMove;
    return best;
}

SearchResult ChessEngine::search(ChessPosition& pos, int maxDepth) {
    if (maxDepth <= 0) maxDepth = defaultDepth_;
    if (maxDepth < 1) maxDepth = 1;
    if (maxDepth > MAX_PLY - 8) maxDepth = MAX_PLY - 8;
    SearchResult result;
    result.targetDepth = maxDepth;

    start_ = std::chrono::high_resolution_clock::now();
    nodes_ = qnodes_ = cutoffs_ = ttHits_ = 0;
    aborted_ = false;
    canAbort_ = false;
    std::fill(tt_.begin(), tt_.end(), TTEntry());   // weights may have changed since the last search
    for (auto& k : killers_) { k[0] = Move(); k[1] = Move(); }
    std::memset(history_, 0, sizeof(history_));

    std::vector<Move> legalMoves = pos.generateLegalMoves();
    if (legalMoves.empty()) {
        result.score = pos.isInCheck(pos.sideToMove)
            ? (pos.sideToMove == Color::White ? -MATE_SCORE : MATE_SCORE) : 0;
        return result;
    }

    const bool isMax = (pos.sideToMove == Color::White);
    Move overallBestMove = legalMoves[0];
    int overallBestScore = 0;
    std::vector<Move> overallPV;
    int completed = 0;

    for (int d = 1; d <= maxDepth; ++d) {
        canAbort_ = (d > 1);   // depth 1 always finishes, so there is always a move
        orderMoves(legalMoves, pos, d > 1 ? &overallBestMove : nullptr, 0);

        int bestScore = isMax ? -INF : INF;
        Move bestMove = legalMoves[0];
        std::vector<Move> bestPV;

        // Final iteration with noise: every root move gets an exact score plus a random wobble
        const bool noisy = (noiseCp_ > 0 && d == maxDepth);
        std::uniform_int_distribution<int> wobble(-noiseCp_, noiseCp_);
        int bestNoisy = isMax ? -INF : INF;

        for (const auto& m : legalMoves) {
            UndoState undo;
            pos.makeMove(m, undo);
            std::vector<Move> childPV;
            int alpha = (isMax && !noisy) ? bestScore : -INF;
            int beta  = (!isMax && !noisy) ? bestScore : INF;
            int score = alphaBeta(pos, d - 1, 1, alpha, beta, !isMax, childPV);
            pos.undoMove(m, undo);
            if (aborted_) break;

            int key = score;
            if (noisy && std::abs(score) < MATE_SCORE - 100) key += wobble(rng_);
            if (isMax ? (key > bestNoisy) : (key < bestNoisy)) {
                bestNoisy = key;
                bestScore = score;
                bestMove = m;
                bestPV.clear();
                bestPV.push_back(m);
                bestPV.insert(bestPV.end(), childPV.begin(), childPV.end());
            }
        }
        if (aborted_) break;   // unfinished iteration: keep the last finished one

        overallBestMove = bestMove;
        overallBestScore = bestScore;
        overallPV = bestPV;
        completed = d;

        if (std::abs(bestScore) >= MATE_SCORE - 100) break;   // forced mate found
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    int elapsedMs = (int)std::chrono::duration_cast<std::chrono::milliseconds>(t1 - start_).count();
    if (elapsedMs == 0) elapsedMs = 1;

    result.bestMove = overallBestMove;
    result.moveUCI  = moveToUCI(overallBestMove);
    result.moveSAN  = pos.moveToSAN(overallBestMove);
    result.score    = overallBestScore;
    result.depth    = completed;
    result.timedOut = aborted_;
    result.nodes    = nodes_;
    result.qnodes   = qnodes_;
    result.cutoffs  = cutoffs_;
    result.ttHits   = ttHits_;
    result.timeMs   = elapsedMs;
    result.nps      = (int)((nodes_ * 1000ULL) / elapsedMs);
    for (const auto& m : overallPV) result.pv.push_back(moveToUCI(m));

    UndoState undo;
    pos.makeMove(overallBestMove, undo);
    result.breakdown = eval_.getBreakdown(pos);
    pos.undoMove(overallBestMove, undo);
    canAbort_ = false;
    return result;
}
