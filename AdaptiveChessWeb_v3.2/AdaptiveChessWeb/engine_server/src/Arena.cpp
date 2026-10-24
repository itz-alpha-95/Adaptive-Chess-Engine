#include "Arena.h"
#include <cstdio>
#include <cmath>
#include <map>
#include <fstream>
#include <algorithm>

namespace {

// Balanced, well-known opening lines in UCI. Every line is played twice (colours swapped),
// so the match is fair and the two deterministic engines don't repeat the same game.
const char* OPENINGS[] = {
    "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6",               // Ruy Lopez
    "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5",               // Italian
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6",     // Open Sicilian
    "e2e4 c7c5 b1c3 b8c6 g2g3",                    // Closed Sicilian
    "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6",               // French
    "e2e4 c7c6 d2d4 d7d5 e4e5 c8f5",               // Caro-Kann Advance
    "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6",               // Queen's Gambit Declined
    "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6",               // Slav
    "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6",     // King's Indian
    "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4",               // Nimzo-Indian
    "c2c4 e7e5 b1c3 g8f6 g2g3",                    // English
    "g1f3 d7d5 g2g3 g8f6 f1g2",                    // Reti
    "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5",               // Scandinavian
    "e2e4 g8f6 e4e5 f6d5 d2d4 d7d6",               // Alekhine
    "e2e4 d7d6 d2d4 g8f6 b1c3 g7g6",               // Pirc
    "d2d4 f7f5 g2g3 g8f6 f1g2",                    // Dutch
    "e2e4 e7e5 f2f4 e5f4 g1f3",                    // King's Gambit
    "d2d4 d7d5 c1f4 g8f6 e2e3",                    // London
    "e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4",     // Petrov
    "e2e4 e7e5 b1c3 g8f6 f2f4",                    // Vienna
    "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g7g6",     // Accelerated Dragon
    "d2d4 g8f6 c2c4 c7c5 d4d5 e7e6",               // Benoni
    "c2c4 c7c5 g1f3 g8f6 b1c3 b8c6",               // Symmetrical English
    "e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4",          // Scotch
};
const int NUM_OPENINGS = sizeof(OPENINGS) / sizeof(OPENINGS[0]);

bool applyUCI(ChessPosition& pos, const std::string& uci) {
    Move m = pos.parseMoveUCI(uci);
    for (const auto& legal : pos.generateLegalMoves()) {
        if (legal == m) {
            UndoState u;
            pos.makeMove(legal, u);
            return true;
        }
    }
    return false;
}

const char* START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

} // namespace

int arenaOpeningCount() { return NUM_OPENINGS; }

ArenaGame playArenaGame(ChessEngine& white, ChessEngine& black, int openingIndex, int maxPlies) {
    ArenaGame g;
    ChessPosition pos;
    pos.loadFEN(START_FEN);
    std::map<std::string, int> seen;

    // Opening line (fixed moves, not chosen by the bots and not reviewed)
    std::string line = OPENINGS[((openingIndex % NUM_OPENINGS) + NUM_OPENINGS) % NUM_OPENINGS];
    size_t start = 0;
    while (start < line.size()) {
        size_t end = line.find(' ', start);
        if (end == std::string::npos) end = line.size();
        std::string uci = line.substr(start, end - start);
        if (!applyUCI(pos, uci)) {
            std::fprintf(stderr, "[WARN] opening %d: illegal move %s, line cut short\n", openingIndex, uci.c_str());
            break;
        }
        g.plies++;
        start = end + 1;
    }
    g.startFen = pos.toFEN();

    while (true) {
        std::string key = pos.positionKey();
        if (++seen[key] >= 3) { g.result = "1/2-1/2"; g.reason = "repetition"; break; }
        if (pos.halfmoveClock >= 100) { g.result = "1/2-1/2"; g.reason = "50-move"; break; }
        if (pos.isInsufficientMaterial()) { g.result = "1/2-1/2"; g.reason = "material"; break; }

        std::vector<Move> legal = pos.generateLegalMoves();
        if (legal.empty()) {
            if (pos.isInCheck(pos.sideToMove)) {
                g.result = (pos.sideToMove == Color::White) ? "0-1" : "1-0";
                g.reason = "checkmate";
            } else {
                g.result = "1/2-1/2";
                g.reason = "stalemate";
            }
            break;
        }
        if (g.plies >= maxPlies) { g.result = "1/2-1/2"; g.reason = "max-plies"; break; }

        const bool whiteToMove = (pos.sideToMove == Color::White);
        ChessEngine& eng = whiteToMove ? white : black;
        SearchResult r = eng.search(pos, 0);
        UndoState u;
        pos.makeMove(r.bestMove, u);
        g.moves.push_back(r.moveUCI);
        g.plies++;
        (whiteToMove ? g.whiteFens : g.blackFens).push_back(pos.toFEN());
    }
    return g;
}

static float eloFromScore(float p) {
    p = std::min(0.99f, std::max(0.01f, p));
    return -400.0f * std::log10(1.0f / p - 1.0f);
}

static void printSkill(const char* name, const SkillProfile& s) {
    std::printf("  %-11s avg level %4.1f | depth %d, capture search %d, noise %2d cp\n",
                name, s.average(), s.searchDepth(), s.quiescenceDepth(), s.noiseCp());
}

float runMatch(int games, const SkillProfile& a, const SkillProfile& b,
               const std::string& nameA, const std::string& nameB, const std::string& csvPath) {
    Evaluator evA(a.weights()), evB(b.weights());
    ChessEngine engA(evA), engB(evB);
    engA.applySkill(a);
    engB.applySkill(b);
    engA.setTimeLimit(MOVE_TIME_LIMIT_MS);
    engB.setTimeLimit(MOVE_TIME_LIMIT_MS);

    std::printf("Match: %s vs %s | %d games | %d opening lines x 2 colours\n",
                nameA.c_str(), nameB.c_str(), games, NUM_OPENINGS);
    printSkill(nameA.c_str(), a);
    printSkill(nameB.c_str(), b);

    std::ofstream csv(csvPath);
    if (csv.is_open()) csv << "game,opening,white,black,result,reason,plies,score_for_" << nameB << "\n";

    float scoreB = 0.0f;
    int winsB = 0, draws = 0, lossesB = 0;
    double sumA[NUM_EVAL_STATS + 1] = {0}, sumB[NUM_EVAL_STATS + 1] = {0};
    long cntA = 0, cntB = 0;
    Evaluator reader;
    auto accumulate = [&](const std::vector<std::string>& fens, int side, double* sum, long& cnt) {
        for (const auto& f : fens) {
            ChessPosition p;
            p.loadFEN(f);
            EvalFeatures ft = reader.computeFeatures(p);
            sum[0] += side * ft.material;
            for (int k = 0; k < NUM_EVAL_STATS; ++k) sum[k + 1] += side * ft.f[k];
            cnt++;
        }
    };

    for (int i = 0; i < games; ++i) {
        const int opening = (i / 2) % NUM_OPENINGS;
        const bool bIsWhite = (i % 2 == 1);
        ArenaGame g = bIsWhite ? playArenaGame(engB, engA, opening) : playArenaGame(engA, engB, opening);
        if (bIsWhite) { accumulate(g.whiteFens, 1, sumB, cntB); accumulate(g.blackFens, -1, sumA, cntA); }
        else          { accumulate(g.whiteFens, 1, sumA, cntA); accumulate(g.blackFens, -1, sumB, cntB); }

        float s;
        if (g.result == "1/2-1/2") { s = 0.5f; draws++; }
        else if ((g.result == "1-0") == bIsWhite) { s = 1.0f; winsB++; }
        else { s = 0.0f; lossesB++; }
        scoreB += s;

        const std::string& w = bIsWhite ? nameB : nameA;
        const std::string& bl = bIsWhite ? nameA : nameB;
        std::printf("  game %3d  opening %2d  %-9s vs %-9s  %-7s (%s, %d plies)  %s: %.1f/%d\n",
                    i + 1, opening + 1, w.c_str(), bl.c_str(), g.result.c_str(), g.reason.c_str(),
                    g.plies, nameB.c_str(), scoreB, i + 1);
        std::fflush(stdout);
        if (csv.is_open()) {
            csv << (i + 1) << "," << (opening + 1) << "," << w << "," << bl << "," << g.result << ","
                << g.reason << "," << g.plies << "," << s << "\n";
        }
    }

    const float pct = games > 0 ? scoreB / games : 0.5f;
    std::printf("\nRESULT  %s scored %.1f / %d (%.1f%%)  W %d  D %d  L %d\n",
                nameB.c_str(), scoreB, games, pct * 100.0f, winsB, draws, lossesB);
    std::printf("Implied Elo difference (%s - %s): %+.0f\n", nameB.c_str(), nameA.c_str(), eloFromScore(pct));
    if (csv.is_open()) std::printf("Per-game results written to %s\n", csvPath.c_str());

    std::printf("\nStyle profile: average raw score of the positions each side reached\n");
    std::printf("(after its own moves, from its own point of view; higher = better for that side)\n");
    std::printf("  %-17s %10s %10s %10s\n", "factor", nameA.c_str(), nameB.c_str(), "B - A");
    for (int k = 0; k <= NUM_EVAL_STATS; ++k) {
        double va = cntA ? sumA[k] / cntA : 0.0, vb = cntB ? sumB[k] / cntB : 0.0;
        std::printf("  %-17s %10.1f %10.1f %+10.1f\n", k == 0 ? "Material" : statLabel(k - 1), va, vb, vb - va);
    }
    return pct;
}

void runLadder(int gamesPerPair) {
    // Neighbouring skill levels play each other; Elo is chained up from level 1 = 400.
    // Small steps at the bottom, because each extra level there is a big jump in strength.
    const float levels[] = {1, 2, 3, 4, 5, 10, 15, 20};
    const int n = (int)(sizeof(levels) / sizeof(levels[0]));
    std::vector<float> elo(n, 400.0f);
    for (int i = 1; i < n; ++i) {
        char a[16], b[16];
        std::snprintf(a, sizeof a, "L%.0f", levels[i - 1]);
        std::snprintf(b, sizeof b, "L%.0f", levels[i]);
        std::printf("\n=== level %.0f vs level %.0f ===\n", levels[i - 1], levels[i]);
        float pct = runMatch(gamesPerPair, SkillProfile(levels[i - 1]), SkillProfile(levels[i]),
                             a, b, std::string("data/ladder_") + b + ".csv");
        // a perfect score has no finite Elo: use (wins + 0.5) / (games + 1) instead
        pct = (pct * gamesPerPair + 0.5f) / (gamesPerPair + 1.0f);
        if (pct < (0.5f / (gamesPerPair + 1.0f)) + 1e-6f) pct = 0.5f / (gamesPerPair + 1.0f);
        elo[i] = elo[i - 1] - 400.0f * std::log10(1.0f / pct - 1.0f);
    }
    std::printf("\nLADDER (level 1 = 400, bot-vs-bot Elo)\n");
    int np;
    const SkillPreset* p = skillPresets(np);
    for (int i = 0; i < n; ++i) {
        const char* name = "";
        for (int k = 0; k < np; ++k) if (p[k].level == levels[i]) name = p[k].name;
        std::printf("  level %4.0f  %-12s measured Elo %6.0f\n", levels[i], name, elo[i]);
    }
}

void runTraining(int games, LearningSystem& learner, const SkillProfile& opponent,
                 const std::string& oppName, float oppElo) {
    Evaluator evOpp(opponent.weights());
    ChessEngine engOpp(evOpp);
    engOpp.applySkill(opponent);
    engOpp.setTimeLimit(MOVE_TIME_LIMIT_MS);
    std::printf("Training: %d games against %s (Elo %.0f)\n", games, oppName.c_str(), oppElo);
    printSkill(oppName.c_str(), opponent);

    for (int i = 0; i < games; ++i) {
        Evaluator evL(learner.skill.weights());
        ChessEngine engL(evL);
        engL.applySkill(learner.skill);
        engL.setTimeLimit(MOVE_TIME_LIMIT_MS);
        const int opening = (learner.games / 2) % NUM_OPENINGS;
        const bool learnerWhite = (learner.games % 2 == 0);

        ArenaGame g = learnerWhite ? playArenaGame(engL, engOpp, opening) : playArenaGame(engOpp, engL, opening);
        std::string result = "draw";
        if (g.result == "1-0") result = learnerWhite ? "win" : "loss";
        else if (g.result == "0-1") result = learnerWhite ? "loss" : "win";

        LearningStepInfo s = learner.learn(result, oppElo, g.startFen, g.moves,
                                           learnerWhite ? Color::White : Color::Black);
        std::printf("  G%-4d %-4s as %s (%s, %d plies) | Elo %4.0f | depth %d | %s\n",
                    learner.games, result.c_str(), learnerWhite ? "White" : "Black",
                    g.reason.c_str(), g.plies, s.eloAfter, s.depthAfter, s.notice.c_str());
        if (learner.games % 10 == 0) {
            std::printf("        levels:");
            for (int k = 0; k < NUM_STATS; ++k) std::printf(" %s %.1f%s", statLabel(k), learner.skill.level[k], k + 1 < NUM_STATS ? "," : "\n");
        }
        std::fflush(stdout);
    }
    std::printf("\nTraining done. W/D/L %d/%d/%d, Elo %.1f, average level %.1f. Saved to %s and %s\n",
                learner.wins, learner.draws, learner.losses, learner.elo, learner.skill.average(),
                learner.dataPath().c_str(), learner.historyPath().c_str());
}

static long perft(ChessPosition& p, int d) {
    if (d == 0) return 1;
    std::vector<Move> ms = p.generateLegalMoves();
    if (d == 1) return (long)ms.size();
    long n = 0;
    for (const auto& m : ms) {
        UndoState u;
        p.makeMove(m, u);
        n += perft(p, d - 1);
        p.undoMove(m, u);
    }
    return n;
}

bool runPerftSuite() {
    struct Case { const char* name; const char* fen; int depth; long expected; };
    const Case cases[] = {
        {"Start position",           START_FEN, 4, 197281},
        {"Kiwipete",                 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 3, 97862},
        {"Rook endgame / en passant","8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 5, 674624},
        {"Promotions + castling",    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 4, 422333},
        {"Promotion with check",     "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 3, 62379},
    };
    bool ok = true;
    std::printf("Perft move-generation self test\n");
    for (const auto& c : cases) {
        ChessPosition p;
        p.loadFEN(c.fen);
        long n = perft(p, c.depth);
        bool pass = (n == c.expected);
        ok = ok && pass;
        std::printf("  %-27s depth %d  expected %8ld  got %8ld  %s\n", c.name, c.depth, c.expected, n, pass ? "PASS" : "FAIL");
    }
    std::printf(ok ? "All perft tests passed.\n" : "PERFT FAILURES DETECTED.\n");
    return ok;
}
