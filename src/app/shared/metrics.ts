import { Injectable, inject } from '@angular/core';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from './interaction';
import { downloadCsv } from './export-csv';

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'teal';
type Getter = (c: CaseRec) => string | number;
type Col = [string, Getter];

const g = {
  authId: (c: CaseRec) => c.authId,
  member: (c: CaseRec) => c.member,
  procedure: (c: CaseRec) => c.procedure,
  serviceType: (c: CaseRec) => c.serviceType,
  decision: (c: CaseRec) => c.decision,
  status: (c: CaseRec) => c.status,
  nurse: (c: CaseRec) => c.nurse,
  tat: (c: CaseRec) => `${c.tatH}h`,
  cost: (c: CaseRec) => `$${c.cost.toLocaleString()}`,
};

const C_DECISION: Col[] = [['Auth ID', g.authId], ['Member', g.member], ['Procedure', g.procedure], ['Decision', g.decision]];
const C_STATUS: Col[]   = [['Auth ID', g.authId], ['Member', g.member], ['Procedure', g.procedure], ['Status', g.status]];
const C_TAT: Col[]      = [['Auth ID', g.authId], ['Member', g.member], ['Procedure', g.procedure], ['TAT', g.tat]];
const C_COST: Col[]     = [['Auth ID', g.authId], ['Member', g.member], ['Procedure', g.procedure], ['Est. Cost', g.cost]];
const C_OON: Col[]      = [['Auth ID', g.authId], ['Member', g.member], ['Procedure', g.procedure], ['Status', g.status]];

const tag = (t: string) => (p: CaseRec[]) => p.filter((c) => c.tags.includes(t));
const notTag = (t: string) => (p: CaseRec[]) => p.filter((c) => !c.tags.includes(t));
const dec = (d: string) => (p: CaseRec[]) => p.filter((c) => c.decision === d);
const all = (p: CaseRec[]) => p;
const byCost = (p: CaseRec[]) => [...p].sort((a, b) => b.cost - a.cost);
const byTat = (p: CaseRec[]) => [...p].sort((a, b) => b.tatH - a.tatH);

interface Drill {
  title: string;
  formula: string;
  note?: string;
  tone?: Tone;
  cols: Col[];
  pick: (pool: CaseRec[]) => CaseRec[];
}

const DRILLS: Record<string, Drill> = {
  // ---- KPI strip ----
  'kpi.pending':    { title: 'Pending Cases', formula: '247 cases pending across all queues', tone: 'green', cols: C_STATUS, pick: tag('pending') },
  'kpi.tat':        { title: 'TAT Compliance', formula: '94.2% = 452 of 480 decisions met their TAT target', tone: 'green', cols: C_TAT, pick: tag('onTrack'), note: 'Cases shown were completed within their turnaround target.' },
  'kpi.auto':       { title: 'Auto-Approval Rate', formula: '38% = 91 of 240 requests auto-approved by rules', tone: 'teal', cols: C_STATUS, pick: tag('auto') },
  'kpi.risk':       { title: 'Cases at Risk', formula: '12 cases at risk of a TAT breach', tone: 'amber', cols: C_STATUS, pick: tag('atRisk') },
  'kpi.aht':        { title: 'Avg Handle Time', formula: 'Average handle time 2.4h across 480 decisions', tone: 'teal', cols: C_TAT, pick: byTat, note: 'Longest-running cases shown first.' },
  'kpi.unassigned': { title: 'Unassigned Queue', formula: '8 cases waiting to be assigned', tone: 'amber', cols: C_STATUS, pick: tag('unassigned') },
  'kpi.breached':   { title: 'Breached SLAs', formula: '3 SLAs breached this period', tone: 'red', cols: C_TAT, pick: tag('breached'), note: 'These cases exceeded their regulatory turnaround deadline.' },
  'kpi.util':       { title: 'Team Utilization', formula: 'Team utilization 87% (average across 6 nurses)', tone: 'green', cols: C_STATUS, pick: all },

  // ---- Clinical Decision Insights ----
  'dec.approved': { title: 'Approved Decisions', formula: '62% = 153 of 247 decisions approved', tone: 'green', cols: C_DECISION, pick: dec('Approved') },
  'dec.denied':   { title: 'Denied Decisions', formula: '18% = 44 of 247 decisions denied', tone: 'red', cols: C_DECISION, pick: dec('Denied') },
  'dec.partial':  { title: 'Partial Approvals', formula: '20% = 49 of 247 decisions partially approved', tone: 'amber', cols: C_DECISION, pick: dec('Partial') },
  'dec.auto':     { title: 'Auto-Approved', formula: '38% = 94 of 247 decisions auto-approved', tone: 'teal', cols: C_STATUS, pick: tag('auto') },
  'dec.md':       { title: 'MD Review', formula: '15% = 37 of 247 decisions required MD review', tone: 'blue', cols: C_STATUS, pick: tag('mdReview') },
  'dec.p2p':      { title: 'Peer-to-Peer Rate', formula: '7% = 17 of 247 decisions required peer-to-peer', tone: 'blue', cols: C_STATUS, pick: tag('p2p') },

  // ---- TAT & SLA ----
  'tat.onTrack':    { title: 'On Track', formula: '186 of 247 cases on track', tone: 'green', cols: C_TAT, pick: tag('onTrack') },
  'tat.atRisk':     { title: 'At Risk', formula: '42 of 247 cases at risk', tone: 'amber', cols: C_TAT, pick: tag('atRisk') },
  'tat.breached':   { title: 'Breached', formula: '19 of 247 cases breached', tone: 'red', cols: C_TAT, pick: tag('breached') },
  'tat.expedited':  { title: 'Expedited Reviews', formula: '34 expedited (72-hour) reviews', tone: 'teal', cols: C_TAT, pick: byTat },
  'tat.standard':   { title: 'Standard Reviews', formula: '213 standard (14-day) reviews', tone: 'teal', cols: C_STATUS, pick: all },
  'tat.paused':     { title: 'Paused Cases', formula: '8 cases paused (clock stopped for RFI)', tone: 'amber', cols: C_STATUS, pick: tag('rfi') },
  'tat.turnaround': { title: 'Avg Turnaround', formula: 'Average turnaround 1.8 days', tone: 'teal', cols: C_TAT, pick: byTat },
  'tat.compliance': { title: 'TAT Compliance', formula: '94% = 452 of 480 decisions met TAT', tone: 'green', cols: C_TAT, pick: tag('onTrack') },

  // ---- Intake & Documentation ----
  'intake.complete': { title: 'Complete Submissions', formula: '87% = 214 of 247 submissions complete', tone: 'green', cols: C_STATUS, pick: notTag('incompleteDoc') },
  'intake.auto':     { title: 'Auto-Approved', formula: '38% = 94 of 247 submissions auto-approved', tone: 'teal', cols: C_STATUS, pick: tag('auto') },
  'intake.rfi':      { title: 'Needing RFI', formula: '15% = 37 of 247 submissions need more information', tone: 'amber', cols: C_STATUS, pick: tag('incompleteDoc') },

  // ---- Audit & Compliance ----
  'audit.doc':       { title: 'Documentation Completeness', formula: '82% = 203 of 247 files fully documented', tone: 'teal', cols: C_STATUS, pick: notTag('incompleteDoc') },
  'audit.guideline': { title: 'Guideline Adherence', formula: '94% = 452 of 480 decisions matched guideline', tone: 'teal', cols: C_DECISION, pick: all },
  'audit.rationale': { title: 'Decision Rationale Documented', formula: '89% = 214 of 240 decisions have documented rationale', tone: 'teal', cols: C_DECISION, pick: dec('Approved') },

  // ---- Financial ----
  'fin.pending':  { title: 'Estimated Pending Cost', formula: '$4.3M estimated cost of pending authorizations', tone: 'red', cols: C_COST, pick: (p) => byCost(tag('pending')(p)) },
  'fin.avoided':  { title: 'Cost Avoided (MTD)', formula: '$1.8M avoided through denials & partial approvals', tone: 'green', cols: C_COST, pick: (p) => byCost(p.filter((c) => c.decision === 'Denied' || c.decision === 'Partial')) },
  'fin.los':      { title: 'LOS Variance', formula: '+1.3 days average length-of-stay variance', tone: 'amber', cols: C_COST, pick: (p) => byCost(p.filter((c) => c.serviceType === 'Inpatient')) },

  // ---- Provider ----
  'prov.oon':     { title: 'Out-of-Network Requests', formula: '47 out-of-network requests this period', tone: 'amber', cols: C_OON, pick: tag('oon') },

  // ---- AI / NextGen ----
  'ai.denial':    { title: 'Denial Likelihood', formula: '23% predicted denial likelihood on open cases', tone: 'red', cols: C_STATUS, pick: tag('mdReview') },
  'ai.appeal':    { title: 'Appeal Likelihood', formula: '15% predicted appeal likelihood on decided cases', tone: 'amber', cols: C_DECISION, pick: (p) => p.filter((c) => c.decision === 'Denied' || c.decision === 'Partial') },
  'ai.tatrisk':   { title: 'TAT Breach Risk', formula: '8% predicted TAT-breach risk on open cases', tone: 'amber', cols: C_TAT, pick: tag('atRisk') },
  'ai.auto':      { title: 'Automation Rate', formula: '38% of decisions handled by automation', tone: 'teal', cols: C_STATUS, pick: tag('auto') },
  'ai.confHigh':  { title: 'High Confidence (>90%)', formula: '72% of AI recommendations are high confidence', tone: 'teal', cols: C_STATUS, pick: tag('auto') },
  'ai.confMed':   { title: 'Medium Confidence (70-90%)', formula: '21% of AI recommendations are medium confidence', tone: 'amber', cols: C_STATUS, pick: tag('atRisk') },
  'ai.confLow':   { title: 'Low Confidence (<70%)', formula: '7% of AI recommendations are low confidence', tone: 'red', cols: C_STATUS, pick: tag('mdReview') },
};

@Injectable({ providedIn: 'root' })
export class Metrics {
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  /** True if a metric key has a drill-down registered. */
  has(key: string) { return key in DRILLS; }

  open(key: string) {
    const d = DRILLS[key];
    if (!d) return;

    // Team utilization drills into the nurse roster instead of the case pool.
    if (key === 'kpi.util') {
      const nurses = this.data.nurses();
      const columns = ['Nurse', 'Active', 'Pending', 'Utilization'];
      const rows = nurses.map((n) => [n.name, n.active, n.pending, `${n.utilization}%`]);
      this.ix.openDrawer({
        title: d.title, formula: d.formula, badge: { text: 'Team view', tone: d.tone! },
        table: { columns, rows, caption: `All ${nurses.length} nurses` },
        actions: [{ label: 'Export nurse utilization', tone: 'teal',
          run: () => downloadCsv(`team-utilization_2026-07-17`, columns, rows) }],
      });
      return;
    }

    const picked = d.pick(CASE_POOL).slice(0, 10);
    const columns = d.cols.map((c) => c[0]);
    const rows = picked.map((c) => d.cols.map((col) => col[1](c)));

    this.ix.openDrawer({
      title: d.title,
      badge: { text: 'Drill-down', tone: d.tone ?? 'teal' },
      formula: d.formula,
      table: { columns, rows, caption: `Representative cases — showing ${rows.length}` },
      note: d.note,
      actions: [{
        label: `Export these ${rows.length} cases`, tone: 'teal',
        run: () => downloadCsv(`${key.replace('.', '-')}_2026-07-17`, columns, rows),
      }],
    });
  }
}
