// Stockfish, running in a Web Worker in this browser (see vendor/stockfish).
// We talk to it in UCI, the text protocol chess engines share: tell it the
// position, ask it to think, read back what it sees.
//
// The app runs two of these: one works through the whole game, move by move,
// and the other looks deeper at whichever position is on the board.

const ENGINE = './vendor/stockfish/stockfish-19-lite-single.js';

/**
 * A score, always from white's point of view: { cp } in centipawns
 * (hundredths of a pawn), or { mate } in moves, positive when white mates.
 */
export function whiteScore(raw, turn) {
  const sign = turn === 'w' ? 1 : -1;
  return raw.mate !== undefined ? { mate: raw.mate * sign } : { cp: raw.cp * sign };
}

export class Engine {
  constructor() {
    this.worker = null;
    this.booting = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
  }

  send(command) {
    this.worker.postMessage(command);
  }

  /** Wait for an output line that passes `test`; `onLine` sees every line meanwhile. */
  until(test, { onLine, timeout = 0 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = timeout && setTimeout(() => { this.listeners.delete(listen); reject(new Error('The chess engine stopped answering.')); }, timeout);
      const listen = (line) => {
        onLine?.(line);
        if (!test(line)) return;
        clearTimeout(timer);
        this.listeners.delete(listen);
        resolve(line);
      };
      this.listeners.add(listen);
    });
  }

  /** Start the engine (once). Resolves when it is ready for commands. */
  boot() {
    if (this.booting) return this.booting;
    this.booting = (async () => {
      this.worker = new Worker(ENGINE);
      this.worker.addEventListener('message', (event) => {
        for (const listen of [...this.listeners]) listen(String(event.data));
      });
      const failed = new Promise((_, reject) => {
        this.worker.addEventListener('error', () => reject(new Error('Couldn’t start the chess engine.')), { once: true });
      });
      const ready = (async () => {
        this.send('uci');
        await this.until((line) => line === 'uciok', { timeout: 30000 });
        this.send('setoption name Hash value 32');
        this.send('isready');
        await this.until((line) => line === 'readyok', { timeout: 30000 });
      })();
      await Promise.race([ready, failed]);
    })();
    this.booting.catch(() => {
      this.worker?.terminate();
      this.worker = null;
      this.booting = null;          // let a later try start afresh
    });
    return this.booting;
  }

  /** Forget everything from the last game (its hash table). */
  async newGame() {
    await this.boot();
    const job = this.queue.then(async () => {
      this.send('ucinewgame');
      this.send('isready');
      await this.until((line) => line === 'readyok');
    });
    this.queue = job.catch(() => {});
    return job;
  }

  /** End the search in progress early; it still resolves, with what it found so far. */
  stop() {
    if (this.searching) this.send('stop');
  }

  /**
   * Think about a position, given as a FEN plus the moves since (in UCI), so the
   * engine knows the history and sees repetitions. `onUpdate(lines, depth)`
   * hears each completed depth. Resolves with { lines, depth }, where each line
   * is { score (from the side to move), pv: [uci…] }, best first. If
   * `cancelled()` is true by the time the engine is free, it doesn't start.
   */
  async search({ fen, moves = [], depth = 16, movetime = 0, multipv = 1, onUpdate, cancelled }) {
    await this.boot();
    const job = this.queue.then(async () => {
      // Asked for, then overtaken by a newer request while waiting its turn.
      if (cancelled?.()) return { lines: [], depth: 0, best: null };
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
      const lines = [];
      let done = 0;                     // the last depth at which every line came in
      let final = [];
      const onLine = (line) => {
        if (!line.startsWith('info ') || !line.includes(' pv ') || / (upper|lower)bound/.test(line)) return;
        const d = Number(/ depth (\d+)/.exec(line)?.[1]);
        const k = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1);
        const s = / score (cp|mate) (-?\d+)/.exec(line);
        if (!d || !s) return;
        const score = s[1] === 'cp' ? { cp: Number(s[2]) } : { mate: Number(s[2]) };
        lines[k - 1] = { depth: d, score, pv: line.slice(line.indexOf(' pv ') + 4).trim().split(/\s+/) };
        // Stockfish reports lines 1, 2, 3… in turn at each depth; the last one closes it.
        // (So never ask for more lines than there are legal moves.)
        if (k === multipv) {
          const complete = lines.filter((l) => l && l.depth === d);
          if (complete.length === lines.length && d > done) {
            done = d;
            final = complete.map((l) => ({ ...l }));
            onUpdate?.(final, d);
          }
        }
      };
      this.searching = true;
      this.send(`go depth ${depth}${movetime ? ` movetime ${movetime}` : ''}`);
      const end = await this.until((line) => line.startsWith('bestmove'), { onLine });
      this.searching = false;
      if (!final.length && lines.length) final = lines.filter(Boolean);    // stopped before depth 1 finished
      const best = end.split(' ')[1];
      return { lines: final, depth: done, best: best && best !== '(none)' ? best : null };
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
