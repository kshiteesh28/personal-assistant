import { CopilotLlmService } from './copilot-llm.service';

export class MotivationService {
  constructor(private llmService: CopilotLlmService) {}

  async getMotivationalMessage(slot: 'morning' | 'midday' | 'signoff'): Promise<string> {
    const prompt = `Write a short, professional motivational message for a busy executive at the ${slot} of their day. Keep it under 2 sentences.`;
    return await this.llmService.ask(prompt, 'Work');
  }
}
