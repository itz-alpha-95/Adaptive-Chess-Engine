#include "HttpServer.h"
#include <iostream>
#include <sstream>
#include <thread>
#include <cmath>
#include <algorithm>
#include <iomanip>
#include <vector>
#include <cctype>
#include <fstream>

#ifdef _WIN32
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #pragma comment(lib, "ws2_32.lib")
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <unistd.h>
  typedef int SOCKET;
  #define INVALID_SOCKET (-1)
  #define SOCKET_ERROR   (-1)
  #define closesocket    close
#endif

// ── Minimal JSON helpers (request bodies are small and come from our own front end) ──
static std::string extractJsonString(const std::string& json, const std::string& key, const std::string& defaultVal = "") {
    size_t pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return defaultVal;
    pos = json.find(':', pos);
    if (pos == std::string::npos) return defaultVal;
    size_t q1 = json.find('"', pos + 1);
    if (q1 == std::string::npos) return defaultVal;
    size_t q2 = json.find('"', q1 + 1);
    if (q2 == std::string::npos) return defaultVal;
    return json.substr(q1 + 1, q2 - q1 - 1);
}

static float extractJsonFloat(const std::string& json, const std::string& key, float defaultVal = 0.0f) {
    size_t pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return defaultVal;
    pos = json.find(':', pos);
    if (pos == std::string::npos) return defaultVal;
    pos++;
    while (pos < json.length() && (std::isspace((unsigned char)json[pos]) || json[pos] == '"')) pos++;
    try {
        return std::stof(json.substr(pos));
    } catch (...) {
        return defaultVal;
    }
}


static std::vector<std::string> splitString(const std::string& s, char sep) {
    std::vector<std::string> out;
    size_t start = 0;
    while (start <= s.size()) {
        size_t end = s.find(sep, start);
        if (end == std::string::npos) end = s.size();
        if (end > start) out.push_back(s.substr(start, end - start));
        start = end + 1;
    }
    return out;
}

static std::string jsonEscape(const std::string& s) {
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (c == '\n') o += "\\n";
        else o += c;
    }
    return o;
}

static std::string num(float v, int prec) {
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(prec) << v;
    return ss.str();
}

static std::string weightsJson(const EvalWeights& w) {
    std::ostringstream ss;
    ss << "{\"material\":" << num(w.material, 3);
    for (int s = 0; s < NUM_EVAL_STATS; ++s) ss << ",\"" << statKey(s) << "\":" << num(w.w[s], 3);
    ss << "}";
    return ss.str();
}

static std::string levelsJson(const float* lv) {
    std::ostringstream ss;
    ss << "{";
    for (int s = 0; s < NUM_STATS; ++s) ss << (s ? "," : "") << "\"" << statKey(s) << "\":" << num(lv[s], 3);
    ss << "}";
    return ss.str();
}

static std::string skillInfoJson(const SkillProfile& sk) {
    std::ostringstream ss;
    ss << "\"skill\":" << levelsJson(sk.level)
       << ",\"skillAverage\":" << num(sk.average(), 2)
       << ",\"depth\":" << sk.searchDepth()
       << ",\"quiescence\":" << sk.quiescenceDepth()
       << ",\"noise\":" << sk.noiseCp()
       << ",\"weights\":" << weightsJson(sk.weights());
    return ss.str();
}

static std::string stepJson(const LearningStepInfo& s) {
    std::ostringstream ss;
    ss << "{\"result\":\"" << s.result << "\""
       << ",\"eloBefore\":" << num(s.eloBefore, 1)
       << ",\"eloAfter\":" << num(s.eloAfter, 1)
       << ",\"eloDelta\":" << num(s.eloDelta, 1)
       << ",\"expected\":" << num(s.expected, 3)
       << ",\"botMoves\":" << s.botMoves
       << ",\"acpl\":" << num(s.acpl, 1)
       << ",\"accuracy\":" << num(s.accuracy, 1)
       << ",\"inaccuracies\":" << s.inaccuracies
       << ",\"mistakes\":" << s.mistakes
       << ",\"blunders\":" << s.blunders
       << ",\"missedWins\":" << s.missedWins
       << ",\"practice\":" << (s.practice ? "true" : "false")
       << ",\"topStat\":\"" << s.topStat << "\""
       << ",\"notice\":\"" << jsonEscape(s.notice) << "\""
       << ",\"pointsTotal\":" << num(s.pointsTotal, 2)
       << ",\"depth\":" << s.depthAfter
       << ",\"consecutiveLosses\":" << s.consecutiveLosses
       << ",\"need\":" << levelsJson(s.need)
       << ",\"points\":" << levelsJson(s.points)
       << ",\"levelsBefore\":" << levelsJson(s.levelsBefore)
       << ",\"levelsAfter\":" << levelsJson(s.levelsAfter) << "}";
    return ss.str();
}

static std::string reviewJson(const GameReview& r) {
    auto perf = [](float acc) { return (int)std::lround(std::max(600.0f, std::min(2600.0f, 750.0f + (acc - 50.0f) * 35.0f))); };
    std::ostringstream ss;
    ss << "{\"whiteAccuracy\":" << num(r.accuracy[0], 1)
       << ",\"blackAccuracy\":" << num(r.accuracy[1], 1)
       << ",\"whiteAcpl\":" << num(r.acpl[0], 1)
       << ",\"blackAcpl\":" << num(r.acpl[1], 1)
       << ",\"whitePerf\":" << perf(r.accuracy[0])
       << ",\"blackPerf\":" << perf(r.accuracy[1])
       << ",\"totalMoves\":" << r.moves.size()
       << ",\"moves\":[";
    int keyCount = 0;
    std::ostringstream km;
    for (size_t i = 0; i < r.moves.size(); ++i) {
        const MoveReview& m = r.moves[i];
        const float winProb = std::max(1.0f, std::min(99.0f, 50.0f + 50.0f * std::tanh(m.evalAfter / 300.0f)));
        const std::string from = m.uci.substr(0, 2), to = m.uci.substr(2, 2);
        const std::string bFrom = m.bestUci.size() >= 4 ? m.bestUci.substr(0, 2) : from;
        const std::string bTo   = m.bestUci.size() >= 4 ? m.bestUci.substr(2, 2) : to;
        ss << (i ? "," : "") << "{\"moveIndex\":" << i
           << ",\"moveNum\":" << (m.ply / 2 + 1)
           << ",\"san\":\"" << m.san << "\",\"color\":\"" << m.color << "\""
           << ",\"from\":\"" << from << "\",\"to\":\"" << to << "\""
           << ",\"evalCp\":" << m.evalAfter
           << ",\"evalLoss\":" << m.loss
           << ",\"classification\":\"" << m.classification << "\""
           << ",\"winProb\":" << num(winProb, 1)
           << ",\"bestMoveSan\":\"" << m.bestSan << "\""
           << ",\"bestMoveFrom\":\"" << bFrom << "\",\"bestMoveTo\":\"" << bTo << "\""
           << ",\"fen\":\"" << m.fenAfter << "\"}";
        if ((m.loss >= 180 || m.classification == "missed_win") && keyCount < 4) {
            km << (keyCount ? "," : "") << "{\"moveIndex\":" << i << ",\"moveNum\":" << (m.ply / 2 + 1)
               << ",\"san\":\"" << m.san << "\",\"color\":\"" << m.color << "\",\"evalLoss\":" << m.loss
               << ",\"classification\":\"" << m.classification << "\",\"bestMoveSan\":\"" << m.bestSan << "\"}";
            keyCount++;
        }
    }
    ss << "],\"keyMoments\":[" << km.str() << "]}";
    return ss.str();
}

static std::string breakdownJson(const EvalBreakdown& b) {
    std::ostringstream ss;
    ss << "{\"material\":" << b.material;
    for (int s = 0; s < NUM_EVAL_STATS; ++s) ss << ",\"" << statKey(s) << "\":" << b.f[s];
    ss << ",\"total\":" << b.totalScore;
    // short keys kept for the existing console view
    ss << ",\"center\":" << b.f[ST_CENTER] << ",\"pst\":" << b.f[ST_PLACEMENT]
       << ",\"kingSafety\":" << b.f[ST_KING_SAFETY] << ",\"mobility\":" << b.f[ST_MOBILITY] << "}";
    return ss.str();
}

static std::string presetsJson() {
    int n;
    const SkillPreset* p = skillPresets(n);
    std::ostringstream ss;
    ss << "[";
    for (int i = 0; i < n; ++i) {
        SkillProfile sk(p[i].level);
        ss << (i ? "," : "") << "{\"key\":\"" << p[i].key << "\",\"name\":\"" << p[i].name
           << "\",\"level\":" << num(p[i].level, 1) << ",\"elo\":" << num(p[i].elo, 0)
           << ",\"depth\":" << sk.searchDepth() << "}";
    }
    ss << "]";
    return ss.str();
}

static std::vector<std::string> parseMoves(const std::string& body) {
    return splitString(extractJsonString(body, "moves", ""), ' ');
}

static const char* START_FEN_STR = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

HttpServer::HttpServer(ChessEngine& engine, LearningSystem& learner, int port)
    : engine_(engine), learner_(learner), port_(port) {}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::start() {
#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        std::cerr << "[ERROR] WSAStartup failed.\n";
        return;
    }
#endif
    SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) {
        std::cerr << "[ERROR] Could not create socket.\n";
        return;
    }

    int opt = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in server{};
    server.sin_family = AF_INET;
    server.sin_addr.s_addr = htonl(INADDR_LOOPBACK);   // only this computer can connect
    server.sin_port = htons((unsigned short)port_);

    if (bind(s, (struct sockaddr*)&server, sizeof(server)) == SOCKET_ERROR) {
        std::cerr << "[ERROR] Bind failed on port " << port_ << " (is another server already running?).\n";
        closesocket(s);
        return;
    }

    listen(s, 16);
    listenSocket_ = (intptr_t)s;
    running_ = true;

    std::cout << "[INFO] AdaptiveEngine C++ Backend Server listening on http://localhost:" << port_ << "\n";
    workerLoop();
}

void HttpServer::stop() {
    if (running_) {
        running_ = false;
        if (listenSocket_ != -1) {
            closesocket((SOCKET)listenSocket_);
            listenSocket_ = -1;
        }
#ifdef _WIN32
        WSACleanup();
#endif
    }
}

void HttpServer::workerLoop() {
    while (running_) {
        sockaddr_in client;
        socklen_t c = sizeof(sockaddr_in);
        SOCKET clientSock = accept((SOCKET)listenSocket_, (struct sockaddr*)&client, &c);
        if (clientSock == INVALID_SOCKET) {
            if (!running_) break;
            continue;
        }
        std::thread([this, clientSock]() {
            handleClient((intptr_t)clientSock);
        }).detach();
    }
}

void HttpServer::handleClient(intptr_t clientSock) {
    SOCKET s = (SOCKET)clientSock;
    char buffer[16384];
    int bytes = recv(s, buffer, sizeof(buffer) - 1, 0);
    if (bytes <= 0) {
        closesocket(s);
        return;
    }
    std::string req(buffer, bytes);

    // Make sure the whole header block has arrived
    while (req.find("\r\n\r\n") == std::string::npos && req.size() < 65536) {
        int more = recv(s, buffer, sizeof(buffer) - 1, 0);
        if (more <= 0) break;
        req.append(buffer, more);
    }

    std::istringstream ss(req);
    std::string method, path, proto;
    ss >> method >> path >> proto;

    if (method == "OPTIONS") {
        std::string resp =
            "HTTP/1.1 204 No Content\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
            "Access-Control-Max-Age: 86400\r\n"
            "Content-Length: 0\r\n\r\n";
        send(s, resp.c_str(), (int)resp.length(), 0);
        closesocket(s);
        return;
    }

    std::string body;
    size_t headerEnd = req.find("\r\n\r\n");
    if (headerEnd != std::string::npos) body = req.substr(headerEnd + 4);

    // Read the rest of the body if Content-Length says there is more
    std::string lower = req.substr(0, headerEnd == std::string::npos ? req.size() : headerEnd);
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return (char)std::tolower(ch); });
    size_t clPos = lower.find("content-length:");
    if (clPos != std::string::npos) {
        try {
            size_t expectedLen = std::stoul(lower.substr(clPos + 15));
            while (body.length() < expectedLen && body.length() < 4 * 1024 * 1024) {
                int more = recv(s, buffer, sizeof(buffer) - 1, 0);
                if (more <= 0) break;
                body.append(buffer, more);
            }
        } catch (...) {}
    }

    std::string jsonResponse;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jsonResponse = handleRequest(method, path, body);
    }

    std::string httpResponse =
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Length: " + std::to_string(jsonResponse.length()) + "\r\n"
        "Connection: close\r\n\r\n" + jsonResponse;

    send(s, httpResponse.c_str(), (int)httpResponse.length(), 0);
    closesocket(s);
}

std::string HttpServer::handleRequest(const std::string& method, const std::string& path, const std::string& body) {
    if (method == "GET" && path == "/state")        return handleGetState();
    if (method == "GET" && path == "/history")      return handleGetHistory();
    if (method == "POST" && path == "/move")        return handlePostMove(body);
    if (method == "POST" && path == "/analyze")     return handlePostAnalyze(body);
    if (method == "POST" && path == "/learn")       return handlePostLearn(body);
    if (method == "POST" && path == "/review")      return handlePostReview(body);
    if (method == "POST" && path == "/import")      return handlePostImport(body);
    if (method == "POST" && path == "/reset")       return handlePostReset();
    return "{\"status\":\"not_found\"}";
}

std::string HttpServer::handleGetState() {
    std::ostringstream ss;
    ss << "{\"status\":\"ok\",\"version\":" << LearningSystem::DATA_VERSION
       << ",\"elo\":" << num(learner_.elo, 1)
       << ",\"games\":" << learner_.games
       << ",\"wins\":" << learner_.wins
       << ",\"losses\":" << learner_.losses
       << ",\"draws\":" << learner_.draws
       << ",\"consecutiveLosses\":" << learner_.consecutiveLosses
       << ",\"pointsNextGame\":" << num(LearningSystem::pointsForGame(learner_.games), 2)
       << ",\"moveTimeLimitMs\":" << MOVE_TIME_LIMIT_MS
       << ",\"presets\":" << presetsJson()
       << "," << skillInfoJson(learner_.skill);
    if (!learner_.lastStep.result.empty()) ss << ",\"lastStep\":" << stepJson(learner_.lastStep);
    ss << "}";
    return ss.str();
}

std::string HttpServer::handlePostMove(const std::string& body) {
    std::string fen = extractJsonString(body, "fen", START_FEN_STR);
    ChessPosition pos;
    if (!pos.loadFEN(fen)) return "{\"status\":\"invalid_fen\",\"error\":\"Invalid FEN position\"}";

    // "level": play as a sparring bot of that skill level instead of AdaptiveEngine
    const float sparLevel = extractJsonFloat(body, "level", -1.0f);
    SearchResult res;
    int qdepth, noise;
    if (sparLevel >= 0.0f) {
        SkillProfile sk(sparLevel);
        Evaluator ev(sk.weights());
        ChessEngine sparring(ev);
        sparring.applySkill(sk);
        sparring.setTimeLimit(MOVE_TIME_LIMIT_MS);
        res = sparring.search(pos, 0);
        qdepth = sparring.getQuiescenceDepth();
        noise = sparring.getNoise();
    } else {
        engine_.applySkill(learner_.skill);   // AdaptiveEngine plays at its current skill
        engine_.setTimeLimit(MOVE_TIME_LIMIT_MS);
        res = engine_.search(pos, 0);
        qdepth = engine_.getQuiescenceDepth();
        noise = engine_.getNoise();
    }

    std::ostringstream ss;
    ss << "{\"status\":\"ok\""
       << ",\"move\":\"" << res.moveUCI << "\""
       << ",\"san\":\"" << res.moveSAN << "\""
       << ",\"score\":" << res.score
       << ",\"depth\":" << res.depth
       << ",\"targetDepth\":" << res.targetDepth
       << ",\"timedOut\":" << (res.timedOut ? "true" : "false")
       << ",\"quiescence\":" << qdepth
       << ",\"noise\":" << noise
       << ",\"nodes\":" << res.nodes
       << ",\"qnodes\":" << res.qnodes
       << ",\"cutoffs\":" << res.cutoffs
       << ",\"ttHits\":" << res.ttHits
       << ",\"time_ms\":" << res.timeMs
       << ",\"nps\":" << res.nps
       << ",\"pv\":[";
    for (size_t i = 0; i < res.pv.size(); ++i) ss << "\"" << res.pv[i] << "\"" << (i + 1 < res.pv.size() ? "," : "");
    ss << "],\"breakdown\":" << breakdownJson(res.breakdown) << "}";
    return ss.str();
}

struct ScoredMove {
    Move move;
    std::string san;
    std::string uci;
    int evalScore = 0; // POV of current player
    float sfLoss = 0.0f; // Loss in pawns
    float humanProb = 0.0f; // Softmax probability
    std::string category; // best, meh, blunder
};

std::string HttpServer::handlePostAnalyze(const std::string& body) {
    std::string fen = extractJsonString(body, "fen", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    if (fen.empty()) fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    ChessPosition pos;
    if (!pos.loadFEN(fen)) return "{\"status\":\"invalid_fen\",\"error\":\"Invalid FEN position\"}";

    std::vector<Move> legal = pos.generateLegalMoves();
    if (legal.empty()) {
        return "{\"status\":\"game_over\"}";
    }

    Evaluator eval(SkillProfile::master().weights());   // analysis panel uses full knowledge
    bool isWhite = (pos.sideToMove == Color::White);

    std::vector<ScoredMove> scored;
    scored.reserve(legal.size());

    for (const auto& m : legal) {
        UndoState undo;
        pos.makeMove(m, undo);
        int score = eval.evaluate(pos);
        pos.undoMove(m, undo);

        int povScore = isWhite ? score : -score;
        ScoredMove sm;
        sm.move = m;
        sm.san = pos.moveToSAN(m);
        sm.uci = moveToUCI(m);
        sm.evalScore = povScore;
        scored.push_back(sm);
    }

    std::sort(scored.begin(), scored.end(), [](const ScoredMove& a, const ScoredMove& b) {
        return a.evalScore > b.evalScore;
    });

    int bestScore = scored[0].evalScore;
    const float T = 120.0f; // Softmax temperature
    float expSum = 0.0f;
    std::vector<float> exps;
    for (const auto& sm : scored) {
        float e = std::exp((sm.evalScore - bestScore) / T);
        exps.push_back(e);
        expSum += e;
    }

    int numBest = 0, numMeh = 0, numBlunders = 0;
    for (size_t i = 0; i < scored.size(); ++i) {
        scored[i].humanProb = (exps[i] / expSum) * 100.0f;
        int evalLossCp = bestScore - scored[i].evalScore;
        scored[i].sfLoss = -((float)evalLossCp / 100.0f);

        if (evalLossCp <= 25) {
            scored[i].category = "best";
            numBest++;
        } else if (evalLossCp <= 150) {
            scored[i].category = "meh";
            numMeh++;
        } else {
            scored[i].category = "blunder";
            numBlunders++;
        }
    }

    int engineEvalCp = isWhite ? bestScore : -bestScore;
    float winProb = 50.0f + 50.0f * (2.0f / (1.0f + std::exp(-0.00368208f * (float)engineEvalCp)) - 1.0f);

    std::ostringstream ss;
    ss << "{\n"
       << "  \"status\": \"ok\",\n"
       << "  \"engineEvalCp\": " << engineEvalCp << ",\n"
       << "  \"winProb\": " << std::fixed << std::setprecision(1) << winProb << ",\n"
       << "  \"numBest\": " << numBest << ",\n"
       << "  \"numMeh\": " << numMeh << ",\n"
       << "  \"numBlunders\": " << numBlunders << ",\n"
       << "  \"total\": " << scored.size() << ",\n"
       << "  \"moves\": [\n";

    for (size_t i = 0; i < scored.size(); ++i) {
        const auto& sm = scored[i];
        ss << "    {\"san\":\"" << sm.san << "\",\"uci\":\"" << sm.uci
           << "\",\"score\":" << sm.evalScore
           << ",\"sfLoss\":" << std::setprecision(2) << sm.sfLoss
           << ",\"humanProb\":" << std::setprecision(1) << sm.humanProb
           << ",\"category\":\"" << sm.category << "\"}"
           << (i + 1 < scored.size() ? ",\n" : "\n");
    }
    ss << "  ]\n}";
    return ss.str();
}

std::string HttpServer::handlePostLearn(const std::string& body) {
    std::string result = extractJsonString(body, "result", "draw");
    if (result != "win" && result != "loss" && result != "draw") result = "draw";
    float oppElo = extractJsonFloat(body, "opp_elo", 800.0f);
    std::string colorStr = extractJsonString(body, "engine_color", "b");
    Color botColor = (colorStr == "w" || colorStr == "white") ? Color::White : Color::Black;
    std::string startFen = extractJsonString(body, "start_fen", START_FEN_STR);
    std::vector<std::string> moves = parseMoves(body);

    LearningStepInfo step = learner_.learn(result, oppElo, startFen, moves, botColor);
    engine_.applySkill(learner_.skill);

    std::cout << "[LEARN] Game " << learner_.games << ": " << result
              << " | Elo " << num(step.eloBefore, 1) << " -> " << num(step.eloAfter, 1)
              << " | depth " << learner_.skill.searchDepth() << " | " << step.notice << std::endl;

    std::ostringstream ss;
    ss << "{\"status\":\"ok\""
       << ",\"elo\":" << num(learner_.elo, 1)
       << ",\"games\":" << learner_.games
       << ",\"wins\":" << learner_.wins
       << ",\"losses\":" << learner_.losses
       << ",\"draws\":" << learner_.draws
       << ",\"consecutiveLosses\":" << learner_.consecutiveLosses
       << ",\"pointsNextGame\":" << num(LearningSystem::pointsForGame(learner_.games), 2)
       << "," << skillInfoJson(learner_.skill)
       << ",\"lastStep\":" << stepJson(step)
       << ",\"review\":" << reviewJson(learner_.lastReview) << "}";
    return ss.str();
}

std::string HttpServer::handlePostReview(const std::string& body) {
    std::string startFen = extractJsonString(body, "start_fen", START_FEN_STR);
    Coach coach;
    GameReview r = coach.review(startFen, parseMoves(body));
    return "{\"status\":\"ok\",\"review\":" + reviewJson(r) + "}";
}

std::string HttpServer::handleGetHistory() {
    std::ifstream ifs(learner_.historyPath());
    std::stringstream ss;
    if (ifs.is_open()) ss << ifs.rdbuf();
    return "{\"status\":\"ok\",\"csv\":\"" + jsonEscape(ss.str()) + "\"}";
}

std::string HttpServer::handlePostImport(const std::string& body) {
    std::string error;
    if (!learner_.importJson(body, error)) {
        return "{\"status\":\"error\",\"error\":\"" + jsonEscape(error) + "\"}";
    }
    engine_.applySkill(learner_.skill);
    std::cout << "[IMPORT] Stats imported: Elo " << num(learner_.elo, 1) << ", " << learner_.games
              << " games, average level " << num(learner_.skill.average(), 1) << std::endl;
    return handleGetState();
}

std::string HttpServer::handlePostReset() {
    learner_.reset();
    engine_.applySkill(learner_.skill);
    return handleGetState();
}
