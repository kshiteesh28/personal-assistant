import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { runMigrations } from './migrations';
import { logger } from '../config/logger';

export function getProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "migrations"))) return cwd;
  if (existsSync(join(cwd, "..", "migrations"))) return join(cwd, "..");
  if (existsSync(join(cwd, "..", "..", "migrations"))) return join(cwd, "..", "..");
  return cwd;
}

export function getDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return join(getProjectRoot(), "flowstate.db");
}

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    const dbPath = getDbPath();
    logger.info(`Starting DB connection at ${dbPath}`);
    dbInstance = new Database(dbPath, { create: true });
    
    // WAL Mode Configuration
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    
    // Run migrations automatically on init
    runMigrations(dbInstance);
  }
  return dbInstance;
}
