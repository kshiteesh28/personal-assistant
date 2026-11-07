import { copyFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../../config/logger';

export class DbBackupJob {
  private timer: NodeJS.Timer | null = null;
  private KEEP_DAYS = 7;

  constructor(private dbPath: string, private backupsDir: string) {}

  start() {
    // Run immediately on start
    this.runBackup();

    if (this.timer) return;
    // Every 24 hours
    this.timer = setInterval(() => {
      this.runBackup();
    }, 86_400_000);
  }

  private runBackup() {
    if (!existsSync(this.dbPath)) return;

    try {
      if (!existsSync(this.backupsDir)) {
        mkdirSync(this.backupsDir, { recursive: true });
      }

      const dateStr = new Date().toISOString().split('T')[0];
      const destPath = join(this.backupsDir, `flowstate-backup-${dateStr}.db`);
      
      copyFileSync(this.dbPath, destPath);
      logger.info(`Database backup created at ${destPath}`);

      this.cleanupOldBackups();
    } catch (e: any) {
      logger.error(`Database backup failed: ${e.message}`);
    }
  }

  private cleanupOldBackups() {
    try {
      const files = readdirSync(this.backupsDir)
        .filter(f => f.startsWith('flowstate-backup-') && f.endsWith('.db'))
        .sort((a, b) => b.localeCompare(a)); // sort descending by date

      if (files.length > this.KEEP_DAYS) {
        const toDelete = files.slice(this.KEEP_DAYS);
        for (const file of toDelete) {
          unlinkSync(join(this.backupsDir, file));
        }
      }
    } catch (e: any) {
      logger.error(`Backup cleanup failed: ${e.message}`);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
