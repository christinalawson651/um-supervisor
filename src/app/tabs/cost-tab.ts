import { Component, computed, inject } from '@angular/core';
import { DashboardData, liveCostInsights, inScope } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { CostFlag } from '../data/dashboard.models';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { Exporter } from '../shared/exporter';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { COLUMNS, toRow } from '../shared/metrics';

const COST_WIDGETS = [
  { id: 'kpis', title: 'Cost Overview' },
  { id: 'flags', title: 'Needs-Attention Summary' },
  { id: 'byService', title: 'Cost Exposure by Service Type' },
  { id: 'byNetwork', title: 'Cost Exposure by Network Status' },
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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

@Component({
  selector: 'app-cost-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Cost &amp; Utilization Insights</h2>
      <span class="section-note">Which active authorizations may create unusually high cost, payment exposure, or avoidable utilization — click a tile to drill in</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>
    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('kpis')) {
    <div class="panel">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Cost Overview</h3>
        <z-widget-actions (exportClick)="exportKpis()" (removeClick)="hide('kpis')"></z-widget-actions>
      </div>
      <div class="tile-row kpi-row panel-pad">
        <div class="tile" (click)="drillAll()">
          <div class="tile-ic"><z-icon name="folder" [size]="16" [stroke]="1.8"></z-icon></div>
          <div class="tile-val">{{ totalActive() }}</div>
          <div class="tile-lab">Active Authorizations</div>
        </div>
        <div class="tile" (click)="drillNeedsAttention()">
          <div class="tile-ic hot"><z-icon name="alert" [size]="16" [stroke]="1.8"></z-icon></div>
          <div class="tile-val">{{ needsAttentionCount() }}</div>
          <div class="tile-lab">Needing Attention</div>
        </div>
        <div class="tile" (click)="drillNeedsAttention()">
          <div class="tile-ic hot"><z-icon name="dollar" [size]="16" [stroke]="1.8"></z-icon></div>
          <div class="tile-val">{{ fmt(totalExposure()) }}</div>
          <div class="tile-lab">Total Cost Exposure (Estimate)</div>
        </div>
        <div class="tile no-clk">
          <div class="tile-ic"><z-icon name="swap" [size]="16" [stroke]="1.8"></z-icon></div>
          <div class="tile-val">{{ avgVariancePct() }}%</div>
          <div class="tile-lab">Avg Requested-vs-Approved Variance</div>
        </div>
      </div>
    </div>
    }

    @if (!isHidden('flags')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Needs-Attention Summary</h3>
        <z-widget-actions (exportClick)="exportFlags()" (removeClick)="hide('flags')"></z-widget-actions>
      </div>
      <div class="tile-row panel-pad">
        @for (t of tiles; track t.flag) {
          <div class="tile" (click)="drillFlag(t.flag)">
            <div class="tile-ic" [class.hot]="tileCount(t.flag) > 0"><z-icon [name]="t.icon" [size]="16" [stroke]="1.8"></z-icon></div>
            <div class="tile-val">{{ tileCount(t.flag) }}</div>
            <div class="tile-lab">{{ t.label }}</div>
          </div>
        }
      </div>
    </div>
    }

    <div class="grid-2 mt-6">
      @if (!isHidden('byService')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Cost Exposure by Service Type</h3>
          <z-widget-actions (exportClick)="exportByService()" (removeClick)="hide('byService')"></z-widget-actions>
        </div>
        <div class="ilist">
          @for (s of byServiceType(); track s.type) {
            <div class="irow clk" (click)="drillServiceType(s.type)">
              <div class="ilab">{{ s.type }}</div>
              <div class="ibar-track"><div class="ibar-fill teal" [style.width.%]="s.pct"></div></div>
              <div class="icount">{{ s.count }} · {{ s.pct }}%</div>
            </div>
          }
        </div>
      </div>
      }
      @if (!isHidden('byNetwork')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Cost Exposure by Network Status</h3>
          <z-widget-actions (exportClick)="exportByNetwork()" (removeClick)="hide('byNetwork')"></z-widget-actions>
        </div>
        <div class="ilist">
          @for (s of byNetworkStatus(); track s.status) {
            <div class="irow clk" (click)="drillNetworkStatus(s.status)">
              <div class="ilab">{{ s.status }}</div>
              <div class="ibar-track"><div class="ibar-fill amber" [style.width.%]="s.pct"></div></div>
              <div class="icount">{{ s.count }} · {{ s.pct }}%</div>
            </div>
          }
        </div>
      </div>
      }
    </div>
  `,
  styles: [`
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .tbl-head { position: relative; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tbl-head:hover z-widget-actions { opacity: 1; }
    .panel-title { margin-right: auto; }

    .tile-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; }
    .kpi-row { grid-template-columns: repeat(4, 1fr); }
    .tile {
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px;
      cursor: pointer; background: #fff; transition: border-color .15s, box-shadow .15s;
    }
    .tile:hover { box-shadow: var(--shadow); }
    .tile.no-clk { cursor: default; }
    .tile.no-clk:hover { box-shadow: none; }
    .tile-ic { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
      background: var(--gray-100); color: var(--gray-500); }
    .tile-ic.hot { background: var(--amber-bg); color: var(--amber-fg); }
    .tile-val { font-size: 20px; font-weight: 700; color: var(--ink); }
    .tile-lab { font-size: 11px; color: var(--gray-500); font-weight: 600; line-height: 1.3; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
    .ilist { padding: 6px 20px 20px; display: flex; flex-direction: column; gap: 8px; }
    .irow { display: grid; grid-template-columns: minmax(100px, 150px) 1fr 70px; align-items: center; gap: 10px;
      padding: 6px 8px; border-radius: 8px; }
    .irow.clk { cursor: pointer; }
    .irow.clk:hover { background: var(--gray-100); }
    .ilab { font-size: 13px; color: var(--ink); font-weight: 500; }
    .ibar-track { height: 8px; background: var(--gray-100); border-radius: 4px; overflow: hidden; }
    .ibar-fill { height: 100%; border-radius: 4px; }
    .ibar-fill.teal { background: var(--teal-600); }
    .ibar-fill.amber { background: var(--amber); }
    .icount { text-align: right; font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--gray-500); }
  `],
})
export class CostTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);

  readonly tiles = FLAG_TILES;
  readonly vis = new WidgetVisibility('zyter-um-cost-widgets-v2', COST_WIDGETS);
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

  readonly totalActive = computed(() => this.rows().length);
  readonly needsAttentionCount = computed(() => this.rows().filter((r) => r.needsAttention).length);
  readonly totalExposure = computed(() => this.rows().reduce((s, r) => s + r.costExposure, 0));
  readonly avgVariancePct = computed(() => {
    const cs = this.rows().filter((r) => r.requestedCost > 0);
    if (!cs.length) return 0;
    return Math.round((cs.reduce((s, r) => s + r.costVariance / r.requestedCost, 0) / cs.length) * 100);
  });

  tileCount(flag: CostFlag) { return this.rows().filter((r) => r.flags.includes(flag)).length; }

  readonly byServiceType = computed(() => {
    const attn = this.rows().filter((r) => r.needsAttention);
    const total = attn.length || 1;
    return [...new Set(this.rows().map((r) => r.serviceType))]
      .map((type) => { const count = attn.filter((r) => r.serviceType === type).length; return { type, count, pct: Math.round((count / total) * 100) }; })
      .sort((a, b) => b.count - a.count);
  });

  readonly byNetworkStatus = computed(() => {
    const attn = this.rows().filter((r) => r.needsAttention);
    const total = attn.length || 1;
    return [...new Set(this.rows().map((r) => r.networkStatus))]
      .map((status) => { const count = attn.filter((r) => r.networkStatus === status).length; return { status, count, pct: Math.round((count / total) * 100) }; })
      .sort((a, b) => b.count - a.count);
  });

  private casesByAuthIds(ids: Set<string>): CaseRec[] {
    const [lob, days] = this.scopeArgs();
    return CASE_POOL.filter((c) => ids.has(c.authId) && inScope(c, lob, days));
  }

  private openCases(title: string, cs: CaseRec[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${cs.length} authorization(s)`,
      columns: COLUMNS, rows: cs.map(toRow),
      exportName: `cost-${exportSlug}_2026-07-17`, memberColumn: 1,
    });
  }

  drillAll() {
    const cs = this.casesByAuthIds(new Set(this.rows().map((r) => r.authId)));
    this.openCases('All Active Authorizations', cs, 'all-active');
  }
  drillNeedsAttention() {
    const cs = this.casesByAuthIds(new Set(this.rows().filter((r) => r.needsAttention).map((r) => r.authId)));
    this.openCases('Authorizations Needing Attention', cs, 'needs-attention');
  }
  drillFlag(flag: CostFlag) {
    const label = this.tiles.find((t) => t.flag === flag)?.label ?? flag;
    const cs = this.casesByAuthIds(new Set(this.rows().filter((r) => r.flags.includes(flag)).map((r) => r.authId)));
    this.openCases(label, cs, flag, `${cs.length} authorization(s) — ${label}`);
  }
  drillServiceType(type: string) {
    const cs = this.casesByAuthIds(new Set(this.rows().filter((r) => r.needsAttention && r.serviceType === type).map((r) => r.authId)));
    this.openCases(`${type} — Needing Attention`, cs, `svc-${slug(type)}`);
  }
  drillNetworkStatus(status: string) {
    const cs = this.casesByAuthIds(new Set(this.rows().filter((r) => r.needsAttention && r.networkStatus === status).map((r) => r.authId)));
    this.openCases(`${status} — Needing Attention`, cs, `net-${slug(status)}`);
  }

  exportKpis() {
    this.exporter.open({
      title: 'Cost Overview', name: 'cost-overview_2026-07-17',
      columns: ['Metric', 'Value'],
      rows: [
        ['Active Authorizations', this.totalActive()],
        ['Needing Attention', this.needsAttentionCount()],
        ['Total Cost Exposure (Estimate)', fmt(this.totalExposure())],
        ['Avg Requested-vs-Approved Variance', `${this.avgVariancePct()}%`],
      ],
    });
  }
  exportFlags() {
    this.exporter.open({
      title: 'Needs-Attention Summary', name: 'cost-needs-attention_2026-07-17',
      columns: ['Flag', 'Authorizations Affected'],
      rows: this.tiles.map((t) => [t.label, this.tileCount(t.flag)]),
    });
  }
  exportByService() {
    this.exporter.open({
      title: 'Cost Exposure by Service Type', name: 'cost-by-service-type_2026-07-17',
      columns: ['Service Type', 'Count', '% of Needs-Attention'],
      rows: this.byServiceType().map((s) => [s.type, s.count, s.pct]),
    });
  }
  exportByNetwork() {
    this.exporter.open({
      title: 'Cost Exposure by Network Status', name: 'cost-by-network-status_2026-07-17',
      columns: ['Network Status', 'Count', '% of Needs-Attention'],
      rows: this.byNetworkStatus().map((s) => [s.status, s.count, s.pct]),
    });
  }
}
