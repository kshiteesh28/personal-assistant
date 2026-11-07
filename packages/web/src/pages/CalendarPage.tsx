import { useState, useEffect } from 'react';
import { Calendar, Plus, MapPin, AlignLeft, X, Trash2, Clock } from 'lucide-react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

import { api } from '../services/api';
import { useEventStream } from '../services/sse';
import { OrganicContainer } from '../components/OrganicContainer';
import NegotiatorModal from '../components/NegotiatorModal';
import { hapticFeedback } from '../services/capacitor';

const defaultForm = { id: '', title: '', start_dt: '', end_dt: '', all_day: false, location: '', description: '' };

const toLocalISO = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export const CalendarPage = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModal] = useState(false);
  const [form, setForm] = useState({ ...defaultForm });
  const [isSaving, setIsSaving] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);

  const load = async () => {
    try {
      setLoading(true);
      const startMs = Date.now() - 30 * 86400000;
      const endMs   = Date.now() + 90 * 86400000;
      const res = await api.get<any[]>(`/api/events?start=${startMs}&end=${endMs}`);
      setEvents(res ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEventStream((type: string, payload: any) => {
    if ((type === 'data.changed' && payload?.entity === 'event') || type === 'schedule.reordered') load();
  });

  const openCreate = (startDt?: string, endDt?: string, allDay?: boolean) => {
    const now = new Date();
    const start = startDt ?? toLocalISO(new Date(Math.ceil(now.getTime() / 1800000) * 1800000));
    const end   = endDt   ?? toLocalISO(new Date(new Date(start).getTime() + 3600000));
    setForm({ ...defaultForm, start_dt: start, end_dt: end, all_day: allDay ?? false });
    setIsModal(true);
    hapticFeedback('light');
  };

  const openEdit = (event: any) => {
    setForm({
      id: event.id, title: event.title,
      start_dt: toLocalISO(new Date(event.start_ts)),
      end_dt:   toLocalISO(new Date(event.end_ts)),
      all_day: event.all_day, location: event.location ?? '', description: event.description ?? '',
    });
    setIsModal(true);
    hapticFeedback('light');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    const start_ts = new Date(form.start_dt).getTime();
    const end_ts = new Date(form.end_dt).getTime();
    
    if (start_ts < Date.now() - 30000 && !form.id) {
      alert('Cannot create an event in the past');
      setIsSaving(false);
      return;
    }

    const payload: any = {
      title: form.title,
      start_ts,
      end_ts,
      all_day:  form.all_day,
      ...(form.location    ? { location:    form.location }    : {}),
      ...(form.description ? { description: form.description } : {}),
    };

    try {
      if (form.id) { await api.put(`/api/events/${form.id}`, payload); }
      else         { await api.post('/api/events', payload); }
      setIsModal(false);
      hapticFeedback('medium');
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: form.id ? 'Event updated' : 'Event scheduled' } }));
      load();
    } catch (err: any) {
      if (err.status === 409 && err.task) {
        hapticFeedback('heavy');
        setConflictData({ task: err.task, event: { ...payload } });
        return;
      }
      alert(`Save failed: ${err.message}`);
    } finally { setIsSaving(false); }
  };

  const handleEventClick = (info: any) => {
    const ev = events.find(e => e.id === info.event.id);
    if (ev) openEdit(ev);
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!confirm(`Delete "${form.title}"?`)) return;
    try {
      await api.delete(`/api/events/${form.id}`);
      hapticFeedback('heavy');
      setIsModal(false); 
      load();
    } catch {}
  };

  const fcEvents = events.map(e => ({
    id: e.id, title: e.title,
    start: new Date(e.start_ts), end: new Date(e.end_ts), allDay: e.all_day,
    extendedProps: { location: e.location, description: e.description },
  }));

  const renderEventContent = (arg: any) => {
    return (
      <div style={{ width: '100%', height: '100%', padding: '1px' }}>
        <OrganicContainer 
          priority={2} 
          style={{ 
            width: '100%', 
            height: '100%', 
            padding: '4px 6px', 
            background: 'color-mix(in srgb, var(--color-blue) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-blue) 30%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-blue)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {arg.event.title}
          </div>
          {!arg.event.allDay && arg.timeText && (
            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
              {arg.timeText}
            </div>
          )}
        </OrganicContainer>
      </div>
    );
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.5rem, 5vw, 2.5rem)', fontWeight: 900, letterSpacing: '-0.04em', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Calendar size={28} color="var(--color-accent)" strokeWidth={2.5} />
            Calendar
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            {fcEvents.length} events categorized this quarter
          </p>
        </div>
        <button className="btn-primary" onClick={() => openCreate()} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.65rem 1.1rem', borderRadius: 'var(--chat-bubble-shape)' }}>
          <Plus size={18} /> New Event
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="skeleton" style={{ height: '500px', borderRadius: 'var(--chat-bubble-shape)' }} />
        </div>
      ) : (
        <div className="glass-card full-calendar-wrapper" style={{ height: 'calc(100vh - 200px)', minHeight: '600px', padding: '1rem', border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-xl)', borderRadius: 'var(--radius-xl)' }}>
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay'
            }}
            events={fcEvents}
            eventClick={handleEventClick}
            selectable={true}
            select={(info) => {
              openCreate(toLocalISO(info.start), toLocalISO(info.end), info.allDay);
              const api = info.view.calendar;
              api.unselect();
            }}
            height="100%"
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            allDaySlot={true}
            nowIndicator={true}
            eventClassNames="flowstate-event"
            eventContent={renderEventContent}
          />
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModal(false)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)' }}>
                  <Calendar size={20} />
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{form.id ? 'Edit Event' : 'New Event'}</h2>
              </div>
              <button onClick={() => setIsModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex' }}><X size={24} /></button>
            </div>
            
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Event Title *</label>
                <input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Design Strategy Meeting" autoFocus />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--color-surface)', borderRadius: 'var(--chat-bubble-shape)', border: '1px solid var(--glass-border)' }}>
                <div className="toggle-switch">
                  <input type="checkbox" checked={form.all_day} onChange={e => setForm(p => ({ ...p, all_day: e.target.checked }))} />
                  <span className="toggle-slider"></span>
                </div>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>All Day Event</span>
              </label>

              {!form.all_day && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={13} /> Start</label>
                    <input required type="datetime-local" value={form.start_dt} 
                      min={toLocalISO(new Date())}
                      onChange={e => setForm(p => ({ ...p, start_dt: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={13} /> End</label>
                    <input required type="datetime-local" value={form.end_dt} 
                      min={form.start_dt || toLocalISO(new Date())}
                      onChange={e => setForm(p => ({ ...p, end_dt: e.target.value }))} />
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14} /> Location</label>
                <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Meeting link or address…" />
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlignLeft size={14} /> Description</label>
                <textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Agenda, notes, or details…" style={{ resize: 'vertical' }} />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '0.75rem', fontWeight: 700 }} disabled={isSaving}>
                  {isSaving ? 'Scheduling…' : form.id ? 'Save Changes' : 'Confirm Event'}
                </button>
                {form.id && (
                  <button type="button" onClick={handleDelete} title="Delete Event" style={{ width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--color-red)', borderRadius: 'var(--chat-bubble-shape)', color: 'var(--color-red)', cursor: 'pointer' }}>
                    <Trash2 size={20} />
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={() => setIsModal(false)} style={{ padding: '0.75rem 1.25rem' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {conflictData && (
        <NegotiatorModal 
          conflictingTask={conflictData.task} 
          eventData={conflictData.event}
          onClose={() => setConflictData(null)}
          onResolve={() => {
            setConflictData(null);
            setIsModal(false);
            load();
          }}
        />
      )}
    </div>
  );
};

export default CalendarPage;
