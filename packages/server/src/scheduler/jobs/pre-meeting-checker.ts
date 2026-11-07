import { EventsRepository, NotesRepository } from '../../repositories';
import { eventBus } from '../event-bus';
import { getConfig } from '../../config';

export class PreMeetingCheckerJob {
  private timer: NodeJS.Timer | null = null;

  constructor(
    private eventsRepo: EventsRepository,
    private notesRepo: NotesRepository
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check();
    }, 60000);
  }

  private check() {
    const config = getConfig();
    if (!config.notifications.triggers.preMeeting) return;

    const preMins = config.notifications.preMeetingMinutes;
    const now = Date.now();
    const windowEnd = now + preMins * 60000;
    const windowStart = windowEnd - 60000;

    const events = this.eventsRepo.findByDateRange(windowStart, windowEnd);
    for (const event of events) {
      if (event.start_ts > windowStart && event.start_ts <= windowEnd) {
        const startsInMs = event.start_ts - now;
        const linkedNotes = this.notesRepo.findByEventId(event.id);
        
        eventBus.emit('meeting.approaching', {
          eventId: event.id,
          title: event.title,
          startsInMs,
          linkedNotes: linkedNotes.map((n: any) => ({ id: n.id, title: n.title }))
        });
      }
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
