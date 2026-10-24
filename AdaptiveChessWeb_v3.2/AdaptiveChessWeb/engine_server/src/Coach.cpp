#include "Coach.h"
#include <algorithm>
#include <cmath>

bool findLegalMove(ChessPosition& pos, const std::string& uci, Move& out) {
    Move m = pos.parseMoveUCI(uci);
    for (const auto& legal : pos.generateLegalMoves()) {
        if (legal.fromSq == m.fromSq && legal.toSq == m.toSq &&
            (legal.promo == m.promo || (m.promo == PieceType::None && legal.promo == PieceType::Queen))) {
            out = legal;
            return true;
        }
    }
    return false;
}

Coach::Coach() : eval_(SkillProfile::master().weights()), engine_(eval_, DEPTH) {
    engine_.setQuiescenceDepth(8);
    engine_.setNoise(0);
}

float Coach::accuracyFromAcpl(float acpl) {
    return std::max(0.0f, std::min(100.0f, 100.0f * std::exp(-0.0033f * acpl)));
}

int Coach::classIndex(const std::string& c) {
    if (c == "best" || c == "brilliant") return 0;
    if (c == "good") return 1;
    if (c == "inaccuracy") return 2;
    if (c == "mistake") return 3;
    if (c == "blunder") return 4;
    return 5; // missed_win
}

static int clampEval(int v) { return std::max(-1000, std::min(1000, v)); }

GameReview Coach::review(const std::string& startFen, const std::vector<std::string>& movesUCI) {
    GameReview gr;
    ChessPosition pos;
    pos.loadFEN(startFen);
    float lossSum[2] = {0, 0};

    for (size_t i = 0; i < movesUCI.size(); ++i) {
        Move played;
        if (!findLegalMove(pos, movesUCI[i], played)) break;   // stop at the first bad move

        MoveReview mr;
        mr.ply = (int)i;
        mr.color = (pos.sideToMove == Color::White) ? 'w' : 'b';
        const int ci = (mr.color == 'w') ? 0 : 1;
        const int s = (mr.color == 'w') ? 1 : -1;
        mr.uci = moveToUCI(played);
        mr.san = pos.moveToSAN(played);

        // Best move and its value
        SearchResult best = engine_.search(pos, DEPTH);
        mr.bestUci = best.moveUCI;
        mr.bestSan = best.moveSAN;
        int bestScore = best.score;

        const int materialBefore = eval_.computeFeatures(pos).material;

        // Value of the played move
        UndoState u;
        pos.makeMove(played, u);
        int playedScore;
        if (played == best.bestMove) {
            playedScore = bestScore;
        } else {
            playedScore = engine_.search(pos, DEPTH - 1).score;
        }
        EvalFeatures fPlayed = eval_.computeFeatures(pos);
        mr.fenAfter = pos.toFEN();
        pos.undoMove(played, u);

        const int bestC = clampEval(bestScore), playedC = clampEval(playedScore);
        mr.loss = std::max(0, s * (bestC - playedC));
        mr.evalAfter = std::max(-2000, std::min(2000, playedScore));

        mr.missedWin = (s * bestC >= 250 && s * playedC <= 60 && mr.loss > 80);
        // Brilliant: the best move, and it gives up at least a minor piece's worth of material
        // on the board while the position stays sound
        const bool sacrifice = s * (fPlayed.material - materialBefore) <= -200;
        if (mr.missedWin)          mr.classification = "missed_win";
        else if (mr.loss <= 10 && sacrifice && s * playedC >= -50) mr.classification = "brilliant";
        else if (mr.loss <= 10)    mr.classification = "best";
        else if (mr.loss <= 30)    mr.classification = "good";
        else if (mr.loss <= 80)    mr.classification = "inaccuracy";
        else if (mr.loss <= 200)   mr.classification = "mistake";
        else                       mr.classification = "blunder";

        // Which stats explain the loss?
        if (mr.loss >= LOSS_FOR_ANALYSIS && !(played == best.bestMove)) {
            UndoState ub;
            pos.makeMove(best.bestMove, ub);
            EvalFeatures fBest = eval_.computeFeatures(pos);
            pos.undoMove(best.bestMove, ub);

            float d[NUM_EVAL_STATS];
            float positional = 0.0f;
            for (int k = 0; k < NUM_EVAL_STATS; ++k) {
                d[k] = std::max(0.0f, (float)s * (fBest.f[k] - fPlayed.f[k]));  // coach weights are 1.0
                positional += d[k];
            }
            const float tactical = std::max(0.0f, (float)mr.loss - positional);
            const float total = positional + tactical;
            if (total > 0.0f) {
                for (int k = 0; k < NUM_EVAL_STATS; ++k) mr.deficit[k] = mr.loss * d[k] / total;
                mr.deficit[ST_CALCULATION] = mr.loss * tactical / total;
            }
        }

        lossSum[ci] += (float)mr.loss;
        gr.moveCount[ci]++;
        gr.counts[ci][classIndex(mr.classification)]++;
        gr.moves.push_back(mr);
        pos.makeMove(played, u);
    }

    for (int c = 0; c < 2; ++c) {
        gr.acpl[c] = gr.moveCount[c] ? lossSum[c] / gr.moveCount[c] : 0.0f;
        gr.accuracy[c] = accuracyFromAcpl(gr.acpl[c]);
    }
    return gr;
}
