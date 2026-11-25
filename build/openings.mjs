// Builds openings.json, the opening names Analyze shows, from Lichess's
// chess-openings tables (https://github.com/lichess-org/chess-openings, CC0).
// Usage: node build/openings.mjs <folder with a.tsv … e.tsv>
// Each name is keyed by the position its moves reach, so a game that gets
// there by another move order (a transposition) is still recognized.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGame } from '../pgn.js';
import { apply } from '../chess.js';
import { positionKey } from '../openings.js';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: node build/openings.mjs <folder with a.tsv … e.tsv>');
const names = {};
let count = 0;
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(join(dir, `${file}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const { game, error } = readGame(pgn);
    if (error || !game) throw new Error(`${eco} ${name}: ${error}`);
    let pos = game.start;
    for (const m of game.moves) pos = apply(pos, m.move);
    const key = positionKey(pos);
    // Where two lines reach the same position, keep the first (the more general).
    if (!names[key]) names[key] = `${eco}|${name}`;
    count++;
  }
}
writeFileSync(new URL('../openings.json', import.meta.url), `${JSON.stringify(names)}\n`);
console.log(`${count} lines, ${Object.keys(names).length} positions`);
