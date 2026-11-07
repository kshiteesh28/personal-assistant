import { BaseRepository } from './base.repository';
import { randomUUID } from 'crypto';

export interface Checklist {
  id: string;
  name: string;
  items: string[];
  is_template: boolean;
  created_at: number;
}

export class ChecklistsRepository extends BaseRepository<Checklist> {
  constructor(db: import('bun:sqlite').Database) {
    super(db, 'checklists');
  }

  findAllRaw(): any[] {
    return this.db.query(`SELECT * FROM checklists ORDER BY created_at DESC`).all();
  }

  findAllParsed(): Checklist[] {
    return this.findAllRaw().map(r => ({
      ...r,
      items: JSON.parse(r.items),
      is_template: Boolean(r.is_template)
    }));
  }

  findByIdParsed(id: string): Checklist | null {
    const row = this.db.query<any, any>(`SELECT * FROM checklists WHERE id = $id`).get({ $id: id });
    if (!row) return null;
    return {
      ...row,
      items: JSON.parse(row.items),
      is_template: Boolean(row.is_template)
    };
  }

  create(name: string, items: string[], isTemplate: boolean = false): Checklist {
    const id = randomUUID();
    const created_at = Date.now();
    const itemsJson = JSON.stringify(items);

    this.db.query(`
      INSERT INTO checklists (id, name, items, is_template, created_at)
      VALUES ($id, $name, $items, $is_template, $created_at)
    `).run({
      $id: id,
      $name: name,
      $items: itemsJson,
      $is_template: isTemplate ? 1 : 0,
      $created_at: created_at
    });

    return { id, name, items, is_template: isTemplate, created_at };
  }

  update(id: string, name?: string, items?: string[]): Checklist | null {
    const existing = this.findByIdParsed(id);
    if (!existing) return null;

    const newName = name ?? existing.name;
    const newItems = items ? JSON.stringify(items) : JSON.stringify(existing.items);

    this.db.query(`
      UPDATE checklists SET name = $name, items = $items WHERE id = $id
    `).run({
      $id: id,
      $name: newName,
      $items: newItems
    });

    return this.findByIdParsed(id);
  }
}
