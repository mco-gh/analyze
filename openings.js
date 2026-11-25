// Opening names, from Lichess's chess-openings tables (CC0), built into
// openings.json by build/openings.mjs. Fetched the first time it's needed.
import { toFEN } from './chess.js';

/** A position without the en passant square or move counters, so move orders that meet match. */
export const positionKey = (pos) => toFEN(pos).split(' ').slice(0, 3).join(' ');

let table = null;
let loading = null;

/** Load the names; resolves when they're ready (or failed, quietly). */
export function loadOpenings() {
  loading ??= fetch(new URL('./openings.json', import.meta.url))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((data) => { table = data; });
  return loading;
}

/**
 * The opening of a line: the last of its positions (an array, from the start)
 * with a name. Returns { eco, name, ply } or null (also while still loading).
 */
export function openingOf(positions) {
  if (!table) return null;
  for (let k = positions.length - 1; k > 0; k--) {
    const hit = table[positionKey(positions[k])];
    if (hit) {
      const [eco, name] = hit.split('|');
      return { eco, name, ply: k };
    }
  }
  return null;
}
