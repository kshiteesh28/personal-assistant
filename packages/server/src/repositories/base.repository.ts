import { Database } from 'bun:sqlite';

export abstract class BaseRepository<T> {
  constructor(protected db: Database, protected tableName: string) {}

  findAll(): T[] {
    return this.db.query<T, any>(`SELECT * FROM ${this.tableName}`).all();
  }

  findById(id: string | number): T | null {
    return this.db.query<T, any>(`SELECT * FROM ${this.tableName} WHERE id = $id`).get({ $id: id }) || null;
  }

  delete(id: string | number): boolean {
    const info = this.db.query(`DELETE FROM ${this.tableName} WHERE id = $id`).run({ $id: id });
    return info.changes > 0;
  }
}
