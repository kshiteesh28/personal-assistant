import { IntegrationPlugin } from './plugin-registry';

export class JiraPlugin implements IntegrationPlugin {
  id = 'jira';
  name = 'Jira';
  
  constructor(public enabled: boolean = false) {}

  get status(): 'healthy' | 'error' | 'syncing' | 'disabled' {
    return this.enabled ? 'healthy' : 'disabled';
  }

  async getBriefContributions(dateStr: string): Promise<any[]> {
    if (!this.enabled) return [];
    return [
      {
        provider: 'jira',
        type: 'assigned_tickets',
        data: {
          items: []
        }
      }
    ];
  }
}
