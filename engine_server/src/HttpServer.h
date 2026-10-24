#pragma once
#include "ChessEngine.h"
#include "LearningSystem.h"
#include <string>
#include <atomic>
#include <mutex>
#include <cstdint>

class HttpServer {
public:
    HttpServer(ChessEngine& engine, LearningSystem& learner, int port = 8080);
    ~HttpServer();

    void start();
    void stop();

private:
    ChessEngine& engine_;
    LearningSystem& learner_;
    int port_;
    std::atomic<bool> running_{false};
    intptr_t listenSocket_ = -1;
    std::mutex mutex_;   // one request at a time touches the engine / learner

    void workerLoop();
    void handleClient(intptr_t clientSock);

    std::string handleRequest(const std::string& method, const std::string& path, const std::string& body);

    std::string handleGetState();
    std::string handleGetHistory();
    std::string handlePostMove(const std::string& body);
    std::string handlePostAnalyze(const std::string& body);
    std::string handlePostLearn(const std::string& body);
    std::string handlePostReview(const std::string& body);
    std::string handlePostImport(const std::string& body);
    std::string handlePostReset();
};
