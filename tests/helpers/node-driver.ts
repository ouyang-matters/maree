// SqlDriver backed by Node's built-in SQLite, used by the automated tests.
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlParam, Statement } from "../../src/data/driver";
import { Repo } from "../../src/data/repo";
import { migrate } from "../../src/data/schema";

const bind = (params: SqlParam[] = []) =>
  params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p)) as (string | number | null)[];

export class NodeDriver implements SqlDriver {
  readonly name = "node:sqlite";
  readonly db: DatabaseSync;
  snapshots: string[] = [];

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async select<T>(sql: string, params?: SqlParam[]): Promise<T[]> {
    return this.db.prepare(sql).all(...bind(params)) as T[];
  }

  async execute(sql: string, params?: SqlParam[]) {
    const r = this.db.prepare(sql).run(...bind(params));
    return { changes: Number(r.changes) };
  }

  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      for (const s of statements) this.db.prepare(s.sql).run(...bind(s.params));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async snapshot(label: string) {
    this.snapshots.push(label);
    return label;
  }

  close() {
    this.db.close();
  }
}

export async function freshRepo(path?: string) {
  const driver = new NodeDriver(path);
  await migrate(driver);
  return { driver, repo: new Repo(driver) };
}
