import { useState, useEffect, useRef } from 'react';
import { Plus, Search, StickyNote, Pencil, Trash2, X } from 'lucide-react';
import { api } from '../services/api';
import { OrganicContainer } from '../components/OrganicContainer';
export const NotesPage = () => {
  const [notes, setNotes]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isModalOpen, setIsModal] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [form, setForm]           = useState({ id: '', title: '', body: '', linked_event_id: '' });
  const [viewNote, setViewNote]   = useState<any | null>(null);
  const [isSaving, setIsSaving]   = useState(false);
  const [search, setSearch]       = useState('');
  const textareaRef               = useRef<HTMLTextAreaElement>(null);

  const load = async () => { try { setLoading(true); setNotes(await api.get<any[]>('/api/notes')); } catch {} finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (isModalOpen && textareaRef.current) setTimeout(() => textareaRef.current?.focus(), 100); }, [isModalOpen]);

  const openCreate = () => { setForm({ id: '', title: '', body: '', linked_event_id: '' }); setIsModal(true); };
  const openEdit   = (n: any) => { setForm({ id: n.id, title: n.title, body: n.body ?? '', linked_event_id: n.linked_event_id ?? '' }); setIsModal(true); };
  const openView   = (n: any) => { setViewNote(n); setIsViewOpen(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.title.trim()) return;
    setIsSaving(true);
    try {
      const payload = { title: form.title, body: form.body, ...(form.linked_event_id ? { linked_event_id: form.linked_event_id } : {}) };
      if (form.id) await api.put(`/api/notes/${form.id}`, payload);
      else await api.post('/api/notes', payload);
      setIsModal(false);
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: form.id ? 'Note updated' : 'Note created' } }));
      load();
    } catch (err: any) { alert(`Save failed: ${err.message}`); } finally { setIsSaving(false); }
  };

  const del = async (id: string, e: React.MouseEvent) => { e.stopPropagation(); if (!confirm('Delete this note?')) return; await api.delete(`/api/notes/${id}`); load(); };
  const filtered = notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase()) || (n.body ?? '').toLowerCase().includes(search.toLowerCase()));

  // Pastel card tints cycling through accent colors
  const tints = [
    'color-mix(in srgb, var(--color-blue) 5%, var(--glass-bg))',
    'color-mix(in srgb, var(--color-purple) 5%, var(--glass-bg))',
    'color-mix(in srgb, var(--color-green) 5%, var(--glass-bg))',
    'color-mix(in srgb, var(--color-orange) 5%, var(--glass-bg))',
  ];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Notes</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>{notes.length} notes</p>
        </div>
        <button className="btn-primary" onClick={openCreate} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
          <Plus size={16} /> New Note
        </button>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '1.25rem', maxWidth: '420px' }}>
        <Search size={15} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
        <input type="search" placeholder="Search notes…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2.25rem' }} />
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: '160px', borderRadius: 'var(--chat-bubble-shape)' }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
          {filtered.map((n, i) => (
            <OrganicContainer priority={2} key={n.id} className="glass-card" onClick={() => openView(n)} style={{ padding: '1.25rem', cursor: 'pointer', background: tints[i % tints.length], position: 'relative', minHeight: '140px', display: 'flex', flexDirection: 'column', animationDelay: `${Math.random()}s` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <StickyNote size={14} color="var(--color-text-tertiary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <h3 style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3, flex: 1 }}>{n.title}</h3>
              </div>
              {n.body
                ? <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.55, flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' as any }}>{n.body}</p>
                : <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic', flex: 1 }}>Empty note…</p>
              }
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>{new Date(n.updated_at).toLocaleDateString()}</span>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button onClick={e => { e.stopPropagation(); openEdit(n); }} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape, 50%)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}><Pencil size={12} color="var(--color-text-secondary)" /></button>
                  <button onClick={e => del(n.id, e)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape, 50%)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}><Trash2 size={12} color="var(--color-red)" /></button>
                </div>
              </div>
            </OrganicContainer>
          ))}
        </div>
      )}

      {/* View modal */}
      {isViewOpen && viewNote && (
        <div className="modal-overlay" onClick={() => setIsViewOpen(false)}>
          <div className="modal" style={{ maxWidth: '660px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{viewNote.title}</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-secondary" onClick={() => { setIsViewOpen(false); openEdit(viewNote); }} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', padding: '0.4rem 0.7rem' }}><Pencil size={13} /> Edit</button>
                <button onClick={() => setIsViewOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: '4px' }}><X size={20} color="var(--color-text-tertiary)" /></button>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginBottom: '1rem' }}>{new Date(viewNote.updated_at).toLocaleString()}</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.95rem', maxHeight: '60vh', overflowY: 'auto' }}>{viewNote.body || <em style={{ color: 'var(--color-text-tertiary)' }}>Empty note</em>}</div>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModal(false)}>
          <div className="modal" style={{ display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{form.id ? 'Edit Note' : 'New Note'}</h2>
              <button onClick={() => setIsModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: '4px' }}><X size={20} color="var(--color-text-tertiary)" /></button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="form-group"><label>Title *</label><input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Note title…" autoFocus /></div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }} className="form-group"><label>Content</label><textarea ref={textareaRef} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} placeholder="Write your note here…" style={{ flex: 1, resize: 'none', fontFamily: 'var(--font-sans)', fontSize: '0.95rem', lineHeight: 1.6, minHeight: '200px' }} /></div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={isSaving}>{isSaving ? 'Saving…' : form.id ? 'Save Changes' : 'Create Note'}</button>
                <button type="button" className="btn-secondary" onClick={() => setIsModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotesPage;
