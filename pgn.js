// Reading games: PGN (as Lichess, Chess.com and most chess programs export
// it), a bare list of moves, or a FEN position. And writing PGN back out.
import { START_FEN, fromFEN, toFEN, legalMoves, parseMove, sanOf, apply, uciOf, verdict } from './chess.js';

const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];

/** Split a PGN file into its games (each starts with tag pairs, or is just moves). */
export function splitGames(text) {
  const games = [];
  let current = '';
  let inMoves = false;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const tag = /^\s*\[\w+\s+".*"\s*\]\s*$/.test(line);
    if (tag && inMoves) {
      games.push(current);
      current = '';
      inMoves = false;
    }
    if (!tag && line.trim()) inMoves = true;
    current += `${line}\n`;
  }
  if (current.trim()) games.push(current);
  return games;
}

/** Tag pairs and move text (without comments, variations or numbers) of one game. */
function tokenize(text) {
  const headers = {};
  const body = String(text).replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm, (_, key, value) => {
    headers[key] = value.replace(/\\(.)/g, '$1');
    return '';
  });
  let clean = '';
  let depth = 0;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '{') { const end = body.indexOf('}', k); k = end < 0 ? body.length : end; clean += ' '; continue; }
    if (c === ';') { const end = body.indexOf('\n', k); k = end < 0 ? body.length : end; clean += ' '; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); clean += ' '; continue; }
    if (depth) continue;
    clean += c;
  }
  const tokens = clean
    .replace(/\$\d+/g, ' ')                      // NAGs: $1, $2…
    .replace(/(\d+)\s*\.+/g, ' ')                // move numbers: 12. or 12...
    .split(/[\s,]+/)
    .filter(Boolean);
  let result = headers.Result && RESULTS.includes(headers.Result) ? headers.Result : '*';
  const moves = [];
  for (const token of tokens) {
    if (RESULTS.includes(token) || token === '½-½') { result = token === '½-½' ? '1/2-1/2' : token; continue; }
    if (/^\.+$/.test(token)) continue;
    moves.push(token);
  }
  return { headers, moves, result };
}

/**
 * Read a game from whatever was pasted: PGN, a list of moves, or a FEN (alone,
 * or followed by moves). Returns { game } or { error }. A game is
 * { headers, start (position), startFen, moves: [{ move, san, uci }], result }.
 */
export function readGame(text) {
  const input = String(text ?? '').trim();
  if (!input) return { error: 'Paste a game first.' };
  const games = splitGames(input);
  const first = games[0];
  // A FEN on its own line at the top, maybe followed by moves.
  const lines = first.trim().split('\n');
  let fen = null;
  let rest = first;
  if (fromFEN(lines[0])) {
    fen = lines[0].trim();
    rest = lines.slice(1).join('\n');
  }
  const { headers, moves, result } = tokenize(rest);
  if (!fen && headers.FEN) fen = headers.FEN;
  let start = fromFEN(fen ?? START_FEN);
  if (!start) return { error: 'That starting position (FEN) isn’t a legal chess position.' };
  const game = { headers, start, startFen: toFEN(start), moves: [], result, count: games.length };
  let pos = start;
  for (const token of moves) {
    const legal = legalMoves(pos);
    const move = parseMove(pos, token, legal);
    if (!move) {
      const number = `${pos.full}${pos.turn === 'w' ? '.' : '…'}`;
      if (!game.moves.length && !fen) return { error: `That doesn’t look like a chess game: couldn’t read “${token.slice(0, 30)}” as a move.` };
      return { error: `Couldn’t read move ${number} ${token.slice(0, 30)}: it isn’t legal in that position.`, game };
    }
    game.moves.push({ move, san: sanOf(pos, move, legal), uci: uciOf(move) });
    pos = apply(pos, move);
  }
  if (game.moves.length > 1200) return { error: 'That game is too long to analyze.' };
  // Fill in a result the moves make plain.
  if (game.result === '*') {
    const end = verdict(pos);
    if (end === 'checkmate') game.result = pos.turn === 'w' ? '0-1' : '1-0';
    else if (end) game.result = '1/2-1/2';
  }
  return { game };
}

/** A game as PGN text. */
export function writePGN(game) {
  const tags = { Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', ...game.headers, Result: game.result };
  if (game.startFen !== START_FEN) Object.assign(tags, { SetUp: '1', FEN: game.startFen });
  const head = Object.entries(tags).map(([k, v]) => `[${k} "${String(v).replace(/[\\"]/g, '\\$&')}"]`).join('\n');
  const words = [];
  let { full, turn } = game.start;
  game.moves.forEach((m, k) => {
    if (turn === 'w') words.push(`${full}.`);
    else if (k === 0) words.push(`${full}...`);
    words.push(m.san);
    if (turn === 'b') full++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  words.push(game.result);
  // Wrap the move text at 80 columns, as PGN asks.
  const out = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > 80) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  out.push(line);
  return `${head}\n\n${out.join('\n')}\n`;
}
