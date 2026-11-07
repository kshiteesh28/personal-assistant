import { CommandResult } from './command-router';

export function formatResponse(result: CommandResult, source?: string): { reply: string, actions_performed: any[] } {
  let reply = result.message;
  let actions: any[] = [];

  if (result.status === 'error') {
    return { reply: `Hmm, there was a problem: ${result.message}`, actions_performed: [] };
  }

  if (result.data) {
    if (Array.isArray(result.data)) {
      reply += `. Found ${result.data.length} items.`;
      actions = result.data.map(d => ({ entity: d.id ? 'unknown' : 'list', id: d.id, item: d.title }));
    } else if (typeof result.data === 'object') {
      if (result.data.id) {
         actions.push({ entity: 'item', id: result.data.id, title: result.data.title });
      } else if (result.data.blocks) {
         reply += `. Generated ${result.data.blocks.length} blocks in the schedule.`;
      }
    }
  }

  // Formatting specific source additions
  if (source === 'voice') {
    // maybe limit the reply length for TTS
  }

  return { reply, actions_performed: actions };
}
