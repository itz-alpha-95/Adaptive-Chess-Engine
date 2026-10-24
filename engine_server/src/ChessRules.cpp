#include "ChessRules.h"
#include <sstream>
#include <cctype>
#include <algorithm>

static const int KNIGHT_OFFSETS[8] = {-17, -15, -10, -6, 6, 10, 15, 17};
static const int BISHOP_OFFSETS[4] = {-9, -7, 7, 9};
static const int ROOK_OFFSETS[4]   = {-8, -1, 1, 8};
static const int KING_OFFSETS[8]   = {-9, -8, -7, -1, 1, 7, 8, 9};

ChessPosition::ChessPosition() {
    loadFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

bool ChessPosition::loadFEN(const std::string& fen) {
    std::istringstream ss(fen);
    std::string placement, turn, castling, ep;
    int newHalfmove = 0, newFullmove = 1;
    if (!(ss >> placement >> turn >> castling >> ep >> newHalfmove >> newFullmove)) return false;
    std::string extra;
    if (ss >> extra) return false;
    if ((turn != "w" && turn != "b") || newHalfmove < 0 || newFullmove < 1) return false;
    if (castling != "-" && castling.find_first_not_of("KQkq") != std::string::npos) return false;
    if (castling != "-" && (castling.find('K') != castling.rfind('K') ||
        castling.find('Q') != castling.rfind('Q') || castling.find('k') != castling.rfind('k') ||
        castling.find('q') != castling.rfind('q'))) return false;

    Piece parsedBoard[64];
    for (Piece& piece : parsedBoard) piece = {PieceType::None, Color::None};
    int sq = 0, rankWidth = 0, ranks = 1;
    bool previousWasDigit = false;
    int whiteKings = 0, blackKings = 0;
    for (char c : placement) {
        if (c == '/') {
            if (rankWidth != 8 || ranks >= 8) return false;
            ++ranks;
            rankWidth = 0;
            previousWasDigit = false;
            continue;
        }
        if (c >= '1' && c <= '8') {
            if (previousWasDigit) return false;
            const int empty = c - '0';
            if (rankWidth + empty > 8) return false;
            sq += empty;
            rankWidth += empty;
            previousWasDigit = true;
        } else {
            if (rankWidth >= 8) return false;
            Color col = std::isupper(c) ? Color::White : Color::Black;
            char lower = std::tolower(c);
            PieceType pt = PieceType::None;
            switch (lower) {
                case 'p': pt = PieceType::Pawn; break;
                case 'n': pt = PieceType::Knight; break;
                case 'b': pt = PieceType::Bishop; break;
                case 'r': pt = PieceType::Rook; break;
                case 'q': pt = PieceType::Queen; break;
                case 'k': pt = PieceType::King; break;
                default: return false;
            }
            parsedBoard[sq++] = {pt, col};
            ++rankWidth;
            previousWasDigit = false;
            if (pt == PieceType::King) (col == Color::White ? whiteKings : blackKings)++;
        }
    }
    if (ranks != 8 || rankWidth != 8 || sq != 64 || whiteKings != 1 || blackKings != 1) return false;
    for (int file = 0; file < 8; ++file) {
        if (parsedBoard[file].type == PieceType::Pawn || parsedBoard[56 + file].type == PieceType::Pawn) return false;
    }

    int newEpSquare = -1;
    if (ep != "-") {
        if (ep.size() != 2 || ep[0] < 'a' || ep[0] > 'h' || ep[1] < '1' || ep[1] > '8') return false;
        newEpSquare = uciToSquare(ep);
        if ((turn == "w" && ep[1] != '6') || (turn == "b" && ep[1] != '3')) return false;
        const int pawnSquare = turn == "w" ? newEpSquare + 8 : newEpSquare - 8;
        const Color pawnColor = turn == "w" ? Color::Black : Color::White;
        if (!parsedBoard[newEpSquare].isEmpty() || parsedBoard[pawnSquare].type != PieceType::Pawn ||
            parsedBoard[pawnSquare].color != pawnColor || newHalfmove != 0) return false;
    }

    uint8_t newCastlingRights = 0;
    if (castling.find('K') != std::string::npos) newCastlingRights |= 1;
    if (castling.find('Q') != std::string::npos) newCastlingRights |= 2;
    if (castling.find('k') != std::string::npos) newCastlingRights |= 4;
    if (castling.find('q') != std::string::npos) newCastlingRights |= 8;
    const auto hasPiece = [&](int square, PieceType type, Color color) {
        return parsedBoard[square].type == type && parsedBoard[square].color == color;
    };
    if (((newCastlingRights & 1) && (!hasPiece(60, PieceType::King, Color::White) || !hasPiece(63, PieceType::Rook, Color::White))) ||
        ((newCastlingRights & 2) && (!hasPiece(60, PieceType::King, Color::White) || !hasPiece(56, PieceType::Rook, Color::White))) ||
        ((newCastlingRights & 4) && (!hasPiece(4, PieceType::King, Color::Black) || !hasPiece(7, PieceType::Rook, Color::Black))) ||
        ((newCastlingRights & 8) && (!hasPiece(4, PieceType::King, Color::Black) || !hasPiece(0, PieceType::Rook, Color::Black)))) return false;

    for (int i = 0; i < 64; ++i) board[i] = parsedBoard[i];
    sideToMove = (turn == "b") ? Color::Black : Color::White;
    castlingRights = newCastlingRights;
    epSquare = newEpSquare;
    halfmoveClock = newHalfmove;
    fullmoveNumber = newFullmove;
    return true;
}

std::string ChessPosition::toFEN() const {
    std::string fen;
    for (int r = 0; r < 8; ++r) {
        int empty = 0;
        for (int c = 0; c < 8; ++c) {
            const Piece& p = board[r * 8 + c];
            if (p.isEmpty()) {
                empty++;
            } else {
                if (empty > 0) {
                    fen += std::to_string(empty);
                    empty = 0;
                }
                char ch = '?';
                switch (p.type) {
                    case PieceType::Pawn:   ch = 'p'; break;
                    case PieceType::Knight: ch = 'n'; break;
                    case PieceType::Bishop: ch = 'b'; break;
                    case PieceType::Rook:   ch = 'r'; break;
                    case PieceType::Queen:  ch = 'q'; break;
                    case PieceType::King:   ch = 'k'; break;
                    default: break;
                }
                if (p.color == Color::White) ch = std::toupper(ch);
                fen += ch;
            }
        }
        if (empty > 0) fen += std::to_string(empty);
        if (r < 7) fen += '/';
    }

    fen += (sideToMove == Color::White) ? " w " : " b ";

    std::string cast;
    if (castlingRights & 1) cast += 'K';
    if (castlingRights & 2) cast += 'Q';
    if (castlingRights & 4) cast += 'k';
    if (castlingRights & 8) cast += 'q';
    if (cast.empty()) cast = "-";
    fen += cast + " ";

    if (epSquare >= 0 && epSquare < 64) {
        fen += squareToUCI(epSquare) + " ";
    } else {
        fen += "- ";
    }

    fen += std::to_string(halfmoveClock) + " " + std::to_string(fullmoveNumber);
    return fen;
}

static inline bool validCoord(int r, int c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

bool ChessPosition::isSquareAttacked(int sq, Color byColor) const {
    int r = sq / 8;
    int c = sq % 8;

    // Pawn attacks
    int pawnRow = (byColor == Color::White) ? r + 1 : r - 1;
    if (pawnRow >= 0 && pawnRow < 8) {
        if (c - 1 >= 0) {
            const Piece& p = board[pawnRow * 8 + (c - 1)];
            if (p.type == PieceType::Pawn && p.color == byColor) return true;
        }
        if (c + 1 < 8) {
            const Piece& p = board[pawnRow * 8 + (c + 1)];
            if (p.type == PieceType::Pawn && p.color == byColor) return true;
        }
    }

    // Knight attacks
    const int knightD[8][2] = {{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
    for (auto& d : knightD) {
        int nr = r + d[0], nc = c + d[1];
        if (validCoord(nr, nc)) {
            const Piece& p = board[nr * 8 + nc];
            if (p.type == PieceType::Knight && p.color == byColor) return true;
        }
    }

    // Bishop / Queen diagonals
    const int diagD[4][2] = {{-1,-1},{-1,1},{1,-1},{1,1}};
    for (auto& d : diagD) {
        int nr = r + d[0], nc = c + d[1];
        while (validCoord(nr, nc)) {
            const Piece& p = board[nr * 8 + nc];
            if (!p.isEmpty()) {
                if (p.color == byColor && (p.type == PieceType::Bishop || p.type == PieceType::Queen))
                    return true;
                break;
            }
            nr += d[0]; nc += d[1];
        }
    }

    // Rook / Queen orthogonal
    const int orthD[4][2] = {{-1,0},{1,0},{0,-1},{0,1}};
    for (auto& d : orthD) {
        int nr = r + d[0], nc = c + d[1];
        while (validCoord(nr, nc)) {
            const Piece& p = board[nr * 8 + nc];
            if (!p.isEmpty()) {
                if (p.color == byColor && (p.type == PieceType::Rook || p.type == PieceType::Queen))
                    return true;
                break;
            }
            nr += d[0]; nc += d[1];
        }
    }

    // King attacks
    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;
            int nr = r + dr, nc = c + dc;
            if (validCoord(nr, nc)) {
                const Piece& p = board[nr * 8 + nc];
                if (p.type == PieceType::King && p.color == byColor) return true;
            }
        }
    }

    return false;
}

bool ChessPosition::isInCheck(Color c) const {
    int kingSq = -1;
    for (int i = 0; i < 64; ++i) {
        if (board[i].type == PieceType::King && board[i].color == c) {
            kingSq = i;
            break;
        }
    }
    if (kingSq == -1) return false;
    Color opp = (c == Color::White) ? Color::Black : Color::White;
    return isSquareAttacked(kingSq, opp);
}

std::vector<Move> ChessPosition::generatePseudoMoves(Color c) const {
    std::vector<Move> moves;
    moves.reserve(48);
    Color opp = (c == Color::White) ? Color::Black : Color::White;

    for (int sq = 0; sq < 64; ++sq) {
        const Piece& p = board[sq];
        if (p.color != c) continue;

        int r = sq / 8;
        int col = sq % 8;

        if (p.type == PieceType::Pawn) {
            int forward = (c == Color::White) ? -1 : 1;
            int startRow = (c == Color::White) ? 6 : 1;
            int promoRow = (c == Color::White) ? 0 : 7;

            // Single push
            int nr = r + forward;
            if (nr >= 0 && nr < 8 && board[nr * 8 + col].isEmpty()) {
                if (nr == promoRow) {
                    moves.push_back({(int8_t)sq, (int8_t)(nr * 8 + col), PieceType::Queen});
                    moves.push_back({(int8_t)sq, (int8_t)(nr * 8 + col), PieceType::Rook});
                    moves.push_back({(int8_t)sq, (int8_t)(nr * 8 + col), PieceType::Bishop});
                    moves.push_back({(int8_t)sq, (int8_t)(nr * 8 + col), PieceType::Knight});
                } else {
                    moves.push_back({(int8_t)sq, (int8_t)(nr * 8 + col), PieceType::None});
                    // Double push
                    if (r == startRow) {
                        int nnr = r + 2 * forward;
                        if (board[nnr * 8 + col].isEmpty()) {
                            moves.push_back({(int8_t)sq, (int8_t)(nnr * 8 + col), PieceType::None});
                        }
                    }
                }
            }

            // Captures
            for (int dc : {-1, 1}) {
                int nc = col + dc;
                if (nc >= 0 && nc < 8 && nr >= 0 && nr < 8) {
                    int targetSq = nr * 8 + nc;
                    if (!board[targetSq].isEmpty() && board[targetSq].color == opp) {
                        if (nr == promoRow) {
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::Queen});
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::Rook});
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::Bishop});
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::Knight});
                        } else {
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::None});
                        }
                    } else if (targetSq == epSquare) {
                        moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::None});
                    }
                }
            }
        }
        else if (p.type == PieceType::Knight) {
            const int knightD[8][2] = {{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
            for (auto& d : knightD) {
                int nr = r + d[0], nc = col + d[1];
                if (validCoord(nr, nc)) {
                    int targetSq = nr * 8 + nc;
                    if (board[targetSq].isEmpty() || board[targetSq].color == opp) {
                        moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::None});
                    }
                }
            }
        }
        else if (p.type == PieceType::Bishop || p.type == PieceType::Queen || p.type == PieceType::Rook) {
            bool diag = (p.type == PieceType::Bishop || p.type == PieceType::Queen);
            bool orth = (p.type == PieceType::Rook   || p.type == PieceType::Queen);

            const int dirs[8][2] = {{-1,-1},{-1,1},{1,-1},{1,1},{-1,0},{1,0},{0,-1},{0,1}};
            int start = diag ? 0 : 4;
            int end   = orth ? 8 : 4;

            for (int i = start; i < end; ++i) {
                int nr = r + dirs[i][0], nc = col + dirs[i][1];
                while (validCoord(nr, nc)) {
                    int targetSq = nr * 8 + nc;
                    if (board[targetSq].isEmpty()) {
                        moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::None});
                    } else {
                        if (board[targetSq].color == opp) {
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::None});
                        }
                        break;
                    }
                    nr += dirs[i][0]; nc += dirs[i][1];
                }
            }
        }
        else if (p.type == PieceType::King) {
            for (int dr = -1; dr <= 1; ++dr) {
                for (int dc = -1; dc <= 1; ++dc) {
                    if (dr == 0 && dc == 0) continue;
                    int nr = r + dr, nc = col + dc;
                    if (validCoord(nr, nc)) {
                        int targetSq = nr * 8 + nc;
                        if (board[targetSq].isEmpty() || board[targetSq].color == opp) {
                            moves.push_back({(int8_t)sq, (int8_t)targetSq, PieceType::None});
                        }
                    }
                }
            }

            // Castling
            if (c == Color::White && sq == 60) { // e1
                if ((castlingRights & 1) && board[61].isEmpty() && board[62].isEmpty()) {
                    if (!isSquareAttacked(60, opp) && !isSquareAttacked(61, opp) && !isSquareAttacked(62, opp)) {
                        moves.push_back({60, 62, PieceType::None});
                    }
                }
                if ((castlingRights & 2) && board[59].isEmpty() && board[58].isEmpty() && board[57].isEmpty()) {
                    if (!isSquareAttacked(60, opp) && !isSquareAttacked(59, opp) && !isSquareAttacked(58, opp)) {
                        moves.push_back({60, 58, PieceType::None});
                    }
                }
            } else if (c == Color::Black && sq == 4) { // e8
                if ((castlingRights & 4) && board[5].isEmpty() && board[6].isEmpty()) {
                    if (!isSquareAttacked(4, opp) && !isSquareAttacked(5, opp) && !isSquareAttacked(6, opp)) {
                        moves.push_back({4, 6, PieceType::None});
                    }
                }
                if ((castlingRights & 8) && board[3].isEmpty() && board[2].isEmpty() && board[1].isEmpty()) {
                    if (!isSquareAttacked(4, opp) && !isSquareAttacked(3, opp) && !isSquareAttacked(2, opp)) {
                        moves.push_back({4, 2, PieceType::None});
                    }
                }
            }
        }
    }
    return moves;
}

void ChessPosition::makeMove(const Move& m, UndoState& undo) {
    undo.captured = board[m.toSq];
    undo.epSq = epSquare;
    undo.castlingRights = castlingRights;
    undo.halfmove = halfmoveClock;

    epSquare = -1;
    halfmoveClock++;

    Piece moving = board[m.fromSq];

    if (moving.type == PieceType::Pawn || !undo.captured.isEmpty()) {
        halfmoveClock = 0;
    }

    // En passant capture
    if (moving.type == PieceType::Pawn && m.toSq == undo.epSq) {
        int capturedPawnSq = (moving.color == Color::White) ? m.toSq + 8 : m.toSq - 8;
        undo.captured = board[capturedPawnSq];
        board[capturedPawnSq] = {PieceType::None, Color::None};
    }

    // Pawn double push creates EP
    if (moving.type == PieceType::Pawn) {
        if (std::abs(m.fromSq - m.toSq) == 16) {
            epSquare = (m.fromSq + m.toSq) / 2;
        }
    }

    // Castling rook move
    if (moving.type == PieceType::King) {
        if (moving.color == Color::White) {
            castlingRights &= ~3; // Lose WK and WQ
            if (m.fromSq == 60 && m.toSq == 62) { // Kingside
                board[61] = board[63]; board[63] = {PieceType::None, Color::None};
            } else if (m.fromSq == 60 && m.toSq == 58) { // Queenside
                board[59] = board[56]; board[56] = {PieceType::None, Color::None};
            }
        } else {
            castlingRights &= ~12; // Lose BK and BQ
            if (m.fromSq == 4 && m.toSq == 6) { // Kingside
                board[5] = board[7]; board[7] = {PieceType::None, Color::None};
            } else if (m.fromSq == 4 && m.toSq == 2) { // Queenside
                board[3] = board[0]; board[0] = {PieceType::None, Color::None};
            }
        }
    }

    // Rook moves or rook captured modifies castling rights
    if (m.fromSq == 63 || m.toSq == 63) castlingRights &= ~1;
    if (m.fromSq == 56 || m.toSq == 56) castlingRights &= ~2;
    if (m.fromSq == 7  || m.toSq == 7)  castlingRights &= ~4;
    if (m.fromSq == 0  || m.toSq == 0)  castlingRights &= ~8;

    // Promotion
    if (m.promo != PieceType::None) {
        moving.type = m.promo;
    }

    board[m.toSq] = moving;
    board[m.fromSq] = {PieceType::None, Color::None};

    if (sideToMove == Color::Black) fullmoveNumber++;
    sideToMove = (sideToMove == Color::White) ? Color::Black : Color::White;
}

void ChessPosition::undoMove(const Move& m, const UndoState& undo) {
    sideToMove = (sideToMove == Color::White) ? Color::Black : Color::White;
    if (sideToMove == Color::Black) fullmoveNumber--;

    Piece moved = board[m.toSq];
    if (m.promo != PieceType::None) {
        moved.type = PieceType::Pawn;
    }

    board[m.fromSq] = moved;
    board[m.toSq] = undo.captured;

    // Undo en passant capture
    if (moved.type == PieceType::Pawn && m.toSq == undo.epSq) {
        board[m.toSq] = {PieceType::None, Color::None};
        int capSq = (moved.color == Color::White) ? m.toSq + 8 : m.toSq - 8;
        board[capSq] = undo.captured;
    }

    // Undo castling rook move
    if (moved.type == PieceType::King) {
        if (moved.color == Color::White) {
            if (m.fromSq == 60 && m.toSq == 62) {
                board[63] = board[61]; board[61] = {PieceType::None, Color::None};
            } else if (m.fromSq == 60 && m.toSq == 58) {
                board[56] = board[59]; board[59] = {PieceType::None, Color::None};
            }
        } else {
            if (m.fromSq == 4 && m.toSq == 6) {
                board[7] = board[5]; board[5] = {PieceType::None, Color::None};
            } else if (m.fromSq == 4 && m.toSq == 2) {
                board[0] = board[3]; board[3] = {PieceType::None, Color::None};
            }
        }
    }

    epSquare = undo.epSq;
    castlingRights = undo.castlingRights;
    halfmoveClock = undo.halfmove;
}

std::vector<Move> ChessPosition::generateLegalMoves() {
    std::vector<Move> pseudo = generatePseudoMoves(sideToMove);
    std::vector<Move> legal;
    legal.reserve(pseudo.size());

    for (const auto& m : pseudo) {
        UndoState undo;
        makeMove(m, undo);
        Color opp = (sideToMove == Color::White) ? Color::Black : Color::White;
        if (!isInCheck(opp)) {
            legal.push_back(m);
        }
        undoMove(m, undo);
    }
    return legal;
}

bool ChessPosition::isCheckmate() {
    if (!isInCheck(sideToMove)) return false;
    return generateLegalMoves().empty();
}

bool ChessPosition::isStalemate() {
    if (isInCheck(sideToMove)) return false;
    return generateLegalMoves().empty();
}

bool ChessPosition::isDraw() {
    if (isStalemate()) return true;
    if (halfmoveClock >= 100) return true;
    return false;
}

std::string ChessPosition::moveToSAN(const Move& m) {
    Piece p = board[m.fromSq];
    if (p.isEmpty()) return moveToUCI(m);

    // Castling
    if (p.type == PieceType::King) {
        if (m.fromSq == 60 && m.toSq == 62) return "O-O";
        if (m.fromSq == 60 && m.toSq == 58) return "O-O-O";
        if (m.fromSq == 4 && m.toSq == 6) return "O-O";
        if (m.fromSq == 4 && m.toSq == 2) return "O-O-O";
    }

    std::string san;
    char pieceChar = 0;
    switch (p.type) {
        case PieceType::Knight: pieceChar = 'N'; break;
        case PieceType::Bishop: pieceChar = 'B'; break;
        case PieceType::Rook:   pieceChar = 'R'; break;
        case PieceType::Queen:  pieceChar = 'Q'; break;
        case PieceType::King:   pieceChar = 'K'; break;
        default: break;
    }

    bool isCapture = (!board[m.toSq].isEmpty() || (p.type == PieceType::Pawn && m.toSq == epSquare));

    if (p.type == PieceType::Pawn) {
        if (isCapture) {
            san += (char)('a' + (m.fromSq % 8));
            san += 'x';
        }
    } else {
        san += pieceChar;
        if (isCapture) san += 'x';
    }

    san += squareToUCI(m.toSq);

    if (m.promo != PieceType::None) {
        san += '=';
        switch (m.promo) {
            case PieceType::Queen:  san += 'Q'; break;
            case PieceType::Rook:   san += 'R'; break;
            case PieceType::Bishop: san += 'B'; break;
            case PieceType::Knight: san += 'N'; break;
            default: break;
        }
    }

    // Check check / checkmate
    UndoState undo;
    makeMove(m, undo);
    if (isCheckmate()) {
        san += '#';
    } else if (isInCheck(sideToMove)) {
        san += '+';
    }
    undoMove(m, undo);

    return san;
}

Move ChessPosition::parseMoveUCI(const std::string& uci) {
    if (uci.length() < 4) return {-1, -1, PieceType::None};
    int fromSq = uciToSquare(uci.substr(0, 2));
    int toSq = uciToSquare(uci.substr(2, 2));
    PieceType promo = PieceType::None;
    if (uci.length() >= 5) {
        switch (std::tolower(uci[4])) {
            case 'q': promo = PieceType::Queen; break;
            case 'r': promo = PieceType::Rook; break;
            case 'b': promo = PieceType::Bishop; break;
            case 'n': promo = PieceType::Knight; break;
            default: break;
        }
    }
    return {(int8_t)fromSq, (int8_t)toSq, promo};
}

std::vector<Move> ChessPosition::generateLegalTactical() {
    std::vector<Move> pseudo = generatePseudoMoves(sideToMove);
    std::vector<Move> out;
    for (const auto& m : pseudo) {
        const Piece& mover = board[m.fromSq];
        bool isCapture = !board[m.toSq].isEmpty() ||
                         (mover.type == PieceType::Pawn && m.toSq == epSquare);
        if (!isCapture && m.promo == PieceType::None) continue;
        UndoState undo;
        Color us = sideToMove;
        makeMove(m, undo);
        if (!isInCheck(us)) out.push_back(m);
        undoMove(m, undo);
    }
    return out;
}

std::string ChessPosition::positionKey() const {
    std::string f = toFEN();
    // Drop the last two fields (halfmove clock, fullmove number)
    size_t sp = f.rfind(' ');
    if (sp != std::string::npos) sp = f.rfind(' ', sp - 1);
    return sp == std::string::npos ? f : f.substr(0, sp);
}

bool ChessPosition::isInsufficientMaterial() const {
    int minors = 0;
    for (int i = 0; i < 64; ++i) {
        PieceType t = board[i].type;
        if (t == PieceType::None || t == PieceType::King) continue;
        if (t == PieceType::Knight || t == PieceType::Bishop) { minors++; continue; }
        return false; // pawn, rook or queen on board
    }
    return minors <= 1;
}

namespace {
struct ZobristKeys {
    uint64_t piece[2][7][64];
    uint64_t black;
    uint64_t castling[16];
    uint64_t ep[64];
    ZobristKeys() {
        uint64_t x = 0x9E3779B97F4A7C15ULL;
        auto next = [&x]() {               // splitmix64
            x += 0x9E3779B97F4A7C15ULL;
            uint64_t z = x;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
            return z ^ (z >> 31);
        };
        for (auto& c : piece) for (auto& t : c) for (auto& sq : t) sq = next();
        black = next();
        for (auto& k : castling) k = next();
        for (auto& k : ep) k = next();
    }
};
const ZobristKeys& zobrist() {
    static const ZobristKeys keys;
    return keys;
}
} // namespace

uint64_t ChessPosition::hash() const {
    const ZobristKeys& z = zobrist();
    uint64_t h = 0;
    for (int sq = 0; sq < 64; ++sq) {
        const Piece& p = board[sq];
        if (p.isEmpty()) continue;
        h ^= z.piece[p.color == Color::White ? 0 : 1][(int)p.type][sq];
    }
    if (sideToMove == Color::Black) h ^= z.black;
    h ^= z.castling[castlingRights & 15];
    if (epSquare >= 0 && epSquare < 64) h ^= z.ep[epSquare];
    return h;
}
