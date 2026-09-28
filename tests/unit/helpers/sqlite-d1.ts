// Hermetic stand-in for a D1 binding: an in-memory node:sqlite database with
// the real migrations applied, behind the subset of the D1 API that Drizzle's
// d1 driver and our raw `prepare().bind()` calls use. No network, no wrangler.
//
// `batch()` runs inside a transaction and rolls back on any failure, like D1.
// `failOn` lets a test make matching statements throw (outage / bad write).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type Param = string | number | bigint | null | Uint8Array;

export interface SqliteD1 {
  d1: D1Database;
  sqlite: DatabaseSync;
  /** Statements whose SQL matches make prepare/bind/execute throw. */
  failOn: RegExp | null;
}

function toParam(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint" || v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return String(v);
}

function applyMigrations(db: DatabaseSync) {
  const dir = resolve(process.cwd(), "drizzle/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    for (const part of sql.split("--> statement-breakpoint")) {
      if (part.trim()) db.exec(part);
    }
  }
}

export function createSqliteD1(): SqliteD1 {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  const handle: SqliteD1 = { d1: null as unknown as D1Database, sqlite, failOn: null };

  class Stmt {
    constructor(
      readonly sql: string,
      readonly params: Param[] = []
    ) {}
    bind(...values: unknown[]) {
      return new Stmt(this.sql, values.map(toParam));
    }
    private stmt(): StatementSync {
      if (handle.failOn && handle.failOn.test(this.sql)) throw new Error("injected D1 failure");
      return sqlite.prepare(this.sql);
    }
    async first<T>(column?: string): Promise<T | null> {
      const row = this.stmt().get(...this.params) as Record<string, unknown> | undefined;
      if (!row) return null;
      return (column ? row[column] : row) as T;
    }
    async all<T>() {
      const results = this.stmt().all(...this.params) as T[];
      return { results, success: true, meta: { changes: 0 } };
    }
    async raw<T>() {
      const s = this.stmt();
      s.setReturnArrays(true);
      return s.all(...this.params) as T[];
    }
    async run() {
      const s = this.stmt();
      // RETURNING statements must be read to take effect in node:sqlite too.
      if (/\breturning\b/i.test(this.sql)) {
        const results = s.all(...this.params);
        return { results, success: true, meta: { changes: results.length } };
      }
      const info = s.run(...this.params);
      return {
        results: [],
        success: true,
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
      };
    }
  }

  const d1 = {
    prepare: (sql: string) => new Stmt(sql),
    async batch(statements: Stmt[]) {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const st of statements) {
          // Drizzle's batch reads rows for selects/returning, runs the rest.
          out.push(/^\s*(select|with)\b|\breturning\b/i.test(st.sql) ? await st.all() : await st.run());
        }
        sqlite.exec("COMMIT");
        return out;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  handle.d1 = d1 as unknown as D1Database;
  return handle;
}
