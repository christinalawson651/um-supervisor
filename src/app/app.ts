import { Component, signal, computed, inject } from '@angular/core';
import { Icon } from './shared/icon';
import { Overlays } from './shared/overlays';
import { CaseExplorer } from './shared/case-explorer';
import { MemberChart } from './shared/member-chart';
import { ReassignPanel } from './shared/reassign-panel';
import { GlobalSearch } from './shared/global-search';
import { Interaction } from './shared/interaction';
import { Metrics } from './shared/metrics';
import { Nav, ROLES } from './shared/nav';
import { downloadCsv } from './shared/export-csv';
import { DashboardData } from './data/dashboard-data';

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
import { FinancialTab } from './tabs/financial-tab';
import { AuditTab } from './tabs/audit-tab';
import { AiTab } from './tabs/ai-tab';
import { ReferralsTab } from './tabs/referrals-tab';

const TABS = [
  'Workforce & Queue Management',
  'TAT & SLA Compliance',
  'Clinical Decision Insights',
  'Risk & Escalation Panel',
  'Concurrent Review Monitoring',
  'Intake & Documentation Quality',
  'Provider & Network Insights',
  'Financial / Cost Indicators',
  'Audit & Compliance',
  'AI / NextGen Intelligence',
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
    Icon, Overlays, CaseExplorer, MemberChart, ReassignPanel, GlobalSearch, OverviewDashboard, CmDashboard, AppealsDashboard,
    WorkforceTab, TatTab, ClinicalTab, RiskTab, ConcurrentTab,
    IntakeTab, ProviderTab, FinancialTab, AuditTab, AiTab, ReferralsTab,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly data = inject(DashboardData);
  private ix = inject(Interaction);
  private metrics = inject(Metrics);
  readonly nav = inject(Nav);
  readonly tabs = TABS;
  readonly rail = RAIL;
  readonly modules = MODULES;
  readonly headings = HEADINGS;
  readonly visibleTabs = computed(() => MODULES.filter((m) => this.nav.visibleModules().includes(m.id)));
  readonly selected = signal(0);
  readonly kpiKeys = ['kpi.pending', 'kpi.tat', 'kpi.auto', 'kpi.risk', 'kpi.aht', 'kpi.unassigned', 'kpi.breached', 'kpi.util'];

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
      note: h.length ? undefined : 'No actions yet — reassign a case or escalate one to see the log here.',
      actions: [{ label: 'Reset demo data', tone: 'red', run: () => this.resetDemo() }],
    });
  }

  resetDemo() {
    this.ix.ask({
      title: 'Reset demo data',
      body: 'Restore all cases, queues, nurses, and history to their original state? Any changes made during the demo will be cleared.',
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

  /** Export the currently visible tab's dataset as CSV. */
  exportCsv() {
    if (this.nav.module() !== 'um') {
      this.ix.toast('Export is available from the tables and drill-downs within this view.', 'info');
      return;
    }
    const d = this.data;
    const stamp = '2026-07-17';
    switch (this.selected()) {
      case 0:
        downloadCsv(`workforce-nurses_${stamp}`,
          ['Nurse', 'Active Cases', 'Pending', 'Completed MTD', 'Avg TAT', 'Utilization %'],
          d.nurses().map((n) => [n.name, n.active, n.pending, n.completed, n.avgTat, n.utilization]));
        break;
      case 1:
        downloadCsv(`tat-sla_${stamp}`, ['Metric', 'Value'],
          [...d.tatBuckets.map((b) => [b.label, b.count] as (string | number)[]),
           ...d.tatStats.map((s) => [s.label, s.value] as (string | number)[])]);
        break;
      case 2:
        downloadCsv(`clinical-decisions_${stamp}`,
          ['Procedure', 'Service Type', 'Guideline', 'Approval Rate %', 'Volume'],
          d.decisionRows.map((r) => [r.procedure, r.serviceType, r.guideline, r.approvalRate, r.volume]));
        break;
      case 3:
        downloadCsv(`risk-escalation_${stamp}`,
          ['Auth ID', 'Member', 'Risk Drivers', 'Amount', 'Stage', 'Risk Score'],
          d.riskCases().map((r) => [r.authId, r.member, r.drivers.join('; '), r.amount, r.stage, r.score]));
        break;
      case 4:
        downloadCsv(`concurrent-review_${stamp}`,
          ['Member', 'Facility', 'Admit', 'Next Review', 'LOS', 'Expected LOS', 'Days Approved', 'Days Requested', 'Overstay Risk'],
          d.concurrentRows().map((r) => [r.member, r.facility, r.admit, r.nextReview, r.los, r.expectedLos, r.daysApproved, r.daysRequested, r.overstayLabel]));
        break;
      case 5:
        downloadCsv(`intake-missing-fields_${stamp}`, ['Field', 'Missing Count', '% of Submissions'],
          d.missingFields.map((f) => [f.field, f.count, f.pct]));
        break;
      case 6:
        downloadCsv(`providers_${stamp}`, ['Provider', 'NPI', 'Requests MTD', 'Approval Rate %', 'RFI Rate %'],
          d.providers.map((p) => [p.provider, p.npi, p.requests, p.approvalRate, p.rfiRate]));
        break;
      case 7:
        downloadCsv(`high-dollar-cases_${stamp}`, ['Auth ID', 'Member', 'Procedure', 'Estimated Cost', 'Status'],
          d.highDollarCases.map((c) => [c.authId, c.member, c.procedure, c.cost, c.status]));
        break;
      case 8:
        downloadCsv(`audit-flags_${stamp}`, ['ID', 'Type', 'Description', 'Date', 'Severity'],
          d.auditFlags().map((f) => [f.id, f.type, f.description, f.date, f.severityLabel]));
        break;
      case 9:
        downloadCsv(`ai-recommendations_${stamp}`, ['Title', 'Detail', 'Confidence %', 'Action'],
          d.aiRecommendations().map((r) => [r.title, r.detail, r.confidence, r.action]));
        break;
    }
    this.ix.toast(`Exported "${this.tabs[this.selected()]}" as CSV.`);
  }
}
