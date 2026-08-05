import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveProviderInsights, inScope } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { ProviderInsightRow, ProviderFlag } from '../data/dashboard.models';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { Exporter } from '../shared/exporter';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';
import { Escalate, ESCALATE_TARGETS } from '../shared/escalate';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { COLUMNS, toRow } from '../shared/metrics';
import { urgencyOf } from '../data/case-fields';

const PROVIDER_WIDGETS = [
  { id: 'flags', title: 'Needs-Attention Summary' },
  { id: 'grid', title: 'Provider & Facility Grid' },
];

interface FlagTile { flag: ProviderFlag; label: string; icon: string; }
const FLAG_TILES: FlagTile[] = [
  { flag: 'oon', label: 'OON Exceptions', icon: 'mappin' },
  { flag: 'missingClinicals', label: 'Missing/Late Clinicals', icon: 'inbox' },
  { flag: 'networkDiscrepancy', label: 'Network-Status Exceptions', icon: 'wifi' },
  { flag: 'highIncomplete', label: 'High Incomplete Rate', icon: 'xcircle' },
  { flag: 'highDenialPartial', label: 'High Denial/Partial Rate', icon: 'alert' },
  { flag: 'unusualUtilization', label: 'Unusual Utilization', icon: 'barchart' },
  { flag: 'tatDelay', label: 'Repeated TAT Delays', icon: 'clock' },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

@Component({
  selector: 'app-provider-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Provider &amp; Network Insights</h2>
      <span class="section-note">Which providers or facilities are creating authorization risk, avoidable work, or network exceptions</span>
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
        <h3 class="panel-title">Providers &amp; Facilities</h3>
        <div class="view-toggle">
          <button class="seg" [class.active]="!activeFilter() && designationFilter() === 'all' && needsAttentionOnly()" (click)="showNeedsAttention()">Needs Attention ({{ needsAttentionCount() }})</button>
          <button class="seg" [class.active]="!activeFilter() && designationFilter() === 'all' && !needsAttentionOnly()" (click)="showAll()">All Providers ({{ rows().length }})</button>
        </div>
        @if (activeFilter() || designationFilter() !== 'all') {
          <span class="filter-chip">Filtered: {{ filterLabel() }} <button class="clr" (click)="clearFilter()">&times;</button></span>
        }
        <select class="prog-filter" [value]="specialtyFilter()" (change)="specialtyFilter.set($any($event.target).value)">
          <option value="all">All Specialties</option>
          @for (s of specialties(); track s) { <option [value]="s">{{ s }}</option> }
        </select>
        <select class="prog-filter" [value]="designationFilter()" (change)="setDesignation($any($event.target).value)">
          <option value="all">All Designations</option>
          <option value="vip">VIP ({{ vipCount() }})</option>
          <option value="goldCard">Gold Card ({{ goldCardCount() }})</option>
        </select>
        <input class="search-box" type="text" placeholder="Search provider or facility…"
          [value]="search()" (input)="search.set($any($event.target).value)" />
        <z-widget-actions (exportClick)="exportGrid()" (removeClick)="hide('grid')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead>
          <tr>
            <th class="sortable" (click)="sortBy('provider')">Provider/Facility{{ caret('provider') }}</th>
            <th class="sortable" (click)="sortBy('specialty')">Specialty{{ caret('specialty') }}</th>
            <th class="sortable" (click)="sortBy('networkStatus')">Network Status{{ caret('networkStatus') }}</th>
            <th class="sortable num" (click)="sortBy('totalRequests')">Total Requests{{ caret('totalRequests') }}</th>
            <th class="sortable num" (click)="sortBy('oonRequests')">OON Requests{{ caret('oonRequests') }}</th>
            <th class="sortable num" (click)="sortBy('approvalRate')">Approval Rate{{ caret('approvalRate') }}</th>
            <th class="sortable num" (click)="sortBy('denialRate')">Denial Rate{{ caret('denialRate') }}</th>
            <th class="sortable num" (click)="sortBy('incompleteRate')">Incomplete Rate{{ caret('incompleteRate') }}</th>
            <th class="sortable num" (click)="sortBy('avgResponseDays')">Avg Response Time{{ caret('avgResponseDays') }}</th>
            <th class="sortable num" (click)="sortBy('expeditedRate')">Expedited Rate{{ caret('expeditedRate') }}</th>
            <th>Primary Insight</th>
          </tr>
        </thead>
        <tbody>
          @for (p of displayRows(); track p.provider) {
            <tr class="clickable" [class.attn]="p.needsAttention" (click)="open(p)">
              <td class="strong">
                {{ p.provider }}
                @if (p.vip) { <span class="tag vip" title="Plan-designated strategic partner">VIP</span> }
                @if (p.goldCard) { <span class="tag gold" title="Clean record + sustained approval rate — eligible for prior-auth exemption">Gold Card</span> }
              </td>
              <td>{{ p.specialty }}</td>
              <td><span class="badge" [class.green]="p.networkStatus === 'In-Network'" [class.blue]="p.networkStatus === 'Delegated'"
                    [class.red]="p.networkStatus === 'Out-of-Network' || p.networkStatus === 'Exception'">{{ p.networkStatus }}</span></td>
              <td class="num">{{ p.totalRequests }}</td>
              <td class="num" [class.danger]="p.oonRequests >= 3">{{ p.oonRequests }}</td>
              <td><span class="rate-pill" [class.good]="p.approvalRate >= 80" [class.mid]="p.approvalRate < 80">{{ p.approvalRate }}%</span></td>
              <td class="num" [class.danger]="p.flags.includes('highDenialPartial')">{{ p.denialRate }}%</td>
              <td class="num" [class.danger]="p.flags.includes('highIncomplete')">{{ p.incompleteRate }}%</td>
              <td class="num" [class.danger]="p.flags.includes('tatDelay')">{{ p.avgResponseDays }}d</td>
              <td class="num" [class.danger]="p.flags.includes('unusualUtilization') && p.expeditedRate > 0">{{ p.expeditedRate }}%</td>
              <td class="insight" [class.ok]="!p.needsAttention">{{ p.primaryInsight }}</td>
            </tr>
          }
          @if (!displayRows().length) {
            <tr><td colspan="11" class="empty">No providers match this view.</td></tr>
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
      width: 180px; outline: none; }
    .search-box:focus { border-color: var(--teal-600); }

    .tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.03em; vertical-align: middle; }
    .tag.vip { background: var(--blue-bg); color: var(--blue-fg); }
    .tag.gold { background: #fef3c7; color: #92400e; }

    .clickable { cursor: pointer; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
    tr.attn { border-left: 3px solid var(--amber); }
    .insight { max-width: 260px; font-size: 12.5px; color: var(--ink-soft); }
    .insight.ok { color: var(--green-fg); }
    .empty { text-align: center; color: var(--gray-500); padding: 24px; }
  `],
})
export class ProviderTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);
  private esc = inject(Escalate);

  readonly tiles = FLAG_TILES;
  readonly vis = new WidgetVisibility('zyter-um-provider-widgets-v2', PROVIDER_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }

  readonly rows = computed(() => {
    const [lob, days] = this.scopeArgs();
    return liveProviderInsights(lob, days);
  });
  readonly needsAttentionCount = computed(() => this.rows().filter((r) => r.needsAttention).length);

  readonly needsAttentionOnly = signal(true);
  readonly activeFilter = signal<ProviderFlag | null>(null);
  showNeedsAttention() { this.activeFilter.set(null); this.designationFilter.set('all'); this.needsAttentionOnly.set(true); }
  showAll() { this.activeFilter.set(null); this.designationFilter.set('all'); this.needsAttentionOnly.set(false); }
  toggleFilter(flag: ProviderFlag) { this.activeFilter.set(this.activeFilter() === flag ? null : flag); this.designationFilter.set('all'); }
  clearFilter() { this.activeFilter.set(null); this.designationFilter.set('all'); }
  filterLabel(): string {
    const d = this.designationFilter();
    if (d !== 'all') return d === 'vip' ? 'VIP' : 'Gold Card';
    return this.tiles.find((t) => t.flag === this.activeFilter())?.label ?? '';
  }

  tileCount(flag: ProviderFlag) { return this.rows().filter((r) => r.flags.includes(flag)).length; }

  readonly sortKey = signal<keyof ProviderInsightRow | ''>('totalRequests');
  readonly sortDir = signal<SortDir>(-1);
  sortBy(k: keyof ProviderInsightRow) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(k); this.sortDir.set(1); }
  }
  caret(k: keyof ProviderInsightRow) { return caretFor(this.sortKey(), k, this.sortDir()); }

  readonly search = signal('');
  readonly specialtyFilter = signal('all');
  readonly specialties = computed(() => [...new Set(this.rows().map((r) => r.specialty))].sort());

  readonly designationFilter = signal<'all' | 'vip' | 'goldCard'>('all');
  readonly vipCount = computed(() => this.rows().filter((r) => r.vip).length);
  readonly goldCardCount = computed(() => this.rows().filter((r) => r.goldCard).length);
  setDesignation(v: string) { this.designationFilter.set(v as 'all' | 'vip' | 'goldCard'); this.activeFilter.set(null); }

  readonly displayRows = computed(() => {
    const flag = this.activeFilter();
    const desig = this.designationFilter();
    let rs = this.rows();
    if (flag) rs = rs.filter((r) => r.flags.includes(flag));
    else if (desig !== 'all') rs = rs.filter((r) => (desig === 'vip' ? r.vip : r.goldCard));
    else if (this.needsAttentionOnly()) rs = rs.filter((r) => r.needsAttention);
    const spec = this.specialtyFilter();
    if (spec !== 'all') rs = rs.filter((r) => r.specialty === spec);
    const q = this.search().trim().toLowerCase();
    if (q) rs = rs.filter((r) => r.provider.toLowerCase().includes(q) || r.specialty.toLowerCase().includes(q));
    return compareRows(rs, this.sortKey(), this.sortDir());
  });

  exportFlags() {
    this.exporter.open({
      title: 'Needs-Attention Summary', name: 'provider-needs-attention_2026-07-17',
      columns: ['Flag', 'Providers/Facilities Affected'],
      rows: this.tiles.map((t) => [t.label, this.tileCount(t.flag)]),
    });
  }
  exportGrid() {
    this.exporter.open({
      title: 'Providers & Facilities', name: 'providers_2026-07-17',
      columns: ['Provider/Facility', 'Specialty', 'Network Status', 'Total Requests', 'OON Requests', 'Approval Rate %', 'Denial Rate %', 'Incomplete Rate %', 'Avg Response (days)', 'Expedited Rate %', 'Primary Insight'],
      rows: this.displayRows().map((p) => [p.provider, p.specialty, p.networkStatus, p.totalRequests, p.oonRequests, p.approvalRate, p.denialRate, p.incompleteRate, p.avgResponseDays, p.expeditedRate, p.primaryInsight]),
    });
  }

  private providerCases(p: ProviderInsightRow): CaseRec[] {
    const [lob, days] = this.scopeArgs();
    return CASE_POOL.filter((c) => c.provider === p.provider && inScope(c, lob, days));
  }

  private openAuths(p: ProviderInsightRow) {
    const cs = this.providerCases(p);
    this.ix.openExplorer({
      title: `${p.provider} — Authorizations`,
      context: `${cs.length} authorization(s) submitted by ${p.provider}`,
      columns: COLUMNS, rows: cs.map(toRow),
      exportName: `provider-${slug(p.provider)}-auths_2026-07-17`, memberColumn: 1,
    });
  }

  private escalateProvider(p: ProviderInsightRow) {
    const flagged = this.providerCases(p).filter((c) => c.phase === 'pending' && (c.tags.includes('oon') || c.tags.includes('incompleteDoc') || c.tags.includes('rfi')));
    const pool = flagged.length ? flagged : this.providerCases(p).filter((c) => c.phase === 'pending');
    const candidates = pool.slice(0, 5).map((c) => ({
      authId: c.authId, member: c.member,
      detail: `${c.procedure} · ${c.tags.includes('oon') ? 'Out of Network' : c.tags.includes('incompleteDoc') ? 'Incomplete submission' : 'Pending review'}`,
      riskLabel: urgencyOf(c), risk: (urgencyOf(c) === 'Expedited' ? 'amber' : 'green') as 'red' | 'amber' | 'green',
    }));
    this.esc.open({
      title: `Escalate ${p.provider}`,
      candidates,
      targets: ['Provider Relations', 'Network Management', ...ESCALATE_TARGETS],
      apply: (_ids, who) => {
        this.ix.toast(`${p.provider} escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Provider escalated', `${p.provider} → ${who}`);
      },
    });
  }

  private requestInfo(p: ProviderInsightRow) {
    this.ix.toast(`Information request sent to ${p.provider}.`, 'info');
    this.data.addHistory('mail', 'Provider information requested', p.provider);
  }

  private addNote(p: ProviderInsightRow) {
    this.ix.toast(`Supervisor note added for ${p.provider}.`);
    this.data.addHistory('folder', 'Supervisor note added', p.provider);
  }

  open(p: ProviderInsightRow) {
    this.ix.openDrawer({
      title: p.provider,
      subtitle: `${p.specialty} · ${p.kind}${p.npi ? ` · NPI ${p.npi}` : ''}`,
      badge: { text: p.needsAttention ? 'Needs Attention' : 'On Track', tone: p.needsAttention ? 'amber' : 'green' },
      fields: [
        ...(p.vip || p.goldCard
          ? [{ label: 'Designations', value: [p.vip ? 'VIP' : null, p.goldCard ? 'Gold Card' : null].filter(Boolean).join(' · '), tone: 'blue' as const }]
          : []),
        { label: 'Network Status', value: p.networkStatus, tone: p.networkStatus === 'In-Network' ? 'green' : p.networkStatus === 'Delegated' ? 'blue' : 'red' },
        { label: 'Total Requests', value: String(p.totalRequests) },
        { label: 'OON Requests', value: String(p.oonRequests), tone: p.oonRequests > 0 ? 'amber' : undefined },
        { label: 'Approval Rate', value: `${p.approvalRate}%`, tone: p.approvalRate >= 80 ? 'green' : 'amber' },
        { label: 'Denial Rate', value: `${p.denialRate}%`, tone: p.flags.includes('highDenialPartial') ? 'red' : undefined },
        { label: 'Partial-Approval Rate', value: `${p.partialRate}%` },
        { label: 'Incomplete-Submission Rate', value: `${p.incompleteRate}%`, tone: p.flags.includes('highIncomplete') ? 'red' : undefined },
        { label: 'Avg Response Time', value: `${p.avgResponseDays} day(s)`, tone: p.flags.includes('tatDelay') ? 'amber' : undefined },
        { label: 'Expedited Rate', value: `${p.expeditedRate}%` },
        { label: 'Cases Awaiting Clinicals', value: String(p.clinicalsAwaiting), tone: p.flags.includes('missingClinicals') ? 'amber' : undefined },
      ],
      table: p.insights.length ? { columns: ['Insight'], rows: p.insights.map((i) => [i]) } : undefined,
      note: p.primaryInsight,
      actions: [
        { label: 'View authorizations', tone: 'teal', run: () => { this.ix.closeDrawer(); this.openAuths(p); } },
        { label: 'Request provider information', tone: 'teal', run: () => this.requestInfo(p) },
        { label: 'Escalate to network / provider relations', tone: 'amber', run: () => { this.ix.closeDrawer(); this.escalateProvider(p); } },
        { label: 'Add supervisor note', tone: 'teal', run: () => this.addNote(p) },
      ],
    });
  }
}
