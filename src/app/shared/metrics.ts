import { Injectable, inject } from '@angular/core';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { DashboardData } from '../data/dashboard-data';
import { nbaFor } from '../data/um-status';
import { lobOf, urgencyOf } from '../data/case-fields';
import { Interaction } from './interaction';
import { LobFilter } from './lob-filter';
import { Lookback } from './lookback';
import { downloadCsv } from './export-csv';

// Rich, full-width column set for the Case Explorer — every drill uses the same shape
// (Provider + Urgency included) so the explorer looks and behaves the same everywhere.
export const COLUMNS = ['Auth ID', 'Member', 'Procedure', 'Service Type', 'Status', 'Decision', 'Provider', 'Urgency', 'Submitted', 'TAT (h)', 'Est. Cost'];
export function toRow(c: CaseRec): (string | number)[] {
  return [c.authId, c.member, c.procedure, c.serviceType, c.status, c.decision, c.provider, urgencyOf(c), c.submitted, c.tatH, `$${c.cost.toLocaleString()}`];
}

const pend = (fn: (c: CaseRec) => boolean = () => true) => CASE_POOL.filter((c) => c.phase === 'pending' && fn(c));
const deci = (fn: (c: CaseRec) => boolean = () => true) => CASE_POOL.filter((c) => c.phase === 'decided' && fn(c));
const has = (t: string) => (c: CaseRec) => c.tags.includes(t);
const byCost = (rows: CaseRec[]) => [...rows].sort((a, b) => b.cost - a.cost);
const byTat = (rows: CaseRec[]) => [...rows].sort((a, b) => b.tatH - a.tatH);

const PENDING_TOTAL = pend().length;   // 247
const DECIDED_TOTAL = deci().length;   // 247
const pct = (n: number, d: number) => Math.round((n / d) * 100);

// Map a pending queue -> canonical pend reason (status); NBA comes from the shared model.
const QUEUE_TO_PEND: Record<string, string> = {
  'Intake': 'Pending Eligibility',
  'Clinical Review': 'Pending Review',
  'MD Review': 'Pending MD Review',
  'RFI Pending': 'Pending Information',
  'OON Review': 'Pending OON Review',
  'Concurrent Review': 'Pending Review',
  'Pending P2P': 'Pending Peer-to-Peer',
};

/** Resolve a pending case to its canonical pend reason (splits some queues for realistic variety). */
export function pendReason(c: CaseRec): string {
  const even = Number(c.authId.slice(-1)) % 2 === 0;
  if (c.status === 'Clinical Review' && even) return 'Pending Determination';
  if (c.status === 'MD Review' && even) return 'Pending Notification';
  return QUEUE_TO_PEND[c.status] ?? 'Pending Review';
}

interface Drill { title: string; ctx: (n: number) => string; pick: () => CaseRec[]; }

const DRILLS: Record<string, Drill> = {
  // ---- KPI strip ----
  'kpi.pending':    { title: 'Pending Authorizations', ctx: (n) => `${n} authorizations pending across all queues`, pick: () => pend() },
  'kpi.tat':        { title: 'TAT — Exceptions (at-risk + breached)', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews are breached or at risk — the authorizations threatening compliance (search/sort to review; On-Track bucket shows the compliant authorizations)`, pick: () => deci((c) => c.tags.includes('breached') || c.tags.includes('atRisk')) },
  'kpi.auto':       { title: 'Auto-Approval Rate', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions auto-approved by rules (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('auto')) },
  'kpi.risk':       { title: 'Authorizations at Risk', ctx: (n) => `${n} pending authorizations at risk of a TAT breach`, pick: () => pend(has('atRisk')) },
  'kpi.aht':        { title: 'Avg Handle Time', ctx: (n) => `Average handle time 2.4h across ${n} completed reviews (longest first)`, pick: () => byTat(deci()) },
  'kpi.unassigned': { title: 'Unassigned Queue', ctx: (n) => `${n} pending authorizations sitting in a queue, available to pull`, pick: () => pend((c) => c.nurse === '—') },
  'kpi.breached':   { title: 'Breached TAT', ctx: (n) => `${n} pending authorizations past their regulatory deadline`, pick: () => pend(has('breached')) },
  'kpi.util':       { title: 'Team Utilization', ctx: () => `Team utilization 87% (average across 6 nurses)`, pick: () => [] },

  // ---- Clinical Decision Insights ----
  'dec.approved': { title: 'Approved Decisions', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions approved (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci((c) => c.decision === 'Approved') },
  'dec.denied':   { title: 'Denied Decisions', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions denied (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci((c) => c.decision === 'Denied') },
  'dec.partial':  { title: 'Partial Approvals', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions partially approved (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci((c) => c.decision === 'Partial') },
  'dec.auto':     { title: 'Auto-Approved', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions auto-approved (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('auto')) },
  'dec.md':       { title: 'MD Review', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions required MD review (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('mdReview')) },
  'dec.p2p':      { title: 'Peer-to-Peer', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions required peer-to-peer (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('p2p')) },

  // ---- TAT & SLA ----
  'tat.onTrack':    { title: 'On Track', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews on track (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('onTrack')) },
  'tat.atRisk':     { title: 'At Risk', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews at risk`, pick: () => deci(has('atRisk')) },
  'tat.breached':   { title: 'Breached', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews breached`, pick: () => deci(has('breached')) },
  'tat.expedited':  { title: 'Expedited Reviews', ctx: (n) => `${n} expedited (72-hour) reviews`, pick: () => deci(has('expedited')) },
  'tat.standard':   { title: 'Standard Reviews', ctx: (n) => `${n} standard (14-day) reviews`, pick: () => deci(has('standard')) },
  'tat.paused':     { title: 'Paused Authorizations', ctx: (n) => `${n} authorizations paused (clock stopped pending RFI)`, pick: () => pend(has('paused')) },
  'tat.turnaround': { title: 'Avg Turnaround', ctx: (n) => `Average turnaround 1.8 days across ${n} completed reviews`, pick: () => byTat(deci()) },
  'tat.compliance': { title: 'TAT — Exceptions (at-risk + breached)', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews are breached or at risk — the authorizations threatening compliance (the On-Track bucket lists the compliant authorizations)`, pick: () => deci((c) => c.tags.includes('breached') || c.tags.includes('atRisk')) },

  // ---- Intake & Documentation ----
  'intake.complete': { title: 'Complete Submissions', ctx: (n) => `${n} of ${PENDING_TOTAL} submissions complete (${pct(n, PENDING_TOTAL)}%)`, pick: () => pend((c) => !c.tags.includes('incompleteDoc')) },
  'intake.auto':     { title: 'Auto-Approved', ctx: (n) => `${n} of ${DECIDED_TOTAL} submissions auto-approved (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('auto')) },
  'intake.rfi':      { title: 'Needing RFI', ctx: (n) => `${n} of ${PENDING_TOTAL} submissions need more information (${pct(n, PENDING_TOTAL)}%)`, pick: () => pend(has('rfi')) },

  // ---- Audit & Compliance ----
  'audit.doc':       { title: 'Documentation Completeness', ctx: (n) => `${n} files fully documented`, pick: () => CASE_POOL.filter((c) => !c.tags.includes('incompleteDoc')) },
  'audit.guideline': { title: 'Guideline Adherence', ctx: (n) => `Guideline adherence 94% across ${n} decisions`, pick: () => deci() },
  'audit.rationale': { title: 'Decision Rationale Documented', ctx: (n) => `Rationale documented on ${n} approved decisions`, pick: () => deci((c) => c.decision === 'Approved') },

  // ---- Financial ----
  'fin.pending':  { title: 'Estimated Pending Cost', ctx: (n) => `$4.3M estimated cost across ${n} pending authorizations (highest first)`, pick: () => byCost(pend()) },
  'fin.avoided':  { title: 'Cost Avoided (MTD)', ctx: (n) => `$1.8M avoided across ${n} denied & partial decisions`, pick: () => byCost(deci((c) => c.decision === 'Denied' || c.decision === 'Partial')) },
  'fin.los':      { title: 'LOS Variance', ctx: (n) => `+1.3 days average LOS variance across ${n} inpatient authorizations`, pick: () => byCost(CASE_POOL.filter((c) => c.serviceType === 'Inpatient')) },
  'fin.highdollar': { title: 'High-Dollar Exposure (>$50k)', ctx: (n) => `${n} open high-dollar authorizations driving cost exposure (highest first)`, pick: () => byCost(CASE_POOL.filter((c) => c.cost >= 50000)) },

  // ---- Provider ----
  'prov.oon':     { title: 'Out-of-Network Requests', ctx: (n) => `${n} out-of-network requests under review`, pick: () => pend(has('oon')) },

  // ---- AI / NextGen ----
  'ai.denial':    { title: 'Denial Likelihood', ctx: (n) => `23% predicted denial likelihood — ${n} open authorizations with elevated risk`, pick: () => pend(has('mdReview')) },
  'ai.appeal':    { title: 'Appeal Likelihood', ctx: (n) => `15% predicted appeal likelihood — ${n} decided authorizations`, pick: () => deci((c) => c.decision === 'Denied' || c.decision === 'Partial') },
  'ai.tatrisk':   { title: 'TAT Breach Risk', ctx: (n) => `8% predicted TAT-breach risk — ${n} open authorizations`, pick: () => pend(has('atRisk')) },
  'ai.auto':      { title: 'Automation Rate', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions handled by automation (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('auto')) },
  'ai.confHigh':  { title: 'High Confidence (>90%)', ctx: (n) => `72% of AI recommendations high confidence — ${n} auto-eligible authorizations`, pick: () => deci(has('auto')) },
  'ai.confMed':   { title: 'Medium Confidence (70-90%)', ctx: (n) => `21% of AI recommendations medium confidence — ${n} authorizations`, pick: () => deci(has('atRisk')) },
  'ai.confLow':   { title: 'Low Confidence (<70%)', ctx: (n) => `7% of AI recommendations low confidence — ${n} authorizations`, pick: () => deci(has('mdReview')) },
};

@Injectable({ providedIn: 'root' })
export class Metrics {
  private ix = inject(Interaction);
  private data = inject(DashboardData);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);

  has(key: string) { return key in DRILLS; }

  /** True when neither shared filter is actively narrowing anything — the original, unfiltered baseline. */
  private isDefaultScope(): boolean {
    return this.lobFilter.value() === 'all' && this.lookback.period() === '30d';
  }

  /** Scope a drill's cases to the shared top-bar LOB + Lookback filters (no-op at the default scope). */
  private byLob(cases: CaseRec[]): CaseRec[] {
    if (this.isDefaultScope()) return cases;
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return cases.filter((c) =>
      (lob === 'all' || lobOf(c.authId) === lob) && (period === '30d' || this.lookback.includes(c.submitted)),
    );
  }

  /** Context line — honest about the LOB/Lookback scope instead of reusing a fixed-denominator % once filtered. */
  private ctxFor(d: Drill, cases: CaseRec[]): string {
    if (this.isDefaultScope()) return d.ctx(cases.length);
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    const periodLabel = this.lookback.periods.find((p) => p.id === period)?.label ?? period;
    const scope = [lob !== 'all' ? lob : null, period !== '30d' ? periodLabel : null].filter(Boolean).join(' · ');
    return `${cases.length} authorization(s) · filtered to ${scope}`;
  }

  open(key: string) {
    const d = DRILLS[key];
    if (!d) return;

    if (key === 'kpi.util') {
      const nurses = this.data.nurses();
      const columns = ['Nurse', 'Active Authorizations', 'Pending', 'Completed (MTD)', 'Avg TAT', 'Utilization'];
      const rows = nurses.map((n) => [n.name, n.active, n.pending, n.completed, n.avgTat, `${n.utilization}%`]);
      this.ix.openExplorer({ title: d.title, context: d.ctx(nurses.length), columns, rows, exportName: 'team-utilization_2026-07-17' });
      return;
    }

    // Pending Cases -> pending authorizations with their pend reason + NBA (from the real UM model)
    if (key === 'kpi.pending') {
      const cases = this.byLob(d.pick());
      const columns = ['Auth ID', 'Member', 'Procedure', 'Service Type', 'Provider', 'Urgency', 'Pend Reason', 'Next Best Action', 'Submitted', 'Est. Cost'];
      const rows = cases.map((c) => {
        const reason = pendReason(c);
        return [c.authId, c.member, c.procedure, c.serviceType, c.provider, urgencyOf(c), reason, nbaFor(reason), c.submitted, `$${c.cost.toLocaleString()}`];
      });
      this.ix.openExplorer({
        title: 'Pending Authorizations',
        context: this.ctxFor({ ...d, ctx: () => `${cases.length} pending authorizations — by pend reason & next best action` }, cases),
        columns, rows, exportName: `pending-auths_2026-07-17`, memberColumn: 1,
      });
      return;
    }

    // Breached TAT -> show how far past the deadline each auth is
    if (key === 'kpi.breached') {
      const cases = this.byLob(d.pick());
      const overdue = (id: string) => { const h = 5 + (Number(id.slice(-2)) % 60); return h < 24 ? `${h}h past deadline` : `${Math.floor(h / 24)}d ${h % 24}h past deadline`; };
      const rows = cases.map((c) => [c.authId, c.member, c.procedure, c.status, c.provider, urgencyOf(c), overdue(c.authId), `$${c.cost.toLocaleString()}`]);
      this.ix.openExplorer({
        title: 'Breached TAT',
        context: this.ctxFor({ ...d, ctx: () => `${cases.length} authorizations past their TAT deadline — time overdue shown` }, cases),
        columns: ['Auth ID', 'Member', 'Procedure', 'Stage', 'Provider', 'Urgency', 'Time Past Deadline', 'Est. Cost'],
        rows, exportName: 'breached-tat_2026-07-17', memberColumn: 1,
      });
      return;
    }

    const cases = this.byLob(d.pick());
    this.ix.openExplorer({
      title: d.title,
      context: this.ctxFor(d, cases),
      columns: COLUMNS,
      rows: cases.map(toRow),
      exportName: `${key.replace('.', '-')}_2026-07-17`,
      memberColumn: 1, // "Member" is the 2nd column
    });
  }
}
