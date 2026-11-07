import { NotesRepository } from '../repositories';
import { Note, NoteCreate } from '@secretary/shared';

export class NoteService {
  constructor(private notesRepo: NotesRepository) {}

  findAll(filters?: { q?: string; linked_event_id?: string }): Note[] {
    let notes: Note[] = [];
    if (filters?.q) {
      notes = this.notesRepo.search(filters.q);
    } else if (filters?.linked_event_id) {
      notes = this.notesRepo.findByEventId(filters.linked_event_id);
    } else {
      notes = this.notesRepo.findAll();
    }
    return notes;
  }

  findById(id: string): Note | null {
    return this.notesRepo.findById(id);
  }

  create(data: NoteCreate): Note {
    return this.notesRepo.create({
      ...data
    });
  }

  update(id: string, updates: Partial<Note>): Note | null {
    return this.notesRepo.update(id, updates);
  }

  delete(id: string): boolean {
    return this.notesRepo.delete(id);
  }
}
