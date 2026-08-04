import { Component, computed, inject } from '@angular/core';
import { DashboardData, liveFinancials, liveHighDollarCases } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics, QUEUE_TO_PEND } from '../shared/metrics';
import { HighDollarCase } from '../data/dashboard.models';
import { nbaFor } from '../data/um-status';
import { Icon } from '../shared/icon';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

@Component({
  selector: 'app-financial-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Financial / Cost Indicators</h2>
      <span class="section-note">Cost management and high-dollar authorization tracking</span>
    </div>

    <div class="grid-3">
      @for (m of financials(); track m.label; let i = $index) {
        <div class="metric-tile clickable" (click)="metrics.open(finKeys[i])">
          <div class="ic"><z-icon [name]="m.icon" [size]="22" [stroke]="1.6"></z-icon></div>
          <div class="val">{{ m.value }}</div>
          <div class="lab">{{ m.label }}</div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">High-Dollar Authorizations</h3></div>
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
  `,
  styles: [`
    .clickable { cursor: pointer; transition: box-shadow .12s; }
    .metric-tile.clickable:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); }
  `],
})
export class FinancialTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  readonly finKeys = ['fin.pending', 'fin.avoided', 'fin.los'];

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
