// The rules of chess, plus reading and writing the usual notations (FEN for a
// position, SAN for a move). No drawing, no engine.
//
// A square is a number 0–63 counted from a8 (0) along each rank to h1 (63).
// A piece is a letter: uppercase for white (PNBRQK), lowercase for black.
// A position is { board, turn, castle, ep, half, full }; positions are never
// changed in place, so a game can keep them all around safely.
const FILES = 'abcdefgh';
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL = [...DIAG, ...ORTH];
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const squareName = (sq) => FILES[sq & 7] + (8 - (sq >> 3));
export const squareOf = (name) => FILES.indexOf(name[0]) + (8 - Number(name[1])) * 8;
export const colorOf = (piece) => (piece === piece.toUpperCase() ? 'w' : 'b');
export const other = (color) => (color === 'w' ? 'b' : 'w');
const onBoard = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;

export const kingSquare = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');

/** Is this square attacked by any piece of color `by`? */
export function attacked(board, sq, by) {
  const r = sq >> 3;
  const f = sq & 7;
  const at = (rr, ff) => (onBoard(rr, ff) ? board[rr * 8 + ff] : undefined);
  const is = (piece, type) => piece === (by === 'w' ? type.toUpperCase() : type);
  const pawnRow = by === 'w' ? r + 1 : r - 1;      // pawns capture towards the other side
  if (is(at(pawnRow, f - 1), 'p') || is(at(pawnRow, f + 1), 'p')) return true;
  for (const [dr, df] of KNIGHT) if (is(at(r + dr, f + df), 'n')) return true;
  for (const [dr, df] of ALL) if (is(at(r + dr, f + df), 'k')) return true;
  for (const [dirs, type] of [[DIAG, 'b'], [ORTH, 'r']]) {
    for (const [dr, df] of dirs) {
      for (let rr = r + dr, ff = f + df; ; rr += dr, ff += df) {
        const piece = at(rr, ff);
        if (piece === undefined) break;
        if (piece === null) continue;
        if (is(piece, type) || is(piece, 'q')) return true;
        break;
      }
    }
  }
  return false;
}

/** Every move the pieces can make, ignoring whether it leaves the king in check. */
function candidateMoves(pos) {
  const { board, turn } = pos;
  const moves = [];
  const mine = (piece) => piece && colorOf(piece) === turn;
  const add = (from, to, extra) => moves.push({ from, to, piece: board[from], capture: board[to], ...extra });

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!mine(piece)) continue;
    const r = from >> 3;
    const f = from & 7;
    const type = piece.toLowerCase();

    if (type === 'p') {
      const d = turn === 'w' ? -1 : 1;
      const home = turn === 'w' ? 6 : 1;
      const last = turn === 'w' ? 0 : 7;
      const advance = (to) => {
        if (to >> 3 === last) for (const promo of 'qrbn') add(from, to, { promo });
        else add(from, to);
      };
      const one = from + d * 8;
      if (onBoard(r + d, f) && !board[one]) {
        advance(one);
        if (r === home && !board[one + d * 8]) add(from, one + d * 8, { double: true });
      }
      for (const df of [-1, 1]) {
        if (!onBoard(r + d, f + df)) continue;
        const to = one + df;
        if (board[to] && !mine(board[to])) advance(to);
        else if (to === pos.ep) add(from, to, { ep: true, capture: turn === 'w' ? 'p' : 'P' });
      }
      continue;
    }

    if (type === 'n' || type === 'k') {
      for (const [dr, df] of type === 'n' ? KNIGHT : ALL) {
        const to = (r + dr) * 8 + f + df;
        if (onBoard(r + dr, f + df) && !mine(board[to])) add(from, to);
      }
    } else {
      for (const [dr, df] of type === 'b' ? DIAG : type === 'r' ? ORTH : ALL) {
        for (let rr = r + dr, ff = f + df; onBoard(rr, ff); rr += dr, ff += df) {
          const to = rr * 8 + ff;
          if (mine(board[to])) break;
          add(from, to);
          if (board[to]) break;
        }
      }
    }

    // Castling: king and rook unmoved, nothing between them, and the king
    // neither in check nor passing through or landing on an attacked square.
    const base = turn === 'w' ? 56 : 0;
    if (type === 'k' && from === base + 4) {
      const them = other(turn);
      const rook = turn === 'w' ? 'R' : 'r';
      const safe = (...squares) => squares.every((sq) => !attacked(board, sq, them));
      const empty = (...squares) => squares.every((sq) => !board[sq]);
      if (pos.castle.includes(turn === 'w' ? 'K' : 'k') && board[base + 7] === rook
        && empty(base + 5, base + 6) && safe(base + 4, base + 5, base + 6)) add(from, base + 6, { castle: 'K' });
      if (pos.castle.includes(turn === 'w' ? 'Q' : 'q') && board[base] === rook
        && empty(base + 1, base + 2, base + 3) && safe(base + 4, base + 3, base + 2)) add(from, base + 2, { castle: 'Q' });
    }
  }
  return moves;
}

/** The position after a move. */
export function apply(pos, move) {
  const board = pos.board.slice();
  const { turn } = pos;
  board[move.from] = null;
  board[move.to] = move.promo ? (turn === 'w' ? move.promo.toUpperCase() : move.promo) : move.piece;
  if (move.ep) board[move.to + (turn === 'w' ? 8 : -8)] = null;
  if (move.castle) {
    const base = move.from - 4;
    const [rookFrom, rookTo] = move.castle === 'K' ? [base + 7, base + 5] : [base, base + 3];
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  // A king or rook leaving home, or a rook captured at home, ends that castling right.
  const LOSES = { 60: 'KQ', 63: 'K', 56: 'Q', 4: 'kq', 7: 'k', 0: 'q' };
  const gone = (LOSES[move.from] ?? '') + (LOSES[move.to] ?? '');
  return {
    board,
    turn: other(turn),
    castle: [...pos.castle].filter((c) => !gone.includes(c)).join(''),
    ep: move.double ? (move.from + move.to) / 2 : -1,
    half: move.capture || move.piece.toLowerCase() === 'p' ? 0 : pos.half + 1,
    full: pos.full + (turn === 'b' ? 1 : 0),
  };
}

export function legalMoves(pos) {
  return candidateMoves(pos).filter((move) => {
    const next = apply(pos, move);
    return !attacked(next.board, kingSquare(next.board, pos.turn), next.turn);
  });
}

export const inCheck = (pos) => attacked(pos.board, kingSquare(pos.board, pos.turn), other(pos.turn));

/** Neither side has enough left to ever give checkmate. */
export function deadPosition(board) {
  const rest = [];
  board.forEach((piece, sq) => { if (piece && piece.toLowerCase() !== 'k') rest.push([piece.toLowerCase(), ((sq >> 3) + sq) & 1]); });
  if (!rest.length) return true;
  if (rest.length === 1) return rest[0][0] === 'b' || rest[0][0] === 'n';
  return rest.every(([type, shade]) => type === 'b' && shade === rest[0][1]);
}

/** How the game stands with no engine: 'checkmate', 'stalemate', 'material' or null. */
export function verdict(pos, legal = legalMoves(pos)) {
  if (!legal.length) return inCheck(pos) ? 'checkmate' : 'stalemate';
  if (deadPosition(pos.board)) return 'material';
  return null;
}

// ── FEN ──────────────────────────────────────────────────────────────────────

/** Read a FEN string. Returns the position, or null if it isn't a sensible one. */
export function fromFEN(text) {
  const parts = String(text).trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 6) return null;
  const [layout, turn, castle = '-', ep = '-', half = '0', full = '1'] = parts;
  const ranks = layout.split('/');
  if (ranks.length !== 8) return null;
  const board = [];
  for (const rank of ranks) {
    let n = 0;
    for (const c of rank) {
      if (/[1-8]/.test(c)) { for (let k = 0; k < Number(c); k++) board.push(null); n += Number(c); }
      else if (/[pnbrqkPNBRQK]/.test(c)) { board.push(c); n++; }
      else return null;
    }
    if (n !== 8) return null;
  }
  if (!['w', 'b'].includes(turn)) return null;
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) return null;
  // Pawns can't stand on the first or last rank.
  if (board.some((p, sq) => p && p.toLowerCase() === 'p' && (sq < 8 || sq >= 56))) return null;
  if (castle !== '-' && !/^K?Q?k?q?$/.test(castle)) return null;
  // Keep only the castling rights the pieces still allow.
  const can = { K: board[60] === 'K' && board[63] === 'R', Q: board[60] === 'K' && board[56] === 'R', k: board[4] === 'k' && board[7] === 'r', q: board[4] === 'k' && board[0] === 'r' };
  const rights = castle === '-' ? '' : [...castle].filter((c) => can[c]).join('');
  let epSq = -1;
  if (ep !== '-') {
    if (!/^[a-h][36]$/.test(ep)) return null;
    epSq = squareOf(ep);
  }
  const pos = { board, turn, castle: rights, ep: epSq, half: Math.max(0, parseInt(half, 10) || 0), full: Math.max(1, parseInt(full, 10) || 1) };
  // The side that just moved can't still be in check.
  if (attacked(board, kingSquare(board, other(turn)), turn)) return null;
  return pos;
}

export function toFEN(pos) {
  let layout = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[r * 8 + f];
      if (!piece) { empty++; continue; }
      if (empty) layout += empty;
      empty = 0;
      layout += piece;
    }
    if (empty) layout += empty;
    if (r < 7) layout += '/';
  }
  return `${layout} ${pos.turn} ${pos.castle || '-'} ${pos.ep >= 0 ? squareName(pos.ep) : '-'} ${pos.half} ${pos.full}`;
}

// ── Moves in notation ────────────────────────────────────────────────────────

export const uciOf = (m) => squareName(m.from) + squareName(m.to) + (m.promo ?? '');

/** A move in standard algebraic notation (SAN), with + or # when it checks. */
export function sanOf(pos, move, legal = legalMoves(pos)) {
  let san;
  if (move.castle) san = move.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const type = move.piece.toLowerCase();
    const dest = squareName(move.to);
    if (type === 'p') {
      san = (move.capture ? `${FILES[move.from & 7]}x` : '') + dest + (move.promo ? `=${move.promo.toUpperCase()}` : '');
    } else {
      // Say which piece, when two of a kind could reach the same square.
      const rivals = legal.filter((m) => m.piece === move.piece && m.to === move.to && m.from !== move.from);
      let which = '';
      if (rivals.length) {
        if (!rivals.some((m) => (m.from & 7) === (move.from & 7))) which = FILES[move.from & 7];
        else if (!rivals.some((m) => m.from >> 3 === move.from >> 3)) which = String(8 - (move.from >> 3));
        else which = squareName(move.from);
      }
      san = type.toUpperCase() + which + (move.capture ? 'x' : '') + dest;
    }
  }
  const next = apply(pos, move);
  if (inCheck(next)) san += legalMoves(next).length ? '+' : '#';
  return san;
}

/**
 * Find the legal move a piece of text means. It understands SAN as people
 * write it (Nf3, exd5, O-O, e8=Q, Ngf3 even when "g" isn't needed, 0-0, with
 * or without +, #, !, ?), long algebraic (Ng1-f3, e2xe4) and UCI (e2e4, e7e8q).
 */
export function parseMove(pos, text, legal = legalMoves(pos)) {
  let t = String(text).trim().replace(/[+#!?]+$/g, '').replace(/[+#]/g, '').replace(/\s*e\.?p\.?$/i, '');
  if (!t) return null;
  if (/^[0O]-[0O](-[0O])?$/i.test(t)) {
    const side = t.length > 3 ? 'Q' : 'K';
    return legal.find((m) => m.castle === side) ?? null;
  }
  // Coordinates: e2e4, e2-e4, e7e8q, Ng1-f3, Pe2xe4.
  const coords = /^([PNBRQK])?([a-h][1-8])[-x:]?([a-h][1-8])=?([nbrqNBRQ])?$/.exec(t);
  if (coords) {
    const from = squareOf(coords[2]);
    const to = squareOf(coords[3]);
    const promo = coords[4]?.toLowerCase() ?? null;
    const found = legal.find((m) => m.from === from && m.to === to && (m.promo ?? null) === promo);
    if (found) return found;
    if (!promo) {
      const queen = legal.find((m) => m.from === from && m.to === to && m.promo === 'q');
      if (queen) return queen;
    }
  }
  const san = /^([NBRQK])?([a-h])?([1-8])?[x:]?([a-h][1-8])(?:=?([nbrqNBRQ]))?$/.exec(t);
  if (!san) return null;
  const [, letter, file, rank, dest, promo] = san;
  // A lowercase "b" could be a bishop written carelessly (bxc6) as well as a pawn on the b-file.
  const type = (letter ?? 'P').toLowerCase();
  const to = squareOf(dest);
  const matches = legal.filter((m) => m.piece.toLowerCase() === type && m.to === to
    && (!file || FILES[m.from & 7] === file)
    && (!rank || String(8 - (m.from >> 3)) === rank)
    && (m.promo ?? null) === (type === 'p' && (to < 8 || to >= 56) ? (promo?.toLowerCase() ?? 'q') : null));
  if (matches.length === 1) return matches[0];
  if (!letter && file === 'b' && !matches.length) {
    const bishop = legal.filter((m) => m.piece.toLowerCase() === 'b' && m.to === to);
    if (bishop.length === 1) return bishop[0];
  }
  return null;
}

/**
 * What each side has taken, and who is ahead.
 * { w: pieces white captured, b: pieces black captured, lead: points white is ahead }
 */
export function captures(board) {
  const count = {};
  let lead = 0;
  for (const piece of board) {
    if (!piece || piece.toLowerCase() === 'k') continue;
    count[piece] = (count[piece] ?? 0) + 1;
    lead += VALUE[piece.toLowerCase()] * (colorOf(piece) === 'w' ? 1 : -1);
  }
  const lost = (color) => [...'qrbnp'].flatMap((type) => {
    const piece = color === 'w' ? type.toUpperCase() : type;
    return Array(Math.max(0, START_COUNT[type] - (count[piece] ?? 0))).fill(piece);
  });
  return { w: lost('b'), b: lost('w'), lead };
}
