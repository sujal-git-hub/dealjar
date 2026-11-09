import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { DDL } from "./ddl";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
const g = globalThis as unknown as { __dealjarDb?: Holder };
const holder: Holder = (g.__dealjarDb ??= {});

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Production: any standard Postgres (Supabase, Neon, ...) over TCP.
    // prepare:false because Supabase's transaction pooler (and PgBouncer generally) doesn't support
    // prepared statements. A small pool keeps us inside free-tier connection limits.
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5), idle_timeout: 20, connect_timeout: 15, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require" });
    return drizzle(client, { schema }) as unknown as DB;
  }
  // Local dev / demo: embedded Postgres (WASM) persisted on disk. No setup needed.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? "./.data/pglite";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  return drizzle(new PGlite(dir), { schema }) as unknown as DB;
}

/** Returns a ready database with the schema created. Safe to call on every request. */
export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  holder.ready ??= (async () => {
    const db = await connect();
    // Over a network every statement is a round trip, so remote Postgres gets the whole schema in one
    // multi-statement query. PGlite (local) only accepts one statement at a time.
    if (process.env.DATABASE_URL) await db.execute(sql.raw(DDL.map((x) => x.trim().replace(/;$/, "")).join(";\n")));
    else for (const stmt of DDL) await db.execute(sql.raw(stmt));
    const { seedIfEmpty } = await import("@srv/seed");
    await seedIfEmpty(db);
    holder.db = db;
    return db;
  })();
  return holder.ready;
}

export { schema };
