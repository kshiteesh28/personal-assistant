import { IntegrationPlugin } from './plugin-registry';

export class OutlookPlugin implements IntegrationPlugin {
  id = 'outlook';
  name = 'Microsoft Outlook';
  
  constructor(public enabled: boolean = false) {}

  get status(): 'healthy' | 'error' | 'syncing' | 'disabled' {
    return this.enabled ? 'healthy' : 'disabled';
  }

  async getBriefContributions(dateStr: string): Promise<any[]> {
    if (!this.enabled) return [];
    return [
      {
        provider: 'outlook',
        type: 'important_emails',
        data: {
          count: 0,
          items: []
        }
      }
    ];
  }
}
