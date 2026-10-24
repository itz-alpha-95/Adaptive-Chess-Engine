#pragma once
#include "ChessTypes.h"
#include <string>
#include <vector>

struct UndoState {
    Piece captured;
    int8_t epSq = -1;
    uint8_t castlingRights = 0;
    int halfmove = 0;
};

class ChessPosition {
public:
    Piece board[64];
    Color sideToMove = Color::White;
    uint8_t castlingRights = 15; // bit 0: WK, bit 1: WQ, bit 2: BK, bit 3: BQ
    int8_t epSquare = -1;
    int halfmoveClock = 0;
    int fullmoveNumber = 1;

    ChessPosition();
    bool loadFEN(const std::string& fen);
    std::string toFEN() const;

    bool isSquareAttacked(int sq, Color byColor) const;
    bool isInCheck(Color c) const;

    std::vector<Move> generateLegalMoves();
    void makeMove(const Move& m, UndoState& undo);
    void undoMove(const Move& m, const UndoState& undo);

    bool isCheckmate();
    bool isStalemate();
    bool isDraw();

    std::string moveToSAN(const Move& m);
    Move parseMoveUCI(const std::string& uci);

    /// Pseudo-legal moves (may leave own king in check). Used for mobility.
    std::vector<Move> generatePseudoMoves(Color c) const;
    /// Legal captures, en-passant captures and promotions only (quiescence search).
    std::vector<Move> generateLegalTactical();
    /// Board + side + castling + en-passant, without move counters (repetition detection).
    std::string positionKey() const;
    /// Bare kings, or king + single minor piece vs king.
    bool isInsufficientMaterial() const;
    /// Zobrist hash of board, side to move, castling rights and en-passant square.
    uint64_t hash() const;
};
