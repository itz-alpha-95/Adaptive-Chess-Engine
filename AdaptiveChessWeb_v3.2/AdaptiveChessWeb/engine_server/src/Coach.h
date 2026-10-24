#pragma once
// =============================================================================
//  Coach: post-game review of every move.
//  The coach is the engine at full knowledge (all stats at level 10) searching
//  3 plies + quiescence. For each move it finds the best move, measures how many
//  centipawns the played move lost, classifies it, and works out WHICH stats explain
//  the loss: for every knowledge stat, how much better the coach's move scored on
//  that feature than the played move. Whatever the features cannot explain is a
//  calculation (tactical) error.
// =============================================================================
#include "ChessEngine.h"
#include <string>
#include <vector>

struct MoveReview {
    int ply = 0;                 // 0-based half-move index from the start position
    char color = 'w';            // mover
    std::string uci, san;
    std::string bestUci, bestSan;
    std::string fenAfter;
    int evalAfter = 0;           // coach evaluation after the move, White's point of view (clamped +-2000)
    int loss = 0;                // centipawns lost versus the best move (mover's point of view)
    bool missedWin = false;
    std::string classification;  // brilliant, best, good, inaccuracy, mistake, blunder, missed_win
    float deficit[NUM_STATS] = {0};  // centipawns of the loss attributed to each stat
};

struct GameReview {
    std::vector<MoveReview> moves;
    float acpl[2] = {0, 0};      // average centipawn loss: [0] White, [1] Black
    float accuracy[2] = {0, 0};  // 0-100
    int counts[2][6] = {{0}};    // per colour: best, good, inaccuracy, mistake, blunder, missed_win
    int moveCount[2] = {0, 0};
};

class Coach {
public:
    static constexpr int DEPTH = 3;
    static constexpr int LOSS_FOR_ANALYSIS = 20;   // smaller losses are noise, no stat blamed

    Coach();
    GameReview review(const std::string& startFen, const std::vector<std::string>& movesUCI);
    static float accuracyFromAcpl(float acpl);
    static int classIndex(const std::string& cls);

private:
    Evaluator eval_;
    ChessEngine engine_;
};

/// Parse a UCI move and check it is legal in pos. Returns false if illegal.
bool findLegalMove(ChessPosition& pos, const std::string& uci, Move& out);
