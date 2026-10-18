'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

type ReviewAction = 'Recommend for Approval' | 'Recommend for Rejection' | 'Return for Correction';
type RequestStatus = 'Pending' | 'Under Review' | 'Recommended for Approval' | 'Recommended for Rejection' | 'Returned for Correction' | 'Approved' | 'Rejected' | string;
type EventRequest = {
  id: string;
  user_id: string;
  proctor_id: string;
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
  student_name?: string | null;
  student_email?: string | null;
};

type ReviewDraft = { action: ReviewAction; remarks: string };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createBrowserClient(supabaseUrl, supabaseAnonKey)
  : null;

const actions: { value: ReviewAction; label: string; description: string; style: string }[] = [
  { value: 'Recommend for Approval', label: 'Recommend for Approval', description: 'Send the request forward for the in-charge’s final decision.', style: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
  { value: 'Recommend for Rejection', label: 'Recommend for Rejection', description: 'Recommend rejection; the in-charge still makes the final decision.', style: 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100' },
  { value: 'Return for Correction', label: 'Return for Correction', description: 'Ask the student to update the request using your remarks.', style: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' },
];

const statusClasses: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  'Under Review': 'bg-blue-100 text-blue-800',
  'Recommended for Approval': 'bg-emerald-100 text-emerald-800',
  'Recommended for Rejection': 'bg-rose-100 text-rose-800',
  'Returned for Correction': 'bg-orange-100 text-orange-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
};

function formatDate(value: string) {
  if (!value) return '—';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'ST';
}

export default function ProctorDashboardPage() {
  const [proctorId, setProctorId] = useState<string | null>(null);
  const [proctorName, setProctorName] = useState('Proctor');
  const [requests, setRequests] = useState<EventRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selected, setSelected] = useState<EventRequest | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setPageError('');
    if (!supabase) {
      setPageError('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setPageError('Please sign in with your proctor account to continue.');
      setLoading(false);
      return;
    }
    const user = authData.user;
    setProctorId(user.id);
    const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
    setProctorName(typeof metadataName === 'string' && metadataName.trim() ? metadataName : (user.email?.split('@')[0] ?? 'Proctor'));

    // Critical: scope the query to the authenticated proctor. RLS must enforce this on the database too.
    const { data, error } = await supabase
      .from('event_applications')
      .select('id,user_id,proctor_id,reference_number,title,organizer,category,venue,start_date,end_date,purpose,document_url,status,created_at,updated_at,student_name,student_email')
      .eq('proctor_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      setPageError(`Could not load assigned requests: ${error.message}. Confirm the event_applications columns and RLS policies.`);
      setRequests([]);
    } else {
      setRequests((data ?? []) as EventRequest[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const filteredRequests = useMemo(() => requests.filter((request) => {
    const student = request.student_name ?? request.student_email ?? request.user_id;
    const matchesQuery = [request.reference_number, request.title, request.category, request.venue, student]
      .some((value) => String(value ?? '').toLowerCase().includes(query.toLowerCase().trim()));
    const matchesStatus = statusFilter === 'All' || request.status === statusFilter;
    return matchesQuery && matchesStatus;
  }), [requests, query, statusFilter]);

  const pendingCount = requests.filter((r) => ['Pending', 'Under Review'].includes(r.status)).length;
  const approvalCount = requests.filter((r) => r.status === 'Recommended for Approval').length;
  const correctionCount = requests.filter((r) => r.status === 'Returned for Correction').length;

  function updateDraft(id: string, changes: Partial<ReviewDraft>) {
    setDrafts((current) => ({ ...current, [id]: { action: current[id]?.action ?? 'Recommend for Approval', remarks: current[id]?.remarks ?? '', ...changes } }));
  }

  async function submitReview(event: FormEvent<HTMLFormElement>, request: EventRequest) {
    event.preventDefault();
    setPageError('');
    setSuccess('');
    const draft = drafts[request.id] ?? { action: 'Recommend for Approval' as ReviewAction, remarks: '' };
    const remarks = draft.remarks.trim();
    if (!remarks) {
      setPageError('Remarks are mandatory. Explain the reason for your recommendation or correction request.');
      return;
    }
    if (remarks.length < 5) {
      setPageError('Please provide a meaningful remark of at least 5 characters.');
      return;
    }
    if (!supabase || !proctorId) {
      setPageError('Your session is unavailable. Sign in again and retry.');
      return;
    }

    const nextStatus: Record<ReviewAction, string> = {
      'Recommend for Approval': 'Recommended for Approval',
      'Recommend for Rejection': 'Recommended for Rejection',
      'Return for Correction': 'Returned for Correction',
    };
    const action = draft.action;
    const updatedStatus = nextStatus[action];
    setSavingId(request.id);
    try {
      // Guard against stale pages and ensure the request remains assigned to this proctor.
      const { data: currentRow, error: currentError } = await supabase
        .from('event_applications')
        .select('id,proctor_id,status')
        .eq('id', request.id)
        .eq('proctor_id', proctorId)
        .maybeSingle();
      if (currentError) throw new Error(`Could not verify request assignment: ${currentError.message}`);
      if (!currentRow) throw new Error('This request is no longer assigned to you or is no longer available. Refresh the dashboard.');
      if (['Approved', 'Rejected'].includes(String(currentRow.status))) throw new Error('This request already has a final decision and cannot be reviewed here.');

      const { data: updatedRows, error: updateError } = await supabase
        .from('event_applications')
        .update({ status: updatedStatus, proctor_remarks: remarks, reviewed_by: proctorId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', request.id)
        .eq('proctor_id', proctorId)
        .select('id');
      if (updateError) throw new Error(`Could not save review: ${updateError.message}`);
      if (!updatedRows?.length) throw new Error('No request was updated. Check the proctor update policy and assigned-student mapping.');

      // Audit every successful review action. Configure RLS to permit assigned proctors to insert their own audit rows.
      const { error: auditError } = await supabase.from('request_audit_log').insert({
        request_id: request.id,
        actor_id: proctorId,
        actor_role: 'proctor',
        action,
        remarks,
        previous_status: String(currentRow.status ?? request.status),
        new_status: updatedStatus,
        created_at: new Date().toISOString(),
      });
      if (auditError) {
        // Do not hide that the review changed but its audit event failed; it requires administrator reconciliation.
        setPageError(`The request status was updated, but audit logging failed: ${auditError.message}. Please notify the administrator; do not submit the review again.`);
      } else {
        setSuccess(`${action} saved for ${request.reference_number}. The in-charge retains final approval authority.`);
      }
      setSelected(null);
      await loadRequests();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'An unexpected error occurred while saving the review.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-0 h-72 bg-gradient-to-br from-indigo-100 via-violet-50 to-sky-100" />
      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-xl font-black text-white shadow-lg shadow-indigo-200">CG</div>
            <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">CampusGate</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Proctor Dashboard</h1><p className="mt-1 text-sm text-slate-500">Review event requests from your assigned students.</p></div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-sm backdrop-blur">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-100 font-extrabold text-indigo-700">{initials(proctorName)}</div>
            <div><p className="text-xs text-slate-500">Signed in as</p><p className="font-bold">{proctorName}</p><p className="text-xs font-semibold text-indigo-600">Assigned-student reviewer</p></div>
            <button onClick={() => void loadRequests()} disabled={loading} className="ml-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50" title="Refresh requests">↻</button>
          </div>
        </header>

        {pageError && <div role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p className="font-bold">Action needed</p><p className="mt-1 break-words">{pageError}</p></div>}
        {success && <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><p className="font-bold">Review recorded</p><p className="mt-1">{success}</p></div>}

        <section className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Assigned requests</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-xl">▤</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : requests.length}</p><p className="mt-1 text-xs text-slate-500">Only requests assigned to your account</p></div>
          <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Awaiting review</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-xl">◷</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : pendingCount}</p><p className="mt-1 text-xs text-slate-500">Pending or under review</p></div>
          <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Recommended approval</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-xl">✓</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : approvalCount}</p><p className="mt-1 text-xs text-slate-500">Awaiting in-charge decision</p></div>
          <div className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Returned for correction</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-xl">↩</span></div><p className="mt-4 text-3xl font-black">{loading ? '—' : correctionCount}</p><p className="mt-1 text-xs text-slate-500">Waiting for student updates</p></div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-extrabold">Student event requests</h2><p className="mt-1 text-sm text-slate-500">Open a request to review its details and record a recommendation.</p></div><div className="flex flex-col gap-3 sm:flex-row"><label className="relative block"><span className="sr-only">Search requests</span><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search student, title, reference…" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 sm:w-72" /></label><select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"><option>All</option>{['Pending', 'Under Review', 'Recommended for Approval', 'Recommended for Rejection', 'Returned for Correction', 'Approved', 'Rejected'].map((status) => <option key={status}>{status}</option>)}</select></div></div></div>
          {loading ? <div className="p-12 text-center text-sm text-slate-500">Loading assigned student requests…</div> : filteredRequests.length === 0 ? <div className="p-12 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-2xl">⌕</div><h3 className="mt-4 font-bold">No requests found</h3><p className="mt-1 text-sm text-slate-500">Try another search or status filter. Only assigned students’ requests appear here.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4 font-bold">Student / Reference</th><th className="px-5 py-4 font-bold">Event</th><th className="px-5 py-4 font-bold">Dates</th><th className="px-5 py-4 font-bold">Status</th><th className="px-5 py-4 font-bold">Submitted</th><th className="px-5 py-4 text-right font-bold">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredRequests.map((request) => { const student = request.student_name ?? request.student_email ?? `Student ${request.user_id.slice(0, 8)}`; return <tr key={request.id} className="transition hover:bg-indigo-50/40"><td className="px-5 py-4"><div className="font-bold text-slate-800">{student}</div><div className="mt-1 font-mono text-xs text-indigo-600">{request.reference_number}</div></td><td className="px-5 py-4"><div className="font-bold">{request.title}</div><div className="mt-1 text-xs text-slate-500">{request.category} · {request.venue}</div></td><td className="px-5 py-4 whitespace-nowrap text-slate-600">{formatDate(request.start_date)}<div className="text-xs text-slate-400">to {formatDate(request.end_date)}</div></td><td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClasses[request.status] ?? 'bg-slate-100 text-slate-700'}`}>{request.status}</span></td><td className="px-5 py-4 whitespace-nowrap text-slate-500">{formatDateTime(request.created_at)}</td><td className="px-5 py-4 text-right"><button onClick={() => { setSelected(request); setPageError(''); setSuccess(''); }} className="rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700">Review request →</button></td></tr>; })}</tbody></table></div>}
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-400"><span>Showing {filteredRequests.length} of {requests.length} assigned requests</span><span>Final approval belongs to the in-charge</span></div>
        </section>
        <footer className="mt-6 flex flex-wrap justify-between gap-2 text-xs text-slate-400"><span>© {new Date().getFullYear()} CampusGate · Proctor portal</span><span>Recommendations and corrections only — no final approval permissions</span></footer>
      </div>

      {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 p-5 backdrop-blur sm:p-6"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Review submission</p><h2 id="review-title" className="mt-1 text-xl font-black sm:text-2xl">{selected.title}</h2><p className="mt-1 font-mono text-xs text-slate-500">{selected.reference_number}</p></div><button onClick={() => setSelected(null)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Close review">✕</button></div>
        <div className="grid gap-6 p-5 sm:grid-cols-[1fr_1fr] sm:p-6"><div className="space-y-4"><div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Student</p><p className="mt-1 break-all font-bold">{selected.student_name ?? selected.student_email ?? selected.user_id}</p><p className="mt-2 text-xs text-slate-500">Student ID: {selected.user_id}</p></div><div className="space-y-3 text-sm"><div><p className="text-xs font-semibold text-slate-400">Organizer</p><p className="mt-1 font-semibold">{selected.organizer}</p></div><div><p className="text-xs font-semibold text-slate-400">Category and venue</p><p className="mt-1 font-semibold">{selected.category} · {selected.venue}</p></div><div><p className="text-xs font-semibold text-slate-400">Event dates</p><p className="mt-1 font-semibold">{formatDate(selected.start_date)} – {formatDate(selected.end_date)}</p></div><div><p className="text-xs font-semibold text-slate-400">Purpose</p><p className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{selected.purpose}</p></div>{selected.document_url && <a href={selected.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50">↗ Open supporting document</a>}</div></div>
          <form onSubmit={(event) => void submitReview(event, selected)} className="space-y-4"><div><h3 className="font-extrabold">Record your review</h3><p className="mt-1 text-xs leading-5 text-slate-500">Choose one action and provide mandatory remarks. You cannot approve or reject the request finally.</p></div><fieldset className="space-y-2"><legend className="mb-2 text-sm font-bold text-slate-700">Recommendation <span className="text-rose-500">*</span></legend>{actions.map((item) => { const active = (drafts[selected.id]?.action ?? 'Recommend for Approval') === item.value; return <label key={item.value} className={`block cursor-pointer rounded-2xl border p-3 transition ${active ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}><span className="flex items-start gap-3"><input type="radio" name={`action-${selected.id}`} value={item.value} checked={active} onChange={() => updateDraft(selected.id, { action: item.value })} className="mt-1 accent-indigo-600"/><span><span className={`inline-flex rounded-lg px-2 py-1 text-xs font-extrabold ${item.style}`}>{item.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span></span></span></label>; })}</fieldset><label className="block"><span className="text-sm font-bold text-slate-700">Remarks <span className="text-rose-500">*</span></span><textarea required minLength={5} maxLength={2000} value={drafts[selected.id]?.remarks ?? ''} onChange={(e) => updateDraft(selected.id, { remarks: e.target.value })} placeholder="Explain your recommendation or list the corrections required…" className="mt-2 min-h-32 w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"/><span className="mt-1 block text-right text-xs text-slate-400">{(drafts[selected.id]?.remarks ?? '').length}/2000</span></label><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><strong>Workflow safeguard:</strong> This action records a recommendation or returns the request. The in-charge alone makes the final approval/rejection decision.</div><div className="flex gap-3 pt-1"><button type="button" onClick={() => setSelected(null)} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button><button type="submit" disabled={savingId === selected.id} className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:from-indigo-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-60">{savingId === selected.id ? 'Saving review…' : 'Save review →'}</button></div></form></div></div></div>}
    </main>
  );
}
