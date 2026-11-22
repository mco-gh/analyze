// Judging the moves. The engine scores each position; here those scores become
// winning chances, and each move is graded by how much of its player's chances
// it gave away. The thresholds follow Lichess: a drop of 5 points (out of 100)
// is an inaccuracy, 10 a mistake, 15 a blunder.

/** White's winning chances, 0–100, from a white-relative score. */
export function winChance(score) {
  if (score.win) return score.win === 'w' ? 100 : 0;
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.cp)) - 1);
}

/** The same chances for one side. */
export const chanceFor = (score, color) => (color === 'w' ? winChance(score) : 100 - winChance(score));

/** A score as people write it: +1.3, −0.4, #3, #−2, or 1-0 when the game is over. */
export function scoreText(score) {
  if (score.win) return score.win === 'w' ? '1-0' : '0-1';
  if (score.draw) return '½-½';
  if (score.mate !== undefined) return score.mate > 0 ? `#${score.mate}` : `#−${-score.mate}`;
  const pawns = score.cp / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`;
}

/** Centipawns, with mates counted as a big, capped number (for average loss). */
const cpOf = (score) => {
  if (score.win) return score.win === 'w' ? 1000 : -1000;
  if (score.mate !== undefined) return score.mate > 0 ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, score.cp));
};

export const KINDS = {
  great: { name: 'Great move', glyph: '!', tone: 'great' },
  best: { name: 'Best move', glyph: '★', tone: 'best' },
  excellent: { name: 'Excellent', glyph: '', tone: 'good' },
  good: { name: 'Good', glyph: '', tone: 'ok' },
  forced: { name: 'Only move', glyph: '□', tone: 'ok' },
  inaccuracy: { name: 'Inaccuracy', glyph: '?!', tone: 'inaccuracy' },
  mistake: { name: 'Mistake', glyph: '?', tone: 'mistake' },
  blunder: { name: 'Blunder', glyph: '??', tone: 'blunder' },
};
export const ORDER = ['great', 'best', 'excellent', 'good', 'forced', 'inaccuracy', 'mistake', 'blunder'];

/**
 * Grade one move. `before` and `after` are the positions' evaluations
 * ({ score, best, second }: white-relative scores and the engine's top move),
 * `ply` the move itself ({ move, uci }), `mover` its color, `legal` how many moves
 * there were to choose from, and `prev` the move before (to spot recaptures).
 * Returns { kind, loss (chance points), accuracy (0–100), cpLoss, note }.
 */
export function grade({ before, after, ply, mover, legal, prev }) {
  const was = chanceFor(before.score, mover);
  const now = chanceFor(after.score, mover);
  const loss = Math.max(0, was - now);
  const sign = mover === 'w' ? 1 : -1;
  const cpLoss = Math.max(0, (cpOf(before.score) - cpOf(after.score)) * sign);
  // Lichess's accuracy curve: 100 for a perfect move, falling away with the chances lost.
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

  let kind;
  if (legal === 1) kind = 'forced';
  else if (ply.uci === before.best || loss < 0.5) {
    kind = 'best';
    // The one move that holds: every other choice would have cost a lot, and it
    // isn't just taking back a piece, and the game wasn't already decided.
    const recapture = prev && ply.move.capture && prev.move.capture && prev.move.to === ply.move.to;
    if (ply.uci === before.best && before.second && !recapture && was < 97 && was > 10
      && was - chanceFor(before.second, mover) >= 15) kind = 'great';
  } else if (loss < 2) kind = 'excellent';
  else if (loss < 5) kind = 'good';
  else if (loss < 10) kind = 'inaccuracy';
  else if (loss < 15) kind = 'mistake';
  else kind = 'blunder';

  // Mates found, missed and allowed say more than chances do.
  let note = '';
  const myMate = (s) => s.mate !== undefined && s.mate * sign > 0;
  const theirMate = (s) => s.mate !== undefined && s.mate * sign < 0;
  if (after.score.win) note = after.score.win === mover ? 'Checkmate!' : '';
  else if (myMate(before.score) && !myMate(after.score)) note = `Missed a forced mate in ${Math.abs(before.score.mate)}.`;
  else if (theirMate(after.score) && !theirMate(before.score)) note = loss >= 5 ? `Allows a forced mate in ${Math.abs(after.score.mate)}.` : `The game was already lost, and now there’s a forced mate in ${Math.abs(after.score.mate)}.`;
  else if (myMate(after.score) && !myMate(before.score)) note = `Finds a forced mate in ${Math.abs(after.score.mate)}.`;
  else if (myMate(after.score) && Math.abs(after.score.mate) > Math.abs(before.score.mate) - 1 && kind !== 'best' && kind !== 'great') note = `Still mating, but there was a faster mate in ${Math.abs(before.score.mate)}.`;
  return { kind, loss, accuracy, cpLoss, note };
}

/**
 * A player's accuracy over the game, 0–100: the average of the plain and the
 * harmonic means of their moves' accuracies, so a single blunder still shows.
 */
export function overall(accuracies) {
  if (!accuracies.length) return null;
  const mean = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  const harmonic = accuracies.length / accuracies.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + harmonic) / 2;
}
