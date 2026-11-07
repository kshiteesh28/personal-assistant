import { Elysia } from 'elysia';
import { ScheduleDesignerService, TaskService, CalendarService } from '../services';
import { DailySchedulesRepository } from '../repositories';
import { eventBus } from '../scheduler/event-bus';

export const scheduleRouter = (
  scheduleDesigner: ScheduleDesignerService, 
  taskService: TaskService, 
  calendarService: CalendarService,
  schedulesRepo: DailySchedulesRepository
) => new Elysia({ prefix: '/api/schedule' })
  .post('/generate', ({ body }: any) => {
    const dateStr = body.date || new Date().toISOString().split('T')[0];
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    
    // Use the same refined logic as BriefingService
    const startObj = new Date(dateStr + 'T00:00:00');
    const startMs = startObj.getTime();
    const endMs = startMs + 86400000;

    const tasks = taskService.findAll({ status: ['todo', 'in_progress'] });
    const events = calendarService.findAll(startMs, endMs);
    
    const result = isToday
      ? scheduleDesigner.rescheduleFromNow(dateStr, tasks, events)
      : scheduleDesigner.designSchedule(dateStr, tasks, events);
    
    schedulesRepo.upsert(dateStr, result.blocks, result.overflow);
    eventBus.emit('data.changed', { entity: 'schedule', id: dateStr, action: 'updated' });
    return result;
  });
