import { parseDate } from 'chrono-node';

export enum IntentType {
  show_brief = 'show_brief',
  add_task = 'add_task',
  add_event = 'add_event',
  add_note = 'add_note',
  next_meeting = 'next_meeting',
  list_tasks = 'list_tasks',
  list_notes = 'list_notes',
  list_reminders = 'list_reminders',
  list_events = 'list_events',
  summarize_tasks = 'summarize_tasks',
  add_reminder = 'add_reminder',
  delete_task = 'delete_task',
  delete_note = 'delete_note',
  delete_reminder = 'delete_reminder',
  delete_event = 'delete_event',
  complete_task = 'complete_task',
  search = 'search',
  ask_copilot = 'ask_copilot',
  ask_motivation = 'ask_motivation',
  design_schedule = 'design_schedule',
  reschedule = 'reschedule',
  research = 'research',
  weekly_review = 'weekly_review',
  create_checklist = 'create_checklist',
  add_to_pipeline = 'add_to_pipeline',
  unrecognized = 'unrecognized',
}

export interface ParsedIntent {
  intent: IntentType;
  slots: {
    title?: string;
    due_ts?: number;
    start_ts?: number;
    end_ts?: number;
    trigger_ts?: number;
    priority?: number;
    energy_level?: 'high' | 'medium' | 'low';
    task_type?: 'deep_work' | 'communication' | 'admin' | 'creative' | 'review' | 'meeting_prep' | 'personal' | 'fitness' | 'mental_health';
    time_estimate?: number;
    time_preference?: 'morning' | 'evening' | 'either';
    [key: string]: any;
  };
}

export function parseIntent(message: string): ParsedIntent {
  const msg = message.trim();
  
  // Handle Slash commands
  if (msg.startsWith('/')) {
    const spaceIdx = msg.indexOf(' ');
    const command = spaceIdx > -1 ? msg.substring(0, spaceIdx).toLowerCase() : msg.toLowerCase();
    const payload = spaceIdx > -1 ? msg.substring(spaceIdx + 1).trim() : '';

    switch (command) {
      case '/task': {
        const params = [
          { key: 'priority', regex: /\bpriority:(\d)\b/, isNum: true },
          { key: 'energy_level', regex: /\benergy:(high|medium|low)\b/ },
          { key: 'task_type', regex: /\btype:([a-zA-Z0-9_]+)\b/ },
          { key: 'time_estimate', regex: /\bestimate:(\d+)\b/, isNum: true },
          { key: 'time_preference', regex: /\btime:(morning|evening)\b/ },
          { key: 'pinned_time', regex: /\bat:(\d{1,2}):(\d{2})\b/, isPinned: true },
        ];

        let finalTitle = payload;
        const slots: any = {};

        params.forEach(p => {
          const match = finalTitle.match(p.regex);
          if (match) {
            if (p.isPinned) {
              slots.pinned_time = parseInt(match[1]) * 60 + parseInt(match[2]);
            } else {
              slots[p.key] = p.isNum ? parseInt(match[1]) : match[1];
            }
            finalTitle = finalTitle.replace(match[0], '');
          }
        });

        if (finalTitle.toLowerCase().includes('today')) {
          const d = new Date();
          d.setHours(23, 59, 59, 999);
          slots.due_ts = d.getTime();
          finalTitle = finalTitle.replace(/\btoday\b/i, '');
        }

        const chronoParsed = parseDate(finalTitle);
        if (chronoParsed && !slots.due_ts) {
          slots.due_ts = chronoParsed.getTime();
          // Remove the date string from title if possible? 
          // Chrono doesn't give the matched text easily here without more work.
        }

        return {
          intent: IntentType.add_task,
          slots: {
            ...slots,
            title: finalTitle.trim() || 'New Task'
          }
        };
      }
      case '/note':
        return { intent: IntentType.add_note, slots: { title: payload || 'New Note' } };
      case '/reminder': {
        const chronoParsed = parseDate(payload);
        return {
          intent: IntentType.add_reminder,
          slots: {
            title: payload || 'Reminder',
            trigger_ts: chronoParsed ? chronoParsed.getTime() : Date.now() + 3600000
          }
        };
      }
      case '/event': {
        const chronoParsed = parseDate(payload);
        return {
          intent: IntentType.add_event,
          slots: {
            title: payload || 'Meeting',
            start_ts: chronoParsed ? chronoParsed.getTime() : Date.now(),
            end_ts: chronoParsed ? chronoParsed.getTime() + 3600000 : Date.now() + 3600000,
          }
        };
      }
      case '/brief':
        return { intent: IntentType.show_brief, slots: {} };
      case '/tasks':
        return { intent: IntentType.list_tasks, slots: {} };
      case '/notes':
        return { intent: IntentType.list_notes, slots: {} };
      case '/reminders':
        return { intent: IntentType.list_reminders, slots: {} };
      case '/meetings':
        return { intent: IntentType.list_events, slots: {} };
      case '/schedule':
        return { intent: IntentType.design_schedule, slots: {} };
      case '/reschedule':
        return { intent: IntentType.reschedule, slots: {} };
      case '/copilot':
        return { intent: IntentType.ask_copilot, slots: { query: payload } };
      case '/research':
        return { intent: IntentType.research, slots: { query: payload } };
      case '/review':
        return { intent: IntentType.weekly_review, slots: {} };
      case '/checklist':
        return { intent: IntentType.create_checklist, slots: { title: payload } };
      case '/pipeline':
        return { intent: IntentType.add_to_pipeline, slots: { title: payload } };
      case '/complete':
        return { intent: IntentType.complete_task, slots: { title: payload } };
      case '/delete':
        return { intent: IntentType.delete_task, slots: { title: payload } };
      case '/motivate':
        return { intent: IntentType.ask_motivation, slots: {} };
      case '/search':
        return { intent: IntentType.search, slots: { query: payload } };
      default:
        // Attempt NLP fallback if slash isn't recognized
        break;
    }
  }

  // Regex Natural Language Patterns Fallback
  const lowerMsg = msg.toLowerCase();
  
  if (lowerMsg.includes('add task') || lowerMsg.includes('create task') || lowerMsg.includes('remind me to')) {
    const chronoParsed = parseDate(msg);
    const slots: any = {
      title: msg.replace(/remind me to/i, '').replace(/create task/i, '').replace(/add task/i, '').replace(/add a task/i, '').split(/priority|energy|type|takes|for/i)[0].trim(),
      due_ts: chronoParsed ? chronoParsed.getTime() : undefined
    };

    // Extract Priority
    if (lowerMsg.includes('urgent') || lowerMsg.includes('high priority')) slots.priority = 1;
    else if (lowerMsg.includes('low priority')) slots.priority = 3;

    // Extract Energy
    if (lowerMsg.includes('high energy')) slots.energy_level = 'high';
    else if (lowerMsg.includes('low energy')) slots.energy_level = 'low';

    // Extract Task Type
    const types: any[] = ['deep_work', 'communication', 'admin', 'creative', 'review', 'meeting_prep', 'personal', 'fitness', 'mental_health'];
    for (const t of types) {
      if (lowerMsg.includes(t.replace(/_/g, ' '))) {
        slots.task_type = t;
        break;
      }
    }

    // Extract Time Estimate
    const estMatch = lowerMsg.match(/(?:takes|for)\s+(\d+)\s*(min|hour|hr|h|m)/);
    if (estMatch) {
      let val = parseInt(estMatch[1]);
      if (estMatch[2].startsWith('h')) val *= 60;
      slots.time_estimate = val;
    }

    return { intent: IntentType.add_task, slots };
  }

  if (lowerMsg.includes('schedule') || lowerMsg.includes('book meeting')) {
    const chronoParsed = parseDate(msg);
    return {
      intent: IntentType.add_event,
      slots: {
        title: msg.replace(/schedule/i, '').replace(/book meeting/i, '').trim(),
        start_ts: chronoParsed ? chronoParsed.getTime() : Date.now()
      }
    };
  }

  if (lowerMsg.includes('my brief') || lowerMsg.includes('what\'s on my plate')) {
    return { intent: IntentType.show_brief, slots: {} };
  }

  if (lowerMsg.includes('list tasks') || lowerMsg.includes('my tasks')) {
    return { intent: IntentType.list_tasks, slots: {} };
  }
  
  if (lowerMsg.includes('list notes') || lowerMsg.includes('show my notes')) {
    return { intent: IntentType.list_notes, slots: {} };
  }

  if (lowerMsg.includes('list reminders') || lowerMsg.includes('what reminders')) {
    return { intent: IntentType.list_reminders, slots: {} };
  }

  if (lowerMsg.includes('delete task')) {
    return { intent: IntentType.delete_task, slots: {} };
  }
  
  if (lowerMsg.includes('motivate me') || lowerMsg.includes('encourage me')) {
    return { intent: IntentType.ask_motivation, slots: {} };
  }

  return { intent: IntentType.unrecognized, slots: { query: msg } };
}
