import { Note } from '@secretary/shared';
import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export class NotesRepository extends BaseRepository<Note> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'notes');
  }

  private syncFts(id: string, title: string, body: string) {
    this.db.query(`DELETE FROM notes_fts WHERE id = $id`).run({ $id: id });
    this.db.query(`INSERT INTO notes_fts(id, title, body) VALUES ($id, $title, $body)`).run({
      $id: id,
      $title: title,
      $body: body
    });
  }

  search(query: string): Note[] {
    if (!query) return this.findAll();
    const cleanQuery = query.replace(/"/g, '""');

    try {
      const noteIds = this.db.query<{id: string}, any>(`
        SELECT id FROM notes_fts WHERE notes_fts MATCH $query ORDER BY rank
      `).all({ $query: `"${cleanQuery}"*` });

      const notes: Note[] = [];
      const getStmt = this.db.query<Note, any>(`SELECT * FROM notes WHERE id = $id`);
      for (const r of noteIds) {
        const n = getStmt.get({ $id: r.id });
        if (n) notes.push(n);
      }
      return notes;
    } catch (e) {
      // fallback
      return this.db.query<Note, any>(`
        SELECT * FROM notes WHERE title LIKE $q OR body LIKE $q
      `).all({ $q: `%${query}%` });
    }
  }

  findByEventId(eventId: string): Note[] {
    return this.db.query<Note, any>(`SELECT * FROM notes WHERE linked_event_id = $eventId`).all({ $eventId: eventId });
  }

  create(data: Omit<Note, 'id' | 'created_at' | 'updated_at'>): Note {
    const now = Date.now();
    const id = randomUUID();
    const note: Note = {
      id,
      ...data,
      created_at: now,
      updated_at: now
    };

    this.db.transaction(() => {
      this.db.query(`
        INSERT INTO notes (id, title, body, linked_event_id, created_at, updated_at)
        VALUES ($id, $title, $body, $linked_event_id, $created_at, $updated_at)
      `).run({
        $id: note.id,
        $title: note.title,
        $body: note.body,
        $linked_event_id: note.linked_event_id || null,
        $created_at: note.created_at,
        $updated_at: note.updated_at
      });
      this.syncFts(note.id, note.title, note.body);
    })();

    return note;
  }

  update(id: string, updates: Partial<Note>): Note | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updated_at: Date.now() };

    this.db.transaction(() => {
      this.db.query(`
        UPDATE notes SET
          title = $title, body = $body, linked_event_id = $linked_event_id, updated_at = $updated_at
        WHERE id = $id
      `).run({
        $id: merged.id,
        $title: merged.title,
        $body: merged.body,
        $linked_event_id: merged.linked_event_id || null,
        $updated_at: merged.updated_at
      });

      this.syncFts(merged.id, merged.title, merged.body);
    })();

    return merged;
  }

  delete(id: string): boolean {
    let success = false;
    this.db.transaction(() => {
      this.db.query(`DELETE FROM notes_fts WHERE id = $id`).run({ $id: id });
      const info = this.db.query(`DELETE FROM notes WHERE id = $id`).run({ $id: id });
      success = info.changes > 0;
    })();
    return success;
  }
}
