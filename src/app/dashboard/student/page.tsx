'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

type RequestStatus = 'Pending' | 'Under Review' | 'Recommended' | 'Returned for Correction' | 'Approved' | 'Rejected';
type AttendanceRow = { id: string; user_id: string; status?: string | null; attended?: boolean | null };
type EventRequest = {
  id: string;
  user_id: string;
  reference_number: string;
  title: string;
  organizer: string;
  category: string;
  venue: string;
  start_date: string;
  end_date: string;
  purpose: string;
  document_url: string | null;
  status: RequestStatus;
  created_at: string;
  updated_at?: string | null;
};

type FormValues = {
  title: string;
  organizer: string;
  category: string;
  venue: string;
  startDate: string;
  endDate: string;
  purpose: string;
  documentUrl: string;
};

const emptyForm: FormValues = {
  title: '', organizer: '', category: '', venue: '', startDate: '', endDate: '', purpose: '', documentUrl: '',
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createBrowserClient(supabaseUrl, supabaseAnonKey)
  : null;

const overlapStatuses = new Set(['Pending', 'Under Review', 'Recommended', 'Approved']);
const statusStyles: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800 ring-amber-200',
  'Under Review': 'bg-blue-100 text-blue-800 ring-blue-200',
  Recommended: 'bg-violet-100 text-violet-800 ring-violet-200',
  'Returned for Correction': 'bg-orange-100 text-orange-800 ring-orange-200',
  Approved: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  Rejected: 'bg-rose-100 text-rose-800 ring-rose-200',
};

function makeReferenceNumber() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `CG-${new Date().getFullYear()}-${suffix}`;
}

function isOverlap(start: string, end: string, otherStart: string, otherEnd: string) {
  return start <= otherEnd && end >= otherStart;
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span>{children}</label>;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50';

export default function StudentDashboardPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState('Student');
  const [studentEmail, setStudentEmail] = useState('');
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [requests, setRequests] = useState<EventRequest[]>([]);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reference, setReference] = useState('');
  const [activeSection, setActiveSection] = useState<'overview' | 'apply' | 'requests'>('overview');

  const loadDashboard = useCallback(async () => {
    if (!supabase) {
      setPageError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, or adapt this page to your existing backend.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setPageError('');
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setPageError('Please sign in with your student account to view your dashboard.');
      setLoading(false);
      return;
    }
    const user = authData.user;
    setUserId(user.id);
    setStudentEmail(user.email ?? '');
    const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
    setStudentName(typeof metadataName === 'string' && metadataName.trim() ? metadataName : (user.email?.split('@')[0] ?? 'Student'));

    const [attendanceResult, requestsResult] = await Promise.all([
      supabase.from('attendance_records').select('id,user_id,status,attended').eq('user_id', user.id),
      supabase.from('event_applications').select('id,user_id,reference_number,title,organizer,category,venue,start_date,end_date,purpose,document_url,status,created_at,updated_at').eq('user_id', user.id).order('created_at', { ascending: false }),
    ]);
    if (attendanceResult.error) setPageError(`Could not load attendance: ${attendanceResult.error.message}`);
    else setAttendanceRows((attendanceResult.data ?? []) as AttendanceRow[]);
    if (requestsResult.error) setPageError((current) => current ? `${current} · Could not load requests: ${requestsResult.error.message}` : `Could not load requests: ${requestsResult.error.message}`);
    else setRequests((requestsResult.data ?? []) as EventRequest[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const attendedCount = useMemo(() => attendanceRows.filter((row) => {
    if (typeof row.attended === 'boolean') return row.attended;
    return ['present', 'attended', 'late'].includes((row.status ?? '').toLowerCase());
  }).length, [attendanceRows]);
  const attendancePercent = attendanceRows.length ? Math.round((attendedCount / attendanceRows.length) * 100) : 0;
  const eligible = attendancePercent >= 75;

  const updateForm = (key: keyof FormValues, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setReference('');
    if (!supabase || !userId) {
      setNotice({ type: 'error', text: 'You must be signed in and have a configured backend before submitting.' });
      return;
    }
    if (form.endDate < form.startDate) {
      setNotice({ type: 'error', text: 'The end date must be on or after the start date.' });
      return;
    }
    if (form.documentUrl.trim()) {
      try {
        const parsed = new URL(form.documentUrl.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
      } catch {
        setNotice({ type: 'error', text: 'Enter a valid document URL starting with https:// or http://.' });
        return;
      }
    }

    setSubmitting(true);
    try {
      // Refresh from the database before checking overlaps; server-side/database enforcement is also required.
      const { data: existing, error: overlapFetchError } = await supabase
        .from('event_applications')
        .select('id,title,start_date,end_date,status')
        .eq('user_id', userId);
      if (overlapFetchError) throw new Error(`Could not validate date conflicts: ${overlapFetchError.message}`);
      const conflict = (existing ?? []).find((item: any) =>
        overlapStatuses.has(String(item.status)) && isOverlap(form.startDate, form.endDate, item.start_date, item.end_date));
      if (conflict) {
        setNotice({ type: 'error', text: `These dates overlap with “${conflict.title}” (${conflict.start_date} to ${conflict.end_date}). Please choose different dates.` });
        setSubmitting(false);
        return;
      }

      let saved: EventRequest | null = null;
      let lastError: string | null = null;
      // Retry reference collisions; the database should have a UNIQUE constraint on reference_number.
      for (let attempt = 0; attempt < 4; attempt++) {
        const ref = makeReferenceNumber();
        const { data, error } = await supabase.from('event_applications').insert({
          user_id: userId,
          reference_number: ref,
          title: form.title.trim(),
          organizer: form.organizer.trim(),
          category: form.category,
          venue: form.venue.trim(),
          start_date: form.startDate,
          end_date: form.endDate,
          purpose: form.purpose.trim(),
          document_url: form.documentUrl.trim() || null,
          status: 'Pending',
        }).select('id,user_id,reference_number,title,organizer,category,venue,start_date,end_date,purpose,document_url,status,created_at,updated_at').single();
        if (!error) { saved = data as EventRequest; break; }
        lastError = error.message;
        if (!/duplicate|unique/i.test(error.message)) break;
      }
      if (!saved) throw new Error(lastError || 'The application could not be saved. Please try again.');
      setReference(saved.reference_number);
      setNotice({ type: 'success', text: 'Your application was submitted successfully. Save your reference number for future tracking.' });
      setForm(emptyForm);
      await loadDashboard();
      setActiveSection('requests');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Something went wrong while submitting your application.' });
    } finally {
      setSubmitting(false);
    }
  }

  const navItems = [
    { id: 'overview' as const, label: 'Overview', icon: '◫' },
    { id: 'apply' as const, label: 'Apply for event', icon: '＋' },
    { id: 'requests' as const, label: 'My requests', icon: '▤' },
  ];

  return (
    <main className="min-h-screen bg-[#f5f7ff] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col md:flex-row">
        <aside className="w-full shrink-0 bg-[#171c4a] px-5 py-6 text-white md:min-h-screen md:w-64 md:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-400 to-indigo-400 text-xl font-black shadow-lg">C</div>
            <div><p className="text-lg font-extrabold tracking-tight">CampusGate</p><p className="text-xs text-indigo-200">Student portal</p></div>
          </div>
          <div className="mt-9 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-pink-400 text-sm font-extrabold text-indigo-950">{studentName.slice(0, 1).toUpperCase()}</div>
            <p className="mt-3 truncate font-semibold">{studentName}</p><p className="mt-1 truncate text-xs text-indigo-200">{studentEmail || 'Student account'}</p>
            <span className="mt-3 inline-flex rounded-full bg-indigo-300/15 px-2.5 py-1 text-[11px] font-semibold text-indigo-100">Student account</span>
          </div>
          <p className="mb-3 mt-8 text-[10px] font-bold uppercase tracking-[.2em] text-indigo-300">Workspace</p>
          <nav className="flex gap-2 overflow-x-auto md:flex-col" aria-label="Student navigation">
            {navItems.map((item) => <button key={item.id} onClick={() => setActiveSection(item.id)} className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${activeSection === item.id ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-950/20' : 'text-indigo-100 hover:bg-white/10'}`}><span className="grid h-6 w-6 place-items-center rounded-lg bg-white/10 text-lg">{item.icon}</span>{item.label}</button>)}
          </nav>
          <div className="mt-10 hidden rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-indigo-400/10 p-4 md:block"><div className="text-xl">✦</div><p className="mt-2 text-sm font-bold">Your campus, in one place</p><p className="mt-1 text-xs leading-5 text-indigo-200">Track attendance and keep your event requests organized.</p></div>
        </aside>

        <section className="min-w-0 flex-1 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-sm font-semibold text-indigo-600">STUDENT SPACE / {activeSection.toUpperCase()}</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{activeSection === 'apply' ? 'Apply for an event' : activeSection === 'requests' ? 'My requests' : `Hey, ${studentName.split(' ')[0]}! 👋`}</h1><p className="mt-2 text-sm text-slate-500">{activeSection === 'overview' ? 'Here’s your attendance and application activity at a glance.' : activeSection === 'apply' ? 'Share the event details below to start your application.' : 'Follow the progress of your event applications.'}</p></div>
            <button onClick={() => void loadDashboard()} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50">↻ Refresh</button>
          </header>

          {pageError && <div role="alert" className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p className="font-bold">Dashboard needs attention</p><p className="mt-1">{pageError}</p><p className="mt-2 text-xs">Expected tables: <code>attendance_records</code> and <code>event_applications</code>, with row-level security restricting each student to their own records.</p></div>}
          {notice && <div role="status" className={`mb-6 rounded-2xl border p-4 text-sm ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}><p className="font-bold">{notice.type === 'success' ? 'All set!' : 'Please check this'}</p><p className="mt-1">{notice.text}</p>{reference && <div className="mt-3 flex flex-wrap items-center gap-3"><code className="rounded-lg border border-emerald-200 bg-white px-3 py-2 font-bold tracking-wider">{reference}</code><button onClick={() => { void navigator.clipboard?.writeText(reference); }} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Copy reference</button></div>}</div>}

          {activeSection === 'overview' && <>
            <div className="relative mb-6 overflow-hidden rounded-[28px] bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 p-6 text-white shadow-xl shadow-indigo-200 sm:p-8"><div className="relative z-10 max-w-xl"><span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold">YOUR CAMPUS SNAPSHOT</span><h2 className="mt-4 text-2xl font-black sm:text-3xl">Small steps, great progress.</h2><p className="mt-2 max-w-md text-sm leading-6 text-indigo-100">Stay on top of your attendance and manage event applications without the paperwork.</p><button onClick={() => setActiveSection('apply')} className="mt-5 rounded-xl bg-white px-4 py-3 text-sm font-bold text-indigo-700 shadow-sm transition hover:-translate-y-0.5">＋ Start an application</button></div><div className="pointer-events-none absolute -right-8 -top-14 h-56 w-56 rounded-full border-[30px] border-white/10"/><div className="pointer-events-none absolute bottom-[-75px] right-24 h-48 w-48 rounded-full bg-pink-300/20 blur-2xl"/><div className="absolute right-8 top-8 hidden text-6xl sm:block">✦</div></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Attendance</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-xl">◉</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : `${attendancePercent}%`}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${attendancePercent}%` }}/></div><p className="mt-2 text-xs text-slate-500">{attendedCount} attended of {attendanceRows.length} recorded classes</p></div>
              <div className={`rounded-2xl border p-5 shadow-sm ${eligible ? 'border-emerald-100 bg-white' : 'border-amber-100 bg-white'}`}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Eligibility</span><span className={`grid h-10 w-10 place-items-center rounded-xl text-xl ${eligible ? 'bg-emerald-50' : 'bg-amber-50'}`}>{eligible ? '✓' : '!'}</span></div><p className="mt-4 text-2xl font-black">{loading ? 'Checking…' : eligible ? 'Eligible' : 'Below target'}</p><span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${eligible ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{attendancePercent}% / 75% required</span><p className="mt-2 text-xs text-slate-500">Based on recorded attendance</p></div>
              <div className="rounded-2xl border border-fuchsia-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Applications</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-fuchsia-50 text-xl">▤</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : requests.length}</p><p className="mt-2 text-xs text-slate-500">Total submitted requests</p><button onClick={() => setActiveSection('requests')} className="mt-3 text-xs font-bold text-fuchsia-700 hover:underline">View request history →</button></div>
              <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Awaiting review</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-xl">◷</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : requests.filter((request) => ['Pending', 'Under Review'].includes(request.status)).length}</p><p className="mt-2 text-xs text-slate-500">Pending or under review</p><button onClick={() => setActiveSection('requests')} className="mt-3 text-xs font-bold text-sky-700 hover:underline">Check status →</button></div>
            </div>
            <div className="mt-7 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-extrabold">Recent applications</h3><p className="mt-1 text-sm text-slate-500">Your latest event requests</p></div><button onClick={() => setActiveSection('requests')} className="text-sm font-bold text-indigo-600 hover:underline">View all →</button></div><RequestTable requests={requests.slice(0, 4)} loading={loading}/></div>
          </>}

          {activeSection === 'apply' && <div className="mx-auto max-w-4xl rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-8"><div className="mb-7 flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-2xl text-white">✦</div><div><h2 className="text-xl font-extrabold">Event application</h2><p className="mt-1 text-sm text-slate-500">Fields marked with * are required. You’ll receive a reference number after submission.</p></div></div>
            <form onSubmit={submitApplication} className="space-y-6">
              <div className="grid gap-5 sm:grid-cols-2"><Field label="Event title" required><input className={inputClass} value={form.title} onChange={(e) => updateForm('title', e.target.value)} placeholder="e.g. National Hackathon 2026" required maxLength={120}/></Field><Field label="Organizer" required><input className={inputClass} value={form.organizer} onChange={(e) => updateForm('organizer', e.target.value)} placeholder="Club, department or organization" required maxLength={120}/></Field><Field label="Category" required><select className={inputClass} value={form.category} onChange={(e) => updateForm('category', e.target.value)} required><option value="">Choose a category</option>{['Technical', 'Cultural', 'Sports', 'Workshop', 'Seminar', 'Other'].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field><Field label="Venue" required><input className={inputClass} value={form.venue} onChange={(e) => updateForm('venue', e.target.value)} placeholder="Event location" required maxLength={180}/></Field></div>
              <div className="rounded-2xl bg-indigo-50/70 p-4 sm:p-5"><p className="mb-4 text-sm font-bold text-indigo-950">📅 Event dates</p><div className="grid gap-5 sm:grid-cols-2"><Field label="Start date" required><input className={inputClass} type="date" value={form.startDate} onChange={(e) => updateForm('startDate', e.target.value)} required/></Field><Field label="End date" required><input className={inputClass} type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => updateForm('endDate', e.target.value)} required/></Field></div><p className="mt-3 text-xs text-indigo-700">Date conflicts are checked against your existing pending, under-review, recommended, and approved applications.</p></div>
              <Field label="Purpose of attending" required><textarea className={`${inputClass} min-h-32 resize-y`} value={form.purpose} onChange={(e) => updateForm('purpose', e.target.value)} placeholder="Explain how this event supports your learning or development…" required minLength={10} maxLength={2000}/></Field>
              <Field label="Supporting document URL"><input className={inputClass} type="url" value={form.documentUrl} onChange={(e) => updateForm('documentUrl', e.target.value)} placeholder="https://… (optional)"/></Field>
              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setForm(emptyForm); setNotice(null); }} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Clear form</button><button type="submit" disabled={submitting || loading} className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit application →'}</button></div>
            </form></div>}

          {activeSection === 'requests' && <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-7"><div className="mb-5"><h2 className="text-xl font-extrabold">Request history</h2><p className="mt-1 text-sm text-slate-500">Your reference numbers and latest review status.</p></div><RequestTable requests={requests} loading={loading} showDetails/></div>}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>© {new Date().getFullYear()} CampusGate · Student portal</span><span>Attendance and event requests</span></footer>
        </section>
      </div>
    </main>
  );
}

function RequestTable({ requests, loading, showDetails = false }: { requests: EventRequest[]; loading: boolean; showDetails?: boolean }) {
  const [selected, setSelected] = useState<EventRequest | null>(null);
  if (loading) return <div className="grid gap-3 py-6">{[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-xl bg-slate-100"/>)}</div>;
  if (!requests.length) return <div className="my-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center"><div className="text-3xl">📭</div><p className="mt-3 font-bold text-slate-800">No applications yet</p><p className="mt-1 text-sm text-slate-500">Your submitted event requests will appear here.</p></div>;
  return <>
    <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] border-separate border-spacing-0 text-left"><thead><tr className="text-xs uppercase tracking-wide text-slate-400"><th className="border-b border-slate-100 px-3 py-3 font-bold">Reference / Event</th><th className="border-b border-slate-100 px-3 py-3 font-bold">Dates</th><th className="border-b border-slate-100 px-3 py-3 font-bold">Submitted</th><th className="border-b border-slate-100 px-3 py-3 font-bold">Status</th>{showDetails && <th className="border-b border-slate-100 px-3 py-3 font-bold">Details</th>}</tr></thead><tbody>{requests.map((request) => <tr key={request.id} className="transition hover:bg-indigo-50/40"><td className="border-b border-slate-50 px-3 py-4"><p className="font-bold text-slate-800">{request.title}</p><p className="mt-1 font-mono text-[11px] text-indigo-600">{request.reference_number}</p><p className="mt-1 text-xs text-slate-400">{request.category} · {request.venue}</p></td><td className="border-b border-slate-50 px-3 py-4 text-sm text-slate-600"><span>{request.start_date}</span><span className="mx-1 text-slate-300">→</span><span>{request.end_date}</span></td><td className="border-b border-slate-50 px-3 py-4 text-sm text-slate-500">{request.created_at ? new Date(request.created_at).toLocaleDateString() : '—'}</td><td className="border-b border-slate-50 px-3 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusStyles[request.status] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}`}>{request.status}</span></td>{showDetails && <td className="border-b border-slate-50 px-3 py-4"><button onClick={() => setSelected(request)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50">View details</button></td>}</tr>)}</tbody></table></div>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="request-details-title" onClick={() => setSelected(null)}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs font-bold text-indigo-600">{selected.reference_number}</p><h3 id="request-details-title" className="mt-2 text-xl font-black">{selected.title}</h3></div><button onClick={() => setSelected(null)} aria-label="Close details" className="rounded-xl bg-slate-100 px-3 py-2 font-bold">✕</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{[['Organizer', selected.organizer], ['Category', selected.category], ['Venue', selected.venue], ['Status', selected.status], ['Start date', selected.start_date], ['End date', selected.end_date]].map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value || '—'}</p></div>)}</div><div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Purpose</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selected.purpose}</p></div>{selected.document_url && <a href={selected.document_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-bold text-indigo-600 underline">Open supporting document ↗</a>}<p className="mt-5 text-xs text-slate-400">Submitted {new Date(selected.created_at).toLocaleString()}{selected.updated_at ? ` · Updated ${new Date(selected.updated_at).toLocaleString()}` : ''}</p></div></div>}
  </>;
}
