// =============================================================================
//  AdaptiveEngine — Adaptive Self-Learning Chess Engine (C++ backend)
//
//  Usage:
//    engine_server                       start the REST server for the web GUI (port 8080)
//    engine_server --perft               move-generation self test
//    engine_server --train N [--opp PRESET|LEVEL|FILE] [--opp-elo R]
//                                        N training games; the bot reviews every game and
//                                        earns stat points: 4 per game for 50 games, then fewer (default opponent: club)
//    engine_server --match N [--a PRESET|LEVEL|FILE] [--b PRESET|LEVEL|FILE]
//                                        N games A vs B (default: beginner vs the learned bot)
//    engine_server --ladder N            measure the presets' Elo (N games per neighbouring pair)
//    engine_server --reset               start again from a beginner bot
//
//  Presets: beginner (every stat level 1, a brand-new bot), novice 3, club 5, strong 8,
//  expert 10 (full knowledge), master 15, grandmaster 20. A plain number = that level.
// =============================================================================
#include "ChessRules.h"
#include "Evaluator.h"
#include "ChessEngine.h"
#include "LearningSystem.h"
#include "HttpServer.h"
#include "Arena.h"
#include <iostream>
#include <iomanip>
#include <string>
#include <map>

static const char* DATA_FILE = "data/learning_data.json";

static void printState(const LearningSystem& learner) {
    std::cout << "[INFO] Elo " << std::fixed << std::setprecision(1) << learner.elo
              << " | Games " << learner.games
              << " (W " << learner.wins << " / L " << learner.losses << " / D " << learner.draws << ")"
              << " | depth " << learner.skill.searchDepth()
              << ", capture search " << learner.skill.quiescenceDepth()
              << ", noise " << learner.skill.noiseCp() << " cp\n";
    std::cout << "[INFO] Skill levels:";
    for (int s = 0; s < NUM_STATS; ++s) {
        std::cout << " " << statLabel(s) << " " << std::setprecision(1) << learner.skill.level[s]
                  << (s + 1 < NUM_STATS ? "," : "\n");
    }
}

/// A preset name (beginner, novice, club, strong, expert, master, grandmaster),
/// a number (that level for every stat) or a path to a learning_data.json (v3)
static bool skillFromArg(const std::string& arg, SkillProfile& out, float& nominalElo) {
    if (const SkillPreset* p = findPreset(arg)) { out = SkillProfile(p->level); nominalElo = p->elo; return true; }
    try {
        size_t used = 0;
        float lv = std::stof(arg, &used);
        if (used == arg.size()) { out = SkillProfile(lv); nominalElo = 800.0f; return true; }
    } catch (...) {}
    if (!loadSkillFile(arg, out)) {
        std::cerr << "[ERROR] Could not read skill levels from " << arg << " (missing or older format)\n";
        return false;
    }
    nominalElo = 800.0f;
    return true;
}

int main(int argc, char** argv) {
    std::map<std::string, std::string> opt;
    std::string mode;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a.rfind("--", 0) != 0) continue;
        std::string key = a.substr(2);
        std::string val = (i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) ? argv[++i] : "";
        if (mode.empty() && (key == "perft" || key == "match" || key == "train" || key == "reset" || key == "ladder")) mode = key;
        opt[key] = val;
    }
    auto intOpt = [&](const std::string& k, int def) {
        try { return opt.count(k) && !opt[k].empty() ? std::stoi(opt[k]) : def; } catch (...) { return def; }
    };
    auto strOpt = [&](const std::string& k, const std::string& def) {
        return opt.count(k) && !opt[k].empty() ? opt[k] : def;
    };

    if (mode == "perft") {
        return runPerftSuite() ? 0 : 1;
    }
    if (mode == "ladder") {
        runLadder(intOpt("ladder", 24));
        return 0;
    }

    LearningSystem learner;
    learner.setDataPath(DATA_FILE);
    bool loaded = learner.load();

    if (mode == "reset") {
        learner.reset();
        std::cout << "[INFO] Learning data reset: the bot is a beginner again (all stats level 1, Elo 400).\n";
        return 0;
    }

    if (mode == "match") {
        SkillProfile a, b;
        float eloA, eloB;
        const std::string argA = strOpt("a", "beginner"), argB = strOpt("b", DATA_FILE);
        if (!skillFromArg(argA, a, eloA) || !skillFromArg(argB, b, eloB)) return 1;
        std::string nameA = findPreset(argA) ? argA : "A";
        std::string nameB = (argB == DATA_FILE) ? "Learned" : findPreset(argB) ? argB : "B";
        runMatch(intOpt("match", 48), a, b, nameA, nameB, "data/match_results.csv");
        return 0;
    }

    if (mode == "train") {
        SkillProfile opp;
        float oppElo;
        const std::string argOpp = strOpt("opp", "club");
        if (!skillFromArg(argOpp, opp, oppElo)) return 1;
        try { if (opt.count("opp-elo") && !opt["opp-elo"].empty()) oppElo = std::stof(opt["opp-elo"]); } catch (...) {}
        printState(learner);
        runTraining(intOpt("train", 30), learner, opp, argOpp, oppElo);
        return 0;
    }

    std::cout << "=========================================================\n";
    std::cout << "  AdaptiveEngine — Self-Learning Chess Engine (C++ Backend)\n";
    std::cout << "  Version 4.2 - REST API Server on port 8080             \n";
    std::cout << "=========================================================\n";
    std::cout << (loaded ? "[INFO] Loaded learning data from " : "[INFO] New beginner bot (no learning file yet): ")
              << DATA_FILE << "\n";
    printState(learner);

    Evaluator evaluator(learner.skill.weights());
    ChessEngine engine(evaluator);
    engine.applySkill(learner.skill);

    HttpServer server(engine, learner, 8080);
    server.start();
    return 0;
}
