# Experiments (engine v4.1, 23-24 Oct 2026)

Note: these runs used v4.1's fixed **3 points per game**. v4.2 gives 4 points per game for the first
50 games (then fewer), so a new bot learns a little faster at the start than shown here.

All games are bot vs bot with the C++ engine, 2 seconds per move, over 24 built-in opening lines with
colours alternated. Everything here can be re-run with the commands shown.

## 1. How strong are the sparring bots? (`engine_server --ladder 24`)

Neighbouring skill levels played each other and the Elo differences were chained up from level 1 = 400.
Small steps at the bottom, because each early level is a big jump (capture search switches on, then 2-ply).

| Match (higher level as B) | Games | B: W / D / L | B score | Elo step | Elo of higher level |
|---|---|---|---|---|---|
| level 1 vs level 2 | 24 | 21 / 2 / 1 | 91.7% | +417 | 817 |
| level 2 vs level 3 | 24 | 15 / 6 / 3 | 75.0% | +191 | 1007 |
| level 3 vs level 4 | 24 | 18 / 3 / 3 | 81.2% | +255 | 1262 |
| level 4 vs level 5 | 24 | 20 / 2 / 2 | 87.5% | +338 | 1600 |
| level 5 vs level 10 | 24 | 18 / 6 / 0 | 87.5% | +338 | 1938 |
| level 10 vs level 15 | 24 | 12 / 11 / 1 | 72.9% | +172 | 2110 |
| level 15 vs level 20 | 8 | 3 / 4 / 1 | 62.5% | +89 | 2199 |

(The level 15 vs 20 match was stopped after 8 of 16 games to save time, so the Grandmaster figure is the
roughest. Logs: `ladder/`.)

| Sparring bot | Level | Search | Measured Elo |
|---|---|---|---|
| Beginner | 1 | 1-ply, captures 0 | 400 |
| Novice | 3 | 1-ply, captures 2 | 1010 |
| Club | 5 | 2-ply, captures 4 | 1600 |
| Expert | 10 | 3-ply, captures 9 | 1940 |
| Master | 15 | 4-ply, captures 10 | 2110 |
| Grandmaster | 20 | 5-ply, captures 10 | 2200 |

These are **bot-vs-bot** ratings, the same scale as OmegaBot's own Elo. Engines are far more consistent
than people, so the gaps are wider than between humans; they are not chess.com/FIDE ratings.

## 2. From beginner to beating the Club bot (`--reset`, `--train 30 --opp club`)

A brand-new bot (every stat level 1: 1-ply search, no capture search, almost no positional knowledge)
played 30 games against the Club bot (level 5, 1600). After every game the coach reviewed each move and
the bot earned 3 stat points where it lacked. Files: `train.log`, `learning_history.csv`,
`learned_after_30_games.json`.

| Games | W / D / L vs Club | Avg ACPL | Avg accuracy | Blunders per game | Search depth after | Elo after |
|---|---|---|---|---|---|---|
| 1-10 | 3 / 1 / 6 | 20.3 | 93.6% | 0.5 | 3-ply | 512 |
| 11-20 | 6 / 3 / 1 | 8.9 | 97.1% | 0.0 | 5-ply | 751 |
| 21-30 | 9 / 1 / 0 | 17.0 | 94.6% | 0.3 | 7-ply | 1049 |

ACPL = average centipawns lost per move, measured by the coach. Elo is recomputed with Club = 1600 (the
run itself used the placeholder 800 that was in the table before the ladder was measured).
Search depth: 2-ply after game 3, 3-ply after game 6, 4-ply after game 12, 5-ply after game 17. First win:
game 7.

### Skill levels

| Stat | Start | After 10 | After 20 | After 30 |
|---|---|---|---|---|
| Development | 1.0 | 2.4 | 4.1 | 5.2 |
| Center control | 1.0 | 2.6 | 3.8 | 6.5 |
| Piece placement | 1.0 | 6.2 | 9.2 | 12.4 |
| Mobility | 1.0 | 3.7 | 7.7 | 10.3 |
| King safety | 1.0 | 3.1 | 5.7 | 7.4 |
| Pawn structure | 1.0 | 1.7 | 1.9 | 2.6 |
| Passed pawns | 1.0 | 1.1 | 1.1 | 1.7 |
| Bishop pair | 1.0 | 1.1 | 3.3 | 4.9 |
| Rook activity | 1.0 | 1.9 | 3.3 | 4.1 |
| Knight outposts | 1.0 | 1.4 | 1.4 | 2.1 |
| Threat awareness | 1.0 | 2.8 | 5.8 | 9.6 |
| King attack | 1.0 | 1.2 | 2.0 | 2.4 |
| Calculation | 1.0 | 13.8 | 23.7 | 33.7 |

### Matches after training (`--match 24 --a beginner`, `--match 16 --a club`)

| Match | Score | W / D / L |
|---|---|---|
| Learned bot vs a brand-new beginner | 24 / 24 (100%) | 24 / 0 / 0 |
| Learned bot vs the Club bot (1600) | 15 / 16 (93.8%) | 15 / 0 / 1 |

## How to read this honestly
- The bot improves fast because it starts genuinely weak and the review tells it which knowledge it lacks.
  The coach is the engine at full knowledge, so this is **learning from post-game analysis** (like a
  player studying an engine review), not discovering chess from nothing.
- Most points go to **Calculation** (34 after 30 games): most of the bot's mistakes are tactics. With no
  level cap the bot keeps aiming deeper (7-ply at level 34), but each move has 2 seconds, so in practice it
  finishes 5-6 plies (measured on 4 positions); the badge shows both ("Lvl 7 · reached 5").
- ACPL is measured by a 3-ply coach. Once the bot searches deeper than the coach, the coach's "best move" is
  sometimes worse than the bot's, so ACPL stops falling (games 21-30) even though results keep improving.
- Elo here is the internal bot-vs-bot scale described above.
