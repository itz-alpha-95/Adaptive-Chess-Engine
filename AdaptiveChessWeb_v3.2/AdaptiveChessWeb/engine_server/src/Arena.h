#pragma once
#include "ChessEngine.h"
#include "LearningSystem.h"
#include <string>
#include <vector>

/// Headless bot-vs-bot games: automated training, head-to-head matches and the perft self-test.
struct ArenaGame {
    std::string result;               // "1-0", "0-1", "1/2-1/2"
    std::string reason;               // checkmate, stalemate, 50-move, repetition, material, max-plies
    int plies = 0;
    std::string startFen;             // position after the opening line (where the bots take over)
    std::vector<std::string> moves;   // the bots' moves from startFen, UCI
    std::vector<std::string> whiteFens, blackFens;  // position after each White / Black move
};

int arenaOpeningCount();

/// One game; each engine searches with its own settings (depth, quiescence, noise).
ArenaGame playArenaGame(ChessEngine& white, ChessEngine& black, int openingIndex, int maxPlies = 300);

/// Head-to-head: A vs B with alternating colours over the built-in opening lines.
/// Prints each game, the score, the implied Elo difference and a style profile.
float runMatch(int games, const SkillProfile& a, const SkillProfile& b,
               const std::string& nameA, const std::string& nameB, const std::string& csvPath);

/// Measure the presets' strength: neighbouring levels (1,2,3,4,5,10,15,20) play each other,
/// Elo is chained up from level 1 = 400.
void runLadder(int gamesPerPair);

/// Training: the learner plays `games` games against a fixed opponent and learns after every game.
void runTraining(int games, LearningSystem& learner, const SkillProfile& opponent,
                 const std::string& oppName, float oppElo);

/// Perft move-generation self test. Returns true when all counts match.
bool runPerftSuite();
