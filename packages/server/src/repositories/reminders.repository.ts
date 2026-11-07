import { Reminder } from '@secretary/shared';
import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export class RemindersRepository extends BaseRepository<Reminder> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'reminders');
  }

  findByStatus(status: string): Reminder[] {
    return this.db.query<Reminder, any>(`SELECT * FROM reminders WHERE status = $status ORDER BY trigger_ts ASC`).all({ $status: status });
  }

  findDue(nowMs: number): Reminder[] {
    return this.db.query<Reminder, any>(`
      SELECT * FROM reminders 
      WHERE (status = 'active' AND trigger_ts <= $now) 
         OR (status = 'snoozed' AND snooze_until_ts IS NOT NULL AND snooze_until_ts <= $now)
    `).all({ $now: nowMs });
  }

  advanceTrigger(id: string, nextTriggerTs: number): void {
    const now = Date.now();
    this.db.query(`
      UPDATE reminders 
      SET trigger_ts = $trigger_ts, status = 'active', snooze_until_ts = NULL, updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: id,
      $trigger_ts: nextTriggerTs,
      $updated_at: now
    });
  }

  create(data: Omit<Reminder, 'id' | 'created_at' | 'updated_at'>): Reminder {
    const now = Date.now();
    const id = randomUUID();
    const reminder: Reminder = {
      id,
      ...data,
      created_at: now,
      updated_at: now
    };

    this.db.query(`
      INSERT INTO reminders (id, title, trigger_ts, repeat_rule, linked_event_id, status, snooze_until_ts, created_at, updated_at)
      VALUES ($id, $title, $trigger_ts, $repeat_rule, $linked_event_id, $status, $snooze_until_ts, $created_at, $updated_at)
    `).run({
      $id: reminder.id,
      $title: reminder.title,
      $trigger_ts: reminder.trigger_ts,
      $repeat_rule: reminder.repeat_rule || null,
      $linked_event_id: reminder.linked_event_id || null,
      $status: reminder.status,
      $snooze_until_ts: reminder.snooze_until_ts || null,
      $created_at: reminder.created_at,
      $updated_at: reminder.updated_at
    });

    return reminder;
  }

  update(id: string, updates: Partial<Reminder>): Reminder | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updated_at: Date.now() };

    this.db.query(`
      UPDATE reminders SET
        title = $title, trigger_ts = $trigger_ts, repeat_rule = $repeat_rule,
        linked_event_id = $linked_event_id, status = $status, snooze_until_ts = $snooze_until_ts,
        updated_at = $updated_at
      WHERE id = $id
    `).run({
      $id: merged.id,
      $title: merged.title,
      $trigger_ts: merged.trigger_ts,
      $repeat_rule: merged.repeat_rule || null,
      $linked_event_id: merged.linked_event_id || null,
      $status: merged.status,
      $snooze_until_ts: merged.snooze_until_ts || null,
      $updated_at: merged.updated_at
    });

    return merged;
  }
}
