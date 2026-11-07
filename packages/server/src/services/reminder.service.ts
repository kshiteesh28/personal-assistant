import { RemindersRepository } from '../repositories';
import { Reminder, ReminderCreate } from '@secretary/shared';

export class ReminderService {
  constructor(private remindersRepo: RemindersRepository) {}

  findAll(filters?: { status?: string }): Reminder[] {
    if (filters?.status) {
      return this.remindersRepo.findByStatus(filters.status);
    }
    return this.remindersRepo.findAll();
  }

  findById(id: string): Reminder | null {
    return this.remindersRepo.findById(id);
  }

  create(data: ReminderCreate): Reminder {
    return this.remindersRepo.create({
      status: 'active',
      ...data
    });
  }

  update(id: string, updates: Partial<Reminder>): Reminder | null {
    return this.remindersRepo.update(id, updates);
  }

  delete(id: string): boolean {
    return this.remindersRepo.delete(id);
  }
}
