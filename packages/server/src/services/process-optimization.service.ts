import { CopilotLlmService } from './copilot-llm.service';

export class ProcessOptimizationService {
  constructor(private llmService: CopilotLlmService) {}

  async suggestImprovements(checklistItems: string[]): Promise<string[]> {
    const prompt = `Given this checklist process, suggest 2-3 ways to optimize or streamline it. Keep them brief. \n\nChecklist:\n- ${checklistItems.join('\n- ')}\n\nReturn ONLY a JSON array of strings.`;
    try {
      const response = await this.llmService.ask(prompt, 'Work');
      const start = response.indexOf('[');
      const end = response.lastIndexOf(']');
      if (start > -1 && end > -1) {
        return JSON.parse(response.substring(start, end + 1));
      }
      return ['Review checklist for redundant steps.'];
    } catch {
      return ['Consider automating repetitive steps.'];
    }
  }
}
