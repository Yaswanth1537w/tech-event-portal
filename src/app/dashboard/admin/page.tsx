'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import * as XLSX from 'xlsx';

type AttendanceRow = { student_id: string; class_date: string; status: 'Present' | 'Absent'; subject?: string };
type EventRequest = {
  id: string; user_id: string; proctor_id: string | null; reference_number: string; title: string;
  organizer: string; category: string; venue: string; start_date: string; end_date: string;
  purpose: string; document_url: string | null; status: string; created_at: string;
  proctor_remarks?: string | null; reviewed_by?: string | null; reviewed_at?: string | null;
  final_remarks?: string | null; final_decision_by?: string | null; final_decided_at?: string | null;
  override_flag?: boolean | null; student_name?: string | null; student_email?: string | null;
};
type DecisionDraft = { decision: 'Approved' | 'Rejected'; remarks: string; override: boolean };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = url && anonKey ? createBrowserClient(url, anonKey) : null;
const statusStyle: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800', 'Under Review': 'bg-blue-100 text-blue-800',
  'Recommended for Approval': 'bg-emerald-100 text-emerald-800',
  'Recommended for Rejection': 'bg-rose-100 text-rose-800',
  'Returned for Correction': 'bg-orange-100 text-orange-800',
  Approved: 'bg-green-100 text-green-800', Rejected: 'bg-red-100 text-red-800',
};
const asText = (value: unknown) => String(value ?? '').trim();
const normalizeHeader = (value: unknown) => asText(value).toLowerCase().replace(/[\s_-]+/g, '');

function normalizeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = asText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = href; link.download = filename; link.click(); URL.revokeObjectURL(href);
}
function displayDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminDashboardPage() {
  const [adminId, setAdminId] = useState('');
  const [adminName, setAdminName] = useState('Admin / In-charge');
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<EventRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [activeTab, setActiveTab] = useState<'requests' | 'attendance'>('requests');
  const [threshold, setThreshold] = useState('75');
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({});
  const [savingId, setSavingId] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    if (!supabase) { setError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.'); setLoading(false); return; }
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) { setError('Please sign in with your admin/in-charge account.'); setLoading(false); return; }
    const user = auth.user;
    setAdminId(user.id);
    const role = String(user.app_metadata?.role ?? user.user_metadata?.role ?? '').toLowerCase();
    const roleIsAdmin = ['admin', 'administrator', 'incharge', 'in-charge'].includes(role);
    setIsAdmin(roleIsAdmin);
    const displayName = user.user_metadata?.full_name ?? user.user_metadata?.name;
    setAdminName(typeof displayName === 'string' && displayName.trim() ? displayName : (user.email?.split('@')[0] ?? 'Admin / In-charge'));
    if (!roleIsAdmin) { setError('Access restricted: sign in with an admin/in-charge account. Configure the trusted role claim and matching Supabase RLS policies.'); setLoading(false); return; }

    const [requestResult, settingsResult] = await Promise.all([
      supabase.from('event_applications').select('id,user_id,proctor_id,reference_number,title,organizer,category,venue,start_date,end_date,purpose,document_url,status,created_at,proctor_remarks,reviewed_by,reviewed_at,final_remarks,final_decision_by,final_decided_at,override_flag,student_name,student_email').order('created_at', { ascending: false }),
      supabase.from('system_settings').select('value').eq('key', 'minimum_attendance_threshold').maybeSingle(),
    ]);
    if (requestResult.error) { setError(`Could not load requests: ${requestResult.error.message}. Verify event_applications columns and admin RLS policies.`); setRequests([]); }
    else setRequests((requestResult.data ?? []) as EventRequest[]);
    if (!settingsResult.error && settingsResult.data?.value !== undefined && settingsResult.data?.value !== null) setThreshold(String(settingsResult.data.value));
    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const filteredRequests = useMemo(() => requests.filter((r) => {
    const text = [r.reference_number, r.title, r.organizer, r.category, r.venue, r.student_name, r.student_email, r.user_id]
      .some((v) => String(v ?? '').toLowerCase().includes(query.trim().toLowerCase()));
    return text && (statusFilter === 'All' || r.status === statusFilter);
  }), [requests, query, statusFilter]);
  const pendingCount = requests.filter((r) => !['Approved', 'Rejected'].includes(r.status)).length;
  const recommendedCount = requests.filter((r) => ['Recommended for Approval', 'Recommended for Rejection'].includes(r.status)).length;
  const decidedCount = requests.filter((r) => ['Approved', 'Rejected'].includes(r.status)).length;

  async function saveThreshold(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    const value = Number(threshold);
    if (!Number.isFinite(value) || value < 0 || value > 100) { setError('Minimum attendance threshold must be between 0 and 100.'); return; }
    if (!supabase || !adminId || !isAdmin) return;
    setThresholdSaving(true);
    const { error: saveError } = await supabase.from('system_settings').upsert({ key: 'minimum_attendance_threshold', value: String(value), updated_by: adminId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (saveError) setError(`Could not save threshold: ${saveError.message}. Confirm the system_settings schema and RLS policy.`);
    else { setThreshold(String(value)); setNotice(`Minimum attendance threshold saved as ${value}%.`); }
    setThresholdSaving(false);
  }

  async function parseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; setImportError(''); setImportNotice(''); setAttendanceRows([]); setFileName('');
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setImportError('Choose an .xlsx or .csv file.'); event.target.value = ''; return; }
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('The file does not contain a worksheet.');
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      if (!raw.length) throw new Error('No data rows found. Put column headers in the first row.');
      const headers = Object.keys(raw[0]);
      const pick = (row: Record<string, unknown>, names: string[]) => {
        const key = headers.find((h) => names.includes(normalizeHeader(h)));
        return key ? row[key] : '';
      };
      const parsed: AttendanceRow[] = raw.map((row, index) => {
        const student_id = asText(pick(row, ['studentid', 'studentrollnumber', 'rollnumber', 'rollno', 'userid']));
        const class_date = normalizeDate(pick(row, ['classdate', 'date', 'attendancedate']));
        const rawStatus = asText(pick(row, ['status', 'attendance', 'attendancestatus'])).toLowerCase();
        const status = ['present', 'p', '1', 'yes'].includes(rawStatus) ? 'Present' : ['absent', 'a', '0', 'no'].includes(rawStatus) ? 'Absent' : '';
        const subject = asText(pick(row, ['subject', 'course', 'coursename', 'paper']));
        if (!student_id || !class_date || !status) throw new Error(`Row ${index + 2}: required fields are Student ID, valid Date, and Status (Present/Absent).`);
        return { student_id, class_date, status: status as 'Present' | 'Absent', ...(subject ? { subject } : {}) };
      });
      const seen = new Set<string>();
      for (const [index, row] of parsed.entries()) {
        const key = `${row.student_id}|${row.class_date}|${row.subject ?? ''}`;
        if (seen.has(key)) throw new Error(`Duplicate attendance row detected at imported row ${index + 2}: ${row.student_id} on ${row.class_date}.`);
        seen.add(key);
      }
      setAttendanceRows(parsed); setFileName(file.name); setImportNotice(`Parsed ${parsed.length} rows. Review the preview before saving.`);
    } catch (e) { setImportError(e instanceof Error ? e.message : 'Unable to read this file.'); }
    finally { event.target.value = ''; }
  }

  async function saveAttendanceBatch() {
    setImportError(''); setImportNotice('');
    if (!supabase || !isAdmin || !attendanceRows.length) return;
    setImporting(true);
    try {
      // Batch in chunks to avoid oversized requests. Requires attendance_records columns to match the preview.
      for (let i = 0; i < attendanceRows.length; i += 250) {
        const chunk = attendanceRows.slice(i, i + 250).map((row) => ({ ...row, imported_by: adminId, created_at: new Date().toISOString() }));
        const { error: insertError } = await supabase.from('attendance_records').insert(chunk);
        if (insertError) throw new Error(`Batch starting at row ${i + 1} failed: ${insertError.message}. Earlier batches, if any, may already have been saved; use a server-side transaction for all-or-nothing imports.`);
      }
      setImportNotice(`Successfully saved ${attendanceRows.length} attendance rows.`); setAttendanceRows([]); setFileName('');
    } catch (e) { setImportError(e instanceof Error ? e.message : 'Attendance import failed.'); }
    finally { setImporting(false); }
  }

  function updateDraft(id: string, changes: Partial<DecisionDraft>) {
    setDrafts((current) => ({ ...current, [id]: { decision: current[id]?.decision ?? 'Approved', remarks: current[id]?.remarks ?? '', override: current[id]?.override ?? false, ...changes } }));
  }
  async function submitDecision(event: FormEvent<HTMLFormElement>, request: EventRequest) {
    event.preventDefault(); setError(''); setNotice('');
    const draft = drafts[request.id] ?? { decision: 'Approved' as const, remarks: '', override: false };
    const remarks = draft.remarks.trim();
    if (remarks.length < 5) { setError('Final decision remarks are mandatory (at least 5 characters).'); return; }
    if (!supabase || !adminId || !isAdmin) return;
    if (['Approved', 'Rejected'].includes(request.status)) { setError('This request already has a final decision.'); return; }
    if (draft.decision === 'Approved' && request.status === 'Recommended for Rejection' && !draft.override) { setError('This request has a proctor rejection recommendation. Select the override flag and explain why you are overriding it.'); return; }
    if (draft.decision === 'Rejected' && request.status === 'Recommended for Approval' && !draft.override) { setError('This request has a proctor approval recommendation. Select the override flag and explain why you are overriding it.'); return; }
    setSavingId(request.id);
    try {
      const { data: current, error: currentError } = await supabase.from('event_applications').select('id,status,proctor_remarks,proctor_id').eq('id', request.id).maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current) throw new Error('Request no longer exists. Refresh and try again.');
      if (['Approved', 'Rejected'].includes(String(current.status))) throw new Error('Another admin has already made the final decision. Refresh the page.');
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await supabase.from('event_applications').update({ status: draft.decision, final_remarks: remarks, final_decision_by: adminId, final_decided_at: now, override_flag: draft.override || false, updated_at: now }).eq('id', request.id).not('status', 'in', '(Approved,Rejected)').select('id');
      if (updateError) throw new Error(`Decision could not be saved: ${updateError.message}`);
      if (!updated?.length) throw new Error('No request was updated; it may already have a final decision.');
      const { error: auditError } = await supabase.from('request_audit_log').insert({ request_id: request.id, actor_id: adminId, actor_role: 'admin', action: draft.decision, remarks, previous_status: current.status, new_status: draft.decision, override_flag: draft.override || false, created_at: now });
      if (auditError) throw new Error(`Decision was saved, but audit logging failed: ${auditError.message}. Do not retry blindly; verify the request and audit log first.`);
      setNotice(`${request.reference_number}: final decision recorded as ${draft.decision}.`);
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the final decision.'); }
    finally { setSavingId(''); }
  }

  function exportRequests() {
    const rows = filteredRequests.map((r) => ({ reference_number: r.reference_number, student_name: r.student_name ?? '', student_email: r.student_email ?? '', student_id: r.user_id, title: r.title, organizer: r.organizer, category: r.category, venue: r.venue, start_date: r.start_date, end_date: r.end_date, status: r.status, proctor_id: r.proctor_id ?? '', proctor_remarks: r.proctor_remarks ?? '', final_remarks: r.final_remarks ?? '', override_flag: Boolean(r.override_flag), submitted_at: r.created_at, final_decided_at: r.final_decided_at ?? '' }));
    downloadCsv(rows, `campusgate-requests-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  if (!supabase || (error.startsWith('Access restricted') || error.startsWith('Please sign in'))) return (
    <main className="min-h-screen bg-slate-50 p-6"><div className="mx-auto max-w-3xl rounded-3xl border border-rose-100 bg-white p-8 shadow-sm"><div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-2xl">🔐</div><h1 className="text-2xl font-bold text-slate-900">Admin access required</h1><p className="mt-2 text-slate-600">{error || 'Configure Supabase to load the admin dashboard.'}</p></div></main>
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <header className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-indigo-700 via-violet-700 to-fuchsia-600 p-6 text-white shadow-xl sm:p-8">
          <div className="absolute -right-10 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl"/><div className="absolute bottom-[-90px] right-1/3 h-48 w-48 rounded-full bg-pink-300/20 blur-2xl"/>
          <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-center"><div><p className="text-sm font-semibold uppercase tracking-[.22em] text-indigo-100">CampusGate · Control Center</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Admin Dashboard</h1><p className="mt-2 max-w-2xl text-indigo-100">Welcome back, {adminName}. Manage attendance, review recommendations, and make final event decisions.</p></div><div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur"><p className="text-xs text-indigo-100">Signed in as</p><p className="mt-1 font-semibold">Admin / In-charge</p></div></div>
        </header>

        {(error && !error.startsWith('Access restricted') && !error.startsWith('Please sign in')) && <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
        {notice && <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[{ label: 'Total requests', value: requests.length, icon: '📋', color: 'from-indigo-500 to-blue-500' }, { label: 'Awaiting final decision', value: pendingCount, icon: '⏳', color: 'from-amber-400 to-orange-500' }, { label: 'Proctor recommendations', value: recommendedCount, icon: '🧭', color: 'from-violet-500 to-fuchsia-500' }, { label: 'Decided requests', value: decidedCount, icon: '✅', color: 'from-emerald-400 to-teal-500' }].map((card) => <div key={card.label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between"><div><p className="text-sm font-medium text-slate-500">{card.label}</p><p className="mt-2 text-3xl font-extrabold">{loading ? '—' : card.value}</p></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${card.color} text-xl text-white shadow-lg`}>{card.icon}</div></div></div>)}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Attendance import</h2><p className="mt-1 text-sm text-slate-500">Upload a spreadsheet, validate rows, preview, then save.</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">XLSX / CSV</span></div>
            <div className="mt-5 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/60 p-5"><label htmlFor="attendance-file" className="flex cursor-pointer flex-col items-center text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">📤</span><span className="mt-3 font-bold text-slate-800">Choose attendance file</span><span className="mt-1 text-sm text-slate-500">.xlsx or .csv · first row must contain column headers</span><span className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Browse files</span></label><input id="attendance-file" type="file" accept=".xlsx,.csv" className="sr-only" onChange={parseFile}/>{fileName && <p className="mt-3 text-center text-sm font-medium text-indigo-800">Selected: {fileName}</p>}</div>
            <div className="mt-3 text-xs leading-5 text-slate-500">Expected headers: <b>Student ID</b>, <b>Date</b>, <b>Status</b> (Present/Absent), and optional <b>Subject</b>. Duplicate student/date/subject rows are blocked.</div>
            {importError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{importError}</p>}{importNotice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{importNotice}</p>}
            {attendanceRows.length > 0 && <><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">Import preview</h3><p className="text-sm text-slate-500">{attendanceRows.length} valid rows ready to save</p></div><button onClick={() => { setAttendanceRows([]); setFileName(''); setImportNotice('Preview cleared.'); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Clear preview</button></div><div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Student ID</th><th className="px-4 py-3">Class date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Subject</th></tr></thead><tbody className="divide-y divide-slate-100">{attendanceRows.slice(0, 100).map((r, i) => <tr key={`${r.student_id}-${r.class_date}-${r.subject}-${i}`}><td className="px-4 py-2 text-slate-400">{i + 1}</td><td className="px-4 py-2 font-medium">{r.student_id}</td><td className="px-4 py-2">{r.class_date}</td><td className="px-4 py-2"><span className={`rounded-full px-2 py-1 text-xs font-bold ${r.status === 'Present' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{r.status}</span></td><td className="px-4 py-2">{r.subject || '—'}</td></tr>)}</tbody></table>{attendanceRows.length > 100 && <p className="p-3 text-center text-xs text-slate-500">Showing first 100 rows of {attendanceRows.length}.</p>}</div><button disabled={importing} onClick={saveAttendanceBatch} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{importing ? 'Saving attendance…' : `Save ${attendanceRows.length} rows to attendance_records`}</button></>}
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-xl">🎯</div><h2 className="mt-4 text-xl font-bold">Attendance eligibility</h2><p className="mt-1 text-sm text-slate-500">Set the minimum percentage used for eligibility calculations.</p><form onSubmit={saveThreshold} className="mt-5"><label htmlFor="threshold" className="text-sm font-semibold text-slate-700">Minimum attendance (%)</label><div className="mt-2 flex items-center gap-2"><input id="threshold" type="number" min="0" max="100" step="0.5" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-lg font-bold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"/><span className="text-xl font-bold text-slate-400">%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(threshold) || 0))}%` }}/></div><button disabled={thresholdSaving} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-60">{thresholdSaving ? 'Saving…' : 'Save threshold'}</button></form><div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><b>Important:</b> This setting must be read by the student dashboard and enforced consistently by trusted server/database logic. Saving it here alone does not recalculate old attendance.</div></div>
        </section>

        <section className="mt-7 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-indigo-600">Decision workspace</p><h2 className="mt-1 text-2xl font-extrabold">Event applications</h2><p className="mt-1 text-sm text-slate-500">Review the proctor’s recommendation and record the final decision with remarks.</p></div><button onClick={exportRequests} disabled={!filteredRequests.length} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"><span>⬇️</span> Export filtered CSV</button></div>
          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reference, student, event, venue…" className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"/><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-indigo-500"><option>All</option>{['Pending', 'Under Review', 'Recommended for Approval', 'Recommended for Rejection', 'Returned for Correction', 'Approved', 'Rejected'].map((s) => <option key={s}>{s}</option>)}</select></div>
          {loading ? <div className="py-16 text-center text-slate-500">Loading requests…</div> : !filteredRequests.length ? <div className="py-16 text-center"><div className="text-4xl">🗂️</div><p className="mt-3 font-bold">No requests found</p><p className="mt-1 text-sm text-slate-500">Try changing the search text or status filter.</p></div> : <div className="mt-5 space-y-4">{filteredRequests.map((r) => { const draft = drafts[r.id] ?? { decision: 'Approved' as const, remarks: '', override: false }; const final = ['Approved', 'Rejected'].includes(r.status); const conflict = (draft.decision === 'Approved' && r.status === 'Recommended for Rejection') || (draft.decision === 'Rejected' && r.status === 'Recommended for Approval'); return <article key={r.id} className="rounded-2xl border border-slate-200 p-4 transition hover:border-indigo-200 hover:shadow-sm sm:p-5"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-indigo-700">{r.reference_number || r.id.slice(0, 8)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle[r.status] ?? 'bg-slate-100 text-slate-700'}`}>{r.status}</span>{r.override_flag && <span className="rounded-full bg-fuchsia-100 px-2.5 py-1 text-xs font-bold text-fuchsia-800">⚑ Override</span>}</div><h3 className="mt-2 text-lg font-extrabold">{r.title}</h3><p className="mt-1 text-sm text-slate-500">{r.student_name || r.student_email || `Student ${r.user_id.slice(0, 8)}`} · {r.category} · {r.organizer}</p><p className="mt-1 text-sm text-slate-600">📍 {r.venue} <span className="mx-1 text-slate-300">•</span> {displayDate(r.start_date)} – {displayDate(r.end_date)}</p></div><div className="text-left text-xs text-slate-500 md:text-right"><p>Submitted {displayDate(r.created_at)}</p>{r.proctor_id && <p className="mt-1">Assigned proctor: {r.proctor_id.slice(0, 8)}…</p>}</div></div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Purpose</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{r.purpose || 'No purpose provided.'}</p>{r.document_url && <a href={r.document_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-indigo-700 underline">View supporting document ↗</a>}</div><div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Proctor recommendation</p><p className="mt-1 font-bold">{r.status.startsWith('Recommended') ? r.status : r.status === 'Returned for Correction' ? 'Returned for Correction' : 'No recommendation recorded yet'}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-600">{r.proctor_remarks || 'No proctor remarks available.'}</p>{r.reviewed_at && <p className="mt-2 text-xs text-slate-500">Reviewed {new Date(r.reviewed_at).toLocaleString()}</p>}</div></div>
            {final ? <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm"><p className="font-bold text-emerald-900">Final decision: {r.status}</p><p className="mt-1 text-emerald-800">{r.final_remarks || 'No final remarks recorded.'}</p>{r.final_decided_at && <p className="mt-1 text-xs text-emerald-700">Decided {new Date(r.final_decided_at).toLocaleString()}</p>}</div> : <form onSubmit={(e) => submitDecision(e, r)} className="mt-4 rounded-xl border border-slate-200 p-4"><div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]"><div><label htmlFor={`decision-${r.id}`} className="text-sm font-bold">Final decision</label><select id={`decision-${r.id}`} value={draft.decision} onChange={(e) => updateDraft(r.id, { decision: e.target.value as 'Approved' | 'Rejected' })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="Approved">Approve request</option><option value="Rejected">Reject request</option></select></div><div><label htmlFor={`remarks-${r.id}`} className="text-sm font-bold">Final remarks <span className="text-rose-600">*</span></label><textarea id={`remarks-${r.id}`} rows={2} minLength={5} required value={draft.remarks} onChange={(e) => updateDraft(r.id, { remarks: e.target.value })} placeholder="Explain the decision; remarks are mandatory…" className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"/></div></div>
              {conflict && <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm text-fuchsia-900"><input type="checkbox" checked={draft.override} onChange={(e) => updateDraft(r.id, { override: e.target.checked })} className="mt-1 h-4 w-4 accent-fuchsia-700"/><span><b>Override proctor recommendation</b><span className="mt-0.5 block">Required because your final decision conflicts with the proctor recommendation. Explain the override in final remarks.</span></span></label>}
              {draft.override && <p className="mt-2 text-xs font-semibold text-fuchsia-700">Override flag will be saved and included in the audit log.</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Final decisions are recorded in the request and audit log.</p><button disabled={savingId === r.id || !draft.remarks.trim()} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${draft.decision === 'Approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>{savingId === r.id ? 'Recording decision…' : `Confirm ${draft.decision}`}</button></div></form>}
          </article>; })}</div>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500"><span>Showing {filteredRequests.length} of {requests.length} requests</span><button onClick={() => void loadData()} className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">↻ Refresh requests</button></div>
        </section>
        <footer className="mt-7 pb-4 text-center text-xs leading-5 text-slate-400">CampusGate · Admin actions should be protected by database RLS and trusted server-side role checks. Client-side role checks are for interface guidance only.</footer>
      </div>
    </main>
  );
}
