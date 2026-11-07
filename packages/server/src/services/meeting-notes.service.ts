import { NoteService } from './note.service';
import { CalendarService } from './calendar.service';
import { CopilotLlmService } from './copilot-llm.service';
import { Note, Event as CalEvent } from '@secretary/shared';
import { logger } from '../config/logger';

export interface MeetingNoteCapture {
  eventId?: string;
  title?: string;
  attendees?: string[];
  rawNotes: string;
  actionItems?: string[];
}

export class MeetingNotesService {
  constructor(
    private readonly noteService: NoteService,
    private readonly calendarService: CalendarService,
    private readonly copilot: CopilotLlmService,
  ) {}

  async capture(input: MeetingNoteCapture): Promise<Note> {
    const title = input.title ?? `Meeting Notes — ${new Date().toLocaleDateString()}`;
    const body = this.formatNotes(input);
    logger.info(`[MeetingNotesService] Capturing notes for: "${title}"`);
    return this.noteService.create({ title, body, linked_event_id: input.eventId });
  }

  formatNotes(input: MeetingNoteCapture): string {
    const lines: string[] = [];
    const now = new Date().toLocaleString();

    lines.push(`# Meeting Notes`);
    lines.push(`**Date:** ${now}`);
    if (input.attendees?.length) lines.push(`**Attendees:** ${input.attendees.join(', ')}`);
    lines.push('');
    lines.push('## Notes');
    lines.push(input.rawNotes);

    if (input.actionItems?.length) {
      lines.push('');
      lines.push('## Action Items');
      input.actionItems.forEach(item => lines.push(`- [ ] ${item}`));
    }

    return lines.join('\n');
  }

  async buildAgendaTemplate(eventId: string): Promise<string> {
    try {
      const events = this.calendarService.findAll(Date.now() - 86400000, Date.now() + 86400000);
      const event = events.find((e: CalEvent) => e.id === eventId);
      if (!event) return this.buildDefaultAgenda();

      const lines = [
        `# Meeting: ${event.title}`,
        `**Date:** ${new Date(event.start_ts).toLocaleString()}`,
        event.location ? `**Location:** ${event.location}` : null,
        '',
        '## Agenda',
        '1. ',
        '2. ',
        '3. ',
        '',
        '## Notes',
        '',
        '## Action Items',
        '- [ ] ',
      ].filter(l => l !== null);

      return lines.join('\n');
    } catch {
      return this.buildDefaultAgenda();
    }
  }

  private buildDefaultAgenda(): string {
    return [
      '# Meeting Notes',
      `**Date:** ${new Date().toLocaleString()}`,
      '',
      '## Agenda',
      '1. ',
      '',
      '## Notes',
      '',
      '## Action Items',
      '- [ ] ',
    ].join('\n');
  }

  async summarizeWithAI(rawNotes: string): Promise<{ summary: string; actionItems: string[] }> {
    const prompt = `Summarize the following meeting notes into:\n1. A 2-3 sentence summary\n2. A bullet list of action items\n\nNotes:\n${rawNotes}`;
    try {
      const result = await this.copilot.ask(prompt, 'Work');
      const actionItems = result
        .split('\n')
        .filter(l => /^[\-\*]\s/.test(l))
        .map(l => l.replace(/^[\-\*]\s/, '').trim());
      return { summary: result, actionItems };
    } catch {
      return { summary: rawNotes, actionItems: [] };
    }
  }
}
