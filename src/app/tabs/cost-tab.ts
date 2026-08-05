import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveCostInsights } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { CostInsightRow, CostFlag } from '../data/dashboard.models';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { Exporter } from '../shared/exporter';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';
import { Escalate, ESCALATE_TARGETS } from '../shared/escalate';
import { Reassign } from '../shared/reassign';

const COST_WIDGETS = [
  { id: 'flags', title: 'Needs-Attention Summary' },
  { id: 'grid', title: 'Authorization Worklist' },
];

interface FlagTile { flag: CostFlag; label: string; icon: string; }
const FLAG_TILES: FlagTile[] = [
  { flag: 'highCost', label: 'High-Cost Active Authorizations', icon: 'dollar' },
  { flag: 'oonExposure', label: 'Out-of-Network Cost Exposure', icon: 'mappin' },
  { flag: 'uncertifiedDays', label: 'Uncertified Inpatient Days', icon: 'alert' },
  { flag: 'extendedStay', label: 'Extended-Stay Cost Exposure', icon: 'clock' },
  { flag: 'highCostDrug', label: 'High-Cost Drug/Procedure Requests', icon: 'shield' },
  { flag: 'costVariance', label: 'Requested-vs-Approved Variance', icon: 'swap' },
  { flag: 'duplicateService', label: 'Potential Duplicate-Service Cost', icon: 'xcircle' },
];

const fmt = (n: number) => `$${n.toLocaleString()}`;

@Component({
  selector: 'app-cost-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Cost &amp; Utilization Insights</h2>
      <span class="section-note">Which active authorizations may create unusually high cost, payment exposure, or avoidable utilization</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>
    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('flags')) {
    <div class="panel">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Needs-Attention Summary</h3>
        <z-widget-actions (exportClick)="exportFlags()" (removeClick)="hide('flags')"></z-widget-actions>
      </div>
      <div class="tile-row panel-pad">
        @for (t of tiles; track t.flag) {
          <div class="tile" [class.active]="activeFilter() === t.flag" (click)="toggleFilter(t.flag)">
            <div class="tile-ic" [class.hot]="tileCount(t.flag) > 0"><z-icon [name]="t.icon" [size]="16" [stroke]="1.8"></z-icon></div>
            <div class="tile-val">{{ tileCount(t.flag) }}</div>
            <div class="tile-lab">{{ t.label }}</div>
          </div>
        }
      </div>
    </div>
    }

    @if (!isHidden('grid')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Authorization Worklist</h3>
        <div class="view-toggle">
          <button class="seg" [class.active]="!activeFilter() && needsAttentionOnly()" (click)="showNeedsAttention()">Needs Attention ({{ needsAttentionCount() }})</button>
          <button class="seg" [class.active]="!activeFilter() && !needsAttentionOnly()" (click)="showAll()">All Active ({{ rows().length }})</button>
        </div>
        @if (activeFilter()) {
          <span class="filter-chip">Filtered: {{ filterLabel() }} <button class="clr" (click)="clearFilter()">&times;</button></span>
        }
        <select class="prog-filter" [value]="serviceTypeFilter()" (change)="serviceTypeFilter.set($any($event.target).value)">
          <option value="all">All Service Types</option>
          @for (s of serviceTypes(); track s) { <option [value]="s">{{ s }}</option> }
        </select>
        <input class="search-box" type="text" placeholder="Search member, service or provider…"
          [value]="search()" (input)="search.set($any($event.target).value)" />
        <z-widget-actions (exportClick)="exportGrid()" (removeClick)="hide('grid')"></z-widget-actions>
      </div>
      <table class="z-table compact">
        <thead>
          <tr>
            <th class="sortable" (click)="sortBy('member')">Member{{ caret('member') }}</th>
            <th class="sortable" (click)="sortBy('service')">Service{{ caret('service') }}</th>
            <th class="sortable" (click)="sortBy('provider')">Provider/Facility{{ caret('provider') }}</th>
            <th class="sortable" (click)="sortBy('networkStatus')">Network Status{{ caret('networkStatus') }}</th>
            <th class="sortable num" (click)="sortBy('requestedCost')">Est. Requested{{ caret('requestedCost') }}</th>
            <th class="sortable num" (click)="sortBy('approvedCost')">Est. Approved{{ caret('approvedCost') }}</th>
            <th class="sortable num" (click)="sortBy('los')">LOS{{ caret('los') }}</th>
            <th class="sortable num" (click)="sortBy('certifiedDays')">Certified{{ caret('certifiedDays') }}</th>
            <th class="sortable num" (click)="sortBy('uncertifiedDays')">Uncertified{{ caret('uncertifiedDays') }}</th>
            <th class="sortable num" (click)="sortBy('costExposure')">Cost Exposure{{ caret('costExposure') }}</th>
            <th class="sortable" (click)="sortBy('assignedTo')">Assigned To{{ caret('assignedTo') }}</th>
            <th>Primary Insight</th>
          </tr>
        </thead>
        <tbody>
          @for (r of displayRows(); track r.authId) {
            <tr class="clickable" [class.attn]="r.needsAttention" (click)="open(r)">
              <td class="strong">{{ r.member }}</td>
              <td>{{ r.service }}<span class="svc-type">{{ r.serviceType }}</span></td>
              <td>{{ r.provider }}</td>
              <td><span class="badge" [class.green]="r.networkStatus === 'In-Network'" [class.blue]="r.networkStatus === 'Delegated'"
                    [class.red]="r.networkStatus === 'Out-of-Network' || r.networkStatus === 'Exception'">{{ r.networkStatus }}</span></td>
              <td class="num" [class.danger]="r.flags.includes('highCost') || r.flags.includes('highCostDrug')">{{ fmt(r.requestedCost) }}</td>
              <td class="num">{{ fmt(r.approvedCost) }}</td>
              <td class="num">{{ r.los ?? '—' }}</td>
              <td class="num">{{ r.certifiedDays ?? '—' }}</td>
              <td class="num" [class.danger]="!!r.uncertifiedDays">{{ r.uncertifiedDays ?? '—' }}</td>
              <td class="num" [class.danger]="r.costExposure > 0">{{ r.costExposure > 0 ? fmt(r.costExposure) : '—' }}</td>
              <td>{{ r.assignedTo }}</td>
              <td class="insight" [class.ok]="!r.needsAttention">{{ r.primaryInsight }}</td>
            </tr>
          }
          @if (!displayRows().length) {
            <tr><td colspan="12" class="empty">No authorizations match this view.</td></tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .tbl-head { position: relative; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tbl-head:hover z-widget-actions { opacity: 1; }
    .panel-title { margin-right: auto; }

    .tile-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; }
    .tile {
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px;
      cursor: pointer; background: #fff; transition: border-color .15s, box-shadow .15s;
    }
    .tile:hover { box-shadow: var(--shadow); }
    .tile.active { border-color: var(--teal-700); box-shadow: 0 0 0 1px var(--teal-700) inset; }
    .tile-ic { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
      background: var(--gray-100); color: var(--gray-500); }
    .tile-ic.hot { background: var(--amber-bg); color: var(--amber-fg); }
    .tile-val { font-size: 20px; font-weight: 700; color: var(--ink); }
    .tile-lab { font-size: 11px; color: var(--gray-500); font-weight: 600; line-height: 1.3; }

    .view-toggle { display: flex; gap: 4px; background: var(--gray-100); border-radius: 8px; padding: 3px; }
    .seg { border: none; background: transparent; padding: 5px 10px; border-radius: 6px; font-size: 12.5px;
      font-weight: 600; color: var(--ink-soft); cursor: pointer; }
    .seg.active { background: #fff; color: var(--teal-700); box-shadow: var(--shadow); }
    .filter-chip { font-size: 12px; color: var(--teal-900); background: var(--teal-50); border: 1px solid var(--teal-100);
      border-radius: 999px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; }
    .filter-chip .clr { border: none; background: none; cursor: pointer; color: var(--teal-900); font-size: 14px; line-height: 1; padding: 0; }
    .prog-filter { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: #fff;
      font-size: 12.5px; color: var(--ink-soft); margin-left: auto; }
    .search-box { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); font-size: 12.5px;
      width: 200px; outline: none; }
    .search-box:focus { border-color: var(--teal-600); }

    .svc-type { display: block; font-size: 10.5px; color: var(--gray-500); font-weight: 600; margin-top: 1px; }
    .clickable { cursor: pointer; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
    tr.attn { border-left: 3px solid var(--amber); }
    .insight { max-width: 240px; font-size: 12.5px; color: var(--ink-soft); }
    .insight.ok { color: var(--green-fg); }
    .empty { text-align: center; color: var(--gray-500); padding: 24px; }
  `],
})
export class CostTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);
  private esc = inject(Escalate);
  private rx = inject(Reassign);

  readonly tiles = FLAG_TILES;
  readonly vis = new WidgetVisibility('zyter-um-cost-widgets-v1', COST_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }
  fmt = fmt;

  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }

  readonly rows = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveCostInsights(lob, days);
  });
  readonly needsAttentionCount = computed(() => this.rows().filter((r) => r.needsAttention).length);

  readonly needsAttentionOnly = signal(true);
  readonly activeFilter = signal<CostFlag | null>(null);
  showNeedsAttention() { this.activeFilter.set(null); this.needsAttentionOnly.set(true); }
  showAll() { this.activeFilter.set(null); this.needsAttentionOnly.set(false); }
  toggleFilter(flag: CostFlag) { this.activeFilter.set(this.activeFilter() === flag ? null : flag); }
  clearFilter() { this.activeFilter.set(null); }
  filterLabel(): string { return this.tiles.find((t) => t.flag === this.activeFilter())?.label ?? ''; }

  tileCount(flag: CostFlag) { return this.rows().filter((r) => r.flags.includes(flag)).length; }

  readonly sortKey = signal<keyof CostInsightRow | ''>('costExposure');
  readonly sortDir = signal<SortDir>(-1);
  sortBy(k: keyof CostInsightRow) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(k); this.sortDir.set(1); }
  }
  caret(k: keyof CostInsightRow) { return caretFor(this.sortKey(), k, this.sortDir()); }

  readonly search = signal('');
  readonly serviceTypeFilter = signal('all');
  readonly serviceTypes = computed(() => [...new Set(this.rows().map((r) => r.serviceType))].sort());

  readonly displayRows = computed(() => {
    const flag = this.activeFilter();
    let rs = this.rows();
    rs = flag ? rs.filter((r) => r.flags.includes(flag)) : this.needsAttentionOnly() ? rs.filter((r) => r.needsAttention) : rs;
    const svc = this.serviceTypeFilter();
    if (svc !== 'all') rs = rs.filter((r) => r.serviceType === svc);
    const q = this.search().trim().toLowerCase();
    if (q) rs = rs.filter((r) => r.member.toLowerCase().includes(q) || r.service.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q));
    return compareRows(rs, this.sortKey(), this.sortDir());
  });

  exportFlags() {
    this.exporter.open({
      title: 'Needs-Attention Summary', name: 'cost-needs-attention_2026-07-17',
      columns: ['Flag', 'Authorizations Affected'],
      rows: this.tiles.map((t) => [t.label, this.tileCount(t.flag)]),
    });
  }
  exportGrid() {
    this.exporter.open({
      title: 'Authorization Worklist', name: 'cost-utilization_2026-07-17',
      columns: ['Member', 'Service', 'Provider/Facility', 'Network Status', 'Est. Requested Cost', 'Est. Approved Cost', 'LOS', 'Certified Days', 'Uncertified Days', 'Cost Exposure', 'Assigned To', 'Primary Insight'],
      rows: this.displayRows().map((r) => [r.member, r.service, r.provider, r.networkStatus, r.requestedCost, r.approvedCost, r.los ?? '', r.certifiedDays ?? '', r.uncertifiedDays ?? '', r.costExposure, r.assignedTo, r.primaryInsight]),
    });
  }

  private reassignOne(r: CostInsightRow) {
    const nurses = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization, active: n.active }));
    this.rx.open({
      title: `Reassign ${r.member}`,
      cases: [{ authId: r.authId, member: r.member, type: r.serviceType, queue: r.queue, priority: r.urgency, owner: r.assignedTo !== '—' ? r.assignedTo : 'Unassigned' }],
      nurses, preselectAll: true,
      apply: (_ids, target, mode) => {
        if (mode === 'queue') {
          this.data.decrementQueue(r.queue); this.data.incrementQueue(target);
          this.ix.toast(`${r.member} moved to ${target}.`);
          this.data.addHistory('swap', 'Authorization moved to queue', `${r.member} → ${target}`);
          return;
        }
        this.data.moveOneCase(r.assignedTo !== '—' ? r.assignedTo : null, target);
        this.ix.toast(`${r.member} reassigned to ${target}.`);
        this.data.addHistory('swap', 'Authorization reassigned', `${r.member} → ${target}`);
      },
    });
  }

  private escalateOne(r: CostInsightRow) {
    this.esc.open({
      title: `Escalate ${r.member}`,
      candidates: [{ authId: r.authId, member: r.member, detail: `${r.service} · ${fmt(r.requestedCost)} · ${r.primaryInsight}`, riskLabel: r.urgency, risk: r.urgency === 'Expedited' ? 'amber' : 'green' }],
      targets: ESCALATE_TARGETS,
      apply: (_ids, who) => {
        this.ix.toast(`${r.member} escalated to ${who} for medical-director review.`, 'warn');
        this.data.addHistory('arrowup', 'Cost review escalated', `${r.member} → ${who}`);
      },
    });
  }

  private routeToOon(r: CostInsightRow) {
    this.data.decrementQueue(r.queue); this.data.incrementQueue('OON Review');
    this.ix.toast(`${r.member} routed to OON Review.`, 'warn');
    this.data.addHistory('mappin', 'Routed to OON review', r.member);
  }

  private requestDischargePlan(r: CostInsightRow) {
    this.ix.toast(`Updated discharge plan requested for ${r.member}.`, 'info');
    this.data.addHistory('mail', 'Discharge plan requested', r.member);
  }

  private documentReview(r: CostInsightRow) {
    this.ix.toast(`Financial-exposure review documented for ${r.member}.`);
    this.data.addHistory('folder', 'Financial-exposure review documented', r.member);
  }

  open(r: CostInsightRow) {
    this.ix.openDrawer({
      title: r.member,
      subtitle: `${r.service} · ${r.serviceType} · ${r.provider}`,
      badge: { text: r.needsAttention ? 'Needs Attention' : 'On Track', tone: r.needsAttention ? 'amber' : 'green' },
      fields: [
        { label: 'Network Status', value: r.networkStatus, tone: r.networkStatus === 'In-Network' ? 'green' : r.networkStatus === 'Delegated' ? 'blue' : 'red' },
        { label: 'Estimated Requested Cost', value: fmt(r.requestedCost), tone: r.flags.includes('highCost') || r.flags.includes('highCostDrug') ? 'red' : undefined },
        { label: 'Estimated Approved Cost', value: fmt(r.approvedCost) },
        { label: 'Cost Variance', value: fmt(r.costVariance), tone: r.flags.includes('costVariance') ? 'red' : undefined },
        ...(r.los !== null ? [{ label: 'Current LOS', value: `${r.los} day(s)` }] : []),
        ...(r.certifiedDays !== null ? [{ label: 'Certified Days', value: `${r.certifiedDays} day(s)` }] : []),
        ...(r.uncertifiedDays !== null ? [{ label: 'Uncertified Days', value: `${r.uncertifiedDays} day(s)`, tone: r.uncertifiedDays > 0 ? 'red' as const : undefined }] : []),
        ...(r.expectedDischarge ? [{ label: 'Expected Discharge', value: r.expectedDischarge }] : []),
        { label: 'Cost Exposure (Estimate)', value: r.costExposure > 0 ? fmt(r.costExposure) : '—', tone: r.costExposure > 0 ? 'amber' as const : undefined },
        { label: 'Assigned To', value: r.assignedTo },
        { label: 'Urgency', value: r.urgency },
      ],
      table: r.insights.length ? { columns: ['Insight'], rows: r.insights.map((i) => [i]) } : undefined,
      note: r.primaryInsight,
      actions: [
        { label: 'Reassign case', tone: 'teal', run: () => { this.ix.closeDrawer(); this.reassignOne(r); } },
        { label: 'Escalate for medical-director review', tone: 'amber', run: () => { this.ix.closeDrawer(); this.escalateOne(r); } },
        ...(r.flags.includes('oonExposure') ? [{ label: 'Route to OON review', tone: 'amber' as const, run: () => this.routeToOon(r) }] : []),
        ...(r.los !== null ? [{ label: 'Request updated discharge plan', tone: 'teal' as const, run: () => this.requestDischargePlan(r) }] : []),
        { label: 'Document financial-exposure review', tone: 'teal', run: () => this.documentReview(r) },
      ],
    });
  }
}
