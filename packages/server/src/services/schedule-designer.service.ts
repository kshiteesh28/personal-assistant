import { Task, Event, ScheduleBlock, OverflowSuggestion, EnergyLevel } from '@secretary/shared';
import { getConfig } from '../config';

export class ScheduleDesignerService {
  private msToMinuteOfDay(ms: number, dateStr: string): number {
    const d = new Date(ms);
    // Use local components to avoid UTC shifts
    const [y, m, day] = dateStr.split('-').map(Number);
    const ref = new Date(y, m - 1, day, 0, 0, 0); 
    return Math.floor((d.getTime() - ref.getTime()) / 60000);
  }

  private parseTime(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  private getEnergyBand(minute: number, dayStart: number, dayEnd: number): EnergyLevel {
    const range = dayEnd - dayStart;
    const progress = (minute - dayStart) / range;
    
    if (progress < 0.35) return "high";   // First ~3.5 hours of a 10h day
    if (progress < 0.70) return "medium"; // Middle ~3.5 hours
    return "low";                        // Final ~3 hours
  }

  public designSchedule(
    dateStr: string,
    tasks: Task[],
    events: Event[],
    fromMinuteOfDay?: number
  ): { blocks: ScheduleBlock[], overflow: OverflowSuggestion[] } {
    const config = getConfig().proactive;
    const dayStartMin = this.parseTime(config.scheduleDayStart);
    let dayEndMin = this.parseTime(config.scheduleDayEnd);
    
    // If dayEndMin is midnight (00:00) or earlier than start, treat as end of 24h cycle
    if (dayEndMin === 0 || dayEndMin <= dayStartMin) {
      dayEndMin = 1440;
    }
    
    const dayRange = dayEndMin - dayStartMin;
    
    const lunchStart = this.parseTime(config.scheduleLunchStartTime);
    const lunchEnd = lunchStart + config.scheduleLunchDurationMin;
    const dinnerStart = this.parseTime(config.scheduleDinnerStartTime);
    const dinnerEnd = dinnerStart + config.scheduleDinnerDurationMin;
    
    const weights = config.scheduleWeights || {
      urgency: 3,
      importance: 3,
      deadline_pressure: 2,
      energy_fit: 1.5,
      context_bonus: 1,
      time_pref_fit: 4
    };

    // 1. Filter out pinned tasks and adjust time_estimates for regular tasks
    const pinnedTasks = tasks.filter(t => t.pinned_time !== undefined && t.pinned_time !== null);
    const pendingTasks = tasks.filter(t => t.pinned_time === undefined || t.pinned_time === null).map(t => ({
      ...t,
      remaining_estimate: Math.max(15, Math.ceil((t.time_estimate || 30) * (100 - (t.progress || 0)) / 100))
    }));

    // 2. Fixed blocks (meetings with buffers, lunch, dinner, and pinned tasks)
    const blocks: ScheduleBlock[] = [];
    
    // Pinned Tasks (treated as fixed events)
    pinnedTasks.forEach(t => {
      const startMin = this.msToMinuteOfDay(t.pinned_time!, dateStr);
      const duration = Math.max(15, Math.ceil((t.time_estimate || 30) * (100 - (t.progress || 0)) / 100));
      blocks.push({
        type: 'task',
        start_ts: startMin,
        end_ts: startMin + duration,
        title: t.title,
        task_id: t.id,
        energy_band: t.energy_level
      });
    });

    // Lunch & Dinner
    blocks.push({ type: 'lunch', start_ts: lunchStart, end_ts: lunchEnd, title: 'Lunch', energy_band: 'medium' });
    blocks.push({ type: 'dinner', start_ts: dinnerStart, end_ts: dinnerEnd, title: 'Dinner', energy_band: 'low' });

    // Events with buffers
    events.forEach(e => {
      const startMin = this.msToMinuteOfDay(e.start_ts, dateStr);
      const endMin = this.msToMinuteOfDay(e.end_ts, dateStr);
      if (startMin >= 0 && endMin <= 1440) {
        // Buffer before
        const beforeStart = Math.max(dayStartMin, startMin - config.scheduleBufferBeforeMeetingMin);
        if (beforeStart < startMin) {
          blocks.push({ type: 'buffer', start_ts: beforeStart, end_ts: startMin, title: 'Pre-meeting buffer', energy_band: 'low' });
        }
        
        // Meeting
        blocks.push({ type: 'meeting', start_ts: startMin, end_ts: endMin, title: e.title, event_id: e.id, energy_band: 'medium' });
        
        // Buffer after
        const afterEnd = Math.min(dayEndMin, endMin + config.scheduleBufferAfterMeetingMin);
        if (afterEnd > endMin) {
          blocks.push({ type: 'buffer', start_ts: endMin, end_ts: afterEnd, title: 'Post-meeting buffer', energy_band: 'low' });
        }
      }
    });

    // Deduplicate/Clean overlapping blocks (sort for consistency)
    blocks.sort((a, b) => a.start_ts - b.start_ts);

    // 3. Score tasks for each potential slot
    const minStart = fromMinuteOfDay !== undefined ? Math.max(dayStartMin, fromMinuteOfDay) : dayStartMin;
    const overflow: OverflowSuggestion[] = [];
    
    // Greedy placement with scoring
    const MAX_ITERATIONS = pendingTasks.length * 100 + 1; // Safeguard
    let iterations = 0;

    while (pendingTasks.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      let bestTaskIdx = -1;
      let bestSlotStart = -1;
      let bestScore = -Infinity;

      // Find the absolute best task + slot combination available
      for (let m = minStart; m < dayEndMin; m += 15) {
        // Skip if blocked
        if (blocks.some(b => m >= b.start_ts && m < b.end_ts)) continue;

        const currentEnergy = this.getEnergyBand(m, dayStartMin, dayEndMin);

        pendingTasks.forEach((t, idx) => {
          let score = 0;
          // Urgency
          const now = Date.now();
          if (t.due_ts && t.due_ts < now) score += weights.urgency * 40; // High multiplier for overdue
          else if (t.due_ts && t.due_ts < now + 86400000) score += weights.urgency * 8;
          
          // Importance
          score += weights.importance * (t.priority === 1 ? 10 : t.priority === 2 ? 5 : 2);
          
          // Energy fit
          if (t.energy_level === currentEnergy) score += weights.energy_fit * 5;
          
          // Time preference (Dynamic morning/evening relative to the day range)
          const midPoint = dayStartMin + (dayRange / 2);
          if (t.time_preference === 'morning' && m < midPoint) score += weights.time_pref_fit * 5;
          else if (t.time_preference === 'evening' && m >= midPoint) score += weights.time_pref_fit * 5;

          // Added context bonus logic per documentation
          if (blocks.length > 0) {
            const lastTask = blocks.filter(b => b.type === 'task').pop();
            if (lastTask && lastTask.end_ts === m && lastTask.energy_band === t.energy_level) {
              score += weights.context_bonus * 3;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestTaskIdx = idx;
            bestSlotStart = m;
          }
        });
      }

      if (bestTaskIdx > -1 && bestSlotStart > -1) {
        const t = pendingTasks[bestTaskIdx];
        const duration = t.is_splittable ? Math.min(t.remaining_estimate, 90) : t.remaining_estimate; 
        
        // Find next collision
        const nextBlock = blocks.filter(b => b.start_ts >= bestSlotStart).sort((a,b) => a.start_ts - b.start_ts)[0];
        const maxContiguousGap = (nextBlock ? nextBlock.start_ts : dayEndMin) - bestSlotStart;
        const fitDuration = Math.min(duration, maxContiguousGap);
        
        // Squeeze logic: We only schedule if it fits or if it's splittable
        // No automatic "now" forcing/trimming per user request
        const canFit = t.is_splittable 
          ? (fitDuration >= 15) 
          : (fitDuration >= t.remaining_estimate || t.priority === 1);

        if (canFit) {
          blocks.push({
            type: 'task',
            start_ts: bestSlotStart,
            end_ts: bestSlotStart + fitDuration,
            title: t.title + (fitDuration < t.remaining_estimate ? ' (Squeezed)' : ''),
            task_id: t.id,
            energy_band: t.energy_level
          });
          
          t.remaining_estimate -= fitDuration;
          if (t.remaining_estimate <= 0) {
            pendingTasks.splice(bestTaskIdx, 1);
          }
          // Resort blocks after adding one
          blocks.sort((a, b) => a.start_ts - b.start_ts);
        } else {
           const failedTask = pendingTasks.splice(bestTaskIdx, 1)[0];
           // Don't auto-schedule trimmed blocks anymore
           // Instead, record them as overflow suggestions so the UI can prompt the user
           overflow.push({ 
             task_id: failedTask.id, 
             action: 'trim', 
             suggested_estimate: Math.max(15, fitDuration)
           });
        }
      } else {
        break;
      }
    }

    // 4. Fill gaps with Flex Space (architectural requirement: 4 anchors taking total 15% of day)
    // We only add flex if there's space LEFT after tasks
    const flexMinutes = Math.round((dayRange * 0.15) / 4);
    const flexAnchors = [
       dayStartMin + Math.round(dayRange * 0.2),
       dayStartMin + Math.round(dayRange * 0.45),
       dayStartMin + Math.round(dayRange * 0.7),
       dayStartMin + Math.round(dayRange * 0.9)
    ];

    flexAnchors.forEach(m => {
      if (m >= minStart && m < dayEndMin) {
        // Find the first available slice of at least 15 min near this anchor
        // We look up to 60 mins around the anchor
        for (let offset = 0; offset <= 60; offset += 15) {
          const testStart = m + offset;
          if (testStart >= dayEndMin) break;
          const duration = Math.min(flexMinutes, dayEndMin - testStart);
          if (duration < 15) break;

          if (!blocks.some(b => testStart < b.end_ts && (testStart + duration) > b.start_ts)) {
            blocks.push({ type: 'flex', start_ts: testStart, end_ts: testStart + duration, title: 'Flex Space', energy_band: 'low' });
            break;
          }
        }
      }
    });

    // 5. Insert Microbreaks per Architecture specs
    blocks.sort((a, b) => a.start_ts - b.start_ts);
    
    for (let i = 0; i < blocks.length - 1; i++) {
        const current = blocks[i];
        const next = blocks[i+1];

        if (current.type === 'task' && next.type === 'task') {
             if (current.end_ts === next.start_ts) {
                 let contiguousDuration = current.end_ts - current.start_ts;
                 let j = i - 1;
                 while (j >= 0 && blocks[j].type === 'task' && blocks[j].end_ts === blocks[j+1].start_ts) {
                     contiguousDuration += (blocks[j].end_ts - blocks[j].start_ts);
                     j--;
                 }
                 
                 if (contiguousDuration >= 90) {
                     if (next.end_ts - next.start_ts > 15) {
                         next.start_ts += 5;
                         blocks.splice(i + 1, 0, {
                             type: 'break',
                             start_ts: current.end_ts,
                             end_ts: current.end_ts + 5,
                             title: 'Micro-break',
                             energy_band: 'low'
                         });
                         i++;
                     }
                 }
             }
        }
    }

    // 6. The Palate Cleanser: Insert 10m break between back-to-back High Energy tasks
    blocks.sort((a, b) => a.start_ts - b.start_ts);
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i];
      const next = blocks[i+1];

      if (current.type === 'task' && next.type === 'task' && 
          current.energy_band === 'high' && next.energy_band === 'high' &&
          current.end_ts === next.start_ts) {
        
        const cleanserDuration = 10;
        const wellnessNudges = getConfig().nudgeMessages.wellness;
        const nudges = Object.values(wellnessNudges).flat() as string[];
        const title = nudges.length > 0 ? nudges[Math.floor(Math.random() * nudges.length)] : 'Palate Cleanser (Stretch)';

        blocks.splice(i + 1, 0, {
          type: 'break',
          start_ts: current.end_ts,
          end_ts: current.end_ts + cleanserDuration,
          title: `Palate Cleanser: ${title}`,
          energy_band: 'low'
        });

        let collisionIdx = -1;
        for (let j = i + 2; j < blocks.length; j++) {
          const b = blocks[j];
          if (b.type === 'meeting' || b.type === 'lunch' || b.type === 'dinner' || b.type === 'flex') {
            collisionIdx = j;
            break;
          }
        }

        if (collisionIdx === -1) {
          for (let j = i + 2; j < blocks.length; j++) {
            blocks[j].start_ts += cleanserDuration;
            blocks[j].end_ts += cleanserDuration;
          }
        } else {
          for (let j = i + 2; j < collisionIdx; j++) {
            blocks[j].start_ts += cleanserDuration;
            blocks[j].end_ts += cleanserDuration;
            if (blocks[j].end_ts > blocks[collisionIdx].start_ts) {
               blocks[j].end_ts = blocks[collisionIdx].start_ts;
            }
          }
        }
        i++;
      }
    }

    // 7. Handle remaining overflow
    pendingTasks.forEach(t => {
      if (t.priority === 1) overflow.push({ task_id: t.id, action: 'trim', suggested_estimate: 15 });
      else overflow.push({ task_id: t.id, action: 'defer' });
    });

    blocks.sort((a, b) => a.start_ts - b.start_ts);

    // Convert to real timestamps using local midnight
    const [y, m, day] = dateStr.split('-').map(Number);
    const refTime = new Date(y, m - 1, day, 0, 0, 0).getTime();
    blocks.forEach(b => {
      b.start_ts = refTime + b.start_ts * 60000;
      b.end_ts = refTime + b.end_ts * 60000;
    });

    return { blocks, overflow };
  }

  public rescheduleFromNow(dateStr: string, tasks: Task[], events: Event[]): { blocks: ScheduleBlock[], overflow: OverflowSuggestion[] } {
    const nowMin = this.msToMinuteOfDay(Date.now(), dateStr);
    return this.designSchedule(dateStr, tasks, events, nowMin);
  }
}
