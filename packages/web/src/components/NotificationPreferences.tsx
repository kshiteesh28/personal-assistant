import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function NotificationPreferences() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<any>('/api/config').then(setConfig).catch(console.error);
  }, []);

  const handleChange = (field: string, val: any) => {
    setConfig((prev: any) => ({ ...prev, [field]: val }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/config', config);
      alert('Preferences saved');
    } catch (e: any) {
      alert(`Error saving: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <div className="text-sec text-sm disabled">Loading preferences...</div>;

  return (
    <div className="surface-elevated p-6 rounded-xl border border-border mt-8">
      <h3 className="text-lg font-semibold text-primary mb-4">Notification & Nudge Preferences</h3>
      
      <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between">
          <span className="text-sec">Enable Proactive Nudges</span>
          <input 
            type="checkbox" 
            checked={config.proactiveNudgeEnabled} 
            onChange={(e) => handleChange('proactiveNudgeEnabled', e.target.checked)}
            className="w-5 h-5 accent-accent"
          />
        </label>
        
        <label className="flex flex-col gap-1">
          <span className="text-sec">Time to Nudge Idle Tasks (minutes)</span>
          <input 
            type="number" 
            value={config.nudgeFrequencyMinutes} 
            onChange={(e) => handleChange('nudgeFrequencyMinutes', parseInt(e.target.value))}
            className="w-24 px-3 py-1 border border-border rounded bg-surface text-primary"
          />
        </label>

        <button 
          onClick={save} 
          disabled={saving}
          className="btn-primary w-fit mt-2"
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
