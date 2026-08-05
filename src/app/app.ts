import { Component, signal, computed, inject } from '@angular/core';
import { Icon } from './shared/icon';
import { Overlays } from './shared/overlays';
import { CaseExplorer } from './shared/case-explorer';
import { MemberChart } from './shared/member-chart';
import { ReassignPanel } from './shared/reassign-panel';
import { EscalatePanel } from './shared/escalate-panel';
import { GlobalSearch } from './shared/global-search';
import { ExportDialog } from './shared/export-dialog';
import { Interaction } from './shared/interaction';
import { Metrics } from './shared/metrics';
import { Nav, ROLES } from './shared/nav';
import { Exporter } from './shared/exporter';
import { Lookback } from './shared/lookback';
import { LobFilter } from './shared/lob-filter';
import { REFERRALS } from './data/referrals';
import { DashboardData, liveTatBuckets, liveTatStats, liveDecisionRows, liveConcurrentRows, liveMissingFields, liveProviderInsights, liveCostInsights } from './data/dashboard-data';

import { OverviewDashboard } from './modules/overview-dashboard';
import { CmDashboard } from './modules/cm-dashboard';
import { AppealsDashboard } from './modules/appeals-dashboard';

import { WorkforceTab } from './tabs/workforce-tab';
import { TatTab } from './tabs/tat-tab';
import { ClinicalTab } from './tabs/clinical-tab';
import { RiskTab } from './tabs/risk-tab';
import { ConcurrentTab } from './tabs/concurrent-tab';
import { IntakeTab } from './tabs/intake-tab';
import { ProviderTab } from './tabs/provider-tab';
import { CostTab } from './tabs/cost-tab';
import { AuditTab } from './tabs/audit-tab';
import { AiTab } from './tabs/ai-tab';
import { ReferralsTab } from './tabs/referrals-tab';

// AI / NextGen Intelligence is temporarily hidden — not deleted, just not listed/switched to.
// To bring it back: add 'AI / NextGen Intelligence' before 'CM Referrals' here, and restore its
// @case (9) in app.html (bumping CM Referrals back to @case (10)) and in exportCsv() below.
const TABS = [
  'Workforce & Queue Management',
  'TAT Compliance',
  'Clinical Decision Insights',
  'Risk & Escalation Panel',
  'Concurrent Review Monitoring',
  'Intake & Documentation Quality',
  'Provider & Network Insights',
  'Cost & Utilization Insights',
  'Audit & Compliance',
  'CM Referrals',
] as const;

const RAIL = [
  { icon: 'barchart', label: 'Dashboard', active: true, badge: 0 },
  { icon: 'users', label: 'Members', active: false, badge: 0 },
  { icon: 'inbox', label: 'Inbox', active: false, badge: 28 },
  { icon: 'clock', label: 'Schedule', active: false, badge: 0 },
  { icon: 'folder', label: 'Reports', active: false, badge: 0 },
  { icon: 'barchart', label: 'Analytics', active: false, badge: 0 },
  { icon: 'clock', label: 'Changelog', active: false, badge: 0 },
];

const MODULES = [
  { id: 'overview' as const, label: 'TruCare Pulse' },
  { id: 'um' as const, label: 'UM' },
  { id: 'cm' as const, label: 'CM' },
  { id: 'appeals' as const, label: 'Appeals' },
];

const HEADINGS: Record<string, { title: string; sub: string; role: string }> = {
  overview: { title: 'TruCare Pulse', sub: 'Outcomes, quality & financial performance across UM, CM & Appeals', role: 'Operations Supervisor' },
  um: { title: 'UM Supervisor Dashboard', sub: "Your team is performing well — here's your operational overview", role: 'UM Supervisor' },
  cm: { title: 'CM Supervisor Dashboard', sub: 'Care management worklist and referral intake', role: 'CM Supervisor' },
  appeals: { title: 'Appeals Supervisor Dashboard', sub: 'Appeals & grievances worklist, prioritized by deadline', role: 'Appeals Supervisor' },
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    Icon, Overlays, CaseExplorer, MemberChart, ReassignPanel, EscalatePanel, GlobalSearch, ExportDialog, OverviewDashboard, CmDashboard, AppealsDashboard,
    WorkforceTab, TatTab, ClinicalTab, RiskTab, ConcurrentTab,
    IntakeTab, ProviderTab, CostTab, AuditTab, AiTab, ReferralsTab,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly data = inject(DashboardData);
  private ix = inject(Interaction);
  private metrics = inject(Metrics);
  private exporter = inject(Exporter);
  readonly nav = inject(Nav);
  readonly tabs = TABS;
  readonly rail = RAIL;
  readonly modules = MODULES;
  readonly headings = HEADINGS;
  readonly visibleTabs = computed(() => MODULES.filter((m) => this.nav.visibleModules().includes(m.id)));
  readonly selected = signal(0);
  readonly kpiKeys = ['kpi.pending', 'kpi.tat', 'kpi.auto', 'kpi.risk', 'kpi.aht', 'kpi.unassigned', 'kpi.breached', 'kpi.util'];
  readonly kpiCollapsed = signal(false); // collapsible for screen real estate

  // ---- lookback period on the KPI tiles (shared across modules) ----
  private lookback = inject(Lookback);
  readonly periods = this.lookback.periods;
  readonly period = this.lookback.period;

  // ---- shared LOB filter (shown next to Lookback, same pattern) ----
  private lobFilter = inject(LobFilter);
  readonly lobOptions = this.lobFilter.options;
  readonly lob = this.lobFilter.value;
  // '30d' is the baseline (every pending case fits within it by construction) so it keeps showing
  // the live, session-mutable KPI values (escalate/resolve/assign actions etc.); any other period
  // is recomputed fresh from the case pool for that real date window — no more canned flavor numbers.
  readonly displayKpis = computed(() => {
    const p = this.period();
    if (p === '30d') return this.data.kpis();
    return this.data.liveKpis(this.lookback.windowDays());
  });

  select(i: number) { this.selected.set(i); }
  drill(key: string) { this.metrics.open(key); }

  openHistory() {
    const h = this.data.history();
    this.ix.openDrawer({
      title: 'Activity History',
      subtitle: `${h.length} action${h.length === 1 ? '' : 's'} this session`,
      table: h.length
        ? { columns: ['Time', 'Action', 'Detail'], rows: h.map((e) => [e.time, e.action, e.detail]) }
        : undefined,
      note: h.length ? undefined : 'No actions yet — reassign an authorization or escalate one to see the log here.',
      actions: [{ label: 'Reset demo data', tone: 'red', run: () => this.resetDemo() }],
    });
  }

  resetDemo() {
    this.ix.ask({
      title: 'Reset demo data',
      body: 'Restore all authorizations, queues, nurses, and history to their original state? Any changes made during the demo will be cleared.',
      confirmLabel: 'Reset', tone: 'red',
      onConfirm: () => { this.data.resetDemo(); this.ix.toast('Demo data reset to defaults.', 'info'); },
    });
  }

  railClick(item: { label: string; active: boolean }) {
    if (item.active) return;
    this.ix.toast(`${item.label} module isn't part of this demo build.`, 'info');
  }

  roleMenu() {
    this.ix.choose({
      title: 'Switch role',
      body: 'Role determines which modules you can see. Executive and combo roles include the cross-module Overview.',
      label: 'View as', options: ROLES.map((r) => r.label),
      confirmLabel: 'Switch', tone: 'teal',
      onChoose: (label) => {
        this.nav.setRole(label);
        this.ix.toast(`Now viewing as ${label}.`, 'info');
      },
    });
  }

  /** Open the export dialog for the currently visible UM tab. */
  exportCsv() {
    if (this.nav.module() !== 'um') {
      this.ix.toast('Export is available from the Export button on each table in this view.', 'info');
      return;
    }
    const d = this.data;
    const lob = this.lob() === 'all' ? undefined : this.lob();
    const days = this.period() === '30d' ? undefined : this.lookback.windowDays();
    let name = 'export', columns: string[] = [], rows: (string | number)[][] = [];
    switch (this.selected()) {
      case 0: name = 'workforce-nurses'; columns = ['Nurse', 'Active Authorizations', 'Pending', 'Completed MTD', 'Avg TAT', 'Utilization %'];
        rows = d.nurses().map((n) => [n.name, n.active, n.pending, n.completed, n.avgTat, n.utilization]); break;
      case 1: name = 'tat-compliance'; columns = ['Metric', 'Value'];
        rows = [...liveTatBuckets(lob, days).map((b) => [b.label, b.count] as (string | number)[]), ...liveTatStats(lob, days).map((s) => [s.label, s.value] as (string | number)[])]; break;
      case 2: name = 'clinical-decisions'; columns = ['Procedure', 'Service Type', 'Guideline', 'Approval Rate %', 'Volume'];
        rows = liveDecisionRows(lob, days).map((r) => [r.procedure, r.serviceType, r.guideline, r.approvalRate, r.volume]); break;
      case 3: name = 'risk-escalation'; columns = ['Auth ID', 'Member', 'Risk Drivers', 'Amount', 'Stage', 'Risk Score'];
        rows = d.riskCases().map((r) => [r.authId, r.member, r.drivers.join('; '), r.amount, r.stage, r.score]); break;
      case 4: name = 'concurrent-review'; columns = ['Member', 'Facility', 'LOS', 'Total Certified Days', 'Certified Through', 'Days Remaining', 'Uncertified Days', 'Next Review Due', 'Requested/Approved', 'Status', 'Reviewer', 'Expected Discharge', 'Next Action'];
        rows = liveConcurrentRows(lob, days).map((r) => [r.member, r.facility, r.los, r.totalCertifiedDays, r.certifiedThrough, r.daysRemaining, r.uncertifiedDays, r.nextReview, `${r.daysRequested} / ${r.totalCertifiedDays}`, r.status, r.reviewer, r.expectedDischarge, r.nextAction]); break;
      case 5: name = 'intake-missing-fields'; columns = ['Field', 'Missing Count', '% of Submissions'];
        rows = liveMissingFields(lob, days).map((f) => [f.field, f.count, f.pct]); break;
      case 6: name = 'providers'; columns = ['Provider/Facility', 'Specialty', 'Network Status', 'Total Requests', 'OON Requests', 'Approval Rate %', 'Denial Rate %', 'Incomplete Rate %', 'Avg Response (days)', 'Expedited Rate %', 'Primary Insight'];
        rows = liveProviderInsights(lob, days).map((p) => [p.provider, p.specialty, p.networkStatus, p.totalRequests, p.oonRequests, p.approvalRate, p.denialRate, p.incompleteRate, p.avgResponseDays, p.expeditedRate, p.primaryInsight]); break;
      case 7: name = 'cost-utilization'; columns = ['Member', 'Service', 'Provider/Facility', 'Network Status', 'Est. Requested Cost', 'Est. Approved Cost', 'LOS', 'Certified Days', 'Uncertified Days', 'Cost Exposure', 'Assigned To', 'Primary Insight'];
        rows = liveCostInsights(lob, days).map((r) => [r.member, r.service, r.provider, r.networkStatus, r.requestedCost, r.approvedCost, r.los ?? '', r.certifiedDays ?? '', r.uncertifiedDays ?? '', r.costExposure, r.assignedTo, r.primaryInsight]); break;
      case 8: name = 'audit-flags'; columns = ['ID', 'Type', 'Description', 'Date', 'Severity'];
        rows = d.auditFlags().map((f) => [f.id, f.type, f.description, f.date, f.severityLabel]); break;
      case 9: name = 'cm-referrals'; columns = ['Auth', 'Member', 'Reason', 'Referred From', 'Sent', 'Status'];
        rows = REFERRALS.map((r) => [r.authId, r.member, r.reason, r.fromStage, r.received, r.status]); break;
    }
    this.exporter.open({ title: this.tabs[this.selected()], name: `${name}_2026-07-17`, columns, rows });
  }
}
