// =============================================================================
//  LearningSystem.cpp — skill levels that grow from post-game review + Elo rating
//
//  After EVERY game (win, loss or draw):
//    1. The coach reviews every move of the game (see Coach.h).
//    2. For each of the bot's own moves, the centipawns it lost are split between the
//       stats that explain the loss ("need"): e.g. it left a piece hanging -> Threat
//       awareness; the coach's move kept the king sheltered -> King safety; the loss
//       came from a tactic no feature shows -> Calculation.
//    3. The bot earns stat points: 4 per game for its first 50 games, then fewer and fewer
//       (1 + 3 x 50 / games, e.g. 2.5 at game 100, 1.3 at game 500), never below 1, so the
//       stats never stop growing (pointsForGame). They are shared out in proportion
//       to need x 10 / (10 + level): stats that cost it the most grow fastest, weak stats
//       catch up, and there is no maximum level. If the review found nothing to fix,
//       the points go mostly to the weakest stats (practice).
//    4. Levels change how the bot plays: weight = 2L / (L + 10) for knowledge stats,
//       Calculation sets search depth and capture search (see EvalWeights.h).
//    5. Elo: standard formula R <- R + 32 (S - E).
//    6. Saves learning_data.json and appends a row to learning_history.csv.
// =============================================================================
#include "LearningSystem.h"
#include <fstream>
#include <sstream>
#include <cmath>
#include <iostream>
#include <iomanip>
#include <algorithm>
#include <filesystem>
#include <cctype>

namespace fs = std::filesystem;

static const char* START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

LearningSystem::LearningSystem() : skill(SkillProfile::beginner()) {}

float LearningSystem::pointsForGame(int gamesPlayed) {
    if (gamesPlayed < EARLY_GAMES) return EARLY_POINTS;
    // games 1-50: 4.0 | game 51: 4.0 | 100: 2.5 | 200: 1.75 | 500: 1.3 | 1000: 1.15 | always > 1
    return MIN_POINTS + (EARLY_POINTS - MIN_POINTS) * (float)EARLY_GAMES / (float)gamesPlayed;
}

float LearningSystem::expectedScore(float a, float b) {
    return 1.0f / (1.0f + std::pow(10.0f, (b - a) / 400.0f));
}

std::string LearningSystem::historyPath() const {
    fs::path p(dataPath_);
    return (p.parent_path() / "learning_history.csv").string();
}

LearningStepInfo LearningSystem::learn(const std::string& result, float oppElo,
                                       const std::string& startFen,
                                       const std::vector<std::string>& movesUCI,
                                       Color botColor) {
    LearningStepInfo step;
    step.result = result;
    step.eloBefore = elo;
    std::copy(skill.level, skill.level + NUM_STATS, step.levelsBefore);

    consecutiveLosses = (result == "loss") ? consecutiveLosses + 1 : 0;
    step.consecutiveLosses = consecutiveLosses;

    // ── 1-2. Review every move; collect what the bot's own mistakes cost, per stat ──
    Coach coach;
    lastReview = coach.review(startFen.empty() ? START_FEN : startFen, movesUCI);
    const char botChar = (botColor == Color::White) ? 'w' : 'b';
    const int bi = (botColor == Color::White) ? 0 : 1;
    for (const auto& m : lastReview.moves) {
        if (m.color != botChar) continue;
        for (int s = 0; s < NUM_STATS; ++s) step.need[s] += m.deficit[s];
    }
    step.botMoves     = lastReview.moveCount[bi];
    step.acpl         = lastReview.acpl[bi];
    step.accuracy     = lastReview.accuracy[bi];
    step.inaccuracies = lastReview.counts[bi][2];
    step.mistakes     = lastReview.counts[bi][3];
    step.blunders     = lastReview.counts[bi][4];
    step.missedWins   = lastReview.counts[bi][5];

    // ── 3. Award stat points where the bot lacked ────────────────────────────
    // Diminishing returns instead of a cap: a stat at level L gets 10 / (10 + L) of the
    // share it would get at level 0, so weak stats catch up but strong ones still grow.
    const float REF = SkillProfile::MASTER_LEVEL;
    float adj[NUM_STATS];
    float sumAdj = 0.0f;
    for (int s = 0; s < NUM_STATS; ++s) {
        adj[s] = step.need[s] * REF / (REF + skill.level[s]);
        sumAdj += adj[s];
    }
    if (sumAdj < 1.0f) {                       // nothing to fix: practice, favour the weakest stats
        step.practice = true;
        sumAdj = 0.0f;
        for (int s = 0; s < NUM_STATS; ++s) { adj[s] = REF / (REF + skill.level[s]); sumAdj += adj[s]; }
    }
    step.pointsTotal = pointsForGame(games);
    if (sumAdj > 0.0f) {
        for (int s = 0; s < NUM_STATS; ++s) {
            step.points[s] = step.pointsTotal * adj[s] / sumAdj;
            skill.level[s] += step.points[s];
        }
    }
    std::copy(skill.level, skill.level + NUM_STATS, step.levelsAfter);
    step.depthAfter = skill.searchDepth();

    // Summary sentence: review counts + the three biggest gains
    int order[NUM_STATS];
    for (int s = 0; s < NUM_STATS; ++s) order[s] = s;
    std::sort(order, order + NUM_STATS, [&](int a, int b) { return step.points[a] > step.points[b]; });
    step.topStat = statKey(order[0]);
    {
        std::ostringstream os;
        os << std::fixed << std::setprecision(0) << "Review: accuracy " << step.accuracy << "%, ACPL " << step.acpl;
        os << ", " << step.inaccuracies << " inaccurac" << (step.inaccuracies == 1 ? "y" : "ies")
           << ", " << step.mistakes << " mistake" << (step.mistakes == 1 ? "" : "s")
           << ", " << step.blunders << " blunder" << (step.blunders == 1 ? "" : "s") << ". ";
        os << std::setprecision(1) << (step.practice ? "Practice points (" : "Points (") << step.pointsTotal << "): ";
        for (int k = 0; k < 3; ++k) {
            os << "+" << step.points[order[k]] << " " << statLabel(order[k]) << (k < 2 ? ", " : ".");
        }
        step.notice = os.str();
    }

    // ── 5. Standard Elo ─────────────────────────────────────────────────────
    const float expected = expectedScore(elo, oppElo);
    const float actual = (result == "win") ? 1.0f : (result == "loss" ? 0.0f : 0.5f);
    elo = std::max(100.0f, elo + K_FACTOR * (actual - expected));
    step.expected = expected;
    step.eloAfter = elo;
    step.eloDelta = elo - step.eloBefore;

    if (result == "win") wins++;
    else if (result == "loss") losses++;
    else draws++;
    games++;

    lastStep = step;
    save();
    appendHistory(step);
    return step;
}

void LearningSystem::appendHistory(const LearningStepInfo& s) const {
    const std::string path = historyPath();
    bool isNew = !fs::exists(path);
    std::ofstream ofs(path, std::ios::app);
    if (!ofs.is_open()) return;
    if (isNew) {
        ofs << "game,result,elo_before,elo_after,bot_moves,acpl,accuracy,inaccuracies,mistakes,blunders,depth_after,points_total";
        for (int k = 0; k < NUM_STATS; ++k) ofs << ",points_" << statKey(k);
        for (int k = 0; k < NUM_STATS; ++k) ofs << ",level_" << statKey(k);
        ofs << "\n";
    }
    ofs << std::fixed << std::setprecision(2)
        << games << "," << s.result << "," << s.eloBefore << "," << s.eloAfter << ","
        << s.botMoves << "," << s.acpl << "," << s.accuracy << ","
        << s.inaccuracies << "," << s.mistakes << "," << s.blunders << "," << s.depthAfter << "," << s.pointsTotal;
    for (int k = 0; k < NUM_STATS; ++k) ofs << "," << s.points[k];
    for (int k = 0; k < NUM_STATS; ++k) ofs << "," << s.levelsAfter[k];
    ofs << "\n";
}

bool LearningSystem::save() {
    std::error_code ec;
    fs::path p(dataPath_);
    if (p.has_parent_path()) fs::create_directories(p.parent_path(), ec);
    std::ofstream ofs(dataPath_);
    if (!ofs.is_open()) return false;

    ofs << "{\n"
        << "  \"version\": " << DATA_VERSION << ",\n"
        << "  \"elo\": " << std::fixed << std::setprecision(1) << elo << ",\n"
        << "  \"games\": " << games << ",\n"
        << "  \"wins\": " << wins << ",\n"
        << "  \"losses\": " << losses << ",\n"
        << "  \"draws\": " << draws << ",\n"
        << "  \"consecutiveLosses\": " << consecutiveLosses << ",\n"
        << "  \"skill\": {\n" << std::setprecision(3);
    for (int s = 0; s < NUM_STATS; ++s) {
        ofs << "    \"" << statKey(s) << "\": " << skill.level[s] << (s + 1 < NUM_STATS ? ",\n" : "\n");
    }
    ofs << "  }\n}\n";
    return true;
}

static bool readFile(const std::string& path, std::string& out) {
    std::ifstream ifs(path);
    if (!ifs.is_open()) return false;
    std::stringstream ss;
    ss << ifs.rdbuf();
    out = ss.str();
    return true;
}

static float extractJsonFloat(const std::string& content, const std::string& key, float defaultVal) {
    size_t pos = content.find("\"" + key + "\"");
    if (pos == std::string::npos) return defaultVal;
    pos = content.find(':', pos);
    if (pos == std::string::npos) return defaultVal;
    pos++;
    while (pos < content.length() && std::isspace((unsigned char)content[pos])) pos++;
    try {
        return std::stof(content.substr(pos));
    } catch (...) {
        return defaultVal;
    }
}

static int extractJsonInt(const std::string& content, const std::string& key, int defaultVal) {
    return (int)extractJsonFloat(content, key, (float)defaultVal);
}

static void readSkill(const std::string& content, SkillProfile& sk) {
    for (int s = 0; s < NUM_STATS; ++s) {
        float v = extractJsonFloat(content, statKey(s), SkillProfile::START_LEVEL);
        sk.level[s] = std::max(0.0f, std::min(10000.0f, v));
    }
}

bool loadSkillFile(const std::string& path, SkillProfile& out) {
    std::string content;
    if (!readFile(path, content)) return false;
    if (extractJsonInt(content, "version", 1) != LearningSystem::DATA_VERSION) return false;
    readSkill(content, out);
    return true;
}

bool LearningSystem::load() {
    std::string content;
    if (!readFile(dataPath_, content)) return false;

    const int version = extractJsonInt(content, "version", 1);
    if (version != DATA_VERSION) {
        std::error_code ec;
        fs::path p(dataPath_);
        fs::path backup = p.parent_path() / ("learning_data_backup_v" + std::to_string(version) + ".json");
        fs::copy_file(p, backup, fs::copy_options::overwrite_existing, ec);
        std::cout << "[INFO] Learning file from an older version (v" << version << ") backed up to "
                  << backup.string() << ". Starting a fresh beginner bot.\n";
        return false;
    }

    elo               = extractJsonFloat(content, "elo", 400.0f);
    games             = extractJsonInt(content, "games", 0);
    wins              = extractJsonInt(content, "wins", 0);
    losses            = extractJsonInt(content, "losses", 0);
    draws             = extractJsonInt(content, "draws", 0);
    consecutiveLosses = extractJsonInt(content, "consecutiveLosses", 0);
    readSkill(content, skill);
    return true;
}

bool LearningSystem::importJson(const std::string& content, std::string& error) {
    // Accepts this engine's learning_data.json or the web page's "Export JSON" file:
    // both have "skill": {"development": .., ...} plus elo / games / wins / losses / draws.
    if (content.find("\"skill\"") == std::string::npos) {
        error = "No \"skill\" section found (is this an OmegaChess v4 export?)";
        return false;
    }
    const size_t at = content.find("\"skill\"");
    const std::string skillPart = content.substr(at);
    readSkill(skillPart, skill);
    elo               = std::max(100.0f, extractJsonFloat(content, "elo", 400.0f));
    games             = std::max(0, extractJsonInt(content, "games", 0));
    wins              = std::max(0, extractJsonInt(content, "wins", 0));
    losses            = std::max(0, extractJsonInt(content, "losses", 0));
    draws             = std::max(0, extractJsonInt(content, "draws", 0));
    consecutiveLosses = std::max(0, extractJsonInt(content, "consecutiveLosses", 0));
    lastStep = LearningStepInfo();
    lastReview = GameReview();
    save();
    return true;
}

void LearningSystem::reset() {
    elo = 400.0f;
    games = wins = losses = draws = consecutiveLosses = 0;
    skill = SkillProfile::beginner();
    lastStep = LearningStepInfo();
    lastReview = GameReview();
    save();
    std::error_code ec;
    fs::remove(historyPath(), ec);
}
