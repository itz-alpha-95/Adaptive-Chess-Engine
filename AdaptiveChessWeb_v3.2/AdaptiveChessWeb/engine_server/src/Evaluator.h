#pragma once
#include "ChessRules.h"
#include "EvalWeights.h"

/// Raw (unweighted) scores in centipawns, White's point of view.
struct EvalFeatures {
    int material = 0;
    int f[NUM_EVAL_STATS] = {0};
};

/// Weighted contribution of material and each stat; totalScore is what the search uses.
struct EvalBreakdown {
    int material = 0;
    int f[NUM_EVAL_STATS] = {0};
    int totalScore = 0;
    EvalFeatures raw;
};

class Evaluator {
public:
    EvalWeights weights;

    explicit Evaluator(const EvalWeights& w = EvalWeights());

    /// Score in centipawns, White's point of view.
    int evaluate(ChessPosition& pos);
    EvalBreakdown getBreakdown(ChessPosition& pos);
    /// Raw scores of every feature (weights not applied).
    EvalFeatures computeFeatures(ChessPosition& pos) const;

    static int pieceValue(PieceType pt);

private:
    static const int PAWN_TABLE[64];
    static const int KNIGHT_TABLE[64];
    static const int BISHOP_TABLE[64];
    static const int ROOK_TABLE[64];
    static const int QUEEN_TABLE[64];
    static const int KING_TABLE[64];
    static const int KING_END_TABLE[64];

    int getPST(PieceType pt, Color col, int sq, bool endgame) const;
};
