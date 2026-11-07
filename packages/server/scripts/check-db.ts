import { getDb } from '../src/db';
import { logger } from '../src/config/logger';

async function check() {
  const db = getDb();
  
  logger.info("--- Tasks Table Schema ---");
  const taskCols = db.query("PRAGMA table_info(tasks)").all();
  console.table(taskCols);

  logger.info("--- Notes Table Schema ---");
  const noteCols = db.query("PRAGMA table_info(notes)").all();
  console.table(noteCols);

  logger.info("--- Schema Version ---");
  const versions = db.query("SELECT * FROM schema_version").all();
  console.table(versions);
}

check().catch(console.error);
