import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
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
      @for (m of data.financials; track m.label) {
        <div class="metric-tile">
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
            <tr>
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
})
export class FinancialTab {
  data = inject(DashboardData);
}
