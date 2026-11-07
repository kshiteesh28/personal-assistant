import { Database } from 'bun:sqlite';
import { join } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { logger } from '../config/logger';
import { getProjectRoot } from './index';

export function runMigrations(db: Database) {
  const migrationsDir = process.env.MIGRATIONS_DIR || join(getProjectRoot(), "migrations");
  
  if (!existsSync(migrationsDir)) {
    logger.warn(`Migrations directory not found at ${migrationsDir}`);
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (isNaN(version)) continue;

    const row = db.query<{version: number}, any>('SELECT version FROM schema_version WHERE version = $version').get({ $version: version });
    
    if (!row) {
      logger.info(`Applying migration: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      
      db.transaction(() => {
        db.exec(sql);
        db.query('INSERT INTO schema_version (version, applied_at) VALUES ($version, $appliedAt)').run({
          $version: version,
          $appliedAt: new Date().toISOString()
        });
      })();
      logger.info(`Successfully applied ${file}`);
    }
  }
}
