export interface IntegrationPlugin {
  id: string;
  name: string;
  enabled: boolean;
  status: 'healthy' | 'error' | 'syncing' | 'disabled';
  lastSync?: number;

  getBriefContributions(dateStr: string): Promise<any[]>;
  sync?(): Promise<void>;
}

export class PluginRegistry {
  private plugins: Map<string, IntegrationPlugin> = new Map();

  register(plugin: IntegrationPlugin) {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): IntegrationPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): IntegrationPlugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabled(): IntegrationPlugin[] {
    return this.getAll().filter(p => p.enabled);
  }

  async getBriefContributions(dateStr: string): Promise<any[]> {
    const contributions = [];
    for (const plugin of this.getEnabled()) {
      try {
        const c = await plugin.getBriefContributions(dateStr);
        contributions.push(...c);
      } catch (e: any) {
        console.error(`Plugin ${plugin.name} brief contribution failed:`, e.message);
      }
    }
    return contributions;
  }
}

export const pluginRegistry = new PluginRegistry();

export * from './outlook.plugin';
export * from './loop.plugin';
export * from './jira.plugin';
