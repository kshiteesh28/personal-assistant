import { Event } from '@secretary/shared';
import { logger } from '../config/logger';
import { getConfig } from '../config';

/**
 * OutlookCalendarService bridges to the Outlook plugin for calendar fetching.
 * Returns empty when the Outlook integration is disabled.
 */
export class OutlookCalendarService {
  async getEvents(startMs: number, endMs: number): Promise<OutlookEvent[]> {
    const config = getConfig() as any;
    if (!config?.integrations?.outlookEnabled) {
      logger.info('[OutlookCalendarService] Outlook integration disabled');
      return [];
    }

    try {
      // In production, this would call the Outlook Graph API via outlook.plugin
      // For now, return stub data if enabled but no token configured
      logger.info('[OutlookCalendarService] Fetching Outlook events');
      return [];
    } catch (err) {
      logger.warn(`[OutlookCalendarService] Failed to fetch Outlook events: ${err}`);
      return [];
    }
  }

  /**
   * Convert an Outlook event to the shared Event type for merging with local events.
   */
  toSharedEvent(outlookEvent: OutlookEvent): Event {
    return {
      id: `outlook-${outlookEvent.id}`,
      title: outlookEvent.subject,
      start_ts: new Date(outlookEvent.start.dateTime + 'Z').getTime(),
      end_ts: new Date(outlookEvent.end.dateTime + 'Z').getTime(),
      all_day: outlookEvent.isAllDay ?? false,
      location: outlookEvent.location?.displayName ?? null,
      description: outlookEvent.bodyPreview ?? null,
      recurrence_rule: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }
}

// Minimal Outlook event shape (from Microsoft Graph API)
export interface OutlookEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end:   { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  location?: { displayName: string };
  bodyPreview?: string;
  webLink?: string;
  source?: 'outlook';
}
