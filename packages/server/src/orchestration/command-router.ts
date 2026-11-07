import { ParsedIntent, IntentType } from './intent-parser';
import { 
  TaskService, 
  CalendarService, 
  BriefingService, 
  ReminderService,
  ScheduleDesignerService,
  CopilotLlmService,
  NoteService
} from '../services';

export interface CommandResult {
  status: 'success' | 'error' | 'delegated';
  message: string;
  data?: any;
}

export class CommandRouter {
  constructor(
    private taskService: TaskService,
    private calendarService: CalendarService,
    private briefingService: BriefingService,
    private reminderService: ReminderService,
    private scheduleService: ScheduleDesignerService,
    private copilotLlmService: CopilotLlmService,
    private noteService: NoteService
  ) {}

  async run(parsed: ParsedIntent, source?: string): Promise<CommandResult> {
    try {
      switch (parsed.intent) {
        case IntentType.add_task: {
          const task = this.taskService.create({
            title: parsed.slots.title || 'New Task',
            due_ts: parsed.slots.due_ts,
            priority: (parsed.slots.priority as 1 | 2 | 3) || 2,
            energy_level: parsed.slots.energy_level || 'medium',
            task_type: parsed.slots.task_type || 'deep_work',
            time_estimate: parsed.slots.time_estimate || 30,
            time_preference: parsed.slots.time_preference || 'either',
            pinned_time: parsed.slots.pinned_time,
            is_splittable: false
          });
          return { status: 'success', message: 'Task added successfully', data: task };
        }
        case IntentType.add_event: {
          const start = parsed.slots.start_ts || Date.now();
          const evt = this.calendarService.create({
            title: parsed.slots.title || 'Meeting',
            start_ts: start,
            end_ts: parsed.slots.end_ts || start + 3600000,
            all_day: false
          });
          return { status: 'success', message: 'Meeting scheduled', data: evt };
        }
        case IntentType.add_note: {
          const note = this.noteService.create({
            title: parsed.slots.title || 'New Note',
            body: parsed.slots.content || '',
            linked_event_id: parsed.slots.linked_event_id
          });
          return { status: 'success', message: 'Note added', data: note };
        }
        case IntentType.add_reminder: {
          const reminder = this.reminderService.create({
            title: parsed.slots.title || 'Reminder',
            trigger_ts: parsed.slots.trigger_ts || Date.now() + 3600000,
          });
          return { status: 'success', message: 'Reminder set', data: reminder };
        }
        case IntentType.show_brief: {
          // get today's briefs
          const date = new Date().toISOString().split('T')[0];
          const brief = await this.briefingService.getBriefForDate(date);
          return { status: 'success', message: 'Here is your brief', data: brief };
        }
        case IntentType.list_tasks: {
          const tasks = this.taskService.findAll({ status: 'todo' });
          return { status: 'success', message: 'Found active tasks', data: tasks };
        }
        case IntentType.ask_copilot: {
          const reply = await this.copilotLlmService.ask(parsed.slots.query || 'Hi', 'Work');
          return { status: 'success', message: reply };
        }
        case IntentType.design_schedule: {
          const date = new Date().toISOString().split('T')[0];
          const allTodo = this.taskService.findAll({ status: 'todo' });
          const events = this.calendarService.findAll(Date.now(), Date.now() + 86400000);
          
          const sched = this.scheduleService.designSchedule(date, allTodo, events);
          // Actually persist it in the route/service wrapper
          return { status: 'success', message: 'Schedule designed', data: sched };
        }
        case IntentType.reschedule: {
          const date = new Date().toISOString().split('T')[0];
          const allTodo = this.taskService.findAll({ status: 'todo' });
          const events = this.calendarService.findAll(Date.now(), Date.now() + 86400000);
          
          const nowMidnight = new Date();
          nowMidnight.setHours(0,0,0,0);
          const fromMin = Math.floor((Date.now() - nowMidnight.getTime()) / 60000);

          const sched = this.scheduleService.designSchedule(date, allTodo, events, fromMin);
          return { status: 'success', message: 'Schedule updated', data: sched };
        }
        case IntentType.complete_task: {
          // simple match helper since title provided is usually partial
          const tasks = this.taskService.findAll({ status: 'todo' });
          const target = tasks.find(t => t.title.toLowerCase().includes(parsed.slots.title?.toLowerCase() || ''));
          if (target) {
            this.taskService.update(target.id, { status: 'done', progress: 100 });
            return { status: 'success', message: `Marked '${target.title}' as complete`, data: target };
          }
          return { status: 'error', message: 'Could not find that task.' };
        }
        case IntentType.delete_task: {
          const success = this.taskService.delete(parsed.slots.id);
          return { status: success ? 'success' : 'error', message: success ? 'Task deleted' : 'Task not found' };
        }
        case IntentType.delete_note: {
          const success = this.noteService.delete(parsed.slots.id);
          return { status: success ? 'success' : 'error', message: success ? 'Note deleted' : 'Note not found' };
        }
        case IntentType.delete_reminder: {
          const success = this.reminderService.delete(parsed.slots.id);
          return { status: success ? 'success' : 'error', message: success ? 'Reminder deleted' : 'Reminder not found' };
        }
        case IntentType.list_notes: {
          const notes = this.noteService.findAll();
          return { status: 'success', message: `Found ${notes.length} notes`, data: notes };
        }
        case IntentType.list_reminders: {
          const reminders = this.reminderService.findAll();
          return { status: 'success', message: `Found ${reminders.length} reminders`, data: reminders };
        }
        case IntentType.search: {
          const query = parsed.slots.query || '';
          const tasks = this.taskService.findAll().filter(t => t.title.toLowerCase().includes(query.toLowerCase()));
          const notes = this.noteService.findAll({ q: query });
          return { status: 'success', message: `Search results for "${query}"`, data: { tasks, notes } };
        }
        case IntentType.ask_motivation:
        case IntentType.unrecognized:
        default: {
          if (parsed.slots.query) {
            const reply = await this.copilotLlmService.ask(parsed.slots.query, 'Work');
            return { status: 'success', message: reply };
          }
          return { status: 'error', message: "I'm sorry, I didn't quite catch that command." };
        }
      }
    } catch (e: any) {
      return { status: 'error', message: e.message };
    }
  }
}
