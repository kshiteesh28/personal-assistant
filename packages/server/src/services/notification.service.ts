import notifier from 'node-notifier';
import { logger } from '../config/logger';

export class NotificationService {
  public notify(title: string, message: string) {
    notifier.notify(
      {
        title,
        message,
        sound: true, 
        wait: false
      },
      (err: Error | null, _response: string) => {
        if (err) {
          logger.error('Notification failed:', err.message);
        }
      }
    );
  }
}
