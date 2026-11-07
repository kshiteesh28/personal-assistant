import { useState, useEffect } from 'react';
import { Plus, Bell, BellOff, Clock, RefreshCw, Trash2, Pencil, X } from 'lucide-react';
import { api } from '../services/api';
import { OrganicContainer } from '../components/OrganicContainer';
export const RemindersPage = () => {
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isModalOpen, setIsModal] = useState(false);
  const [form, setForm]           = useState({ id: '', title: '', trigger_dt: '', repeat_rule: '' });
  const [isSaving, setIsSaving]   = useState(false);

  const load = async () => {
    try { setLoading(true); setReminders(await api.get<any[]>('/api/reminders')); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm({ id: '', title: '', trigger_dt: new Date(Date.now() + 3600000).toISOString().slice(0,16), repeat_rule: '' }); setIsModal(true); };
  const openEdit   = (r: any) => { setForm({ id: r.id, title: r.title, trigger_dt: new Date(r.trigger_ts).toISOString().slice(0,16), repeat_rule: r.repeat_rule ?? '' }); setIsModal(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.title.trim() || !form.trigger_dt) return;
    setIsSaving(true);
    try {
      const ts = new Date(form.trigger_dt).getTime();
      const payload = { title: form.title, trigger_ts: ts, ...(form.repeat_rule ? { repeat_rule: form.repeat_rule } : {}) };
      if (form.id) await api.put(`/api/reminders/${form.id}`, payload);
      else await api.post('/api/reminders', payload);
      setIsModal(false);
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: form.id ? 'Reminder updated' : 'Reminder created' } }));
      load();
    } catch (err: any) { alert(`Save failed: ${err.message}`); } finally { setIsSaving(false); }
  };

  const dismiss = async (id: string) => { await api.patch(`/api/reminders/${id}`, { status: 'dismissed' }); load(); };
  const snooze  = async (id: string) => { await api.patch(`/api/reminders/${id}`, { status: 'snoozed', snooze_until_ts: Date.now() + 15 * 60000 }); load(); };
  const del     = async (id: string) => { if (!confirm('Delete this reminder?')) return; await api.delete(`/api/reminders/${id}`); load(); };

  const active  = reminders.filter(r => r.status === 'active');
  const snoozed = reminders.filter(r => r.status === 'snoozed');
  const past    = reminders.filter(r => r.status === 'dismissed');

  const RCard = ({ r }: { r: any }) => {
    const isSnoozed = r.status === 'snoozed';
    return (
      <OrganicContainer priority={3} className="glass-card" style={{ padding: '1rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', animationDelay: `${Math.random() * 2}s` }}>
        <div style={{ width: 40, height: 40, borderRadius: 'var(--chat-bubble-shape, 50%)', background: isSnoozed ? 'color-mix(in srgb, var(--color-text-tertiary) 12%, transparent)' : 'color-mix(in srgb, var(--color-orange) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isSnoozed ? <BellOff size={18} color="var(--color-text-tertiary)" /> : <Bell size={18} color="var(--color-orange)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{r.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={11} />
            {isSnoozed && r.snooze_until_ts ? `Snoozed until ${new Date(r.snooze_until_ts).toLocaleString()}` : new Date(r.trigger_ts).toLocaleString()}
            {r.repeat_rule && ` · ${r.repeat_rule}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
          <button onClick={() => openEdit(r)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape, 50%)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}><Pencil size={13} color="var(--color-text-secondary)" /></button>
          {r.status === 'active' && <button onClick={() => snooze(r.id)} title="Snooze 15m" style={{ padding: '0 0.5rem', height: 32, background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--task-radius-low, 2rem)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>+15m</button>}
          <button onClick={() => dismiss(r.id)} title="Dismiss" style={{ background: 'color-mix(in srgb, var(--color-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-green) 25%, transparent)', borderRadius: 'var(--task-radius-low, 2rem)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-green)', fontFamily: 'inherit', padding: '0 0.5rem', height: 32 }}>Done</button>
          <button onClick={() => del(r.id)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape, 50%)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}><Trash2 size={13} color="var(--color-red)" /></button>
        </div>
      </OrganicContainer>
    );
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Reminders</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>{active.length} active · {snoozed.length} snoozed</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '0.5rem 0.9rem' }}><RefreshCw size={14} /> Refresh</button>
          <button className="btn-primary" onClick={openCreate} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', padding: '0.5rem 1rem' }}><Plus size={16} /> New</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--chat-bubble-shape)' }} />)}
        </div>
      ) : active.length === 0 && snoozed.length === 0 ? (
        <div className="glass-card" style={{ padding: '4rem 2rem', textAlign: 'center', border: '2px dashed var(--color-border)' }}>
          <Bell size={40} color="var(--color-text-tertiary)" style={{ margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>No active reminders</p>
          <button className="btn-primary" onClick={openCreate} style={{ marginTop: '1rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}><Plus size={14} /> Add Reminder</button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>Active</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{active.map(r => <RCard key={r.id} r={r} />)}</div>
            </section>
          )}
          {snoozed.length > 0 && (
            <section style={{ marginBottom: '1.5rem', opacity: 0.7 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>Snoozed</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{snoozed.map(r => <RCard key={r.id} r={r} />)}</div>
            </section>
          )}
          {past.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--color-text-tertiary)', userSelect: 'none', marginBottom: '0.5rem' }}>Dismissed ({past.length})</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: 0.45, marginTop: '0.5rem' }}>{past.map(r => <RCard key={r.id} r={r} />)}</div>
            </details>
          )}
        </>
      )}

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{form.id ? 'Edit Reminder' : 'New Reminder'}</h2>
              <button onClick={() => setIsModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: '4px' }}><X size={20} color="var(--color-text-tertiary)" /></button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              <div className="form-group"><label>Title *</label><input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Call dentist…" autoFocus /></div>
              <div className="form-group"><label>Date & Time *</label><input type="datetime-local" required value={form.trigger_dt} min={new Date().toISOString().slice(0,16)} onChange={e => setForm(p => ({ ...p, trigger_dt: e.target.value }))} /></div>
              <div className="form-group"><label>Repeat</label>
                <select value={form.repeat_rule} onChange={e => setForm(p => ({ ...p, repeat_rule: e.target.value }))}>
                  <option value="">No repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isSaving}>{isSaving ? 'Saving…' : form.id ? 'Save Changes' : 'Create Reminder'}</button>
                <button type="button" className="btn-secondary" onClick={() => setIsModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemindersPage;
