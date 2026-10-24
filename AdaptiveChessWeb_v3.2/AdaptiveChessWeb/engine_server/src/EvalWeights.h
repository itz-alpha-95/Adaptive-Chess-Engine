#pragma once
// =============================================================================
//  Skill model: 13 stats, each with a level that starts at 1 and has no maximum.
//    level 1  = where a brand-new bot starts (a beginner)
//    level 10 = full knowledge (the coach's own setting, weight 1.0)
//  Twelve stats are evaluation knowledge (weight = 2L / (L + 10)).
//  The thirteenth, Calculation, controls how far the bot looks ahead.
//  Material (piece values) is known from the start and is not a stat.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <string>

enum Stat {
    ST_DEVELOPMENT = 0,
    ST_CENTER,
    ST_PLACEMENT,
    ST_MOBILITY,
    ST_KING_SAFETY,
    ST_PAWN_STRUCTURE,
    ST_PASSED_PAWNS,
    ST_BISHOP_PAIR,
    ST_ROOK_ACTIVITY,
    ST_KNIGHT_OUTPOSTS,
    ST_THREATS,
    ST_KING_ATTACK,
    NUM_EVAL_STATS
};
constexpr int ST_CALCULATION = NUM_EVAL_STATS;   // index 12
constexpr int NUM_STATS = NUM_EVAL_STATS + 1;    // 13

inline const char* statKey(int s) {
    static const char* k[NUM_STATS] = {
        "development", "centerControl", "piecePlacement", "mobility", "kingSafety",
        "pawnStructure", "passedPawns", "bishopPair", "rookActivity", "knightOutposts",
        "threatAwareness", "kingAttack", "calculation"
    };
    return k[s];
}

inline const char* statLabel(int s) {
    static const char* l[NUM_STATS] = {
        "Development", "Center control", "Piece placement", "Mobility", "King safety",
        "Pawn structure", "Passed pawns", "Bishop pair", "Rook activity", "Knight outposts",
        "Threat awareness", "King attack", "Calculation"
    };
    return l[s];
}

/// Evaluation weights. material = 1.0 always (100 cp per pawn); w[s] multiplies stat s.
struct EvalWeights {
    float material = 1.0f;
    float w[NUM_EVAL_STATS];
    explicit EvalWeights(float v = 1.0f) { std::fill(w, w + NUM_EVAL_STATS, v); }
};

/// The bot's current ability. Everything about how it plays is derived from these levels.
/// There is no maximum level: stats keep growing, with diminishing returns.
struct SkillProfile {
    static constexpr float START_LEVEL  = 1.0f;
    static constexpr float MASTER_LEVEL = 10.0f;   // full knowledge: weight 1.0

    float level[NUM_STATS];

    explicit SkillProfile(float v = START_LEVEL) { std::fill(level, level + NUM_STATS, v); }

    static SkillProfile beginner() { return SkillProfile(START_LEVEL); }
    static SkillProfile master()   { return SkillProfile(MASTER_LEVEL); }   // full knowledge (the coach)

    /// Knowledge weight from a level: 2L / (L + 10).
    /// Level 1 -> 0.18, 5 -> 0.67, 10 -> 1.00, 20 -> 1.33, 50 -> 1.67, never above 2.
    /// Each extra level still helps, but less, so no single stat can outweigh material.
    static float weightFromLevel(float L) { return L <= 0.0f ? 0.0f : 2.0f * L / (L + MASTER_LEVEL); }

    EvalWeights weights() const {
        EvalWeights e(0.0f);
        for (int s = 0; s < NUM_EVAL_STATS; ++s) e.w[s] = weightFromLevel(level[s]);
        return e;
    }

    /// Calculation: 1 ply + 1 more for every 5 levels (0-4: 1, 5-9: 2, 10-14: 3, 15-19: 4, 20-24: 5, ...).
    /// Deep searches are cut off by the per-move time limit, so the bot always answers in time.
    int searchDepth() const {
        return std::max(1, std::min(40, 1 + (int)(level[ST_CALCULATION] / 5.0f)));
    }

    /// How many plies of captures the bot follows after its main search: none below level 1.5,
    /// then one more per level (2 -> 1, 3 -> 2, ... 10.5+ -> 10), so tactics come in gradually.
    int quiescenceDepth() const {
        const float c = level[ST_CALCULATION];
        return c < 1.5f ? 0 : std::min(10, (int)(c - 0.5f));
    }

    float average() const {
        float sum = 0.0f;
        for (int s = 0; s < NUM_STATS; ++s) sum += level[s];
        return sum / NUM_STATS;
    }

    /// Random wobble (cp) added to root move scores: big for a beginner, zero once the
    /// average level reaches full knowledge. Makes early play human-like and games varied.
    int noiseCp() const {
        return (int)std::lround(40.0f * std::max(0.0f, 1.0f - average() / MASTER_LEVEL));
    }
};

/// Fixed opponents for training and the browser's sparring bots. Elo values were measured with
/// bot-vs-bot matches between neighbouring levels 1,2,3,4,5,10,15,20 (24 games each; 8 for 15 vs 20),
/// chained up from level 1 = 400 (engine_server --ladder, logs in experiments/ladder/).
struct SkillPreset { const char* key; const char* name; float level; float elo; };
inline const SkillPreset* skillPresets(int& count) {
    static const SkillPreset presets[] = {
        {"beginner",    "Beginner",     1.0f,  400.0f},
        {"novice",      "Novice",       3.0f, 1010.0f},
        {"club",        "Club",         5.0f, 1600.0f},
        {"expert",      "Expert",      10.0f, 1940.0f},
        {"master",      "Master",      15.0f, 2110.0f},
        {"grandmaster", "Grandmaster", 20.0f, 2200.0f},
    };
    count = (int)(sizeof(presets) / sizeof(presets[0]));
    return presets;
}
inline const SkillPreset* findPreset(const std::string& key) {
    int n;
    const SkillPreset* p = skillPresets(n);
    for (int i = 0; i < n; ++i) if (key == p[i].key) return &p[i];
    return nullptr;
}

/// Per-move time limit (ms) for the bot and the sparring bots.
constexpr int MOVE_TIME_LIMIT_MS = 2000;
