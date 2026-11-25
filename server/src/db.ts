import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, sub TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL,
  created INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_state (
  state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_handoff (
  id_hash TEXT PRIMARY KEY, sid TEXT, role TEXT, error TEXT, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, role TEXT NOT NULL,
  text TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'chat', meta TEXT
);
CREATE INDEX IF NOT EXISTS messages_ts ON messages(ts);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, icon TEXT NOT NULL, text TEXT NOT NULL,
  about_date TEXT, asked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, usd REAL NOT NULL,
  bucket TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS spend_ts ON spend(ts);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL, category TEXT NOT NULL,
  child_notice TEXT NOT NULL, parent_text TEXT NOT NULL, status TEXT NOT NULL,
  delivered_ts INTEGER, delivery TEXT
);
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL UNIQUE, text TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL UNIQUE, text TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, delivered INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_held (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, connection TEXT NOT NULL, tool TEXT NOT NULL,
  level TEXT NOT NULL, args TEXT NOT NULL, result TEXT NOT NULL, ok INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS desk_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  request TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  file_id TEXT, error TEXT, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, updated INTEGER NOT NULL, sheet TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, item_id TEXT NOT NULL, version INTEGER NOT NULL,
  provider TEXT NOT NULL, url TEXT NOT NULL, extra TEXT
);
CREATE INDEX IF NOT EXISTS cloud_links_item ON cloud_links(item_id);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER, topic TEXT NOT NULL DEFAULT '', front TEXT NOT NULL, back TEXT NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5, interval_days REAL NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_files (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, source TEXT NOT NULL, coursework INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, lines TEXT NOT NULL,
  payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS kana_progress (
  kana TEXT PRIMARY KEY, streak INTEGER NOT NULL DEFAULT 0, right INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0,
  learned INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lang_practice (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, lang TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS lang_practice_ts ON lang_practice(lang, ts);
CREATE TABLE IF NOT EXISTS help_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, subject TEXT NOT NULL, asked TEXT NOT NULL, help TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, minutes INTEGER NOT NULL, subject_id INTEGER
);
CREATE TABLE IF NOT EXISTS sketchbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS moodboard (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, story_id INTEGER NOT NULL, ts INTEGER NOT NULL, author TEXT NOT NULL,
  text TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'passage', replaces INTEGER
);
CREATE TABLE IF NOT EXISTS desk_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, icon TEXT NOT NULL, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS browse_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
  why TEXT NOT NULL, job_id INTEGER, outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
  payload TEXT NOT NULL, at INTEGER NOT NULL, repeat TEXT NOT NULL, time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, last_run INTEGER
);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, title TEXT NOT NULL, parent_id INTEGER,
  from_text TEXT, archived INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, outcome TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', sig TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL, command TEXT,
  body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL
);
`;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // secure_delete: deleted chats are overwritten on disk, not just unlinked from the file.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const now = () => Date.now();

/** Small typed helpers so call sites stay readable. */
export function all<T>(db: DB, sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T>(db: DB, sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(db: DB, sql: string, ...params: (string | number | null)[]) {
  return db.prepare(sql).run(...params);
}

/**
 * Numbered migrations. Each runs once, inside a transaction, and bumps PRAGMA user_version, so a
 * crash half-way leaves the database as it was. Migration 1 is the older additive steps (which
 * check before they change anything, so databases from before versioning take it safely).
 */
export const MIGRATIONS: ((db: DB) => void)[] = [
  // 1: columns added before migrations were numbered.
  (db) => {
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    // Push subscriptions belong to the child (all older ones) or the parent.
    if (!cols("push_subs").includes("audience")) db.exec("ALTER TABLE push_subs ADD COLUMN audience TEXT NOT NULL DEFAULT 'child'");
    const st = cols("oidc_state");
    if (!st.includes("handoff")) db.exec("ALTER TABLE oidc_state ADD COLUMN handoff TEXT");
    if (!st.includes("app")) db.exec("ALTER TABLE oidc_state ADD COLUMN app TEXT");
    // Language flashcards share the cards table: a language and a reading (kana for Japanese).
    const cc = cols("cards");
    if (!cc.includes("lang")) db.exec("ALTER TABLE cards ADD COLUMN lang TEXT");
    if (!cc.includes("reading")) db.exec("ALTER TABLE cards ADD COLUMN reading TEXT NOT NULL DEFAULT ''");
    if (!cols("messages").includes("thread_id")) db.exec("ALTER TABLE messages ADD COLUMN thread_id INTEGER NOT NULL DEFAULT 1");
    db.exec("CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id)");
    const th = cols("threads");
    if (!th.includes("lang")) db.exec("ALTER TABLE threads ADD COLUMN lang TEXT");
    if (!th.includes("topic")) db.exec("ALTER TABLE threads ADD COLUMN topic TEXT");
  },
  // 2: delivery per reporter (so retries only go to the ones that failed), desk job attempts,
  // capped retries for the journal and weekly summary, and indexes for the retention deletes.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS report_deliveries (
        report_id INTEGER NOT NULL, reporter TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER, last_error TEXT, delivered_ts INTEGER, PRIMARY KEY (report_id, reporter)
      );
      CREATE TABLE IF NOT EXISTS job_attempts (job TEXT NOT NULL, period TEXT NOT NULL, attempts INTEGER NOT NULL, last_ts INTEGER NOT NULL, PRIMARY KEY (job, period));
      CREATE INDEX IF NOT EXISTS checkins_ts ON checkins(ts);
      CREATE INDEX IF NOT EXISTS tool_log_ts ON tool_log(ts);
      CREATE INDEX IF NOT EXISTS reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS reports_ts ON reports(ts);
    `);
    const dj = (db.prepare("PRAGMA table_info(desk_jobs)").all() as { name: string }[]).map((c) => c.name);
    if (!dj.includes("attempts")) db.exec("ALTER TABLE desk_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  },
  // 3: each push subscription belongs to the session that turned it on, so signing out (or being
  // signed out) stops that device's notifications. Older ones have none until the app re-registers.
  (db) => {
    const cols = (db.prepare("PRAGMA table_info(push_subs)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("sid")) db.exec("ALTER TABLE push_subs ADD COLUMN sid TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS push_subs_sid ON push_subs(sid)");
  },
];

export function migrate(db: DB) {
  const version = () => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = version(); v < MIGRATIONS.length; v = version()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  // Thread 1 is always the main chat.
  db.prepare("INSERT OR IGNORE INTO threads(id, ts, title, updated) VALUES (1, ?, 'Chat', ?)").run(Date.now(), Date.now());
}
