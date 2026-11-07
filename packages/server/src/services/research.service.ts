import { CopilotLlmService } from './copilot-llm.service';
import { getConfig } from '../config';
import { logger } from '../config/logger';

export interface ResearchResult {
  topic: string;
  summary: string;
  keyPoints: string[];
  sources?: string[];
  generatedAt: number;
}

export class ResearchService {
  constructor(private readonly copilot: CopilotLlmService) {}

  async research(topic: string, depth: 'brief' | 'deep' = 'brief'): Promise<ResearchResult> {
    logger.info(`[ResearchService] Researching: "${topic}" (depth=${depth})`);

    const prompt = depth === 'deep'
      ? `You are a thorough research assistant. Provide a detailed, structured research summary on the following topic. Include key points, important facts, and actionable insights. Topic: "${topic}"`
      : `Provide a concise research summary on: "${topic}". Include 3-5 key points.`;

    try {
      const rawSummary = await this.copilot.ask(prompt, 'Web');

      // Extract key points (lines starting with -, *, or numbers)
      const keyPoints = rawSummary
        .split('\n')
        .filter(line => /^[\-\*\d\•]/.test(line.trim()))
        .map(line => line.replace(/^[\-\*\d\•\.]\s*/, '').trim())
        .filter(l => l.length > 0)
        .slice(0, 8);

      return {
        topic,
        summary: rawSummary,
        keyPoints: keyPoints.length > 0 ? keyPoints : [rawSummary.split('.')[0]],
        generatedAt: Date.now(),
      };
    } catch (err) {
      logger.warn(`[ResearchService] Research failed for "${topic}": ${err}`);
      return {
        topic,
        summary: `Research on "${topic}" is not available at this time. Please try again later or search manually.`,
        keyPoints: [],
        generatedAt: Date.now(),
      };
    }
  }

  async summarizeUrl(url: string): Promise<string> {
    const prompt = `Summarize the content at this URL in a concise paragraph: ${url}`;
    try {
      return await this.copilot.ask(prompt, 'Web');
    } catch {
      return `Unable to summarize URL: ${url}`;
    }
  }
}
