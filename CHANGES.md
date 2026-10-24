# OmegaChess v4.2 — a bot that starts as a beginner and learns from every game

## New in v4.2: stat points per game follow a schedule

| Games played | Points per game |
|---|---|
| 1-50 | **4.0** (faster early learning) |
| 100 | 2.5 |
| 200 | 1.75 |
| 500 | 1.3 |
| 1000 | 1.15 |
| any number | always more than 1 |

Rule: 4 points while the bot has played fewer than 50 games, then `1 + 3 x 50 / games`.
The points shrink as the bot gets experienced, but never reach zero, and **no stat has a maximum**,
so the stats keep growing for as long as it plays. The Skill Stats panel shows how many points the next
game is worth; `learning_history.csv` has a `points_total` column.


## How to run

| What | Double-click | Same as |
|---|---|---|
| Play in the browser (server + page) | `start.bat` | `engine_server.exe` + open `index.html` |
| Move-generation self test | `engine_server\test.bat` | `engine_server.exe --perft` |
| Automated training (close the server first) | `engine_server\train.bat` | `engine_server.exe --train 30 --opp club` |
| Proof: brand-new beginner vs learned bot | `engine_server\match.bat` | `engine_server.exe --match 48 --a beginner` |
| Measure the sparring bots' Elo | — | `engine_server.exe --ladder 24` |
| Make the bot a beginner again | `engine_server\reset.bat` | `engine_server.exe --reset` |

The first run compiles the engine (`build.bat`, g++ from MSYS2 at `C:\msys64\ucrt64\bin`).
`start.bat` rebuilds automatically when `engine_server\BUILD_4.2.stamp` is missing.
Old learning files (v1/v2) are backed up as `learning_data_backup_vN.json` and the bot starts fresh.

Output files (in `engine_server\data\`):
- `learning_data.json` — Elo, W/L/D and the 13 skill levels (saved after every game)
- `learning_history.csv` — one row per game: result, Elo, ACPL, accuracy, mistakes, points per stat, levels
- `match_results.csv` — one row per match game

## Saving and loading the bot's stats (JSON)

**Export Stats** / **Import Stats** buttons are under *OmegaBot Skill Stats* (Play tab), next to
*Wipe Bot Memory* (Train tab) and in the *Brain Learning Log*.
- Export asks the C++ engine for its current stats and downloads
  `omegabot_stats_elo<Elo>_g<games>_<date>.json`: skill levels, Elo, W/L/D, the games played in this
  browser (with PGNs) and `historyCsv` (every game the engine has learned from, `GET /history`).
- Import sends the file to the C++ engine (`POST /import`), which saves it to `learning_data.json`
  straight away, so it survives restarts. `learning_data.json` itself can also be imported.
- Earlier, import only changed the page's copy and the engine overwrote it a few seconds later. Fixed.
- The engine console now starts minimised (`>_ Console` button, bottom right). It used to cover the
  export/import buttons.

## The skill model

13 stats. Every stat starts at **level 1** and has **no maximum**.

| Stat | What it measures in a position |
|---|---|
| Development | Knights/bishops off their home squares, castled king, no early queen |
| Center control | Pawns and minor pieces on the 16 central squares |
| Piece placement | Piece-square tables (good squares for each piece) |
| Mobility | Number of moves available (White minus Black) |
| King safety | Pawn shield, open files next to the king, attacked squares around it |
| Pawn structure | Doubled and isolated pawns |
| Passed pawns | Passed pawns, bigger bonus the further they are and in the endgame |
| Bishop pair | Having both bishops |
| Rook activity | Rooks on open / half-open files and on the 7th rank |
| Knight outposts | Knights on protected squares in enemy territory that pawns can't attack |
| Threat awareness | Own pieces attacked and undefended (hanging) |
| King attack | Own pieces close to the enemy king |
| **Calculation** | Search depth = 1 ply + 1 per 5 levels; capture search from level 2 (+1 ply per level, max 10) |

- **Knowledge weight = 2L / (L + 10)**: level 1 → 0.18, 5 → 0.67, **10 → 1.00 (full knowledge)**,
  20 → 1.33, 50 → 1.67, never above 2. Levels never stop growing, but each extra level helps a bit less,
  so no single stat can ever outweigh the value of the pieces.
- **Calculation has no cap either.** Each move has a **2-second time limit**: the bot searches 1, 2, 3 …
  plies and plays the best move of the deepest search it finished in time.
- A small random wobble is added to the bot's move choice while its average level is below 10
  (40 cp at level 0, 0 at level 10). It makes the beginner play like a human beginner and makes games vary.
- Material (piece values) is known from the start and is not a stat.

## How it learns (after EVERY game: win, loss or draw)

1. **Coach review.** The coach is the same engine at full knowledge searching 3 plies + captures. For every
   move of the game it finds the best move and how many centipawns the played move lost, and labels it
   brilliant / best / excellent / inaccuracy / mistake / blunder / missed win.
2. **Where did it lack?** For each of the bot's own mistakes (loss of at least 20 cp) it compares the
   position after the coach's move with the position after the bot's move, feature by feature. A feature
   that was better after the coach's move explains part of the loss (e.g. the bot's move left a piece
   hanging -> Threat awareness). Whatever the features cannot explain is a tactic the bot did not see
   -> Calculation.
3. **Stat points** (4 per game for the first 50 games, then fewer, never below 1; see the table above),
   shared out in proportion to `need(stat) x 10 / (10 + level)`: stats that
   cost it the most grow fastest and weak stats catch up. No stat has a maximum. A game with nothing to
   fix gives practice points, mostly to the weakest stats.
4. **Elo:** standard formula `R <- R + 32 (S - E)`, starting at 400. Opponent rating: the sparring bot's
   measured Elo in Auto-Train, or **Your rating** (Play tab, remembered) in games against you.

## Sparring bots (Auto-Train opponents)

The old sparring bots were a 1-ply browser bot that blundered on purpose, labelled 400–2400 Elo, so
their labels had nothing to do with their strength. Now every sparring bot is **the C++ engine at a fixed
skill level** (same 2-second time limit), and its Elo was **measured** in bot-vs-bot matches between
neighbouring levels, chained up from Beginner = 400 (`--ladder`, logs in `experiments/ladder/`):

| Sparring bot | Level | Search | Measured Elo |
|---|---|---|---|
| Beginner | 1 | 1-ply, captures 0 | 400 |
| Novice | 3 | 1-ply, captures 2 | 1010 |
| Club | 5 | 2-ply, captures 4 | 1600 |
| Expert | 10 | 3-ply, captures 9 | 1940 |
| Master | 15 | 4-ply, captures 10 | 2110 |
| Grandmaster | 20 | 5-ply, captures 10 | 2200 |

These are **bot-vs-bot ratings** on the same scale as OmegaBot's own Elo. Engines play much more
consistently than people, so the gaps are wider than between humans; they are not chess.com/FIDE ratings.
If the C++ engine is offline, Auto-Train falls back to the simple browser bot and says so in the log.

## Other polish in v4.1
- Auto-Train moves are animated and slower by default: Slow 1.2 s, **Normal 0.6 s (default)**, Fast 0.15 s,
  Instant (no animation). Board animation is slower (380 ms) and the bot waits 0.45 s before replying to you.
- Search: transposition table, killer moves and history heuristic. Same moves as before, 3–4× faster
  (depth 5 in about 0.7–2 s instead of 2–3 s), plus the per-move time limit.
- Skill bars run from 0 to 50 (they stretch further if a stat ever passes 50), the full-knowledge mark
  (level 10) sits at one fifth, and each bar's tooltip shows the level and the weight it gives.
- Console button has a text label (it used an online icon that was blank offline).

## Earlier fixes still included
- v4.0: coach review drives learning; game review overlay shows real accuracy/ACPL; Elo and ACPL chart;
  offline browser engine fixed (it produced NaN scores).
- v3.2: the server read only the board part of the FEN and thought White was always to move, so the engine
  never chose Black's moves in browser games; capture search; perft self-test; one request at a time;
  Auto-Train uses the C++ learner; `stockfish.js` and misleading labels removed.

## Measured learning result

Full details and logs: `experiments/README.md`.

A brand-new beginner trained 30 games against the Club bot (1600):

| Games | Result vs Club | Avg ACPL | Search depth after |
|---|---|---|---|
| 1-10 | 3 W / 1 D / 6 L | 20.3 | 3-ply |
| 11-20 | 6 W / 3 D / 1 L | 8.9 | 5-ply |
| 21-30 | 9 W / 1 D / 0 L | 17.0 | aims for 7, reaches 5-6 in 2 s |

After training: learned bot vs a brand-new beginner **24/24**; learned bot vs the Club bot **15/16**.
