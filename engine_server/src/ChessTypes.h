#pragma once
#include <string>
#include <vector>
#include <cstdint>

enum class Color : int8_t {
    White = 0,
    Black = 1,
    None  = 2
};

enum class PieceType : int8_t {
    None   = 0,
    Pawn   = 1,
    Knight = 2,
    Bishop = 3,
    Rook   = 4,
    Queen  = 5,
    King   = 6
};

struct Piece {
    PieceType type  = PieceType::None;
    Color     color = Color::None;

    bool isEmpty() const { return type == PieceType::None; }
};

struct Move {
    int8_t fromSq   = 0; // 0..63 (0=a8, 63=h1 or 0=a1, etc. Let's use 0..63 row*8 + col)
    int8_t toSq     = 0;
    PieceType promo = PieceType::None;
    int score       = 0;

    bool operator==(const Move& other) const {
        return fromSq == other.fromSq && toSq == other.toSq && promo == other.promo;
    }
};

inline std::string squareToUCI(int sq) {
    int col = sq % 8;
    int row = sq / 8;
    // Row 0 = 8th rank, Row 7 = 1st rank
    char file = 'a' + col;
    char rank = '8' - row;
    std::string s;
    s += file;
    s += rank;
    return s;
}

inline int uciToSquare(const std::string& str) {
    if (str.length() < 2) return -1;
    int col = str[0] - 'a';
    int row = '8' - str[1];
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return row * 8 + col;
}

inline std::string moveToUCI(const Move& m) {
    std::string s = squareToUCI(m.fromSq) + squareToUCI(m.toSq);
    if (m.promo != PieceType::None) {
        switch (m.promo) {
            case PieceType::Queen:  s += 'q'; break;
            case PieceType::Rook:   s += 'r'; break;
            case PieceType::Bishop: s += 'b'; break;
            case PieceType::Knight: s += 'n'; break;
            default: break;
        }
    }
    return s;
}
