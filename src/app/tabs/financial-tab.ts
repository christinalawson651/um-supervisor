import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveFinancials, liveHighDollarCases } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics, QUEUE_TO_PEND } from '../shared/metrics';
import { Exporter } from '../shared/exporter';
import { HighDollarCase } from '../data/dashboard.models';
import { nbaFor } from '../data/um-status';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

const FINANCIAL_WIDGETS = [
  { id: 'Estimated Pending Cost', title: 'Estimated Pending Cost' }, { id: 'Cost Avoided (MTD)', title: 'Cost Avoided (MTD)' },
  { id: 'LOS Variance', title: 'LOS Variance' }, { id: 'high-dollar', title: 'High-Dollar Authorizations' },
];

@Component({
  selector: 'app-financial-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Financial / Cost Indicators</h2>
      <span class="section-note">Cost management and high-dollar authorization tracking</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    <div class="grid-3">
      @for (m of financials(); track m.label; let i = $index) {
        @if (!isHidden(m.label)) {
          <div class="metric-tile clickable" (click)="metrics.open(finKeys[i])">
            <z-widget-actions (exportClick)="exportMetric(m)" (removeClick)="hide(m.label)"></z-widget-actions>
            <div class="ic"><z-icon [name]="m.icon" [size]="22" [stroke]="1.6"></z-icon></div>
            <div class="val">{{ m.value }}</div>
            <div class="lab">{{ m.label }}</div>
          </div>
        }
      }
    </div>

    @if (!isHidden('high-dollar')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">High-Dollar Authorizations</h3>
        <z-widget-actions (exportClick)="exportHighDollar()" (removeClick)="hide('high-dollar')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead>
          <tr><th>Auth ID</th><th>Member</th><th>Procedure</th><th>Estimated Cost</th><th>Status</th><th>Next Best Action</th></tr>
        </thead>
        <tbody>
          @for (c of highDollarCases(); track c.authId) {
            <tr class="clickable" (click)="open(c)">
              <td class="strong">{{ c.authId }}</td>
              <td>{{ c.member }}</td>
              <td>{{ c.procedure }}</td>
              <td class="strong num">{{ c.cost }}</td>
              <td><span class="badge blue">{{ c.status }}</span></td>
              <td>{{ nba(c) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .clickable { cursor: pointer; transition: box-shadow .12s; }
    .metric-tile.clickable:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); }
    .metric-tile, .tbl-head { position: relative; }
    .metric-tile:hover z-widget-actions, .tbl-head:hover z-widget-actions { opacity: 1; }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
  `],
})
export class FinancialTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);
  readonly finKeys = ['fin.pending', 'fin.avoided', 'fin.los'];

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or a card's × ----
  readonly vis = new WidgetVisibility('zyter-um-financial-widgets-v1', FINANCIAL_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  exportMetric(m: { label: string; value: string }) {
    this.exporter.open({ title: m.label, name: `financial-${m.label.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`, columns: ['Metric', 'Value'], rows: [[m.label, m.value]] });
  }
  exportHighDollar() {
    this.exporter.open({
      title: 'High-Dollar Authorizations', name: 'high-dollar-authorizations_2026-07-17',
      columns: ['Auth ID', 'Member', 'Procedure', 'Estimated Cost', 'Status'],
      rows: this.highDollarCases().map((c) => [c.authId, c.member, c.procedure, c.cost, c.status]),
    });
  }

  /**
   * c.status here is the case's real queue/decision status (e.g. "RFI Pending", "Clinical Review")
   * — not the canonical pend-reason vocabulary STATUS_NBA is keyed on — so translate pending queue
   * names the same way Metrics.pendReason() does before looking up the next best action.
   */
  nba(c: { status: string; authId: string }): string {
    if (c.status === 'Approved' || c.status === 'Denied') return nbaFor(c.status);
    if (c.status === 'Partial Approval' || c.status === 'Auto-Approved') return 'None – Completed';
    const even = Number(c.authId.slice(-1)) % 2 === 0;
    const reason = c.status === 'Clinical Review' && even ? 'Pending Determination'
      : c.status === 'MD Review' && even ? 'Pending Notification'
      : QUEUE_TO_PEND[c.status] ?? 'Pending Review';
    return nbaFor(reason);
  }

  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }
  readonly financials = computed(() => liveFinancials(...this.scopeArgs()));
  readonly highDollarCases = computed(() => liveHighDollarCases(...this.scopeArgs()));

  open(c: HighDollarCase) {
    this.ix.openDrawer({
      title: `${c.authId} · ${c.member}`,
      subtitle: c.procedure,
      badge: { text: c.status, tone: 'blue' },
      fields: [
        { label: 'Estimated Cost', value: c.cost, tone: 'red' },
        { label: 'Procedure', value: c.procedure },
        { label: 'Current Status', value: c.status, tone: 'blue' },
        { label: 'Next Best Action', value: this.nba(c), tone: 'teal' },
        { label: 'Review Track', value: 'High-dollar / MD oversight' },
      ],
      note: 'High-dollar authorization flagged for supervisor visibility. Confirm medical necessity documentation before final determination.',
      actions: [
        { label: 'Assign to MD review', tone: 'teal',
          run: () => this.ix.toast(`${c.authId} routed to MD review.`, 'info') },
        { label: 'Request peer-to-peer', tone: 'amber',
          run: () => this.ix.toast(`Peer-to-peer requested for ${c.authId}.`, 'warn') },
      ],
    });
  }
}
