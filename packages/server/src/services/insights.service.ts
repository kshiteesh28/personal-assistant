import { TasksRepository, DailySchedulesRepository, ActivityRepository } from '../repositories';
import { CopilotLlmService } from './copilot-llm.service';

export class InsightsService {
  constructor(
    private taskRepo: TasksRepository,
    private scheduleRepo: DailySchedulesRepository,
    private activityRepo: ActivityRepository,
    private llmService: CopilotLlmService
  ) {}

  async generateDailySummary(dateStr: string): Promise<string> {
    // Collect data for the day
    const tasks = this.taskRepo.findByStatus('done');
    const todayTasks = tasks.filter(t => new Date(t.updated_at).toISOString().startsWith(dateStr));
    
    // Prepare prompt
    const prompt = `Summarize today's achievements briefly. The user completed ${todayTasks.length} tasks: ${todayTasks.map(t => t.title).join(', ')}. Write a 2-3 sentence encouraging end-of-day summary.`;
    return await this.llmService.ask(prompt, 'Work');
  }

  shouldSuggestBreak(): boolean {
    // We'll rely on the usage-tracking service for this logic largely,
    // but the insight itself asserts if a break is needed depending on the focus block.
    // The break-checker job coordinates between usage-tracking and this function.
    return true; 
  }
}
