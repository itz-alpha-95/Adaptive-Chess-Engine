#pragma once
#include "ChessRules.h"
#include "Evaluator.h"
#include <chrono>
#include <functional>
#include <random>
#include <vector>

struct SearchResult {
    Move bestMove;
    std::string moveUCI;
    std::string moveSAN;
    int score = 0;          // centipawns, White's point of view
    int depth = 0;          // deepest iteration that finished
    int targetDepth = 0;    // depth the bot's Calculation level asked for
    bool timedOut = false;  // stopped by the time limit before reaching targetDepth
    int nodes = 0;
    int qnodes = 0;         // nodes spent in the capture search
    int cutoffs = 0;
    int ttHits = 0;         // positions answered from the transposition table
    int timeMs = 0;
    int nps = 0;
    std::vector<std::string> pv;
    EvalBreakdown breakdown; // evaluation of the position AFTER the chosen move
};

class ChessEngine {
public:
    explicit ChessEngine(Evaluator& eval, int depth = 3);

    SearchResult search(ChessPosition& pos, int maxDepth = 0);

    void setDepth(int d) { defaultDepth_ = d; }
    /// Max plies of capture search after the main search (0 = none).
    void setQuiescenceDepth(int q) { maxQDepth_ = q; }
    /// Random wobble (cp) added to root move scores (0 = always the best move).
    void setNoise(int cp) { noiseCp_ = cp; }
    /// Time limit per move in milliseconds (0 = none). Depth 1 always completes.
    void setTimeLimit(int ms) { timeLimitMs_ = ms; }
    /// Depth, capture search, noise and weights from a skill profile.
    void applySkill(const SkillProfile& s) {
        eval_.weights = s.weights();
        defaultDepth_ = s.searchDepth();
        maxQDepth_ = s.quiescenceDepth();
        noiseCp_ = s.noiseCp();
    }
    int getQuiescenceDepth() const { return maxQDepth_; }
    int getNoise() const { return noiseCp_; }
    int getDepth() const { return defaultDepth_; }
    int getTimeLimit() const { return timeLimitMs_; }
    Evaluator& getEvaluator() { return eval_; }
    void setWeights(const EvalWeights& w) { eval_.weights = w; }

    static const int INF = 1000000;
    static const int MATE_SCORE = 99000;

private:
    struct TTEntry {
        uint64_t key = 0;
        int32_t score = 0;
        int8_t depth = -1;
        uint8_t flag = 0;      // 0 empty, 1 exact, 2 lower bound, 3 upper bound
        Move best;
    };
    static const size_t TT_SIZE = 1u << 18;   // 262,144 entries
    static const int MAX_PLY = 64;

    Evaluator& eval_;
    int defaultDepth_ = 3;
    int nodes_ = 0;
    int qnodes_ = 0;
    int cutoffs_ = 0;
    int ttHits_ = 0;
    int maxQDepth_ = 8;
    int noiseCp_ = 0;
    int timeLimitMs_ = 0;
    bool aborted_ = false;
    bool canAbort_ = false;
    std::chrono::high_resolution_clock::time_point start_;
    std::mt19937 rng_{(unsigned)std::chrono::high_resolution_clock::now().time_since_epoch().count() ^ std::random_device{}()};

    std::vector<TTEntry> tt_;
    Move killers_[MAX_PLY][2];
    int history_[64][64];

    bool timeUp();
    int alphaBeta(ChessPosition& pos, int depth, int ply, int alpha, int beta, bool isMax, std::vector<Move>& pv);
    int quiesce(ChessPosition& pos, int ply, int qdepth, int alpha, int beta, bool isMax);
    void orderMoves(std::vector<Move>& moves, ChessPosition& pos, const Move* first = nullptr, int ply = -1);
};
