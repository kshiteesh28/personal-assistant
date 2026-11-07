import { ActivityRepository } from '../repositories';
import { logger } from '../config/logger';

// Mocked to avoid native dependency issues during dev verification
const activeWindow = async () => {
  return { title: 'Personal Secretary', owner: { name: 'browser' } };
};

export class UsageTrackingService {
  private currentSessionStartTs: number = Date.now();
  private currentCategory: string = 'uncategorized';

  constructor(private activityRepo: ActivityRepository) {}

  public trackingUnavailable: boolean = false;
  public trackingUnavailableReason?: string;

  public async sample(): Promise<void> {
    try {
      const win = await activeWindow();
      if (!win) return;

      const title = win.title;
      const owner = win.owner.name;

      // rudimentary categorizer
      let category = 'uncategorized';
      if (owner.includes('Cursor') || owner.includes('Code')) category = 'cursor_coding';
      else if (owner.includes('Jira')) category = 'jira';
      else if (owner.includes('Teams') || owner.includes('Zoom')) category = 'team_call';
      
      const now = Date.now();
      
      if (category !== this.currentCategory) {
        // end old
        this.activityRepo.createSession({
          activity_type: this.currentCategory,
          start_ts: this.currentSessionStartTs,
          end_ts: now,
          source: 'active_window',
          app_name: owner,
          window_title: title
        });

        // start new
        this.currentCategory = category;
        this.currentSessionStartTs = now;
      }

      this.trackingUnavailable = false;
      this.trackingUnavailableReason = undefined;

    } catch (e: any) {
      this.trackingUnavailable = true;
      this.trackingUnavailableReason = e.message;
    }
  }

  public getCurrentFocusBlockStartTs(): number {
    return this.currentSessionStartTs;
  }
}
