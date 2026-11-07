import { Brief } from '@secretary/shared';
import { EventsRepository, TasksRepository, RemindersRepository, DailySchedulesRepository } from '../repositories';
import { ScheduleDesignerService } from './schedule-designer.service';

export class BriefingService {
  constructor(
    private eventsRepo: EventsRepository,
    private tasksRepo: TasksRepository,
    private remindersRepo: RemindersRepository,
    private schedulesRepo: DailySchedulesRepository,
    private scheduleDesigner: ScheduleDesignerService
  ) {}

  public async getBriefForDate(dateStr: string): Promise<Brief> {
    const startObj = new Date(dateStr + 'T00:00:00');
    const startMs = startObj.getTime();
    const endMs = startMs + 86400000; // +1 day

    const events = this.eventsRepo.findByDateRange(startMs, endMs);
    const rawTasksDueToday = this.tasksRepo.findByDueDate(startMs, endMs);
    const tasksDueToday = rawTasksDueToday.filter(t => t.status !== 'cancelled');
    const allTodoTasks = [
      ...this.tasksRepo.findByStatus('todo'),
      ...this.tasksRepo.findByStatus('in_progress')
    ];
    
    const now = Date.now();
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    const overdue_tasks = this.tasksRepo.findOverdue(now);
    
    // Get all reminders and filter by range manually
    const allReminders = this.remindersRepo.findByStatus('active');
    const reminders = allReminders.filter(r => r.trigger_ts >= startMs && r.trigger_ts <= endMs);

    let schedule = this.schedulesRepo.findByDate(dateStr);
    
    if (!schedule) {
      const design = isToday 
        ? this.scheduleDesigner.rescheduleFromNow(dateStr, allTodoTasks, events)
        : this.scheduleDesigner.designSchedule(dateStr, allTodoTasks, events);
      schedule = this.schedulesRepo.upsert(dateStr, design.blocks, design.overflow);
    }

    const scheduleData = {
      blocks: schedule.blocks,
      overflow: schedule.overflow
    };

    const mergedOverdue = [...overdue_tasks];
    // Disabled: Today's tasks shouldn't be 'overdue' just because the block passed.
    // The user prefers manual trim/overflow decisions.
    /*
    const scheduledOverdue = schedule.blocks
      .filter(b => b.type === 'task' && b.task_id && b.end_ts + 300000 < now)
      .map(b => allTodoTasks.find(t => t.id === b.task_id))
      .filter((t): t is any => !!t && (t.status === 'todo' || t.status === 'in_progress'));

    for (const st of scheduledOverdue) {
      if (!mergedOverdue.some(o => o.id === st.id)) {
        mergedOverdue.push(st);
      }
    }
    */

    // Return all tasks that are either due today or part of the schedule
    const scheduledTaskIds = schedule.blocks.filter(b => b.type === 'task' && b.task_id).map(b => b.task_id);
    const relevantTasks = allTodoTasks.filter(t => 
      t.status === 'in_progress' || 
      tasksDueToday.some(td => td.id === t.id) || 
      scheduledTaskIds.includes(t.id) ||
      mergedOverdue.some(o => o.id === t.id)
    );

    // Also include done tasks that were scheduled today so they don't disappear from the UI
    const allTasksForDate = this.tasksRepo.findAll().filter(t => 
      relevantTasks.some(rt => rt.id === t.id) || 
      (scheduledTaskIds.includes(t.id) && (t.status === 'done' || t.status === 'in_progress'))
    );

    const { pluginRegistry } = await import('../integrations/plugin-registry');
    const contributions = await pluginRegistry.getBriefContributions(dateStr);
    
    return {
      date: dateStr,
      events,
      tasks: allTasksForDate,
      reminders,
      overdue_tasks: mergedOverdue,
      schedule: scheduleData,
      sections: [],
      integrations: contributions,
      usage_summary: null,
      generated_at: Date.now()
    };
  }

  private async getPluginContributions(dateStr: string) {
    // In a real impl, we'd import the registry, but we'll use a local helper if needed
    // Actually, let's assume it's passed in or used via a global (not ideal but matches spec patterns)
    try {
      const { pluginRegistry } = await import('../integrations/plugin-registry');
      return await pluginRegistry.getBriefContributions(dateStr);
    } catch {
      return [];
    }
  }
}
