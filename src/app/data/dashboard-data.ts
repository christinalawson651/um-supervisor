import { Injectable, signal, effect, computed } from '@angular/core';
import {
  Kpi, QueueCard, NurseRow, TatBucket, TatStat, DecisionStat, DecisionRow,
  ConcurrentRow, QualityBar, MissingField, ProviderRow, HighDollarCase,
  AuditFlag, AiRecommendation, RiskCase, RiskTile,
} from './dashboard.models';
import { CASE_POOL, NURSES, CaseRec, GUIDELINE_BY_PROCEDURE } from './case-pool';
import { ageH, bandOf, lobOf, daysAgo, TODAY } from './case-fields';

/**
 * One inpatient concurrent-review row per real 'concurrent'-tagged case in the pool (LOS/admit/
 * review-due fields are deterministic per authId, same pattern as ageH/vary elsewhere — not
 * randomized, so the demo is stable across reloads).
 */
function concurrentRowFor(c: CaseRec): ConcurrentRow {
  const n = Number(c.authId.slice(-2));
  const los = 3 + (n % 10);
  const expectedLos = 3 + ((n + 3) % 8);
  const daysApproved = Math.max(1, expectedLos - (n % 3));
  const daysRequested = daysApproved + (n % 4);
  const nextReviewDate = new Date(TODAY);
  nextReviewDate.setDate(nextReviewDate.getDate() + (2 + (n % 5)));
  const diff = los - expectedLos;
  const overstayRisk = diff >= 3 ? 'red' : diff >= 1 ? 'amber' : 'green';
  const overstayLabel = diff >= 3 ? 'High' : diff >= 1 ? 'Medium' : 'Low';
  return {
    member: c.member, facility: c.provider,
    admit: c.submitted, nextReview: nextReviewDate.toISOString().slice(0, 10),
    los: `${los}d`, losFlag: diff > 0, expectedLos: `${expectedLos}d`,
    daysApproved, daysRequested,
    overstayRisk, overstayLabel,
  };
}

/**
 * Active / Pending / Completed / Avg TAT are real counts from the case pool (not placeholder
 * flavor text) so each Workload column means something distinct and its drill-down matches it:
 *  - active    = every pending authorization currently assigned to this nurse
 *  - pending   = the subset of those awaiting an external response (RFI / peer-to-peer)
 *  - completed = decided authorizations this nurse has closed
 * Utilization stays an independently-curated capacity indicator (real UM workload reflects case
 * complexity, not just raw count) — that's what gives Balance/Reassign a busiest-vs-most-capacity
 * spread to work with, rather than everyone landing at a near-identical case count.
 */
/**
 * A "queue" is the pool of authorizations available for any nurse to pull next — not every
 * authorization currently sitting at that stage. Most authorizations at a stage are already
 * claimed by a nurse (see nurseStats above); only the unclaimed ones (nurse === '—') belong to
 * the shared queue. Count and age bars are both computed from that unclaimed subset only, so a
 * queue card's bars describe exactly the cases its count refers to.
 */
function queueStats(statusName: string, opts?: { lob?: string; withinDays?: number }) {
  const unclaimed = CASE_POOL.filter((c) =>
    c.phase === 'pending' && c.status === statusName && c.nurse === '—' &&
    (!opts?.lob || opts.lob === 'all' || lobOf(c.authId) === opts.lob) &&
    (opts?.withinDays === undefined || daysAgo(c.submitted) <= opts.withinDays),
  );
  const total = unclaimed.length || 1;
  const bands = { fresh: 0, day2: 0, over48: 0, breach: 0 };
  unclaimed.forEach((c) => { bands[bandOf(c.authId, c.tags.includes('breached'))]++; });
  return {
    count: unclaimed.length,
    buckets: {
      fresh: Math.round((bands.fresh / total) * 100), day2: Math.round((bands.day2 / total) * 100),
      over48: Math.round((bands.over48 / total) * 100), breach: Math.round((bands.breach / total) * 100),
    },
  };
}

function nurseStats(name: string, opts?: { lob?: string; withinDays?: number }) {
  const inScope = (c: CaseRec) =>
    (!opts?.lob || opts.lob === 'all' || lobOf(c.authId) === opts.lob) &&
    (opts?.withinDays === undefined || daysAgo(c.submitted) <= opts.withinDays);
  const active = CASE_POOL.filter((c) => c.phase === 'pending' && c.nurse === name && inScope(c));
  const pending = active.filter((c) => c.tags.includes('rfi') || c.tags.includes('p2p'));
  const completed = CASE_POOL.filter((c) => c.phase === 'decided' && c.nurse === name && inScope(c));
  const avgTatH = completed.length ? completed.reduce((s, c) => s + c.tatH, 0) / completed.length : 0;
  return { active: active.length, pending: pending.length, completed: completed.length, avgTat: `${avgTatH.toFixed(1)}h` };
}

const pctOf = (n: number, d: number) => Math.round((n / (d || 1)) * 100);

export interface HistoryEntry {
  time: string;
  icon: string;
  action: string;
  detail: string;
  actor: string;
}

/**
 * Every authorization currently sitting unclaimed because it was returned (not the never-touched
 * Intake ones) gets a real history entry explaining why — either the nurse sent it back, or the
 * system auto-returned it after the SLA window passed without action.
 */
function seedReturnHistory(): HistoryEntry[] {
  const returned = CASE_POOL.filter((c) => c.phase === 'pending' && c.tags.includes('returned'));
  return returned.map((c, idx) => {
    const prevOwner = NURSES[idx % NURSES.length];
    const auto = idx % 3 !== 0; // most returns are SLA timeouts; some are nurse-initiated
    const hh = 8 + (idx % 4);
    const mm = (idx * 11) % 60;
    return {
      time: `${hh}:${mm < 10 ? '0' : ''}${mm} AM`,
      icon: 'inbox',
      action: auto ? 'Auto-returned to queue' : 'Returned to queue',
      detail: auto
        ? `${c.authId} (${c.member}) — not worked within the SLA window; returned from ${prevOwner}`
        : `${c.authId} (${c.member}) — sent back to the queue by ${prevOwner}`,
      actor: auto ? 'System' : prevOwner,
    } as HistoryEntry;
  });
}

const STORAGE_KEY = 'zyter-um-demo-v3';

@Injectable({ providedIn: 'root' })
export class DashboardData {
  readonly today = 'Friday, July 17, 2026';

  // Mutable collections are signals so the UI reacts to demo actions.
  readonly kpis = signal<Kpi[]>([
    { icon: 'folder',   value: '247',   label: 'Pending Authorizations', tone: 'green' },
    { icon: 'check',    value: '94.2%', label: 'TAT Compliance',    tone: 'green' },
    { icon: 'bolt',     value: '38%',   label: 'Auto-Approval Rate', tone: 'teal' },
    { icon: 'alert',    value: '12',    label: 'Authorizations at Risk', tone: 'amber' },
    { icon: 'clock',    value: '2.4h',  label: 'Avg Handle Time',   tone: 'teal' },
    { icon: 'inbox',    value: '39',    label: 'Unassigned Queue',  tone: 'amber' },
    { icon: 'xcircle',  value: '3',     label: 'Breached TAT',      tone: 'red' },
    { icon: 'users',    value: '87%',   label: 'Team Utilization',  tone: 'green' },
  ]);

  // ---------- Workforce & Queue Management ----------
  // Each card is the unclaimed pool for that stage — not everything currently at that stage (most
  // of which is already claimed by a nurse; see the Workload table). Count + age bars are both
  // computed live from the case pool via queueStats(), so they always describe the same set.
  readonly queues = signal<QueueCard[]>([
    { name: 'Intake', ...queueStats('Intake') },
    { name: 'Clinical Review', ...queueStats('Clinical Review') },
    { name: 'MD Review', ...queueStats('MD Review') },
    { name: 'RFI Pending', ...queueStats('RFI Pending') },
    { name: 'OON Review', ...queueStats('OON Review') },
    { name: 'Concurrent Review', ...queueStats('Concurrent Review') },
    { name: 'Pending P2P', ...queueStats('Pending P2P') },
  ]);

  readonly nurses = signal<NurseRow[]>([
    { name: 'Maria Gonzalez, RN',  team: 'Inpatient Review',     ...nurseStats('Maria Gonzalez, RN'),  utilization: 92 },
    { name: 'Andrew Mitchell, RN', team: 'Inpatient Review',     ...nurseStats('Andrew Mitchell, RN'), utilization: 96 },
    { name: 'Jessica Williams, RN', team: 'Outpatient Review',   ...nurseStats('Jessica Williams, RN'), utilization: 85 },
    { name: 'Sarah Mitchell, RN',  team: 'Outpatient Review',    ...nurseStats('Sarah Mitchell, RN'),  utilization: 72 },
    { name: 'Emily Chen, RN',      team: 'Complex & Concurrent', ...nurseStats('Emily Chen, RN'),      utilization: 88 },
    { name: 'Robert Kim, RN',      team: 'Complex & Concurrent', ...nurseStats('Robert Kim, RN'),      utilization: 80 },
  ]);

  // ---------- TAT & SLA Compliance, Clinical Decision Insights, Concurrent Review ----------
  // These 3 sections' headline numbers are exported as plain functions (below the class) instead of
  // static arrays, so every consumer — the tab's own on-screen computed(), and the global Export
  // button in app.ts — always reads the exact same live, LOB/Lookback-scoped values.

  // ---------- Intake & Documentation Quality ----------
  readonly qualityBars: QualityBar[] = [
    { label: 'Complete Submissions', pct: 87, tone: 'green', icon: 'check' },
    { label: 'Auto-Approved',        pct: 38, tone: 'teal',  icon: 'bolt' },
    { label: 'Needing RFI',          pct: 15, tone: 'amber', icon: 'mail' },
  ];
  readonly missingFields: MissingField[] = [
    { field: 'Clinical Justification',   count: 23, pct: 42 },
    { field: 'Provider NPI',             count: 18, pct: 33 },
    { field: 'Diagnosis Code (ICD-10)',  count: 14, pct: 25 },
    { field: 'Procedure Code (CPT)',     count: 11, pct: 20 },
    { field: 'Supporting Documentation', count: 9,  pct: 16 },
  ];

  // ---------- Provider & Network Insights ----------
  readonly oonRequests = 47;
  readonly providers: ProviderRow[] = [
    { provider: 'Dr. Sarah Mitchell',          npi: '1234567890', requests: 34, approvalRate: 82, rfiRate: 12, rfiHigh: false },
    { provider: 'Dr. James Parker',            npi: '0987654321', requests: 28, approvalRate: 75, rfiRate: 18, rfiHigh: false },
    { provider: 'Dr. Emily Chen',              npi: '1122334455', requests: 25, approvalRate: 91, rfiRate: 5,  rfiHigh: false },
    { provider: 'Memorial Orthopedic Group',   npi: '5544332211', requests: 22, approvalRate: 68, rfiRate: 24, rfiHigh: true },
    { provider: 'Regional Heart Center',       npi: '6677889900', requests: 19, approvalRate: 88, rfiRate: 8,  rfiHigh: false },
    { provider: 'Coastal Neurology Associates', npi: '1133557799', requests: 17, approvalRate: 71, rfiRate: 22, rfiHigh: true },
  ];

  // ---------- Financial / Cost Indicators ----------
  readonly financials = [
    { value: '$4.3M', label: 'Estimated Pending Cost', icon: 'dollar' },
    { value: '$1.8M', label: 'Cost Avoided (MTD)',     icon: 'shield' },
    { value: '+1.3d', label: 'LOS Variance',           icon: 'barchart' },
  ];
  readonly highDollarCases: HighDollarCase[] = [
    { authId: 'AUTH-4521', member: 'Johnson, Robert',  procedure: 'Cardiac Bypass (CABG)',     cost: '$285K', status: 'Pending Review' },
    { authId: 'AUTH-4498', member: 'Martinez, Carlos', procedure: 'Liver Transplant Evaluation', cost: '$142K', status: 'Pending MD Review' },
    { authId: 'AUTH-4534', member: 'Williams, Sarah',  procedure: 'NICU Stay (21 days)',        cost: '$198K', status: 'Concurrent Review' },
    { authId: 'AUTH-4512', member: 'Thompson, James',  procedure: 'Spinal Fusion (3-level)',    cost: '$127K', status: 'Pending Peer-to-Peer' },
  ];

  // ---------- Audit & Compliance ----------
  readonly complianceBars: QualityBar[] = [
    { label: 'Documentation Completeness', pct: 82, tone: 'teal', icon: '' },
    { label: 'Guideline Adherence',        pct: 94, tone: 'teal', icon: '' },
    { label: 'Decision Rationale Documented', pct: 89, tone: 'teal', icon: '' },
  ];
  readonly auditFlags = signal<AuditFlag[]>([
    { id: 'AUD-201', type: 'Missing Rationale',       description: 'Decision rationale not documented for AUTH-4488', date: '2026-03-15', severity: 'amber', severityLabel: 'Medium' },
    { id: 'AUD-202', type: 'Guideline Deviation',     description: 'Approval without XYZ criteria match — AUTH-4501',  date: '2026-03-14', severity: 'red',   severityLabel: 'High' },
    { id: 'AUD-203', type: 'Incomplete Documentation', description: 'Clinical notes incomplete for concurrent review AUTH-4515', date: '2026-03-16', severity: 'green', severityLabel: 'Low' },
    { id: 'AUD-204', type: 'TAT Compliance',          description: 'Decision rendered after SLA deadline — AUTH-4473', date: '2026-03-13', severity: 'red',   severityLabel: 'High' },
  ]);

  // ---------- AI / NextGen Intelligence ----------
  readonly aiRecommendations = signal<AiRecommendation[]>([
    { icon: 'swap',   title: 'Reassign Authorization AUTH-4587', detail: 'Nurse Andrew Mitchell is at 96% capacity. Reassign to Sarah Mitchell (72%) to prevent TAT breach.', confidence: 94, action: 'Reassign Authorization', tone: 'red' },
    { icon: 'mail',   title: 'Send RFI for AUTH-4521', detail: 'Clinical justification missing for cardiac bypass request. Provider has 24h response history.', confidence: 89, action: 'Send RFI', tone: 'amber' },
    { icon: 'arrowup', title: 'Escalate AUTH-4498 to MD', detail: 'Liver transplant evaluation exceeds nurse review scope. Dr. Patel available for immediate review.', confidence: 97, action: 'Escalate to MD', tone: 'blue' },
  ]);
  readonly riskGauges = [
    { value: 23, label: 'Denial Likelihood',  tone: 'red' as const },
    { value: 15, label: 'Appeal Likelihood',  tone: 'amber' as const },
    { value: 8,  label: 'TAT Breach Risk',    tone: 'amber' as const },
  ];
  readonly aiAutoApproved = 38;
  readonly aiConfidence = [
    { label: 'High (>90%)',    pct: 72, tone: 'teal' as const },
    { label: 'Medium (70-90%)', pct: 21, tone: 'amber' as const },
    { label: 'Low (<70%)',     pct: 7,  tone: 'red' as const },
  ];

  // ---------- Risk & Escalation Panel (matches um-supervisor.html) ----------
  readonly riskTiles: RiskTile[] = [
    { icon: 'alert',  label: 'SLA Breach Risk',       value: '12', footer: '3 already breached',        footerTone: 'red', tone: 'red' },
    { icon: 'dollar', label: 'High-Dollar (>$50k)',   value: '9',  footer: '$1.2M exposure',            tone: 'amber' },
    { icon: 'shield', label: 'High-Acuity',           value: '14', footer: 'ICU / transplant / oncology', tone: 'amber' },
    { icon: 'arrowup', label: 'Escalated Today',      value: '6',  footer: '4 to MD, 2 to peer-to-peer', tone: 'blue' },
  ];
  readonly riskCases = signal<RiskCase[]>([
    { authId: 'IP542119', member: 'Karen Wells',   drivers: ['SLA breached', 'Expedited'],       amount: '$18k',  stage: 'Clinical Review', score: 98, risk: 'red' },
    { authId: 'IP543902', member: 'Robert Hayes',  drivers: ['2h to SLA', 'High-acuity ICU'],    amount: '$142k', stage: 'Clinical Review', score: 95, risk: 'red' },
    { authId: 'IP540088', member: 'George Pike',   drivers: ['High-dollar', 'Transplant'],       amount: '$310k', stage: 'MD Review',       score: 91, risk: 'red' },
    { authId: 'OP331880', member: 'Luis Ramirez',  drivers: ['RFI aging 4d', 'SLA risk'],        amount: '$7k',   stage: 'RFI Pending',     score: 82, risk: 'amber' },
    { authId: 'IP539774', member: 'Nina Patel',    drivers: ['Oncology', 'High-dollar'],         amount: '$88k',  stage: 'Concurrent',      score: 79, risk: 'amber' },
    { authId: 'OP329910', member: 'Frank Doyle',   drivers: ['OON', 'Appeal risk'],              amount: '$26k',  stage: 'OON Review',      score: 74, risk: 'amber' },
  ]);

  // ---------- activity / reassignment history ----------
  readonly history = signal<HistoryEntry[]>(seedReturnHistory());

  /** Just the assignment-moving entries (reassign + balance) — the full activity log also includes escalations, etc. */
  readonly assignmentHistory = computed(() => this.history().filter((h) => h.icon === 'swap' || h.icon === 'balance'));

  addHistory(icon: string, action: string, detail: string, actor = 'Christina Lawson') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.history.update((h) => [{ time, icon, action, detail, actor }, ...h]);
  }

  // ---------- persistence (localStorage) ----------
  private defaults: any;

  constructor() {
    // capture pristine defaults before any hydration
    this.defaults = this.snapshot();
    this.hydrate();
    // auto-save whenever any persisted signal changes
    effect(() => {
      const blob = this.snapshot();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(blob)); } catch {}
    });
  }

  private snapshot() {
    return {
      kpis: this.kpis(), queues: this.queues(), nurses: this.nurses(),
      aiRecommendations: this.aiRecommendations(), riskCases: this.riskCases(),
      auditFlags: this.auditFlags(),
      history: this.history(),
    };
  }

  private hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.kpis) this.kpis.set(s.kpis);
      if (s.queues) this.queues.set(s.queues);
      if (s.nurses) this.nurses.set(s.nurses);
      if (s.aiRecommendations) this.aiRecommendations.set(s.aiRecommendations);
      if (s.riskCases) this.riskCases.set(s.riskCases);
      if (s.auditFlags) this.auditFlags.set(s.auditFlags);
      if (s.history) this.history.set(s.history);
    } catch {}
  }

  /** Restore every mutable collection to its original demo state. */
  resetDemo() {
    const d = structuredClone(this.defaults);
    this.kpis.set(d.kpis); this.queues.set(d.queues); this.nurses.set(d.nurses);
    this.aiRecommendations.set(d.aiRecommendations); this.riskCases.set(d.riskCases);
    this.auditFlags.set(d.auditFlags);
    this.history.set(d.history); // restores the seeded return-to-queue entries, clears session actions
  }

  // ---------- demo actions (mutate signal-backed state) ----------

  private setKpi(label: string, transform: (n: number) => number, suffix = '') {
    this.kpis.update((list) =>
      list.map((k) => {
        if (k.label !== label) return k;
        const num = parseFloat(k.value);
        const next = transform(isNaN(num) ? 0 : num);
        return { ...k, value: `${next}${suffix}` };
      }),
    );
  }

  /** Recompute a nurse's utilization proportionally to their own load change. */
  private withActive(n: NurseRow, nextActive: number, pendingDelta = 0): NurseRow {
    const active = Math.max(0, nextActive);
    // preserve each nurse's own active→utilization ratio, so more cases → higher %
    const perCase = n.active > 0 ? n.utilization / n.active : 3;
    const utilization = Math.max(0, Math.min(100, Math.round(active * perCase)));
    return { ...n, active, pending: Math.max(0, n.pending + pendingDelta), utilization };
  }

  /** Move one case from the busiest nurse to the one with most headroom — optionally restricted to a subset of nurse names (e.g. one team). */
  reassignBusiest(nurseScope?: string[]): { from: string; to: string } | null {
    const list = this.nurses().filter((n) => !nurseScope || nurseScope.includes(n.name));
    if (list.length < 2) return null;
    const from = list.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    const to = list.reduce((a, b) => (b.utilization < a.utilization ? b : a));
    if (from.name === to.name) return null;
    this.nurses.update((rows) =>
      rows.map((n) => {
        if (n.name === from.name) return this.withActive(n, n.active - 1, -1);
        if (n.name === to.name) return this.withActive(n, n.active + 1);
        return n;
      }),
    );
    return { from: from.name, to: to.name };
  }

  /** Move one case from a specific owner (or Unassigned) to a target nurse. */
  moveOneCase(fromName: string | null, toName: string) {
    this.nurses.update((rows) =>
      rows.map((n) => {
        if (fromName && n.name === fromName && n.name !== toName) return this.withActive(n, n.active - 1);
        if (n.name === toName) return this.withActive(n, n.active + 1);
        return n;
      }),
    );
  }

  /** Reassign to a specific nurse (from the busiest). */
  reassignTo(targetName: string) {
    this.nurses.update((rows) => {
      const from = rows.reduce((a, b) => (b.utilization > a.utilization ? b : a));
      return rows.map((n) => {
        if (n.name === from.name && n.name !== targetName) return this.withActive(n, n.active - 1, -1);
        if (n.name === targetName) return this.withActive(n, n.active + 1);
        return n;
      });
    });
  }

  /** Assign N unassigned cases to a nurse and shrink the Unassigned Queue KPI. */
  assignUnassigned(count: number, target: string) {
    for (let i = 0; i < count; i++) this.moveOneCase(null, target);
    this.setKpi('Unassigned Queue', (n) => Math.max(0, n - count));
  }

  /** Drop one case from a named queue (min 0). */
  decrementQueue(name: string) {
    this.queues.update((qs) =>
      qs.map((q) => (q.name === name ? { ...q, count: Math.max(0, q.count - 1) } : q)),
    );
  }

  dismissRecommendation(title: string) {
    this.aiRecommendations.update((r) => r.filter((x) => x.title !== title));
  }

  resolveRiskCase(authId: string) {
    this.riskCases.update((r) => r.filter((x) => x.authId !== authId));
    this.setKpi('Authorizations at Risk', (n) => Math.max(0, n - 1));
  }

  resolveAuditFlag(id: string) {
    this.auditFlags.update((f) => f.filter((x) => x.id !== id));
  }

  /**
   * Active/Pending/Completed/Avg TAT for one nurse, scoped to a LOB and/or a lookback window —
   * recomputed live from the case pool so the Workload table reacts to the shared top-bar LOB and
   * Lookback filters the same way the queue cards do. Utilization is left untouched: it's the
   * nurse's overall capacity indicator (and reflects any session reassign/balance moves), not a
   * value that splits meaningfully by LOB or date.
   */
  nurseStatsForLob(name: string, lob?: string, withinDays?: number) {
    return nurseStats(name, { lob, withinDays });
  }

  /** Same idea as nurseStatsForLob, for one queue's unclaimed pool — used by Workforce's queue cards. */
  queueStatsScoped(statusName: string, lob?: string, withinDays?: number) {
    return queueStats(statusName, { lob, withinDays });
  }

  /**
   * The 8 top KPI tiles, recomputed live from the case pool for a given lookback window (days back
   * from "today", inclusive; undefined = no date filter). Mirrors the same math as the static
   * `kpis` signal's default values so switching lookback periods shows a real, consistent picture
   * instead of hand-picked flavor numbers.
   */
  liveKpis(withinDays: number): Kpi[] {
    const within = (c: CaseRec) => daysAgo(c.submitted) <= withinDays;
    const pendingIn = CASE_POOL.filter((c) => c.phase === 'pending' && within(c));
    const decidedIn = CASE_POOL.filter((c) => c.phase === 'decided' && within(c));
    const onTrack = decidedIn.filter((c) => c.tags.includes('onTrack')).length;
    const auto = decidedIn.filter((c) => c.tags.includes('auto')).length;
    const avgTatH = decidedIn.length ? decidedIn.reduce((s, c) => s + c.tatH, 0) / decidedIn.length : 0;
    const unassigned = pendingIn.filter((c) => c.nurse === '—').length;
    const breached = pendingIn.filter((c) => c.tags.includes('breached')).length;
    const atRisk = pendingIn.filter((c) => c.tags.includes('atRisk')).length;
    const nurseRows = this.nurses();
    const util = pctOf(nurseRows.reduce((s, n) => s + n.utilization, 0), nurseRows.length);
    return [
      { icon: 'folder',  value: `${pendingIn.length}`,        label: 'Pending Authorizations', tone: 'green' },
      { icon: 'check',   value: `${pctOf(onTrack, decidedIn.length)}%`, label: 'TAT Compliance',    tone: 'green' },
      { icon: 'bolt',    value: `${pctOf(auto, decidedIn.length)}%`,    label: 'Auto-Approval Rate', tone: 'teal' },
      { icon: 'alert',   value: `${atRisk}`,                  label: 'Authorizations at Risk', tone: 'amber' },
      { icon: 'clock',   value: `${avgTatH.toFixed(1)}h`,     label: 'Avg Handle Time',   tone: 'teal' },
      { icon: 'inbox',   value: `${unassigned}`,               label: 'Unassigned Queue',  tone: 'amber' },
      { icon: 'xcircle', value: `${breached}`,                 label: 'Breached TAT',      tone: 'red' },
      { icon: 'users',   value: `${util}%`,                    label: 'Team Utilization',  tone: 'green' },
    ];
  }
}

// ---------------------------------------------------------------------------------------------
// Live, LOB/Lookback-scoped derivations shared by a tab's own on-screen computed() AND the global
// Export button in app.ts, so a tile's number, its drilldown table, and its CSV export can never
// drift apart the way separately hand-typed static arrays used to.
// ---------------------------------------------------------------------------------------------

function inScope(c: CaseRec, lob?: string, withinDays?: number): boolean {
  return (!lob || lob === 'all' || lobOf(c.authId) === lob)
    && (withinDays === undefined || daysAgo(c.submitted) <= withinDays);
}

export function liveTatBuckets(lob?: string, withinDays?: number): TatBucket[] {
  const cs = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, withinDays));
  return [
    { label: 'On Track', count: cs.filter((c) => c.tags.includes('onTrack')).length, tone: 'green' },
    { label: 'At Risk', count: cs.filter((c) => c.tags.includes('atRisk')).length, tone: 'amber' },
    { label: 'Breached', count: cs.filter((c) => c.tags.includes('breached')).length, tone: 'red' },
  ];
}

export function liveTatStats(lob?: string, withinDays?: number): TatStat[] {
  const decided = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, withinDays));
  const pending = CASE_POOL.filter((c) => c.phase === 'pending' && inScope(c, lob, withinDays));
  const avg = decided.length ? `${(decided.reduce((s, c) => s + c.tatH, 0) / decided.length).toFixed(1)}d` : '0.0d';
  return [
    { value: String(decided.filter((c) => c.tags.includes('expedited')).length), label: 'Expedited' },
    { value: String(decided.filter((c) => c.tags.includes('standard')).length), label: 'Standard' },
    { value: String(pending.filter((c) => c.tags.includes('paused')).length), label: 'Paused' },
    { value: avg, label: 'Avg Turnaround' },
  ];
}

export function liveDecisionStats(lob?: string, withinDays?: number): DecisionStat[] {
  const cs = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, withinDays));
  const total = cs.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const count = (fn: (c: CaseRec) => boolean) => cs.filter(fn).length;
  return [
    { value: `${pct(count((c) => c.decision === 'Approved'))}%`, label: 'Approved', icon: 'check', tone: 'green' },
    { value: `${pct(count((c) => c.decision === 'Denied'))}%`, label: 'Denied', icon: 'xcircle', tone: 'red' },
    { value: `${pct(count((c) => c.decision === 'Partial'))}%`, label: 'Partial', icon: 'minus', tone: 'amber' },
    { value: `${pct(count((c) => c.tags.includes('auto')))}%`, label: 'Auto-Approved', icon: 'bolt', tone: 'teal' },
    { value: `${pct(count((c) => c.tags.includes('mdReview')))}%`, label: 'MD Review', icon: 'user', tone: 'blue' },
    { value: `${pct(count((c) => c.tags.includes('p2p')))}%`, label: 'P2P Rate', icon: 'phone', tone: 'purple' as any },
  ];
}

export function liveDecisionRows(lob?: string, withinDays?: number): DecisionRow[] {
  const cs = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, withinDays));
  const byProc = new Map<string, CaseRec[]>();
  for (const c of cs) { if (!byProc.has(c.procedure)) byProc.set(c.procedure, []); byProc.get(c.procedure)!.push(c); }
  return [...byProc.entries()].map(([procedure, group]) => ({
    procedure,
    serviceType: group[0].serviceType,
    guideline: GUIDELINE_BY_PROCEDURE[procedure] ?? 'Internal Criteria',
    approvalRate: Math.round((group.filter((c) => c.decision === 'Approved').length / group.length) * 100),
    volume: group.length,
  })).sort((a, b) => b.volume - a.volume);
}

export function liveConcurrentRows(lob?: string, withinDays?: number): ConcurrentRow[] {
  return CASE_POOL
    .filter((c) => c.phase === 'pending' && c.tags.includes('concurrent') && inScope(c, lob, withinDays))
    .map(concurrentRowFor);
}
