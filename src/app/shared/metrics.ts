import { Injectable, inject } from '@angular/core';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from './interaction';
import { downloadCsv } from './export-csv';

// Rich, full-width column set for the Case Explorer.
const COLUMNS = ['Auth ID', 'Member', 'Procedure', 'Service Type', 'Status', 'Decision', 'Submitted', 'TAT (h)', 'Est. Cost'];
function toRow(c: CaseRec): (string | number)[] {
  return [c.authId, c.member, c.procedure, c.serviceType, c.status, c.decision, c.submitted, c.tatH, `$${c.cost.toLocaleString()}`];
}

const pend = (fn: (c: CaseRec) => boolean = () => true) => CASE_POOL.filter((c) => c.phase === 'pending' && fn(c));
const deci = (fn: (c: CaseRec) => boolean = () => true) => CASE_POOL.filter((c) => c.phase === 'decided' && fn(c));
const has = (t: string) => (c: CaseRec) => c.tags.includes(t);
const byCost = (rows: CaseRec[]) => [...rows].sort((a, b) => b.cost - a.cost);
const byTat = (rows: CaseRec[]) => [...rows].sort((a, b) => b.tatH - a.tatH);

const PENDING_TOTAL = pend().length;   // 247
const DECIDED_TOTAL = deci().length;   // 247
const pct = (n: number, d: number) => Math.round((n / d) * 100);

// Canonical UM pend reason (status) + Next Best Action, from the real Zyter/NextGen model (PEND_REASONS).
const PEND_MAP: Record<string, { reason: string; nba: string }> = {
  'Intake':            { reason: 'Pending Eligibility',  nba: 'Review Eligibility' },
  'Clinical Review':   { reason: 'Pending Review',        nba: 'Resume Review' },
  'MD Review':         { reason: 'Pending MD Review',     nba: 'MD Review' },
  'RFI Pending':       { reason: 'Pending Information',   nba: 'Follow Up RFI' },
  'OON Review':        { reason: 'Pending OON Review',    nba: 'OON Provider Review' },
  'Concurrent Review': { reason: 'Pending Review',        nba: 'Resume Review' },
  'Pending P2P':       { reason: 'Pending Peer-to-Peer',  nba: 'P2P' },
};

interface Drill { title: string; ctx: (n: number) => string; pick: () => CaseRec[]; }

const DRILLS: Record<string, Drill> = {
  // ---- KPI strip ----
  'kpi.pending':    { title: 'Pending Cases', ctx: (n) => `${n} cases pending across all queues`, pick: () => pend() },
  'kpi.tat':        { title: 'TAT — Exceptions (at-risk + breached)', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews are breached or at risk — the cases threatening compliance (search/sort to review; On-Track bucket shows the compliant cases)`, pick: () => deci((c) => c.tags.includes('breached') || c.tags.includes('atRisk')) },
  'kpi.auto':       { title: 'Auto-Approval Rate', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions auto-approved by rules (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('auto')) },
  'kpi.risk':       { title: 'Cases at Risk', ctx: (n) => `${n} pending cases at risk of a TAT breach`, pick: () => pend(has('atRisk')) },
  'kpi.aht':        { title: 'Avg Handle Time', ctx: (n) => `Average handle time 2.4h across ${n} completed reviews (longest first)`, pick: () => byTat(deci()) },
  'kpi.unassigned': { title: 'Unassigned Queue', ctx: (n) => `${n} pending cases waiting to be assigned`, pick: () => pend(has('unassigned')) },
  'kpi.breached':   { title: 'Breached SLAs', ctx: (n) => `${n} pending cases past their regulatory deadline`, pick: () => pend(has('breached')) },
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
  'tat.paused':     { title: 'Paused Cases', ctx: (n) => `${n} cases paused (clock stopped pending RFI)`, pick: () => pend(has('paused')) },
  'tat.turnaround': { title: 'Avg Turnaround', ctx: (n) => `Average turnaround 1.8 days across ${n} completed reviews`, pick: () => byTat(deci()) },
  'tat.compliance': { title: 'TAT — Exceptions (at-risk + breached)', ctx: (n) => `${n} of ${DECIDED_TOTAL} reviews are breached or at risk — the cases threatening compliance (the On-Track bucket lists the compliant cases)`, pick: () => deci((c) => c.tags.includes('breached') || c.tags.includes('atRisk')) },

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
  'fin.los':      { title: 'LOS Variance', ctx: (n) => `+1.3 days average LOS variance across ${n} inpatient cases`, pick: () => byCost(CASE_POOL.filter((c) => c.serviceType === 'Inpatient')) },
  'fin.highdollar': { title: 'High-Dollar Exposure (>$50k)', ctx: (n) => `${n} open high-dollar cases driving cost exposure (highest first)`, pick: () => byCost(CASE_POOL.filter((c) => c.cost >= 50000)) },

  // ---- Provider ----
  'prov.oon':     { title: 'Out-of-Network Requests', ctx: (n) => `${n} out-of-network requests under review`, pick: () => pend(has('oon')) },

  // ---- AI / NextGen ----
  'ai.denial':    { title: 'Denial Likelihood', ctx: (n) => `23% predicted denial likelihood — ${n} open cases with elevated risk`, pick: () => pend(has('mdReview')) },
  'ai.appeal':    { title: 'Appeal Likelihood', ctx: (n) => `15% predicted appeal likelihood — ${n} decided cases`, pick: () => deci((c) => c.decision === 'Denied' || c.decision === 'Partial') },
  'ai.tatrisk':   { title: 'TAT Breach Risk', ctx: (n) => `8% predicted TAT-breach risk — ${n} open cases`, pick: () => pend(has('atRisk')) },
  'ai.auto':      { title: 'Automation Rate', ctx: (n) => `${n} of ${DECIDED_TOTAL} decisions handled by automation (${pct(n, DECIDED_TOTAL)}%)`, pick: () => deci(has('auto')) },
  'ai.confHigh':  { title: 'High Confidence (>90%)', ctx: (n) => `72% of AI recommendations high confidence — ${n} auto-eligible cases`, pick: () => deci(has('auto')) },
  'ai.confMed':   { title: 'Medium Confidence (70-90%)', ctx: (n) => `21% of AI recommendations medium confidence — ${n} cases`, pick: () => deci(has('atRisk')) },
  'ai.confLow':   { title: 'Low Confidence (<70%)', ctx: (n) => `7% of AI recommendations low confidence — ${n} cases`, pick: () => deci(has('mdReview')) },
};

@Injectable({ providedIn: 'root' })
export class Metrics {
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  has(key: string) { return key in DRILLS; }

  open(key: string) {
    const d = DRILLS[key];
    if (!d) return;

    if (key === 'kpi.util') {
      const nurses = this.data.nurses();
      const columns = ['Nurse', 'Active Cases', 'Pending', 'Completed (MTD)', 'Avg TAT', 'Utilization'];
      const rows = nurses.map((n) => [n.name, n.active, n.pending, n.completed, n.avgTat, `${n.utilization}%`]);
      this.ix.openExplorer({ title: d.title, context: d.ctx(nurses.length), columns, rows, exportName: 'team-utilization_2026-07-17' });
      return;
    }

    // Pending Cases -> pending authorizations with their pend reason + NBA (from the real UM model)
    if (key === 'kpi.pending') {
      const cases = d.pick();
      const columns = ['Auth ID', 'Member', 'Procedure', 'Service Type', 'Pend Reason', 'Next Best Action', 'Submitted', 'Est. Cost'];
      const rows = cases.map((c) => {
        let p = PEND_MAP[c.status] ?? { reason: 'Pending Review', nba: 'Resume Review' };
        // clinical-review holds split between resume-review and pending-determination
        if (c.status === 'Clinical Review' && Number(c.authId.slice(-1)) % 2 === 0) {
          p = { reason: 'Pending Determination', nba: 'Determination' };
        }
        return [c.authId, c.member, c.procedure, c.serviceType, p.reason, p.nba, c.submitted, `$${c.cost.toLocaleString()}`];
      });
      this.ix.openExplorer({
        title: 'Pending Authorizations',
        context: `${cases.length} pending authorizations — by pend reason & next best action`,
        columns, rows, exportName: `pending-auths_2026-07-17`, memberColumn: 1,
      });
      return;
    }

    const cases = d.pick();
    this.ix.openExplorer({
      title: d.title,
      context: d.ctx(cases.length),
      columns: COLUMNS,
      rows: cases.map(toRow),
      exportName: `${key.replace('.', '-')}_2026-07-17`,
      memberColumn: 1, // "Member" is the 2nd column
    });
  }
}
