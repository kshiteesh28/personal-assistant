import { useState, useEffect } from 'react';
import { Plus, Coffee, BookOpen, Code2, Settings, Bed, Clock, CheckCircle2, Trash2, Star } from 'lucide-react';
import { api } from '../services/api';

interface DowntimeItem { id: string; title: string; category: string; estimated_mins: number; priority: number; status: string; }

const CATEGORY_META: Record<string, { icon: React.ReactNode; color: string }> = {
  research: { icon: <BookOpen size={14} />, color: 'var(--color-blue)' },
  reading:  { icon: <BookOpen size={14} />, color: 'var(--color-purple)' },
  coding:   { icon: <Code2 size={14} />,    color: 'var(--color-green)' },
  admin:    { icon: <Settings size={14} />, color: 'var(--color-orange)' },
  rest:     { icon: <Bed size={14} />,      color: 'var(--color-text-tertiary)' },
};

export default function DowntimePage() {
  const [items, setItems]     = useState<DowntimeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState({ title: '', category: 'research', estimated_mins: 30, priority: 2 });
  const [isAdding, setIsAdding] = useState(false);

  const load = async () => { setLoading(true); try { setItems(await api.get<DowntimeItem[]>('/api/downtime')); } catch {} finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.title.trim()) return;
    setIsAdding(true);
    try { await api.post('/api/downtime', form); setForm({ title: '', category: 'research', estimated_mins: 30, priority: 2 }); load(); }
    catch { alert('Failed to add item'); } finally { setIsAdding(false); }
  };
  const complete = async (id: string) => { try { await api.post(`/api/downtime/${id}/complete`, {}); load(); } catch { alert('Action failed'); } };
  const del      = async (id: string) => { if (!confirm('Remove this item?')) return; try { await api.delete(`/api/downtime/${id}`); load(); } catch {} };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Downtime Pipeline</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Activities for unexpected free time</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: '1.5rem', alignItems: 'start' }}>
        {/* List */}
        <div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '76px', borderRadius: 'var(--chat-bubble-shape)' }} />)}
            </div>
          ) : items.length === 0 ? (
            <div className="glass-card" style={{ padding: '4rem 2rem', textAlign: 'center', border: '2px dashed var(--color-border)' }}>
              <Coffee size={40} color="var(--color-text-tertiary)" style={{ margin: '0 auto 1rem' }} />
              <p style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>Your pipeline is empty.</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem' }}>Add things you'd like to do when you have unexpected free time.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {items.map(item => {
                const cm = CATEGORY_META[item.category] ?? CATEGORY_META['rest'];
                return (
                  <div key={item.id} className="glass-card" style={{ padding: '1rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--chat-bubble-shape)', background: `color-mix(in srgb, ${cm.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cm.color, flexShrink: 0 }}>
                      {cm.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.2rem' }}>{item.title}</div>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', background: `color-mix(in srgb, ${cm.color} 10%, transparent)`, color: cm.color, padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-pill)', fontWeight: 600 }}>{item.category}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '2px' }}><Clock size={10} />{item.estimated_mins}m</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '2px' }}><Star size={10} />{item.priority}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                      <button onClick={() => complete(item.id)} title="Complete" style={{ background: 'color-mix(in srgb, var(--color-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-green) 25%, transparent)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}><CheckCircle2 size={14} color="var(--color-green)" /></button>
                      <button onClick={() => del(item.id)} title="Delete" style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}><Trash2 size={14} color="var(--color-red)" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add form */}
        <div className="glass-card" style={{ padding: '1.25rem', position: 'sticky', top: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={16} /> Add to Pipeline
          </h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            <div className="form-group"><label>What would you do?</label><input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Read Deep Work ch.2" /></div>
            <div className="form-group"><label>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="research">Research</option><option value="reading">Reading</option><option value="coding">Coding</option><option value="admin">Admin</option><option value="rest">Rest / Personal</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group"><label>Minutes</label><input type="number" min={5} max={180} value={form.estimated_mins} onChange={e => setForm(f => ({ ...f, estimated_mins: +e.target.value }))} /></div>
              <div className="form-group"><label>Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: +e.target.value }))}>
                  <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
                </select>
              </div>
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: '0.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} disabled={isAdding}>
              <Plus size={15} />{isAdding ? 'Adding…' : 'Add Activity'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
