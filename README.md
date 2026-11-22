# Analyze

Chess game analysis in the browser, at [mco.dev/analyze](https://mco.dev/analyze/). Paste a game and step through it with Stockfish: who was winning at every point, the engine's best moves, and every great move, inaccuracy, mistake and blunder, with an accuracy score for each player.

It is a static app with no build step: open `index.html` from any web server. It is made of plain HTML, CSS and JavaScript modules, and nothing leaves the browser.

## Loading a game

- **PGN**, as Lichess, Chess.com and most chess programs export it. Comments, side lines and NAGs are skipped; a `[FEN]` tag sets the starting position. A file with several games opens the first.
- **A list of moves** in SAN (`1. e4 e5 2. Nf3`), long algebraic (`Ng1-f3`) or UCI (`e2e4 e7e5`).
- **A FEN**, alone or followed by moves.
- **A Lichess game link**: the game is fetched from Lichess's public export API.
- **A PGN file**, opened from disk.
- **The address**: `?pgn=…`, `?moves=…` or `?fen=…` (with optional `&moves=…`) load a game, `?ply=N` opens it after N half-moves, and `?orient=black` turns the board. [Chess](https://mco.dev/chess/) uses this for its "Analyze this game" button.

## How it works

- **The engine** is [Stockfish](https://stockfishchess.org/) 19, the free, open-source engine, in the lite single-threaded WebAssembly build from [Stockfish.js](https://github.com/nmrugg/stockfish.js) (vendored, unmodified, in `vendor/stockfish/` with its GPL v3 license, as in Chess). `engine.js` talks to it over UCI.
- **Two engines run at once**, each in its own Web Worker. One sweeps through every position of the game in order (depth 12, 16 or 20, chosen in Settings, with its top two moves). The other thinks about whichever position is on the board, up to depth 22 with its top three lines, and restarts whenever you move. When it sees deeper than the sweep did, its evaluation replaces the sweep's and the moves on either side are graded again.
- **Grading** (`review.js`) turns each evaluation into white's winning chances, using the same curve as Lichess, and grades a move by how many points of its player's chances it gave away: 5 is an inaccuracy, 10 a mistake, 15 a blunder. A move that matches the engine is Best; a best move whose alternatives were all at least 15 points worse (and which isn't a recapture, in a game not yet decided) is Great. Accuracy per move follows Lichess's formula, and a player's accuracy is the average of the plain and harmonic means of theirs. Missed, found and allowed forced mates are called out.
- **Exploring**: move a piece, or tap one of the engine's lines, to try something else. The engine follows along, and "Back to the game" returns to what was played.
- **Saved in the browser**: the last dozen games reviewed, with their evaluations, so reopening one is instant, plus settings. Colors and piece style default to whatever was chosen in Chess.

`chess.js` (the rules, plus FEN and SAN), `board.js` and `pieces.js` come from Chess, extended here with FEN, SAN parsing, arrows and move badges.

## Install on a phone

The app is an installable web app: `manifest.webmanifest` describes it, and `sw.js` is a network-first service worker, so it is always current when online and still opens offline (Stockfish included). The icons in `icons/` are rendered from the SVG sources by `bash build/icons/render.sh` (needs Google Chrome).

This repo is mounted in [mco-gh/mco.dev](https://github.com/mco-gh/mco.dev) as a git submodule at `static/analyze`. After pushing a change here, update the submodule pointer there to publish it:

```bash
cd mco.dev
git submodule update --remote static/analyze
git commit -am "Update analyze"
git push
```
