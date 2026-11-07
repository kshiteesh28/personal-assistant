import { IntegrationPlugin } from './plugin-registry';

export class LoopPlugin implements IntegrationPlugin {
  id = 'loop';
  name = 'Microsoft Loop';
  
  constructor(public enabled: boolean = false) {}

  get status(): 'healthy' | 'error' | 'syncing' | 'disabled' {
    return this.enabled ? 'healthy' : 'disabled';
  }

  async getBriefContributions(dateStr: string): Promise<any[]> {
    if (!this.enabled) return [];
    return [
      {
        provider: 'loop',
        type: 'action_items',
        data: {
          items: []
        }
      }
    ];
  }
}
