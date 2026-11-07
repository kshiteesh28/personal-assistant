import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { getDb, getDbPath } from './db';
import { getConfig } from './config';
import { authMiddleware } from './middleware/auth';
import { configRouter } from './routes/config';
import { sseRouter } from './routes/sse';
import { eventsRouter } from './routes/events';
import { tasksRouter } from './routes/tasks';
import { remindersRouter } from './routes/reminders';
import { notesRouter } from './routes/notes';
import { briefRouter } from './routes/brief';
import { scheduleRouter } from './routes/schedule';
import { chatRouter } from './routes/chat';
import { checklistsRouter } from './routes/checklists';
import { weeklyReviewsRouter } from './routes/weekly-reviews';
import { downtimePipelineRouter } from './routes/downtime-pipeline';
import { importRouter } from './routes/import';
import { exportRouter } from './routes/export';
import { integrationsRouter } from './routes/integrations';
import { testNudgeRouter } from './routes/test-nudge';
import { voiceRouter } from './routes/voice';
import { outlookCalendarRouter } from './routes/outlook-calendar';

import { eventBus } from './scheduler/event-bus';

// Import Repos
import { 
  EventsRepository, TasksRepository, RemindersRepository, NotesRepository, 
  DailySchedulesRepository, ActivityRepository, ChecklistsRepository,
  WeeklyReviewsRepository, DowntimePipelineRepository, IntegrationCacheRepository
} from './repositories';

// Import Services & Orchestration
import {
  CalendarService, TaskService, ReminderService, NoteService,
  ScheduleDesignerService, BriefingService, UsageTrackingService,
  CopilotLlmService, MotivationService, InsightsService,
  ProductivityService, ProcessOptimizationService, DowntimePipelineService,
  NotificationService
} from './services';
import { CommandRouter } from './orchestration/command-router';

// Import Plugins
import { pluginRegistry, OutlookPlugin, LoopPlugin, JiraPlugin } from './integrations/plugin-registry';
pluginRegistry.register(new OutlookPlugin(true));
pluginRegistry.register(new LoopPlugin(true));
pluginRegistry.register(new JiraPlugin(true));

// Import Jobs
import { CacheCleanupJob } from './scheduler/jobs/cache-cleanup';
import { UsageSamplerJob } from './scheduler/jobs/usage-sampler';
import { BreakCheckerJob } from './scheduler/jobs/break-checker';
import { PreMeetingCheckerJob } from './scheduler/jobs/pre-meeting-checker';
import { CheckDowntimeJob } from './scheduler/jobs/check-downtime';
import { DbBackupJob } from './scheduler/jobs/db-backup';
import { TaskDeadlineCheckerJob } from './scheduler/jobs/task-deadline-checker';
import { ReminderCheckerJob } from './scheduler/jobs/reminder-checker';
import { DailyBriefTriggerJob } from './scheduler/jobs/daily-brief-trigger';
import { ProactiveNudgeJob } from './scheduler/jobs/proactive-nudge';

// Initialize Repos
const db = getDb();
const eventsRepo = new EventsRepository(db);
const tasksRepo = new TasksRepository(db);
const remindersRepo = new RemindersRepository(db);
const notesRepo = new NotesRepository(db);
const schedulesRepo = new DailySchedulesRepository(db);
const activityRepo = new ActivityRepository(db);
const checklistsRepo = new ChecklistsRepository(db);
const weeklyReviewsRepo = new WeeklyReviewsRepository(db);
const downtimeRepo = new DowntimePipelineRepository(db);
const cacheRepo = new IntegrationCacheRepository(db);

// Initialize Services
const calendarService = new CalendarService(eventsRepo, tasksRepo, schedulesRepo);
const taskService = new TaskService(tasksRepo, eventBus);
const reminderService = new ReminderService(remindersRepo);
const noteService = new NoteService(notesRepo);
const scheduleDesigner = new ScheduleDesignerService();
const briefingService = new BriefingService(eventsRepo, tasksRepo, remindersRepo, schedulesRepo, scheduleDesigner);

const copilotService = new CopilotLlmService();
const notificationService = new NotificationService();
const usageService = new UsageTrackingService(activityRepo);
const insightsService = new InsightsService(tasksRepo, schedulesRepo, activityRepo, copilotService);
const downtimeService = new DowntimePipelineService(downtimeRepo, calendarService, scheduleDesigner, schedulesRepo);

const commandRouter = new CommandRouter(
  taskService,
  calendarService,
  briefingService,
  reminderService,
  scheduleDesigner,
  copilotService,
  noteService
);

// Start Jobs
new CacheCleanupJob(cacheRepo).start();
new UsageSamplerJob(usageService).start();
new BreakCheckerJob(usageService, insightsService).start();
new PreMeetingCheckerJob(eventsRepo, notesRepo).start();
new CheckDowntimeJob(downtimeService).start();
new DbBackupJob(getDbPath(), './backups').start();
new TaskDeadlineCheckerJob(tasksRepo, notificationService).start();
new ReminderCheckerJob(remindersRepo, eventBus).start();
new DailyBriefTriggerJob(eventBus).start();
new ProactiveNudgeJob(eventBus).start();

// Wire Proactive Alerts to Desktop Notifications
eventBus.on('flowstate.nudge', (p: any) => {
  const categoryStr = p.category ? p.category.charAt(0).toUpperCase() + p.category.slice(1) : 'Flow-State';
  notificationService.notify(`Nudge: ${categoryStr}`, p.message);
});

eventBus.on('reminder.due', (p: any) => {
  notificationService.notify('Reminder Due', p.title);
});

eventBus.on('break.suggested', (p: any) => {
  const msg = p.message || `Consider taking a ${p.durationMin}m break for ${p.activityType}.`;
  notificationService.notify('Break Suggested', msg);
});

eventBus.on('meeting.approaching', (p: any) => {
  notificationService.notify('Meeting Approaching', `Your meeting "${p.title}" is coming up soon.`);
});

// Main Elysia App
const app = new Elysia()
  .onError(({ code, error, set }) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Server Error] ${code}: ${message}`);
    
    if (message === 'UNAUTHORIZED') {
      set.status = 401;
      return { status: 'error', message: 'Unauthorized' };
    }
    set.status = 500;
    return { status: 'error', message };
  })
  .get('/health', () => ({ status: 'ok', db: 'ok', version: '1.0.0' }))
  .get('/api/bootstrap', () => {
    // Basic implementation: if host is localhost return token
    const config = getConfig();
    const isLocal = true; // simplifying for dev
    return { authToken: isLocal ? config.server.authToken : null };
  })
  .use(authMiddleware)
  .use(configRouter)
  .use(sseRouter)
  .use(eventsRouter(calendarService))
  .use(tasksRouter(taskService))
  .use(remindersRouter(reminderService))
  .use(notesRouter(noteService))
  .use(briefRouter(briefingService))
  .use(scheduleRouter(scheduleDesigner, taskService, calendarService, schedulesRepo))
  .use(chatRouter(commandRouter))
  .use(checklistsRouter(checklistsRepo))
  .use(weeklyReviewsRouter(weeklyReviewsRepo))
  .use(downtimePipelineRouter(downtimeRepo))
  .use(importRouter(eventsRepo, tasksRepo, notesRepo, remindersRepo))
  .use(exportRouter(eventsRepo, tasksRepo, notesRepo, remindersRepo))
  .use(integrationsRouter(pluginRegistry.getAll()))
  .use(testNudgeRouter)
  .use(voiceRouter)
  .use(outlookCalendarRouter)
  
  .listen(getConfig().server.port || 3000);

console.log(`🦊 Flow-State Server is running at ${app.server?.hostname}:${app.server?.port}`);
