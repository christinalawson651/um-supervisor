import { Injectable, signal, effect } from '@angular/core';
import {
  Kpi, QueueCard, NurseRow, TatBucket, TatStat, DecisionStat, DecisionRow,
  ConcurrentRow, QualityBar, MissingField, ProviderRow, HighDollarCase,
  AuditFlag, AiRecommendation, RiskCase, RiskTile,
} from './dashboard.models';

export interface HistoryEntry {
  time: string;
  icon: string;
  action: string;
  detail: string;
  actor: string;
}

const STORAGE_KEY = 'zyter-um-demo-v2';

@Injectable({ providedIn: 'root' })
export class DashboardData {
  readonly today = 'Friday, July 17, 2026';

  // Mutable collections are signals so the UI reacts to demo actions.
  readonly kpis = signal<Kpi[]>([
    { icon: 'folder',   value: '247',   label: 'Pending Cases',     tone: 'green' },
    { icon: 'check',    value: '94.2%', label: 'TAT Compliance',    tone: 'green' },
    { icon: 'bolt',     value: '38%',   label: 'Auto-Approval Rate', tone: 'teal' },
    { icon: 'alert',    value: '12',    label: 'Cases at Risk',     tone: 'amber' },
    { icon: 'clock',    value: '2.4h',  label: 'Avg Handle Time',   tone: 'teal' },
    { icon: 'inbox',    value: '8',     label: 'Unassigned Queue',  tone: 'amber' },
    { icon: 'xcircle',  value: '3',     label: 'Breached SLAs',     tone: 'red' },
    { icon: 'users',    value: '87%',   label: 'Team Utilization',  tone: 'green' },
  ]);

  // ---------- Workforce & Queue Management ----------
  readonly queues = signal<QueueCard[]>([
    { name: 'Intake',          count: 42, buckets: { fresh: 45, day2: 30, over48: 18, breach: 7 } },
    { name: 'Clinical Review', count: 68, buckets: { fresh: 55, day2: 28, over48: 12, breach: 5 } },
    { name: 'MD Review',       count: 23, buckets: { fresh: 40, day2: 32, over48: 20, breach: 8 } },
    { name: 'RFI Pending',     count: 31, buckets: { fresh: 30, day2: 35, over48: 25, breach: 10 } },
    { name: 'OON Review',      count: 15, buckets: { fresh: 50, day2: 30, over48: 14, breach: 6 } },
    { name: 'Concurrent',      count: 38, buckets: { fresh: 52, day2: 30, over48: 13, breach: 5 } },
  ]);

  readonly nurses = signal<NurseRow[]>([
    { name: 'Maria Gonzalez, RN',  active: 32, pending: 8,  completed: 145, avgTat: '1.8h', utilization: 92 },
    { name: 'Jessica Williams, RN', active: 28, pending: 5,  completed: 132, avgTat: '2.1h', utilization: 85 },
    { name: 'Andrew Mitchell, RN', active: 35, pending: 12, completed: 128, avgTat: '2.6h', utilization: 96 },
    { name: 'Sarah Mitchell, RN',  active: 22, pending: 3,  completed: 156, avgTat: '1.5h', utilization: 72 },
    { name: 'Emily Chen, RN',      active: 30, pending: 7,  completed: 141, avgTat: '2.0h', utilization: 88 },
    { name: 'Robert Kim, RN',      active: 26, pending: 4,  completed: 138, avgTat: '1.9h', utilization: 80 },
  ]);

  // ---------- TAT & SLA Compliance ----------
  readonly tatCompliance = 94;
  readonly tatBuckets: TatBucket[] = [
    { label: 'On Track', count: 186, tone: 'green' },
    { label: 'At Risk',  count: 42,  tone: 'amber' },
    { label: 'Breached', count: 19,  tone: 'red' },
  ];
  readonly tatStats: TatStat[] = [
    { value: '34',   label: 'Expedited' },
    { value: '213',  label: 'Standard' },
    { value: '8',    label: 'Paused' },
    { value: '1.8d', label: 'Avg Turnaround' },
  ];

  // ---------- Clinical Decision Insights ----------
  readonly decisionStats: DecisionStat[] = [
    { value: '62%', label: 'Approved',      icon: 'check',   tone: 'green' },
    { value: '18%', label: 'Denied',        icon: 'xcircle', tone: 'red' },
    { value: '20%', label: 'Partial',       icon: 'minus',   tone: 'amber' },
    { value: '38%', label: 'Auto-Approved', icon: 'bolt',    tone: 'teal' },
    { value: '15%', label: 'MD Review',     icon: 'user',    tone: 'blue' },
    { value: '7%',  label: 'P2P Rate',      icon: 'phone',   tone: 'purple' as any },
  ];
  readonly decisionRows: DecisionRow[] = [
    { procedure: 'Total Knee Replacement',   serviceType: 'Inpatient',  guideline: 'XYZ 2024',     approvalRate: 78, volume: 42 },
    { procedure: 'Lumbar Fusion',            serviceType: 'Inpatient',  guideline: 'ABCD A-0420',  approvalRate: 65, volume: 28 },
    { procedure: 'Cardiac Catheterization',  serviceType: 'Outpatient', guideline: 'XYZ 2024',     approvalRate: 82, volume: 35 },
    { procedure: 'MRI Brain w/ Contrast',    serviceType: 'Outpatient', guideline: 'AIM Guidelines', approvalRate: 91, volume: 56 },
    { procedure: 'Physical Therapy (12 visits)', serviceType: 'Outpatient', guideline: 'ABCD A-0103', approvalRate: 88, volume: 64 },
    { procedure: 'Behavioral Health IOP',    serviceType: 'Behavioral', guideline: 'LOCUS Criteria', approvalRate: 72, volume: 19 },
  ];

  // ---------- Concurrent Review Monitoring ----------
  readonly concurrentRows = signal<ConcurrentRow[]>([
    { member: 'Adams, Patricia', facility: 'Memorial Hospital',  admit: '2026-03-10', nextReview: '2026-03-18', los: '7d', losFlag: true,  expectedLos: '5d', daysApproved: 5, daysRequested: 10, overstayRisk: 'red',   overstayLabel: 'High' },
    { member: 'Brown, Michael',  facility: 'St. Mary Medical',   admit: '2026-03-12', nextReview: '2026-03-19', los: '5d', losFlag: true,  expectedLos: '4d', daysApproved: 4, daysRequested: 7,  overstayRisk: 'amber', overstayLabel: 'Medium' },
    { member: 'Clark, Jennifer', facility: 'University Hospital', admit: '2026-03-14', nextReview: '2026-03-17', los: '3d', losFlag: false, expectedLos: '3d', daysApproved: 3, daysRequested: 5,  overstayRisk: 'green', overstayLabel: 'Low' },
    { member: 'Davis, Robert',   facility: 'Community General',  admit: '2026-03-08', nextReview: '2026-03-17', los: '9d', losFlag: true,  expectedLos: '6d', daysApproved: 6, daysRequested: 12, overstayRisk: 'red',   overstayLabel: 'High' },
    { member: 'Evans, Susan',    facility: 'Regional Medical',   admit: '2026-03-13', nextReview: '2026-03-20', los: '4d', losFlag: false, expectedLos: '5d', daysApproved: 5, daysRequested: 5,  overstayRisk: 'green', overstayLabel: 'Low' },
  ]);

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
    { authId: 'AUTH-4498', member: 'Martinez, Carlos', procedure: 'Liver Transplant Evaluation', cost: '$142K', status: 'MD Review' },
    { authId: 'AUTH-4534', member: 'Williams, Sarah',  procedure: 'NICU Stay (21 days)',        cost: '$198K', status: 'Concurrent Review' },
    { authId: 'AUTH-4512', member: 'Thompson, James',  procedure: 'Spinal Fusion (3-level)',    cost: '$127K', status: 'Pending P2P' },
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
    { icon: 'swap',   title: 'Reassign Case AUTH-4587', detail: 'Nurse Andrew Mitchell is at 96% capacity. Reassign to Sarah Mitchell (72%) to prevent TAT breach.', confidence: 94, action: 'Reassign Case', tone: 'red' },
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
  readonly history = signal<HistoryEntry[]>([]);

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
      concurrentRows: this.concurrentRows(), auditFlags: this.auditFlags(),
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
      if (s.concurrentRows) this.concurrentRows.set(s.concurrentRows);
      if (s.auditFlags) this.auditFlags.set(s.auditFlags);
      if (s.history) this.history.set(s.history);
    } catch {}
  }

  /** Restore every mutable collection to its original demo state. */
  resetDemo() {
    const d = structuredClone(this.defaults);
    this.kpis.set(d.kpis); this.queues.set(d.queues); this.nurses.set(d.nurses);
    this.aiRecommendations.set(d.aiRecommendations); this.riskCases.set(d.riskCases);
    this.concurrentRows.set(d.concurrentRows); this.auditFlags.set(d.auditFlags);
    this.history.set([]);
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

  /** Move one case from the busiest nurse to the one with most headroom. */
  reassignBusiest(): { from: string; to: string } | null {
    const list = [...this.nurses()];
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
    this.setKpi('Cases at Risk', (n) => Math.max(0, n - 1));
  }

  /** Approve the requested days for a concurrent-review case (clears overstay risk). */
  approveConcurrentDays(member: string) {
    this.concurrentRows.update((rows) =>
      rows.map((r) =>
        r.member === member
          ? { ...r, daysApproved: r.daysRequested, overstayRisk: 'green', overstayLabel: 'Low', losFlag: false }
          : r,
      ),
    );
  }

  resolveAuditFlag(id: string) {
    this.auditFlags.update((f) => f.filter((x) => x.id !== id));
  }
}
