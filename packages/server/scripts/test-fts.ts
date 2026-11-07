import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync } from 'fs';

const DB_PATH = "test_fts.db";
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const db = new Database(DB_PATH);

try {
  console.log("Creating tables...");
  db.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT ''
    );
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content='notes', content_rowid='rowid');
  `);

  console.log("Inserting into notes...");
  const info = db.query("INSERT INTO notes (id, title, body) VALUES ('1', 'Test', 'Body')").run();
  const rowid = info.lastInsertRowid;
  console.log("LastRowId:", rowid);

  console.log("Inserting into notes_fts...");
  db.query("INSERT INTO notes_fts (rowid, title, body) VALUES ($rowid, $title, $body)").run({
    $rowid: rowid,
    $title: "Test",
    $body: "Body"
  });

  console.log("Success!");
} catch (e) {
  console.error("Failed:", e.message);
} finally {
  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
}
