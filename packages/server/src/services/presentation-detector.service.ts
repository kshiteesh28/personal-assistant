import { logger } from '../config/logger';

/**
 * PresentationDetectorService detects if the user is actively presenting.
 * Uses process name heuristics via get-windows (if available on Windows).
 * Falls back gracefully to false on non-Windows or missing dependency.
 */
export class PresentationDetectorService {
  private lastCheck = 0;
  private cachedResult = false;
  private CACHE_MS = 15_000; // 15 second cache

  async isPresenting(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastCheck < this.CACHE_MS) return this.cachedResult;

    this.lastCheck = now;
    this.cachedResult = await this.detectFullscreen();
    return this.cachedResult;
  }

  private async detectFullscreen(): Promise<boolean> {
    if (process.platform !== 'win32') return false;

    try {
      // Dynamically import get-windows — may not be installed
      // Use a require-style workaround to avoid TypeScript module resolution errors
      const mod = await eval('import("get-windows")').catch(() => null) as any;
      if (!mod?.activeWindow) return false;

      const win = await mod.activeWindow();
      if (!win) return false;

      const processName = ((win.owner?.name ?? '') as string).toLowerCase();

      // Presentation apps
      const presentationApps = ['powerpnt', 'keynote', 'soffice', 'impress'];
      if (presentationApps.some(app => processName.includes(app))) return true;

      // Meeting apps in fullscreen = likely presenting
      const meetingApps = ['teams', 'zoom', 'webex'];
      return meetingApps.some(app => processName.includes(app));
    } catch (err) {
      logger.info(`[PresentationDetector] Detection skipped: ${err}`);
      return false;
    }
  }

  /**
   * Returns true if nudges should be suppressed (user is presenting).
   */
  async shouldSuppressNudges(): Promise<boolean> {
    return this.isPresenting();
  }
}
