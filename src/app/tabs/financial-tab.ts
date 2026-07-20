import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { HighDollarCase } from '../data/dashboard.models';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-financial-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Financial / Cost Indicators</h2>
      <span class="section-note">Cost management and high-dollar case tracking</span>
    </div>

    <div class="grid-3">
      @for (m of data.financials; track m.label; let i = $index) {
        <div class="metric-tile clickable" (click)="metrics.open(finKeys[i])">
          <div class="ic"><z-icon [name]="m.icon" [size]="22" [stroke]="1.6"></z-icon></div>
          <div class="val">{{ m.value }}</div>
          <div class="lab">{{ m.label }}</div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">High-Dollar Cases</h3></div>
      <table class="z-table">
        <thead>
          <tr><th>Auth ID</th><th>Member</th><th>Procedure</th><th>Estimated Cost</th><th>Status</th></tr>
        </thead>
        <tbody>
          @for (c of data.highDollarCases; track c.authId) {
            <tr class="clickable" (click)="open(c)">
              <td class="strong">{{ c.authId }}</td>
              <td>{{ c.member }}</td>
              <td>{{ c.procedure }}</td>
              <td class="strong num">{{ c.cost }}</td>
              <td><span class="badge blue">{{ c.status }}</span></td>
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
  readonly finKeys = ['fin.pending', 'fin.avoided', 'fin.los'];

  open(c: HighDollarCase) {
    this.ix.openDrawer({
      title: `${c.authId} · ${c.member}`,
      subtitle: c.procedure,
      badge: { text: c.status, tone: 'blue' },
      fields: [
        { label: 'Estimated Cost', value: c.cost, tone: 'red' },
        { label: 'Procedure', value: c.procedure },
        { label: 'Current Status', value: c.status, tone: 'blue' },
        { label: 'Review Track', value: 'High-dollar / MD oversight' },
      ],
      note: 'High-dollar case flagged for supervisor visibility. Confirm medical necessity documentation before final determination.',
      actions: [
        { label: 'Assign to MD review', tone: 'teal',
          run: () => this.ix.toast(`${c.authId} routed to MD review.`, 'info') },
        { label: 'Request peer-to-peer', tone: 'amber',
          run: () => this.ix.toast(`Peer-to-peer requested for ${c.authId}.`, 'warn') },
      ],
    });
  }
}
