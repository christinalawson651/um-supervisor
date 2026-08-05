import { Injectable, signal, effect, computed } from '@angular/core';
import {
  Kpi, QueueCard, NurseRow, TatBucket, TatStat, DecisionStat, DecisionRow,
  ConcurrentRow, QualityBar, MissingField, ProviderInsightRow, ProviderFlag,
  AuditFlag, AiRecommendation, RiskCase, RiskTile, CostInsightRow, CostFlag,
} from './dashboard.models';
import { CASE_POOL, NURSES, CaseRec, GUIDELINE_BY_PROCEDURE, PROVIDERS, NPI_BY_PROVIDER } from './case-pool';
import {
  ageH, bandOf, lobOf, daysAgo, TODAY, APPROVAL_CODES, DENIAL_CODES, determinationReasonOf,
  providerMetaOf, providerResponseDaysOf, rfiOriginStageOf, serviceCategoryOf, urgencyOf,
  isDuplicateOf, duplicateResolvedOf,
} from './case-fields';

/**
 * One inpatient concurrent-review row per real 'concurrent'-tagged case in the pool (LOS/admit/
 * review-due fields are deterministic per authId, same pattern as ageH/vary elsewhere — not
 * randomized, so the demo is stable across reloads).
 *
 * Certified Through / Days Remaining / Uncertified Days are the primary risk indicators: Total
 * Certified Days can lag behind the actual LOS (the nurse hasn't certified the most recent days
 * yet) — that gap is Uncertified Days, a real payment/compliance risk distinct from Requested/
 * Approved (the provider explicitly asking for *additional* days beyond what's certified).
 */
function concurrentRowFor(c: CaseRec): ConcurrentRow {
  const n = Number(c.authId.slice(-2));
  const los = 3 + (n % 10);                 // current day of stay — "today" is day `los`
  const expectedLos = 3 + ((n + 3) % 8);     // total days this stay was expected to run

  // Certification is usually granted a few days *ahead* of the current stay day; ~20% of cases
  // lag behind instead (the nurse hasn't certified the most recent day(s)) — that gap is Uncertified
  // Days, a real payment/compliance risk. Both are anchored on `los`/TODAY, not the submitted date,
  // so Certified Through and Days Remaining land near today regardless of how old the auth record is.
  const lagging = n % 5 === 0;
  const totalCertifiedDays = lagging ? Math.max(1, los - 2) : los + (1 + (n % 4));
  const uncertifiedDays = Math.max(0, los - totalCertifiedDays);
  const daysRemaining = totalCertifiedDays - los;
  const overExpected = los > expectedLos;
  const daysRequested = totalCertifiedDays + (overExpected && n % 3 === 0 ? 3 : 0);

  const certifiedThroughDate = new Date(TODAY);
  certifiedThroughDate.setDate(certifiedThroughDate.getDate() + daysRemaining);

  const nextReviewDate = new Date(TODAY);
  nextReviewDate.setDate(nextReviewDate.getDate() + (2 + (n % 5)));

  const expectedDischargeDate = new Date(TODAY);
  expectedDischargeDate.setDate(expectedDischargeDate.getDate() + (expectedLos - los));

  const diff = los - expectedLos;
  const overstayRisk = diff >= 3 ? 'red' : diff >= 1 ? 'amber' : 'green';
  const overstayLabel = diff >= 3 ? 'High' : diff >= 1 ? 'Medium' : 'Low';

  let status: string; let statusTone: 'green' | 'amber' | 'red'; let nextAction: string; let nextActionShort: string;
  if (uncertifiedDays > 0) {
    status = 'Uncertified Days'; statusTone = 'red';
    nextAction = `Certify ${uncertifiedDays} outstanding day(s) or request a retro review`;
    nextActionShort = `Certify ${uncertifiedDays}d gap`;
  } else if (daysRequested > totalCertifiedDays) {
    status = 'Extension Requested'; statusTone = 'amber';
    nextAction = `Route ${daysRequested - totalCertifiedDays} additional day(s) to formal review`;
    nextActionShort = 'Route extension';
  } else if (daysRemaining <= 1) {
    status = 'Recert Due'; statusTone = 'amber';
    nextAction = 'Submit continued-stay review before certification lapses';
    nextActionShort = 'Recertify';
  } else {
    status = 'Certified'; statusTone = 'green';
    nextAction = 'Continue monitoring — no action needed';
    nextActionShort = 'Monitor';
  }

  return {
    authId: c.authId,
    member: c.member, facility: c.provider,
    admit: c.submitted,
    los: `${los}d`, losFlag: diff > 0,
    totalCertifiedDays,
    certifiedThrough: certifiedThroughDate.toISOString().slice(0, 10),
    daysRemaining, uncertifiedDays,
    nextReview: nextReviewDate.toISOString().slice(0, 10),
    daysRequested,
    status, statusTone,
    reviewer: c.nurse,
    expectedDischarge: expectedDischargeDate.toISOString().slice(0, 10),
    nextAction, nextActionShort,
    expectedLos: `${expectedLos}d`,
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
  // liveQualityBars()/liveMissingFields() (below the class) are the real source now.

  // ---------- Provider & Network Insights ----------
  // liveProviderInsights() (below the class) is the real source now; OON Requests uses Metrics.count('prov.oon').

  // ---------- Financial / Cost Indicators ----------
  // liveCostInsights() (below the class) is the real source now.

  // ---------- Audit & Compliance ----------
  // liveComplianceBars() (below the class) is the real source now. auditFlags stays a curated,
  // session-mutable list (like riskCases) — these are discrete flagged audit EVENTS, not an
  // aggregate stat, so they aren't derived from the case pool the way the compliance bars are.
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

  /** Add one case to a named queue — pairs with decrementQueue() for a "move to queue" action. */
  incrementQueue(name: string) {
    this.queues.update((qs) =>
      qs.map((q) => (q.name === name ? { ...q, count: q.count + 1 } : q)),
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

export function inScope(c: CaseRec, lob?: string, withinDays?: number): boolean {
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

export interface DeterminationMixRow { code: string; label: string; category: string; count: number; pct: number; }
export type DeterminationOutcome = 'Approved' | 'Denied' | 'Partial';

/** Breakdown of the reason codes behind one outcome's determinations — the real UM workflow
 *  requires one of these codes on every determination, not just denials. Denied and Partial are
 *  tracked separately (Partial still uses denial-style codes for why the cut portion was reduced). */
export function liveDeterminationMix(outcome: DeterminationOutcome, lob?: string, withinDays?: number): DeterminationMixRow[] {
  const cs = CASE_POOL.filter((c) => c.phase === 'decided' && c.decision === outcome && inScope(c, lob, withinDays));
  const total = cs.length || 1;
  const codes = outcome === 'Approved' ? APPROVAL_CODES : DENIAL_CODES;
  return codes
    .map((d) => {
      const count = cs.filter((c) => determinationReasonOf(c)?.code === d.code).length;
      return { code: d.code, label: d.label, category: d.category, count, pct: Math.round((count / total) * 100) };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** The real cases behind one reason code — backs both the mix row's click-through and its export. */
export function liveDeterminationCases(outcome: DeterminationOutcome, code: string, lob?: string, withinDays?: number): CaseRec[] {
  return CASE_POOL.filter((c) => c.phase === 'decided' && c.decision === outcome && inScope(c, lob, withinDays)
    && determinationReasonOf(c)?.code === code);
}

export function liveConcurrentRows(lob?: string, withinDays?: number): ConcurrentRow[] {
  return CASE_POOL
    .filter((c) => c.phase === 'pending' && c.tags.includes('concurrent') && inScope(c, lob, withinDays))
    .map(concurrentRowFor);
}

export function liveQualityBars(lob?: string, withinDays?: number): QualityBar[] {
  const pendingCs = CASE_POOL.filter((c) => c.phase === 'pending' && inScope(c, lob, withinDays));
  const decidedCs = CASE_POOL.filter((c) => c.phase === 'decided' && inScope(c, lob, withinDays));
  return [
    { label: 'Complete Submissions', pct: pctOf(pendingCs.filter((c) => !c.tags.includes('incompleteDoc')).length, pendingCs.length), tone: 'green', icon: 'check' },
    { label: 'Auto-Approved', pct: pctOf(decidedCs.filter((c) => c.tags.includes('auto')).length, decidedCs.length), tone: 'teal', icon: 'bolt' },
    { label: 'Needing RFI', pct: pctOf(pendingCs.filter((c) => c.tags.includes('rfi')).length, pendingCs.length), tone: 'amber', icon: 'mail' },
  ];
}

const MISSING_FIELDS = ['Clinical Justification', 'Provider NPI', 'Diagnosis Code (ICD-10)', 'Procedure Code (CPT)', 'Supporting Documentation'];
/** Deterministic primary missing field per incomplete case (not randomized — stable per authId). */
function missingFieldOf(c: CaseRec): string {
  return MISSING_FIELDS[Number(c.authId.slice(-2)) % MISSING_FIELDS.length];
}

export function liveMissingFields(lob?: string, withinDays?: number): MissingField[] {
  const pendingCs = CASE_POOL.filter((c) => c.phase === 'pending' && inScope(c, lob, withinDays));
  const incomplete = pendingCs.filter((c) => c.tags.includes('incompleteDoc'));
  const counts = new Map<string, number>();
  for (const c of incomplete) { const f = missingFieldOf(c); counts.set(f, (counts.get(f) ?? 0) + 1); }
  return MISSING_FIELDS
    .map((field) => ({ field, count: counts.get(field) ?? 0, pct: pctOf(counts.get(field) ?? 0, pendingCs.length) }))
    .sort((a, b) => b.count - a.count);
}

const HIGH_COST_THRESHOLD = 50000;
const DRUG_COST_THRESHOLD = 10000;

/** Deterministic, per-case "modeled approval rate" — not a real decision (these are pending cases),
 *  just a stable estimate of what fraction of the requested cost would likely be approved, so the
 *  worklist can show a plausible requested-vs-approved variance before a decision exists. Skewed so
 *  most requests are modeled near full approval (realistic — most UM requests aren't contentious)
 *  and only a minority land in the low-factor band that's actually worth flagging as variance. */
function approvalFactorOf(authId: string): number {
  const h = Number(authId.slice(-2)) % 100;
  return h < 20 ? 0.5 + (h / 20) * 0.15 : 0.85 + ((h - 20) / 80) * 0.15;
}

/**
 * Cost & Utilization Insights — one row per ACTIVE (pending) authorization with a cost-exposure
 * flag. Reuses `concurrentRowFor` for the LOS/certified/uncertified fields on 'concurrent'-tagged
 * inpatient stays (single source of truth with Concurrent Review Monitoring) rather than
 * re-deriving that math here; non-inpatient/non-concurrent cases simply have no LOS data.
 */
export function liveCostInsights(lob?: string, withinDays?: number): CostInsightRow[] {
  const cases = CASE_POOL.filter((c) => c.phase === 'pending' && inScope(c, lob, withinDays));

  return cases.map((c) => {
    const meta = providerMetaOf(c.provider);
    const requestedCost = c.cost;
    const approvedCost = Math.round(requestedCost * approvalFactorOf(c.authId));
    const costVariance = requestedCost - approvedCost;

    // `concurrent` is a queue tag, not a service-type guarantee — a handful of non-inpatient cases
    // sit in the Concurrent Review queue too. LOS/certified-day fields only make sense for actual
    // inpatient stays, so gate on both rather than the tag alone (unlike liveConcurrentRows, which
    // is intentionally queue-scoped for its own worklist and out of scope to change here).
    const cr = c.tags.includes('concurrent') && c.serviceType === 'Inpatient' ? concurrentRowFor(c) : null;
    const los = cr ? parseInt(cr.los) : null;
    const expectedLos = cr ? parseInt(cr.expectedLos) : null;
    const certifiedDays = cr ? cr.totalCertifiedDays : null;
    const uncertifiedDays = cr ? cr.uncertifiedDays : null;
    const expectedDischarge = cr ? cr.expectedDischarge : null;
    const avoidableDays = los !== null && expectedLos !== null ? Math.max(0, los - expectedLos) : 0;
    const costPerDay = cr && los ? requestedCost / los : 0;

    const flags: CostFlag[] = [];
    const insights: string[] = [];
    const flag = (f: CostFlag, msg: string) => { flags.push(f); insights.push(msg); };

    if (requestedCost >= HIGH_COST_THRESHOLD) {
      flag('highCost', `Estimated cost of $${Math.round(requestedCost / 1000)}K exceeds the $${HIGH_COST_THRESHOLD / 1000}K supervisor-review threshold`);
    }
    if (c.tags.includes('oon')) {
      flag('oonExposure', `Out-of-network request estimated at $${Math.round(requestedCost / 1000)}K — confirm a network-access exception is documented`);
    }
    if (uncertifiedDays) {
      flag('uncertifiedDays', `${uncertifiedDays} uncertified inpatient day(s) estimated at $${Math.round(uncertifiedDays * costPerDay).toLocaleString()}`);
    }
    if (avoidableDays > 0) {
      flag('extendedStay', `Current stay exceeds expected LOS by ${avoidableDays} day(s) — estimated $${Math.round(avoidableDays * costPerDay).toLocaleString()} avoidable-day exposure`);
    }
    const svcCat = serviceCategoryOf(c);
    if ((svcCat === 'Pharmacy' || svcCat === 'DME / Home Health') && requestedCost >= DRUG_COST_THRESHOLD) {
      flag('highCostDrug', `High-cost ${svcCat === 'Pharmacy' ? 'drug' : 'DME'} request at $${Math.round(requestedCost / 1000)}K exceeds the supervisor-review threshold`);
    }
    if (costVariance >= Math.max(5000, requestedCost * 0.15)) {
      flag('costVariance', `Requested-vs-approved cost variance estimated at $${costVariance.toLocaleString()}`);
    }
    if (isDuplicateOf(c) && !duplicateResolvedOf(c)) {
      flag('duplicateService', `Potential duplicate-service authorization identified — $${Math.round(requestedCost / 1000)}K at risk`);
    }

    const exposures: number[] = [];
    if (flags.includes('uncertifiedDays')) exposures.push(Math.round((uncertifiedDays ?? 0) * costPerDay));
    if (flags.includes('extendedStay')) exposures.push(Math.round(avoidableDays * costPerDay));
    if (flags.includes('oonExposure') || flags.includes('duplicateService') || flags.includes('highCost') || flags.includes('highCostDrug')) exposures.push(requestedCost);
    if (flags.includes('costVariance')) exposures.push(costVariance);
    const costExposure = exposures.length ? Math.max(...exposures) : 0;

    return {
      authId: c.authId, member: c.member, service: c.procedure, serviceType: c.serviceType,
      provider: c.provider, networkStatus: c.tags.includes('oon') ? 'Out-of-Network' : meta.networkStatus,
      requestedCost, approvedCost, costVariance,
      los, certifiedDays, uncertifiedDays, expectedDischarge,
      costExposure, flags, insights,
      primaryInsight: insights[0] ?? 'Cost profile within expected range',
      needsAttention: flags.length > 0,
      assignedTo: c.nurse, urgency: urgencyOf(c), queue: c.status,
    };
  }).sort((a, b) => b.costExposure - a.costExposure);
}

/**
 * No single CaseRec tag maps 1:1 to "guideline adherence" or "rationale documented" — these are
 * reasonable proxies (adherence ~ decision wasn't appealed; rationale ~ approval wasn't purely
 * rule-based auto-approval and had complete documentation), not a literal stored field.
 */
export function liveComplianceBars(lob?: string, withinDays?: number): QualityBar[] {
  const all = CASE_POOL.filter((c) => inScope(c, lob, withinDays));
  const decided = all.filter((c) => c.phase === 'decided');
  const approved = decided.filter((c) => c.decision === 'Approved');
  return [
    { label: 'Documentation Completeness', pct: pctOf(all.filter((c) => !c.tags.includes('incompleteDoc')).length, all.length), tone: 'teal', icon: '' },
    { label: 'Guideline Adherence', pct: pctOf(decided.filter((c) => !c.tags.includes('appeal')).length, decided.length), tone: 'teal', icon: '' },
    { label: 'Decision Rationale Documented', pct: pctOf(approved.filter((c) => !c.tags.includes('auto') && !c.tags.includes('incompleteDoc')).length, approved.length), tone: 'teal', icon: '' },
  ];
}

/**
 * Provider & Network Insights — one aggregate row per provider/facility, plus a peer-relative
 * "Needs Attention" flag set. Thresholds are relative to the live peer average (not fixed magic
 * numbers) so the flagging stays sane regardless of LOB/Lookback scope or roster size.
 */
export function liveProviderInsights(lob?: string, withinDays?: number): ProviderInsightRow[] {
  const base = PROVIDERS.map((provider) => {
    const cs = CASE_POOL.filter((c) => c.provider === provider && inScope(c, lob, withinDays));
    const decidedCs = cs.filter((c) => c.phase === 'decided');
    const total = cs.length || 1;
    const decidedTotal = decidedCs.length || 1;
    const meta = providerMetaOf(provider);
    return {
      provider, specialty: meta.specialty, kind: meta.kind, npi: NPI_BY_PROVIDER[provider] ?? '',
      networkStatus: meta.networkStatus, vip: meta.vip,
      totalRequests: cs.length,
      oonRequests: cs.filter((c) => c.tags.includes('oon')).length,
      approvalRate: pctOf(decidedCs.filter((c) => c.decision === 'Approved').length, decidedTotal),
      denialRate: pctOf(decidedCs.filter((c) => c.decision === 'Denied').length, decidedTotal),
      partialRate: pctOf(decidedCs.filter((c) => c.decision === 'Partial').length, decidedTotal),
      incompleteRate: pctOf(cs.filter((c) => c.tags.includes('incompleteDoc')).length, total),
      expeditedRate: pctOf(cs.filter((c) => c.tags.includes('expedited')).length, total),
      avgResponseDays: providerResponseDaysOf(provider),
      clinicalsAwaiting: cs.filter((c) => c.tags.includes('rfi') && rfiOriginStageOf(c) === 'Clinical Review').length,
    };
  });

  const avg = (fn: (r: typeof base[number]) => number) => base.reduce((s, r) => s + fn(r), 0) / (base.length || 1);
  const avgDenialPartial = avg((r) => r.denialRate + r.partialRate);
  const avgIncomplete = avg((r) => r.incompleteRate);
  const avgVolume = avg((r) => r.totalRequests);
  const avgExpedited = avg((r) => r.expeditedRate);
  const avgClinicalsAwaiting = avg((r) => r.clinicalsAwaiting);
  const avgResponseDays = avg((r) => r.avgResponseDays);

  return base.map((r) => {
    const flags: ProviderFlag[] = [];
    const insights: string[] = [];
    const flag = (f: ProviderFlag, msg: string) => { flags.push(f); insights.push(msg); };

    if (r.oonRequests > 0 && (r.networkStatus === 'In-Network' || r.networkStatus === 'Delegated')) {
      flag('oon', `${r.oonRequests} active out-of-network exception${r.oonRequests > 1 ? 's' : ''} despite in-network status`);
    } else if (r.oonRequests >= 3) {
      flag('oon', `${r.oonRequests} out-of-network requests this period`);
    }
    if (r.clinicalsAwaiting >= Math.max(2, avgClinicalsAwaiting * 1.25)) {
      flag('missingClinicals', `${r.clinicalsAwaiting} case${r.clinicalsAwaiting > 1 ? 's' : ''} awaiting clinical records`);
    }
    if (r.networkStatus === 'Out-of-Network' || r.networkStatus === 'Exception') {
      flag('networkDiscrepancy', `Network status is ${r.networkStatus} — confirm directory listing matches submitted claims`);
    }
    if (r.incompleteRate >= Math.max(10, avgIncomplete * 1.25)) {
      flag('highIncomplete', `Incomplete-submission rate is ${r.incompleteRate}%, above the peer average of ${Math.round(avgIncomplete)}%`);
    }
    if (r.denialRate + r.partialRate >= Math.max(15, avgDenialPartial * 1.25)) {
      flag('highDenialPartial', `Denial + partial-approval rate is ${r.denialRate + r.partialRate}%, above the peer average of ${Math.round(avgDenialPartial)}%`);
    }
    if (r.totalRequests >= avgVolume * 1.4) {
      flag('unusualUtilization', `Request volume is ${r.totalRequests}, above the peer average of ${Math.round(avgVolume)} — unusual utilization pattern`);
    } else if (r.expeditedRate >= Math.max(15, avgExpedited * 1.4)) {
      flag('unusualUtilization', `Expedited-request rate is ${r.expeditedRate}%, above the peer average of ${Math.round(avgExpedited)}%`);
    }
    if (r.avgResponseDays >= Math.max(3, avgResponseDays * 1.2)) {
      flag('tatDelay', `Averages ${r.avgResponseDays} days to respond to information requests, above the peer average of ${avgResponseDays.toFixed(1)}`);
    }

    const needsAttention = flags.length > 0;
    // Gold Card — real-world analog to state prior-auth-exemption programs: a clean record (no
    // active flags) plus a sustained approval rate over a minimum volume, so a single small sample
    // can't earn it. Threshold is absolute, not peer-relative, since exemption programs are set by
    // statute against a fixed bar, not graded on a curve against other providers.
    const goldCard = !needsAttention && r.approvalRate >= 60 && r.totalRequests >= 20;
    const primaryInsight = insights[0] ?? (goldCard ? `Gold Card — ${r.approvalRate}% approval rate with a clean record qualifies for prior-auth exemption` : 'Performance within expected thresholds');
    return { ...r, flags, insights, primaryInsight, needsAttention, goldCard };
  }).sort((a, b) => b.totalRequests - a.totalRequests);
}
