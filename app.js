// Analyze: the page logic. chess.js knows the rules, pgn.js reads games,
// engine.js runs Stockfish, review.js grades the moves and board.js draws;
// this file loads games, runs the review and keeps the screen up to date.
import * as Chess from './chess.js';
import { readGame, writePGN } from './pgn.js';
import { Engine, whiteScore } from './engine.js';
import { winChance, scoreText, grade, overall, KINDS, ORDER } from './review.js';
import { Board, pieceEl, pieceSVG, redrawPieces } from './board.js';
import { PIECE_STYLES, setPieceStyle, pieceStyle } from './pieces.js';
import { SAMPLES } from './samples.js';

const $ = (id) => document.getElementById(id);
const TITLE = document.title;

/** Read a setting saved by Analyze, or else the one saved by Chess (same site, same browser). */
function saved(key) {
  try { return localStorage.getItem(`analyze-${key}`) ?? localStorage.getItem(`chess-${key}`); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(`analyze-${key}`, value); } catch {}
}

// The piece style comes first: the boards below draw with it.
setPieceStyle(saved('pieces'));

// ── Colors (as in Chess) ─────────────────────────────────────────────────────
const THEMES = {
  Carnival: { pieceW: '#ffd23f', pieceB: '#ff4f79', light: '#e4dcff', dark: '#7a5cf0', frame: '#2a1f5c', glow: '#3bceac' },
  Classic: { pieceW: '#fffaf0', pieceB: '#3b2a1e', light: '#f0d9b5', dark: '#b58863', frame: '#5b3a1e', glow: '#f6e05e' },
  Ocean: { pieceW: '#ffffff', pieceB: '#ff6b6b', light: '#d7f0f7', dark: '#3a86c8', frame: '#0b3954', glow: '#ffd166' },
  Meadow: { pieceW: '#fdfdf5', pieceB: '#2f2a26', light: '#eeeed2', dark: '#769656', frame: '#33502a', glow: '#ffb703' },
  Candy: { pieceW: '#fffbe6', pieceB: '#5a189a', light: '#ffe3ef', dark: '#ff8fb8', frame: '#b5179e', glow: '#72efdd' },
  Midnight: { pieceW: '#edf2f4', pieceB: '#ef233c', light: '#8d99ae', dark: '#2b2d42', frame: '#14152b', glow: '#ffd60a' },
};
const CSS_VAR = { pieceW: '--piece-w', pieceB: '--piece-b', light: '--sq-light', dark: '--sq-dark', frame: '--frame', glow: '--glow' };

function loadColors() {
  try {
    const value = JSON.parse(saved('colors'));
    if (value && Object.keys(CSS_VAR).every((k) => /^#[0-9a-f]{6}$/i.test(value[k]))) return value;
  } catch {}
  return { ...THEMES.Carnival };
}

/** An outline that shows up against a piece's own color: dark on light, light on dark. */
function outline(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const bright = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.42;
  const mix = (v) => Math.round(bright ? v * 0.32 : v + (255 - v) * 0.72);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

function themeVars(theme, style) {
  for (const [key, name] of Object.entries(CSS_VAR)) style.setProperty(name, theme[key]);
  style.setProperty('--piece-w-line', outline(theme.pieceW));
  style.setProperty('--piece-b-line', outline(theme.pieceB));
}

let colors = loadColors();

function applyColors(store = false) {
  themeVars(colors, document.documentElement.style);
  for (const input of document.querySelectorAll('[data-color]')) input.value = colors[input.dataset.color];
  for (const button of $('theme-list').children) {
    const theme = THEMES[button.dataset.theme];
    button.setAttribute('aria-pressed', String(Object.keys(CSS_VAR).every((k) => theme[k] === colors[k])));
  }
  if (store) save('colors', JSON.stringify(colors));
}

for (const [name, theme] of Object.entries(THEMES)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme';
  button.dataset.theme = name;
  themeVars(theme, button.style);
  const swatch = document.createElement('span');
  swatch.className = 'theme-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  swatch.append(document.createElement('i'), document.createElement('i'));
  button.append(swatch, name);
  button.addEventListener('click', () => { colors = { ...theme }; applyColors(true); });
  $('theme-list').append(button);
}
for (const input of document.querySelectorAll('[data-color]')) {
  input.addEventListener('input', () => { colors[input.dataset.color] = input.value; applyColors(true); });
}
applyColors();

for (const style of PIECE_STYLES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'piece-style';
  button.dataset.style = style.id;
  const sample = document.createElement('span');
  sample.className = 'style-sample';
  sample.setAttribute('aria-hidden', 'true');
  for (const piece of ['N', 'q']) {
    const el = document.createElement('span');
    el.className = `pc ${piece === 'N' ? 'w' : 'b'}`;
    el.innerHTML = pieceSVG(piece.toLowerCase(), style.id);
    sample.append(el);
  }
  button.append(sample, style.name);
  button.addEventListener('click', () => {
    setPieceStyle(style.id);
    save('pieces', style.id);
    showPieceStyle();
    redrawPieces();
  });
  $('style-list').append(button);
}
function showPieceStyle() {
  for (const button of $('style-list').children) button.setAttribute('aria-pressed', String(button.dataset.style === pieceStyle()));
}
showPieceStyle();

// ── Review settings ──────────────────────────────────────────────────────────
// How hard the engine looks at each position of the game. Whichever position is
// on the board also gets a deeper look of its own, and that one counts too.
const DEPTHS = [
  { id: 'quick', name: 'Quick', depth: 12, movetime: 1200, help: 'Depth 12: a review in seconds. Fine for spotting blunders.' },
  { id: 'standard', name: 'Standard', depth: 16, movetime: 3000, help: 'Depth 16: about a minute for a typical game.' },
  { id: 'deep', name: 'Deep', depth: 20, movetime: 8000, help: 'Depth 20: several minutes, for the subtlest mistakes.' },
];
let depthPick = DEPTHS.find((d) => d.id === saved('depth')) ?? DEPTHS[1];
for (const d of DEPTHS) {
  const label = document.createElement('label');
  const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'depth', value: d.id, checked: d === depthPick });
  input.addEventListener('change', () => {
    depthPick = d;
    save('depth', d.id);
    $('depth-help').textContent = d.help;
    if (game) startSweep();
  });
  label.append(input, Object.assign(document.createElement('span'), { textContent: d.name }));
  $('depth-pick').append(label);
}
$('depth-help').textContent = depthPick.help;

const options = { arrows: saved('arrows') !== 'off', badges: saved('badges') !== 'off' };
for (const key of ['arrows', 'badges']) {
  const box = $(`opt-${key}`);
  box.checked = options[key];
  box.addEventListener('change', () => {
    options[key] = box.checked;
    save(key, box.checked ? 'on' : 'off');
    render();
  });
}

// ── Toast ────────────────────────────────────────────────────────────────────
const toastEl = $('toast');
const nativePopover = 'showPopover' in toastEl;
if (!nativePopover) toastEl.removeAttribute('popover');
let toastTimer = 0;
function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  if (nativePopover) {
    if (toastEl.matches(':popover-open')) toastEl.hidePopover();
    toastEl.showPopover();
  } else {
    toastEl.classList.add('show');
  }
  toastTimer = setTimeout(() => {
    if (nativePopover) toastEl.hidePopover();
    else toastEl.classList.remove('show');
  }, 3800);
}

// ── The start screen ─────────────────────────────────────────────────────────
// Its board plays through the Opera Game, marking the famous moves.
const preview = new Board($('preview'));
{
  const demo = readGame(SAMPLES[0].pgn).game;
  const famous = { 18: 'great', 30: 'great', 32: 'great' };
  let pos = demo.start;
  let step = 0;
  preview.sync(pos.board, { instant: true });
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  setInterval(() => {
    if ($('start').hidden || document.hidden || calm.matches) return;
    if (step < demo.moves.length) {
      const { move } = demo.moves[step];
      pos = Chess.apply(pos, move);
      preview.sync(pos.board, { move });
      preview.setHints({ last: [move.from, move.to] });
      const tone = famous[step];
      preview.setBadge(tone ? { sq: move.to, glyph: step === 30 ? '!!' : step === 32 ? '#' : '!', tone } : null);
    } else if (step > demo.moves.length + 2) {
      pos = demo.start;
      step = -1;
      preview.sync(pos.board);
      preview.setHints();
      preview.setBadge(null);
    }
    step++;
  }, 1300);
}

for (const sample of SAMPLES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sample';
  button.append(
    Object.assign(document.createElement('strong'), { textContent: sample.name }),
    Object.assign(document.createElement('small'), { textContent: sample.blurb }),
    Object.assign(document.createElement('span'), { className: 'go', textContent: '→', ariaHidden: 'true' }),
  );
  button.addEventListener('click', () => load(sample.pgn));
  $('samples').append(button);
}

function setStartState({ busy = '', error = '' } = {}) {
  $('loading').hidden = !busy;
  $('loading-text').textContent = busy;
  $('load-btn').disabled = Boolean(busy);
  $('load-error').hidden = !error;
  $('load-error').textContent = error;
}

$('load-form').addEventListener('submit', (event) => {
  event.preventDefault();
  load($('game-text').value);
});
$('game-text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('load-form').requestSubmit();
});
$('game-file').addEventListener('change', async () => {
  const file = $('game-file').files[0];
  $('game-file').value = '';
  if (!file) return;
  if (file.size > 5e6) return setStartState({ error: 'That file is too big to be a chess game.' });
  const text = await file.text();
  $('game-text').value = text;
  load(text);
});

// Lichess shares games publicly and lets other sites fetch them.
const LICHESS = /lichess\.org\/(?:embed\/|game\/export\/)?(?:game\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(white|black))?/;

async function load(text, { ply = null, orient: wanted = null, fromUrl = false, explorer = null } = {}) {
  text = String(text ?? '').trim();
  // Nothing to load: the starting position, to build a game on (Explorer mode).
  if (!text || explorer) return openExplorer(text, { ply, orient: wanted, id: explorer });
  if (/chess\.com\//i.test(text) && text.length < 300) {
    return setStartState({ error: 'Chess.com doesn’t let other sites fetch its games. On Chess.com, choose Share, then PGN, and paste that here.' });
  }
  const lichess = text.length < 300 && LICHESS.exec(text);
  if (lichess) {
    setStartState({ busy: 'Fetching the game from Lichess…' });
    try {
      const response = await fetch(`https://lichess.org/game/export/${lichess[1]}?evals=false&clocks=false&literate=false`, { headers: { Accept: 'application/x-chess-pgn' } });
      if (!response.ok) throw new Error(response.status === 404 ? 'Lichess has no game at that link.' : 'Lichess didn’t answer. Try again in a moment.');
      text = await response.text();
      wanted ??= lichess[2] === 'black' ? 'b' : null;
    } catch (error) {
      return setStartState({ error: error.message.startsWith('Lichess') ? error.message : 'Couldn’t reach Lichess. Check your connection, or paste the game’s PGN instead.' });
    }
  }
  setStartState();
  const { game: read, error } = readGame(text);
  if (!read || (error && !read.moves.length)) {
    if (fromUrl) $('game-text').value = text;
    return setStartState({ error });
  }
  if (error) toast(`${error} Showing the game up to there.`);
  else if (read.count > 1) toast(`That file has ${read.count} games. Showing the first.`);
  openReview(read, { ply, orient: wanted });
}

/**
 * Explorer mode: a game built move by move on the board, for both sides, with
 * every move graded as it's played. `text` holds any moves so far (from a link
 * or a recent game), and `id` keeps one session's entry in Recent games.
 */
function openExplorer(text, { ply = null, orient: wanted = null, id = null } = {}) {
  setStartState();
  let read = text ? readGame(text).game : null;
  if (!read) {
    const start = Chess.fromFEN(Chess.START_FEN);
    read = { headers: {}, start, startFen: Chess.START_FEN, moves: [], result: '*', count: 1 };
  }
  read.headers = { Event: 'Explorer' };
  read.explorer = typeof id === 'string' && /^x[a-z0-9]{1,16}$/.test(id) ? id : `x${Date.now().toString(36)}`;
  openReview(read, { ply: ply ?? read.moves.length, orient: wanted });
}

// ── Recently analyzed games ──────────────────────────────────────────────────
const RECENT_KEY = 'analyze-recent';
const RECENT_MAX = 12;

function hash(text) {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
  return (h >>> 0).toString(36);
}

function recentList() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.filter((g) => g && typeof g.pgn === 'string') : [];
  } catch { return []; }
}

function storeRecent(entry) {
  if (entry.explorer && entry.sub === '') return;   // no moves yet: nothing worth keeping
  const list = [entry, ...recentList().filter((g) => g.id !== entry.id)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); }
  catch { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 3))); } catch {} }
}

function showRecent() {
  const list = recentList();
  $('recent-wrap').hidden = !list.length;
  $('recent').replaceChildren(...list.map((entry) => {
    const item = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'sample';
    const when = new Date(entry.when);
    const date = Number.isFinite(when.getTime()) ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    open.append(
      Object.assign(document.createElement('strong'), { textContent: entry.title }),
      Object.assign(document.createElement('small'), { textContent: [entry.sub, date].filter(Boolean).join(' · ') }),
      Object.assign(document.createElement('span'), { className: 'go', textContent: '→', ariaHidden: 'true' }),
    );
    open.addEventListener('click', () => load(entry.pgn, { ply: entry.ply ?? null, orient: entry.orient ?? null, explorer: entry.explorer ? entry.id : null }));
    const forget = Object.assign(document.createElement('button'), { type: 'button', className: 'forget', textContent: '×' });
    forget.setAttribute('aria-label', `Forget ${entry.title}`);
    forget.addEventListener('click', () => {
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentList().filter((g) => g.id !== entry.id))); } catch {}
      showRecent();
    });
    item.append(open, forget);
    return item;
  }));
}

// Evaluations are saved compactly: [cp, mate, win, best, second cp, second mate, depth].
const packScore = (s) => (s ? [s.cp ?? null, s.mate ?? null, s.win ?? (s.draw ? 'd' : null)] : [null, null, null]);
function unpackScore(cp, mate, win) {
  if (win === 'w' || win === 'b') return { win };
  if (win === 'd') return { cp: 0, draw: true };
  if (Number.isFinite(mate)) return { mate };
  if (Number.isFinite(cp)) return { cp };
  return null;
}
const packEval = (e) => (e ? [...packScore(e.score), e.best ?? null, ...packScore(e.second).slice(0, 2), e.depth] : null);
function unpackEval(row) {
  if (!Array.isArray(row)) return null;
  const score = unpackScore(row[0], row[1], row[2]);
  if (!score) return null;
  return { score, best: typeof row[3] === 'string' ? row[3] : null, second: unpackScore(row[4], row[5], null), depth: Number(row[6]) || 0 };
}

// ── The review ───────────────────────────────────────────────────────────────
const sweeper = new Engine();     // works through every position of the game
const live = new Engine();        // thinks about the position on the board

let game = null;          // the game being reviewed (from readGame)
let gameId = '';
let positions = [];       // positions[k]: the position after k moves
let legal = [];           // legal[k]: the legal moves in positions[k]
let evals = [];           // evals[k]: { score, best, second, depth }, or null until analyzed
let grades = [];          // grades[k]: how good move k (from positions[k]) was
let ply = 0;              // which position of the game is on the board
let side = null;          // a line being explored off the game: { base, moves, positions, at }
let orient = 'w';
let sweepRun = 0;
let swept = 0;            // how many positions the sweep has done
let sweeping = false;
let liveLines = null;     // { key, lines, depth } for the position on the board
let selected = null;
let targets = new Map();
let wasSelected = false;
let cancelPromo = null;

const board = new Board($('board'), { press: onPress, release: onRelease });

function openReview(read, { ply: startPly = null, orient: wanted = null } = {}) {
  game = read;
  gameId = game.explorer ?? hash(`${game.startFen}|${game.moves.map((m) => m.uci).join(' ')}`);
  positions = [game.start];
  for (const m of game.moves) positions.push(Chess.apply(positions.at(-1), m.move));
  legal = positions.map((pos) => Chess.legalMoves(pos));
  evals = positions.map(() => null);
  grades = game.moves.map(() => null);
  // Reuse what an earlier review of this game found.
  const before = recentList().find((g) => g.id === gameId);
  if (Array.isArray(before?.evals)) before.evals.forEach((row, k) => { if (k < evals.length) evals[k] = unpackEval(row); });
  for (let k = 0; k < positions.length; k++) evals[k] = terminalEval(k) ?? evals[k];
  regradeAll();
  side = null;
  selected = null;
  liveLines = null;
  orient = wanted ?? (/^(you|me)$/i.test(game.headers.Black ?? '') ? 'b' : 'w');
  const n = Number(startPly);
  ply = Number.isInteger(n) && n >= 0 ? Math.min(n, game.moves.length) : 0;

  const names = playerNames();
  document.title = game.explorer ? `Explorer · ${TITLE}` : `${names.w} vs ${names.b} · ${TITLE}`;
  $('summary-title').textContent = game.explorer ? 'Explorer' : 'Game review';
  $('tally-w').textContent = names.w;
  $('tally-b').textContent = names.b;
  $('tally-w').title = names.w;
  $('tally-b').title = names.b;
  const h = game.headers;
  const date = h.Date && !h.Date.startsWith('?') ? h.Date.replace(/\.\?\?/g, '').replace(/\./g, '-') : '';
  const meta = [h.Event && h.Event !== '?' ? h.Event : '', date, h.Opening ?? (h.ECO && h.ECO !== '?' ? `ECO ${h.ECO}` : '')].filter(Boolean);
  $('game-meta').textContent = game.explorer ? 'Explorer mode: you make the moves for both sides.' : meta.join(' · ');
  $('game-result').textContent = resultText();

  rememberUrl();
  $('start').hidden = true;
  $('review').hidden = false;
  scrollTo(0, 0);
  board.setView(orient);
  board.sync(here().pos.board, { instant: true });
  shownMoves = '';
  render();
  startSweep();
  if (!game.explorer || game.moves.length) storeRecent(recentEntry());
}

function playerNames() {
  const name = (v, fallback) => (v && v !== '?' ? v : fallback);
  return { w: name(game.headers.White, 'White'), b: name(game.headers.Black, 'Black') };
}

function resultText() {
  const names = playerNames();
  const how = game.headers.Termination && !/^normal$/i.test(game.headers.Termination) ? ` (${game.headers.Termination.toLowerCase()})` : '';
  const end = Chess.verdict(positions.at(-1), legal.at(-1));
  const reason = end === 'checkmate' ? ' by checkmate' : end === 'stalemate' ? ' by stalemate' : end === 'material' ? ': not enough pieces left to mate' : how;
  if (game.result === '1-0') return `1-0 · ${names.w} won${reason}`;
  if (game.result === '0-1') return `0-1 · ${names.b} won${reason}`;
  if (game.result === '1/2-1/2') return `½-½ · Drawn${reason}`;
  return '';
}

function recentEntry() {
  if (game.explorer) {
    const line = sanLine(game.start, game.moves.map((m) => m.uci), 6);
    return {
      id: gameId, explorer: true, title: 'Explorer', sub: game.moves.length > 6 ? `${line} …` : line,
      when: Date.now(), pgn: writePGN(game), orient, ply, evals: evals.map(packEval),
    };
  }
  const names = playerNames();
  const sub = [`${Math.ceil(game.moves.length / 2)} moves`, game.result !== '*' ? game.result.replace('1/2-1/2', '½-½') : ''].filter(Boolean).join(', ');
  return {
    id: gameId, title: `${names.w} vs ${names.b}`, sub, when: Date.now(), pgn: writePGN(game), orient,
    evals: evals.map(packEval),
  };
}

/** The game in the address bar, so a reload or a bookmark comes back to it. */
function rememberUrl() {
  const url = shareUrl(false);
  history.replaceState(null, '', url ?? location.pathname);
}

function shareUrl(withPly = true) {
  const params = new URLSearchParams();
  if (game.explorer) {
    params.set('explore', game.explorer);
    if (game.startFen !== Chess.START_FEN) params.set('fen', game.startFen);
    if (game.moves.length) params.set('moves', game.moves.map((m) => m.san).join(' '));
    if (orient === 'b') params.set('orient', 'black');
    if (withPly && ply !== game.moves.length) params.set('ply', String(ply));
    return `${location.pathname}?${params}`;
  }
  const h = Object.fromEntries(Object.entries(game.headers).filter(([k, v]) => v && v !== '?' && ['Event', 'Site', 'Date', 'White', 'Black', 'WhiteElo', 'BlackElo', 'Opening', 'ECO', 'Termination'].includes(k)));
  params.set('pgn', writePGN({ ...game, headers: h }).replace(/\[(Event|Site|Date|Round|White|Black) "\?(?:\?\?\?\.\?\?\.\?\?)?"\]\n/g, ''));
  if (orient === 'b') params.set('orient', 'black');
  if (withPly) {
    const at = side ? side.base : ply;
    if (at) params.set('ply', String(at));
  }
  const url = `${location.pathname}?${params}`;
  return url.length > 8000 ? null : url;
}

function toStart() {
  game = null;
  sweepRun++;
  sweeper.stop();
  liveToken++;
  live.stop();
  cancelPromo?.();
  history.replaceState(null, '', location.pathname);
  document.title = TITLE;
  $('review').hidden = true;
  $('start').hidden = false;
  setStartState();
  showRecent();
}
$('another').addEventListener('click', toStart);

// ── Evaluating positions ─────────────────────────────────────────────────────

/** A finished position needs no engine: checkmate, stalemate, or too little left to mate. */
function terminalEval(k) {
  const end = Chess.verdict(positions[k], legal[k]);
  if (end === 'checkmate') return { score: { win: Chess.other(positions[k].turn) }, best: null, second: null, depth: 99 };
  if (end) return { score: { cp: 0, draw: true }, best: null, second: null, depth: 99 };
  return null;
}

/** An engine result as an evaluation of the position, with white-relative scores. */
function toEval(result, pos) {
  if (!result.lines.length) return null;
  return {
    score: whiteScore(result.lines[0].score, pos.turn),
    best: result.lines[0].pv[0] ?? result.best,
    second: result.lines[1] ? whiteScore(result.lines[1].score, pos.turn) : null,
    depth: result.depth,
  };
}

function regrade(k) {
  if (k < 0 || k >= grades.length) return;
  const before = evals[k];
  const after = evals[k + 1];
  grades[k] = before && after ? grade({
    before, after, ply: game.moves[k], mover: positions[k].turn, legal: legal[k].length, prev: game.moves[k - 1],
  }) : null;
}
function regradeAll() { for (let k = 0; k < grades.length; k++) regrade(k); }

/** A deeper look at position k came in: keep it if it beats what we had. */
function improve(k, evaluation) {
  if (!evaluation || (evals[k] && evals[k].depth >= evaluation.depth)) return false;
  evals[k] = evaluation;
  regrade(k - 1);
  regrade(k);
  return true;
}

async function startSweep() {
  const run = ++sweepRun;
  sweeper.stop();
  sweeping = true;
  swept = 0;
  render();
  try {
    await sweeper.newGame();
    const { depth, movetime } = depthPick;
    for (let k = 0; k < positions.length; k++) {
      if (run !== sweepRun) return;
      if (!evals[k] || evals[k].depth < depth) {
        const result = await sweeper.search({
          fen: game.startFen,
          moves: game.moves.slice(0, k).map((m) => m.uci),
          depth,
          movetime,
          multipv: Math.min(2, legal[k].length),
          cancelled: () => run !== sweepRun,
        });
        if (run !== sweepRun) return;
        improve(k, toEval(result, positions[k]));
      }
      swept = k + 1;
      if (k % 4 === 3 || k === positions.length - 1) storeRecent({ ...recentEntry(), when: Date.now() });
      scheduleRender();
    }
  } catch (error) {
    if (run === sweepRun) toast(`${error.message} Try reloading the page.`);
  } finally {
    if (run === sweepRun) {
      sweeping = false;
      scheduleRender();
    }
  }
}

// The live engine: the position on the board, deeper and with three lines.
let liveToken = 0;
let liveTimer = 0;
const LIVE_DEPTH = 22;

function analyseHere() {
  clearTimeout(liveTimer);
  const token = ++liveToken;
  live.stop();
  const { pos, moves, k } = here();
  const key = `${game.startFen}|${moves.join(' ')}`;
  if (liveLines?.key !== key) liveLines = { key, lines: [], depth: 0 };
  const moveCount = (k === null ? Chess.legalMoves(pos) : legal[k]).length;
  if (!moveCount || document.hidden) return;
  liveTimer = setTimeout(() => {
    live.search({
      fen: game.startFen,
      moves,
      depth: LIVE_DEPTH,
      multipv: Math.min(3, moveCount),
      cancelled: () => token !== liveToken,
      onUpdate: (lines, depth) => {
        if (token !== liveToken) return;
        liveLines = { key, lines, depth };
        if (k !== null && lines.length >= Math.min(2, moveCount)) improve(k, toEval({ lines, depth }, pos));
        scheduleRender();
      },
    }).catch((error) => { if (token === liveToken) toast(error.message); });
  }, 140);
}
document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) { liveToken++; live.stop(); } else analyseHere();
});

// ── Where we are ─────────────────────────────────────────────────────────────

/**
 * The position on the board: { pos, moves (UCI from the start), k (its index in
 * the game, or null off it), last (the move that led here, or null), lastSan }.
 */
function here() {
  if (side) {
    const moves = [...game.moves.slice(0, side.base).map((m) => m.uci), ...side.moves.slice(0, side.at).map((m) => m.uci)];
    const last = side.at ? side.moves[side.at - 1] : game.moves[side.base - 1] ?? null;
    return { pos: side.positions[side.at], moves, k: side.at ? null : side.base, last: last?.move ?? null, lastPly: last };
  }
  const last = game.moves[ply - 1] ?? null;
  return { pos: positions[ply], moves: game.moves.slice(0, ply).map((m) => m.uci), k: ply, last: last?.move ?? null, lastPly: last };
}

const moveNumber = (pos) => `${pos.full}${pos.turn === 'w' ? '.' : '…'}`;
const findUci = (pos, uci, list = Chess.legalMoves(pos)) => list.find((m) => Chess.uciOf(m) === uci) ?? null;

/** Engine moves (UCI) as numbered SAN, as far as `max` moves. */
function sanLine(pos, ucis, max = 12) {
  const words = [];
  let p = pos;
  for (const uci of ucis.slice(0, max)) {
    const list = Chess.legalMoves(p);
    const move = findUci(p, uci, list);
    if (!move) break;
    if (p.turn === 'w' || !words.length) words.push(p.turn === 'w' ? `${p.full}.` : `${p.full}…`);
    words.push(Chess.sanOf(p, move, list));
    p = Chess.apply(p, move);
  }
  return words.join(' ');
}

function sanFor(pos, uci) {
  const list = Chess.legalMoves(pos);
  const move = findUci(pos, uci, list);
  return move ? Chess.sanOf(pos, move, list) : uci;
}

// ── Moving around ────────────────────────────────────────────────────────────

/** Show game position k (leaving any side line). */
function goTo(k) {
  k = Math.max(0, Math.min(game.moves.length, k));
  const from = here();
  const stepping = !side && k === ply + 1 ? game.moves[ply].move : !side && k === ply - 1 ? reverse(game.moves[k].move) : null;
  side = null;
  ply = k;
  show(from, stepping);
}

const reverse = (m) => ({ from: m.to, to: m.from });

function show(from, move = null) {
  cancelPromo?.();
  selected = null;
  board.sync(here().pos.board, move ? { move } : {});
  render();
  const row = $('movelist').querySelector('[aria-current="true"]');
  if (row) {
    const list = $('movelist');
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight / 2;
  }
}

function step(delta) {
  if (side) {
    const at = side.at + delta;
    if (at < 0 || at > side.moves.length) return;
    const from = here();
    const move = delta > 0 ? side.moves[side.at].move : reverse(side.moves[at].move);
    if (at === 0) { ply = side.base; side = null; }
    else side.at = at;
    return show(from, move);
  }
  goTo(ply + delta);
}

/** Play a move on the board: follow the game if it's the move played, or explore. */
function playHere(move, extra = []) {
  const from = here();
  const { pos } = from;
  const list = Chess.legalMoves(pos);
  const entry = { move, san: Chess.sanOf(pos, move, list), uci: Chess.uciOf(move) };
  if (!side && game.moves[ply]?.uci === entry.uci && (!extra.length || game.explorer)) return goTo(ply + 1);
  if (game.explorer && !side) return extendGame(entry, from);
  if (side && side.moves[side.at]?.uci === entry.uci && !extra.length) { side.at++; return show(from, move); }
  if (!side) side = { base: ply, moves: [], positions: [pos], at: 0 };
  side.moves.length = side.at;
  side.positions.length = side.at + 1;
  for (const m of [entry, ...extra]) {
    side.moves.push(m);
    side.positions.push(Chess.apply(side.positions.at(-1), m.move));
  }
  side.at++;
  show(from, move);
}

/**
 * Explorer mode: the move becomes part of the game. Played anywhere but the end,
 * it starts a new line from there, replacing the moves that came after.
 */
function extendGame(entry, from) {
  const dropped = game.moves.length - ply;
  game.moves.length = ply;
  positions.length = ply + 1;
  legal.length = ply + 1;
  evals.length = ply + 1;
  grades.length = ply;
  game.moves.push(entry);
  positions.push(Chess.apply(positions[ply], entry.move));
  legal.push(Chess.legalMoves(positions.at(-1)));
  evals.push(terminalEval(ply + 1));
  grades.push(null);
  regrade(ply);
  ply++;
  const end = Chess.verdict(positions.at(-1), legal.at(-1));
  game.result = end === 'checkmate' ? (positions.at(-1).turn === 'w' ? '0-1' : '1-0') : end ? '1/2-1/2' : '*';
  $('game-result').textContent = resultText();
  if (dropped) toast(dropped === 1 ? 'Replaced the move that came next.' : `A new line from here: replaced the ${dropped} moves that came next.`);
  show(from, entry.move);
  rememberUrl();
  storeRecent(recentEntry());
  startSweep();
}

/** Play out one of the engine's lines from here, stopping after its first move. */
function playLine(ucis) {
  const { pos } = here();
  const entries = [];
  let p = pos;
  for (const uci of ucis.slice(0, 16)) {
    const list = Chess.legalMoves(p);
    const move = findUci(p, uci, list);
    if (!move) break;
    entries.push({ move, san: Chess.sanOf(p, move, list), uci });
    p = Chess.apply(p, move);
  }
  if (!entries.length) return;
  // The engine agrees with the game: just step forward.
  if (!side && game.moves[ply]?.uci === entries[0].uci) return goTo(ply + 1);
  playHere(entries[0].move, entries.slice(1));
}

$('nav-first').addEventListener('click', () => goTo(0));
$('nav-prev').addEventListener('click', () => step(-1));
$('nav-next').addEventListener('click', () => step(1));
$('nav-last').addEventListener('click', () => (side ? (side.at = side.moves.length, show(null)) : goTo(game.moves.length)));
$('nav-flip').addEventListener('click', flip);
$('explore-back').addEventListener('click', () => { const base = side.base; side = null; goTo(base); });

function flip() {
  orient = Chess.other(orient);
  board.setView(orient);
  render();
  rememberUrl();
}

document.addEventListener('keydown', (event) => {
  if (!game || $('review').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('input, textarea, select, dialog') || document.querySelector('dialog[open]')) return;
  const keys = {
    ArrowLeft: () => step(-1), ArrowRight: () => step(1), Home: () => goTo(0),
    End: () => $('nav-last').click(), f: flip, F: flip,
  };
  if (!keys[event.key]) return;
  event.preventDefault();
  keys[event.key]();
});

// ── Moving pieces on the board ───────────────────────────────────────────────
function movesHere() {
  const { pos, k } = here();
  return k !== null ? legal[k] : Chess.legalMoves(pos);
}

function onPress(sq) {
  if (cancelPromo) return false;
  if (selected !== null && targets.has(sq)) {
    tryMove(selected, sq);
    return false;
  }
  if (movesHere().some((m) => m.from === sq)) {
    wasSelected = selected === sq;
    selected = sq;
    renderBoard();
    return true;
  }
  selected = null;
  renderBoard();
  return false;
}

function onRelease(sq, dragged) {
  if (cancelPromo || selected === null) return false;
  if (dragged) return sq !== null && targets.has(sq) && tryMove(selected, sq);
  if (wasSelected) {
    selected = null;
    renderBoard();
  }
  return false;
}

function tryMove(from, to) {
  const options = movesHere().filter((m) => m.from === from && m.to === to);
  if (!options.length) return false;
  if (options.length === 1) {
    playHere(options[0]);
    return true;
  }
  const { pos } = here();
  askPromotion(pos.turn).then((type) => {
    const move = type && options.find((m) => m.promo === type);
    if (move) playHere(move);
    else renderBoard();
  });
  return false;
}

function askPromotion(color) {
  return new Promise((resolve) => {
    const done = (type) => {
      cancelPromo = null;
      $('promo').hidden = true;
      resolve(type);
    };
    cancelPromo = () => done(null);
    $('promo-row').replaceChildren(...[...'qrbn'].map((type) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type]);
      button.append(pieceEl(color === 'w' ? type.toUpperCase() : type));
      button.addEventListener('click', () => done(type));
      return button;
    }));
    $('promo').hidden = false;
    $('promo-row').firstChild.focus();
  });
}
$('promo-cancel').addEventListener('click', () => cancelPromo?.());
$('promo').addEventListener('keydown', (event) => { if (event.key === 'Escape') cancelPromo?.(); });

// ── Drawing ──────────────────────────────────────────────────────────────────
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

/** The evaluation of the position on the board: the game's, or the live engine's off it. */
function evalHere() {
  const { pos, k, moves } = here();
  if (k !== null && evals[k]) return evals[k];
  const end = Chess.verdict(pos);
  if (end === 'checkmate') return { score: { win: Chess.other(pos.turn) } };
  if (end) return { score: { cp: 0, draw: true } };
  const key = `${game.startFen}|${moves.join(' ')}`;
  if (liveLines?.key === key && liveLines.lines.length) return { score: whiteScore(liveLines.lines[0].score, pos.turn), best: liveLines.lines[0].pv[0], depth: liveLines.depth };
  return null;
}

function render() {
  if (!game) return;
  const was = liveLines?.key;
  const { moves } = here();
  if (was !== `${game.startFen}|${moves.join(' ')}`) analyseHere();
  renderBoard();
  renderEvalBar();
  renderSeats();
  renderNow();
  renderLines();
  renderGraph();
  renderTally();
  renderMoves();
  const end = side ? side.at === side.moves.length : ply === game.moves.length;
  $('nav-next').disabled = end;
  $('nav-last').disabled = end;
  $('nav-prev').disabled = !side && ply === 0;
  $('nav-first').disabled = !side && ply === 0;
}

function renderBoard() {
  const { pos, last } = here();
  const list = movesHere();
  if (!list.some((m) => m.from === selected)) selected = null;
  targets = new Map(list.filter((m) => m.from === selected).map((m) => [m.to, Boolean(m.capture)]));
  board.setHints({
    movable: new Set(cancelPromo ? [] : list.map((m) => m.from)),
    selected,
    targets,
    last: last && [last.from, last.to],
    check: Chess.inCheck(pos) ? Chess.kingSquare(pos.board, pos.turn) : null,
  });

  // The badge: how good the move just played was.
  const g = !side && ply > 0 ? grades[ply - 1] : null;
  board.setBadge(options.badges && g && last ? { sq: last.to, glyph: KINDS[g.kind].glyph, tone: KINDS[g.kind].tone } : null);

  // The arrow: after a mistake, what should have been played instead;
  // otherwise, the engine's choice for the move to play now.
  const arrows = [];
  if (options.arrows && selected === null) {
    const bad = g && ['inaccuracy', 'mistake', 'blunder'].includes(g.kind) && evals[ply - 1]?.best;
    if (bad) {
      const better = findUci(positions[ply - 1], evals[ply - 1].best, legal[ply - 1]);
      if (better) arrows.push({ from: better.from, to: better.to, tone: 'best' });
    } else {
      const e = evalHere();
      const best = e?.best && findUci(pos, e.best, list);
      if (best) arrows.push({ from: best.from, to: best.to, tone: 'best' });
    }
  }
  board.setArrows(arrows);
}

function renderEvalBar() {
  const e = evalHere();
  const bar = $('evalbar');
  const chance = e ? winChance(e.score) : 50;
  bar.classList.toggle('flip', orient === 'b');
  $('evalbar-fill').style.setProperty('--white', `${chance}%`);
  bar.setAttribute('aria-valuenow', String(Math.round(chance)));
  const text = e ? scoreText(e.score) : '';
  const el = $('evalbar-text');
  el.textContent = text.replace(/^\+/, '').replace('½-½', '½');
  // The number sits at the end of the bar of the side that's ahead.
  const whiteAhead = chance >= 50;
  const atBottom = whiteAhead === (orient === 'w');
  el.className = `evalbar-text ${atBottom ? 'low' : 'high'}`;
  el.style.color = whiteAhead ? '#2c2541' : '#f7f4ff';
  bar.setAttribute('aria-valuetext', e ? `${text}, white ${Math.round(chance)}%` : 'Not analyzed yet');
}

function renderSeats() {
  const { pos } = here();
  const names = playerNames();
  const taken = Chess.captures(pos.board);
  for (const [id, color] of [['seat-bottom', orient], ['seat-top', Chess.other(orient)]]) {
    const seat = $(id);
    const chip = pieceEl(color === 'w' ? 'K' : 'k');
    chip.classList.add('chip');
    seat.querySelector('.seat-piece').replaceChildren(chip);
    seat.querySelector('.seat-name').textContent = names[color];
    const elo = game.headers[color === 'w' ? 'WhiteElo' : 'BlackElo'];
    seat.querySelector('.seat-elo').textContent = elo && elo !== '?' && elo !== '-' ? elo : '';
    const lead = color === 'w' ? taken.lead : -taken.lead;
    const box = seat.querySelector('.taken');
    box.replaceChildren(...taken[color].map((p) => pieceEl(p)));
    if (lead > 0) box.append(Object.assign(document.createElement('span'), { className: 'lead', textContent: `+${lead}` }));
    seat.classList.toggle('turn', pos.turn === color && Chess.legalMoves(pos).length > 0);
  }
}

const pct = (n) => `${Math.round(n)}%`;
const colorName = (c) => (c === 'w' ? 'White' : 'Black');
const san = (text) => Object.assign(document.createElement('span'), { className: 'san', textContent: text });

function renderNow() {
  const card = $('now');
  const title = $('now-title');
  const text = $('now-text');
  const e = evalHere();
  $('now-score').textContent = e ? scoreText(e.score) : '…';
  $('explore').hidden = !side;
  let tone = '';
  let badge = '';
  const { pos, lastPly } = here();

  if (side) {
    const b = side.base;
    $('explore-text').textContent = b ? `Off the game, after ${moveNumber(positions[b - 1])} ${game.moves[b - 1].san}` : 'Off the game, from the start';
    if (!side.at) {
      title.textContent = 'Your own line';
      text.textContent = 'Move a piece to try an idea.';
    } else {
      const p = side.positions[side.at - 1];
      title.replaceChildren(`${moveNumber(p)} ${lastPly.san}`);
      text.textContent = side.at === side.moves.length && side.at === 1 ? 'Not the move played in the game. The engine follows your line.' : 'A line of your own. The engine follows along.';
    }
  } else if (ply === 0 && game.explorer) {
    title.textContent = 'Explorer mode';
    text.textContent = game.moves.length
      ? 'Step forward through your line, or play a different move here to start a new one.'
      : 'Make the moves for both sides, say an opening you’re studying. Stockfish grades each one as you go. Step back and play something else to try another line.';
  } else if (ply === 0) {
    title.textContent = game.startFen === Chess.START_FEN ? 'Starting position' : 'Starting position (from FEN)';
    text.textContent = game.moves.length ? 'Step through the moves with the arrows or the → key, or tap any move or point on the graph.' : 'No moves to step through: the engine panel shows the best ideas here. Move a piece to explore.';
  } else {
    const k = ply - 1;
    const before = positions[k];
    const g = grades[k];
    const m = game.moves[k];
    const mover = before.turn;
    const head = [`${moveNumber(before)} ${m.san}`];
    if (!g) {
      title.replaceChildren(...head);
      text.textContent = 'Analyzing…';
    } else {
      const kind = KINDS[g.kind];
      tone = kind.tone;
      badge = kind.glyph || '✓';
      title.replaceChildren(...head, Object.assign(document.createElement('span'), { className: 'tone-text', textContent: kind.name.toLowerCase() === 'good' ? 'Good move' : kind.name }));
      const was = mover === 'w' ? winChance(evals[k].score) : 100 - winChance(evals[k].score);
      const now = mover === 'w' ? winChance(evals[ply].score) : 100 - winChance(evals[ply].score);
      const bestSan = evals[k].best ? sanFor(before, evals[k].best) : '';
      const parts = [];
      if (g.note) parts.push(`${g.note} `);
      switch (g.kind) {
        case 'forced': parts.push('The only legal move.'); break;
        case 'great': parts.push('The only good move here: anything else would have given away much of ', `${colorName(mover)}’s chances.`); break;
        case 'best': parts.push(m.uci === evals[k].best ? 'The engine’s first choice.' : 'As good as the engine’s first choice.'); break;
        case 'excellent': parts.push('Nearly as good as the best move, ', san(bestSan), '.'); break;
        case 'good': parts.push('A reasonable move, though ', san(bestSan), ' was better.'); break;
        default: {
          parts.push(`${colorName(mover)}’s winning chances drop from ${pct(was)} to ${pct(now)}. Best was `, san(bestSan), ` (${scoreText(evals[k].score)}), shown by the green arrow.`);
        }
      }
      if (!['inaccuracy', 'mistake', 'blunder'].includes(g.kind) && Chess.legalMoves(pos).length) {
        parts.push(` ${colorName(pos.turn)} to move: ${colorName(pos.turn)}’s chances are ${pct(pos.turn === 'w' ? winChance(evals[ply].score) : 100 - winChance(evals[ply].score))}.`);
      }
      text.replaceChildren(...parts);
    }
  }
  card.dataset.tone = tone;
  $('now-badge').textContent = badge;
}

function renderLines() {
  const { pos, moves } = here();
  const key = `${game.startFen}|${moves.join(' ')}`;
  const list = $('lines');
  const end = Chess.verdict(pos);
  if (end) {
    $('depth').textContent = '';
    const words = { checkmate: `Checkmate. ${colorName(Chess.other(pos.turn))} wins.`, stalemate: 'Stalemate: a draw.', material: 'Neither side can checkmate: a draw.' };
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: words[end] }));
    return;
  }
  const current = liveLines?.key === key ? liveLines : null;
  $('depth').textContent = current?.depth ? `Stockfish 19 · depth ${current.depth}` : 'Stockfish 19 · thinking…';
  if (!current?.lines.length) {
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Thinking…' }));
    return;
  }
  // Update the buttons in place: the engine reports several times a second, and
  // a button replaced between press and release would swallow the click.
  const buttons = [...list.querySelectorAll('li > button')];
  if (buttons.length !== current.lines.length) {
    list.replaceChildren(...current.lines.map(() => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => { if (button.pv) playLine(button.pv); });
      item.append(button);
      return item;
    }));
  }
  [...list.querySelectorAll('li > button')].forEach((button, k) => {
    const line = current.lines[k];
    const score = whiteScore(line.score, pos.turn);
    const chip = Object.assign(document.createElement('span'), { className: `score ${winChance(score) >= 50 ? 'w' : 'b'}`, textContent: scoreText(score) });
    const text = sanLine(pos, line.pv, 10);
    const [firstNo, firstSan, ...rest] = text.split(' ');
    const pv = Object.assign(document.createElement('span'), { className: 'pv' });
    pv.append(`${firstNo} `, san(firstSan ?? ''), rest.length ? ` ${rest.join(' ')}` : '');
    button.pv = line.pv;
    button.replaceChildren(chip, pv);
    button.setAttribute('aria-label', `${scoreText(score)}: ${text}. Play it out.`);
  });
}

// The graph: white's winning chances over the game, filled from the bottom.
const graph = $('graph');
const dots = document.createElement('div');
dots.className = 'graph-dots';
graph.after(dots);
graph.parentElement.style.position = 'relative';

function renderGraph() {
  const n = game.moves.length;
  const NS = 'http://www.w3.org/2000/svg';
  const x = (k) => (n ? (k / n) * 400 : 200);
  const y = (k) => 100 - winChance(evals[k].score);
  let path = `M0 100`;
  let lastDone = -1;
  for (let k = 0; k <= n; k++) {
    if (!evals[k]) break;
    path += ` L${x(k).toFixed(2)} ${y(k).toFixed(2)}`;
    lastDone = k;
  }
  if (lastDone >= 0) path += ` L${x(lastDone).toFixed(2)} 100 Z`;
  const make = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const cursorX = x(side ? side.base : ply);
  const shapes = [
    make('rect', { class: 'bg', x: 0, y: 0, width: 400, height: 100 }),
    make('path', { class: 'area', d: lastDone >= 0 ? path : 'M0 0' }),
  ];
  if (lastDone < n) shapes.push(make('rect', { class: 'pending', x: x(Math.max(0, lastDone)), y: 0, width: 400 - x(Math.max(0, lastDone)), height: 100 }));
  shapes.push(make('line', { class: 'mid', x1: 0, x2: 400, y1: 50, y2: 50 }));
  shapes.push(make('line', { class: 'cursor', x1: cursorX, x2: cursorX, y1: 0, y2: 100 }));
  graph.replaceChildren(...shapes);
  graph.setAttribute('aria-label', `Evaluation graph. ${lastDone < n ? `Analyzed ${lastDone + 1} of ${n + 1} positions.` : ''}`);

  // Mistakes as dots (in HTML, so they stay round however the graph is stretched).
  const marks = [];
  grades.forEach((g, k) => {
    if (!g || !['inaccuracy', 'mistake', 'blunder', 'great'].includes(g.kind)) return;
    const dot = document.createElement('i');
    dot.dataset.tone = KINDS[g.kind].tone;
    dot.style.left = `${(x(k + 1) / 400) * 100}%`;
    dot.style.top = `${y(k + 1)}%`;
    marks.push(dot);
  });
  dots.replaceChildren(...marks);
}

function graphPick(event) {
  const box = graph.getBoundingClientRect();
  const k = Math.round(((event.clientX - box.left) / box.width) * game.moves.length);
  if (side || k !== ply) goTo(k);
}
graph.addEventListener('pointerdown', (event) => {
  graph.setPointerCapture(event.pointerId);
  graphPick(event);
});
graph.addEventListener('pointermove', (event) => { if (graph.hasPointerCapture(event.pointerId)) graphPick(event); });

function renderTally() {
  const done = !sweeping;
  $('summary').classList.toggle('done', done);
  const total = positions.length;
  const count = Math.min(swept, total);
  $('progress-bar').style.setProperty('--done', `${(count / total) * 100}%`);

  const rows = [];
  const by = { w: [], b: [] };
  grades.forEach((g, k) => { if (g) by[positions[k].turn].push({ ...g, k }); });
  const acc = document.createElement('tr');
  acc.className = 'acc';
  acc.append(Object.assign(document.createElement('th'), { scope: 'row', textContent: 'Accuracy' }));
  for (const c of ['w', 'b']) {
    const value = overall(by[c].filter((g) => g.kind !== 'forced').map((g) => g.accuracy));
    acc.append(Object.assign(document.createElement('td'), { textContent: value === null ? '–' : done ? Math.round(value) : '…' }));
  }
  rows.push(acc);
  // Folded, the panel's heading still gives the gist: progress, then each side's accuracy.
  const accuracy = ['w', 'b'].map((c) => overall(by[c].filter((g) => g.kind !== 'forced').map((g) => g.accuracy)));
  const line = $('progress-text');
  if (!done) line.textContent = `Analyzing… ${Math.round((count / total) * 100)}%`;
  else if (accuracy.every((a) => a === null)) line.textContent = '';
  else {
    line.replaceChildren('Accuracy ', ...['w', 'b'].flatMap((c, n) => [
      n ? ' · ' : '',
      Object.assign(document.createElement('b'), { className: `acc-chip ${c}`, textContent: accuracy[n] === null ? '–' : Math.round(accuracy[n]), title: `${playerNames()[c]}’s accuracy` }),
    ]));
  }
  for (const kind of ORDER) {
    if (kind === 'forced') continue;
    const info = KINDS[kind];
    const row = document.createElement('tr');
    row.className = 'kind';
    row.dataset.tone = info.tone;
    const th = Object.assign(document.createElement('th'), { scope: 'row' });
    th.append(Object.assign(document.createElement('span'), { className: 'glyph', textContent: info.glyph || '✓' }), info.name);
    row.append(th);
    for (const c of ['w', 'b']) {
      const list = by[c].filter((g) => g.kind === kind);
      const td = document.createElement('td');
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: String(list.length), disabled: !list.length });
      button.setAttribute('aria-label', `${list.length} ${info.name.toLowerCase()}${list.length === 1 ? '' : 's'} by ${colorName(c)}${list.length ? ': go to the next one' : ''}`);
      button.addEventListener('click', () => {
        const next = list.find((g) => g.k + 1 > (side ? side.base : ply)) ?? list[0];
        goTo(next.k + 1);
      });
      td.append(button);
      row.append(td);
    }
    rows.push(row);
  }
  const loss = document.createElement('tr');
  loss.className = 'acpl';
  loss.append(Object.assign(document.createElement('th'), { scope: 'row', textContent: 'Average loss', title: 'Average centipawn loss: how much each move gave away, in hundredths of a pawn' }));
  for (const c of ['w', 'b']) {
    const list = by[c];
    loss.append(Object.assign(document.createElement('td'), { textContent: list.length ? Math.round(list.reduce((a, g) => a + g.cpLoss, 0) / list.length) : '–' }));
  }
  rows.push(loss);
  $('tally-body').replaceChildren(...rows);
}

let shownMoves = '';
function renderMoves() {
  const key = `${gameId}|${game.moves.map((m) => m.san).join(' ')}|${grades.map((g) => g?.kind ?? '').join(',')}`;
  const list = $('movelist');
  if (key !== shownMoves) {
    shownMoves = key;
    const items = [];
    let first = game.start.turn === 'b';
    game.moves.forEach((m, k) => {
      const pos = positions[k];
      if (pos.turn === 'w' || first) {
        items.push(Object.assign(document.createElement('li'), { className: 'no', textContent: `${pos.full}.` }));
        if (first) items.push(Object.assign(document.createElement('li'), { className: 'filler', textContent: '…' }));
        first = false;
      }
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.ply = String(k + 1);
      const g = grades[k];
      button.append(m.san);
      if (g && KINDS[g.kind].glyph && !['best', 'forced'].includes(g.kind)) {
        button.dataset.tone = KINDS[g.kind].tone;
        button.append(Object.assign(document.createElement('span'), { className: 'g', textContent: KINDS[g.kind].glyph }));
      }
      button.setAttribute('aria-label', `${moveNumber(pos)} ${m.san}${g ? `, ${KINDS[g.kind].name}` : ''}`);
      button.addEventListener('click', () => goTo(k + 1));
      item.append(button);
      items.push(item);
    });
    list.replaceChildren(...items);
  }
  const current = side ? side.base : ply;
  for (const button of list.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(Number(button.dataset.ply) === current && !side));
  }
}

// The review panel starts folded; opening it is remembered.
$('summary').open = saved('review-open') === 'on';
$('summary').addEventListener('toggle', () => save('review-open', $('summary').open ? 'on' : 'off'));

// ── Copying ──────────────────────────────────────────────────────────────────
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    let text = '';
    if (button.dataset.copy === 'pgn') text = writePGN(game);
    else if (button.dataset.copy === 'fen') text = Chess.toFEN(here().pos);
    else {
      const url = shareUrl();
      if (!url) return toast('This game is too long for a link. Copy the PGN instead.');
      text = new URL(url, location.href).href;
    }
    let ok = true;
    try { await navigator.clipboard.writeText(text); } catch { ok = false; }
    const tip = button.nextElementSibling;
    tip.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { tip.textContent = ''; }, 1800);
  });
}

// ── Dialogs ──────────────────────────────────────────────────────────────────
for (const dialog of document.querySelectorAll('dialog')) {
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => dialog.close());
}
if (!('closedBy' in HTMLDialogElement.prototype)) {
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    dialog.addEventListener('click', (e) => {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  }
}
if (!('CommandEvent' in window)) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[command="show-modal"]');
    if (button) document.getElementById(button.getAttribute('commandfor'))?.showModal();
  });
}

// ── Appearance: Light (the default), Dark or System, saved in this browser. The choice is written
// to <meta name="color-scheme">, which the stylesheet follows. ──
{
  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  for (const input of document.querySelectorAll('input[name="scheme"]')) {
    input.checked = input.value === schemeMeta.content;
    input.addEventListener('change', () => {
      schemeMeta.content = input.value;
      // Saved even when it's System: with nothing saved, the app starts in Light.
      try { localStorage.setItem('analyze-scheme', input.value); } catch {}
    });
  }
}

// ── Boot: a game in the address? ─────────────────────────────────────────────
{
  const params = new URLSearchParams(location.search);
  const pgn = params.get('pgn');
  const fen = params.get('fen');
  const moves = params.get('moves');
  const orientParam = (params.get('orient') ?? params.get('color') ?? '').toLowerCase();
  const wanted = ['b', 'black'].includes(orientParam) ? 'b' : ['w', 'white'].includes(orientParam) ? 'w' : null;
  const text = pgn ?? (fen ? `${fen}\n${moves ?? ''}` : moves);
  showRecent();
  if (params.has('explore')) {
    load(text ?? '', { ply: params.get('ply'), orient: wanted, explorer: params.get('explore') || true });
  } else if (text) {
    $('game-text').value = text;
    load(text, { ply: params.get('ply'), orient: wanted, fromUrl: true });
  }
}
