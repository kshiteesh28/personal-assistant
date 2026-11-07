import { DowntimePipelineRepository, DowntimeItem } from '../repositories';
import { CalendarService } from './calendar.service';
import { ScheduleDesignerService } from './schedule-designer.service';

export class DowntimePipelineService {
  constructor(
    private downtimeRepo: DowntimePipelineRepository,
    private calendarService: CalendarService,
    private scheduleService: ScheduleDesignerService,
    private schedulesRepo: import('../repositories').DailySchedulesRepository
  ) {}

  async detectFreeTime(dateStr: string): Promise<number> {
    const schedule = this.schedulesRepo.findByDate(dateStr);
    if (!schedule) return 0;
    
    const now = Date.now();
    const blocks = [...schedule.blocks].sort((a, b) => a.start_ts - b.start_ts);
    
    let currentEnd = now;
    for (const block of blocks) {
      if (block.start_ts > currentEnd) {
        const gap = (block.start_ts - currentEnd) / 60000;
        if (gap >= 15) return Math.floor(gap);
      }
      currentEnd = Math.max(currentEnd, block.end_ts);
    }
    
    return 0;
  }

  suggestForTimeSlot(gapMinutes: number): DowntimeItem | null {
    const suggestions = this.downtimeRepo.findSuggestions(gapMinutes);
    if (suggestions.length > 0) return suggestions[0];
    return null;
  }
}
