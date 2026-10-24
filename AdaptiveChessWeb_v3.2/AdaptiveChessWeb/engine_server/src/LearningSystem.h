#pragma once
#include "EvalWeights.h"
#include "ChessTypes.h"
#include "Coach.h"
#include <string>
#include <vector>

/// Everything one learning step decided (sent to the GUI and written to the CSV log).
struct LearningStepInfo {
    std::string result;              // "win" | "loss" | "draw" (bot's point of view)
    float eloBefore = 400.0f;
    float eloAfter  = 400.0f;
    float eloDelta  = 0.0f;
    float expected  = 0.5f;          // Elo expected score before the game

    // Review of the bot's own moves
    int   botMoves = 0;
    float acpl = 0.0f;               // average centipawn loss
    float accuracy = 0.0f;           // 0-100
    int   inaccuracies = 0, mistakes = 0, blunders = 0, missedWins = 0;

    // Stat points
    float need[NUM_STATS]   = {0};   // centipawns lost that each stat explains
    float points[NUM_STATS] = {0};   // points awarded this game (sum = pointsTotal)
    float pointsTotal = 0.0f;        // points this game was worth (see pointsForGame)
    float levelsBefore[NUM_STATS] = {0};
    float levelsAfter[NUM_STATS]  = {0};
    bool  practice = false;          // no mistakes found: points spread evenly
    std::string topStat;             // stat that received the most points
    std::string notice;              // one-sentence summary

    int depthAfter = 1;
    int consecutiveLosses = 0;
};

class LearningSystem {
public:
    float elo = 400.0f;
    int games = 0;
    int wins = 0;
    int losses = 0;
    int draws = 0;
    int consecutiveLosses = 0;
    SkillProfile skill;              // starts at level 1 everywhere (a beginner)
    LearningStepInfo lastStep;
    GameReview lastReview;           // full review of the last game (both colours)

    static constexpr int   DATA_VERSION    = 3;
    // Stat points per game: EARLY_POINTS for the first EARLY_GAMES games, then they slowly
    // decrease towards MIN_POINTS but never reach it, so the stats can keep growing forever.
    static constexpr int   EARLY_GAMES  = 50;
    static constexpr float EARLY_POINTS = 4.0f;
    static constexpr float MIN_POINTS   = 1.0f;
    /// Points earned by a game, given how many games the bot had played before it.
    static float pointsForGame(int gamesPlayed);
    static constexpr float K_FACTOR        = 32.0f;

    LearningSystem();

    /// Review every move of a finished game and award stat points where the bot lacked.
    /// @param startFen   position the move list starts from
    /// @param movesUCI   all moves of the game (both colours) in UCI
    /// @param botColor   colour the bot played
    LearningStepInfo learn(const std::string& result, float oppElo,
                           const std::string& startFen, const std::vector<std::string>& movesUCI,
                           Color botColor = Color::Black);

    bool save();
    bool load();
    void reset();
    /// Replace the bot's stats with an exported JSON file (learning_data.json or the page's export).
    bool importJson(const std::string& content, std::string& error);

    void setDataPath(const std::string& jsonPath) { dataPath_ = jsonPath; }
    const std::string& dataPath() const { return dataPath_; }
    std::string historyPath() const;

    static float expectedScore(float a, float b);

private:
    std::string dataPath_ = "data/learning_data.json";
    void appendHistory(const LearningStepInfo& s) const;
};

/// Read the skill levels from a learning_data.json file (v3). Returns false if missing / old.
bool loadSkillFile(const std::string& path, SkillProfile& out);
