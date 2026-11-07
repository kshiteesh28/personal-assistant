import { CopilotLlmService } from './copilot-llm.service';

export class ProductivityService {
  constructor(private llmService: CopilotLlmService) {}

  async analyzeWorkflow(data: string): Promise<string> {
    const prompt = `Analyze this workflow data and suggest one concrete productivity tip: ${data}`;
    return await this.llmService.ask(prompt, 'Work');
  }
}
