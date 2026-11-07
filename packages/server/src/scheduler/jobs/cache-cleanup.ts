import { IntegrationCacheRepository } from '../../repositories';

export class CacheCleanupJob {
  private timer: NodeJS.Timer | null = null;

  constructor(private cacheRepo: IntegrationCacheRepository) {}

  start() {
    if (this.timer) return;
    // Every 15 minutes (900_000 ms)
    this.timer = setInterval(() => {
      this.cacheRepo.purgeExpired();
    }, 900_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
