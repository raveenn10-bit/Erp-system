'use client';
// Encrypted on-device SQLite (SQLCipher via @capacitor-community/sqlite).
// The passphrase is random, generated once on this phone and kept by the
// plugin in Android Keystore-backed encrypted preferences. Schema changes are
// additive only and tracked with PRAGMA user_version, so app updates never
// reset local data.
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'nugathalawa_erp';
const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, user_id TEXT, body TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL, user_id TEXT NOT NULL,
      op_type TEXT NOT NULL, entity_id TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
      payload TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, summary TEXT,
      created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Pending',
      retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0,
      server_ref TEXT, updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status, created_at)`,
  ],
];

let conn: Promise<SQLiteDBConnection> | null = null;

async function open(): Promise<SQLiteDBConnection> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  if (!(await sqlite.isSecretStored()).result) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await sqlite.setEncryptionSecret(Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''));
  }
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const db = exists ? await sqlite.retrieveConnection(DB_NAME, false) : await sqlite.createConnection(DB_NAME, true, 'secret', 1, false);
  await db.open();
  const v = Number((await db.query('PRAGMA user_version')).values?.[0]?.user_version ?? 0);
  for (let i = v; i < MIGRATIONS.length; i++) {
    await db.executeSet([...MIGRATIONS[i].map(statement => ({ statement, values: [] })), { statement: `PRAGMA user_version = ${i + 1}`, values: [] }], true);
  }
  return db;
}

export function db(): Promise<SQLiteDBConnection> {
  if (!conn) conn = open().catch(e => { conn = null; throw e; });
  return conn;
}

export async function getMeta(key: string): Promise<string | null> {
  const r = await (await db()).query('SELECT value FROM meta WHERE key=?', [key]);
  return (r.values?.[0]?.value as string) ?? null;
}
export async function setMeta(key: string, value: string) {
  await (await db()).run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}
export async function deviceId(): Promise<string> {
  let id = await getMeta('device_id');
  if (!id) { id = crypto.randomUUID(); await setMeta('device_id', id); }
  return id;
}
