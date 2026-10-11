// The minimal SQL surface the repository needs. Implemented by the Tauri bridge
// (rusqlite), the browser fallback (sql.js) and the Node test driver (node:sqlite).

export type SqlParam = string | number | boolean | null;
export type Row = Record<string, unknown>;

export interface Statement {
  sql: string;
  params?: SqlParam[];
}

export interface SqlDriver {
  readonly name: string;
  select<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  /** Runs all statements in a single transaction (all-or-nothing). */
  batch(statements: Statement[]): Promise<void>;
  /** Point-in-time copy of the database; returns a description of where it went, or null if unsupported. */
  snapshot?(label: string): Promise<string | null>;
}

/**
 * Serialises writes so that read-modify-write sequences issued from different
 * UI events never interleave. Reads are not queued.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Resolves once every write queued so far has settled. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}
