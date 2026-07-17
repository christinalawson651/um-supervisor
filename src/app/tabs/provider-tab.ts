import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-provider-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Provider &amp; Network Insights</h2>
      <span class="section-note">Provider performance and network utilization</span>
    </div>

    <div class="oon">
      <div class="oon-ic"><z-icon name="mappin" [size]="18" [stroke]="1.8"></z-icon></div>
      <div>
        <div class="oon-val">{{ data.oonRequests }}</div>
        <div class="oon-lab">Out-of-Network Requests</div>
      </div>
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">Top Requesting Providers</h3></div>
      <table class="z-table">
        <thead>
          <tr><th>Provider</th><th>NPI</th><th>Requests (MTD)</th><th>Approval Rate</th><th>RFI Rate</th></tr>
        </thead>
        <tbody>
          @for (p of data.providers; track p.npi) {
            <tr>
              <td class="strong">{{ p.provider }}</td>
              <td class="num">{{ p.npi }}</td>
              <td class="num">{{ p.requests }}</td>
              <td><span class="rate-pill" [class.good]="p.approvalRate >= 80"
                    [class.mid]="p.approvalRate < 80">{{ p.approvalRate }}%</span></td>
              <td class="num" [class.danger]="p.rfiHigh">{{ p.rfiRate }}%</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .oon { display:flex; align-items:center; gap:12px; width: 260px;
      background:#fff; border:1px solid var(--border); border-left:3px solid var(--amber);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; }
    .oon-ic { width:34px;height:34px;border-radius:8px;background:var(--amber-bg);color:var(--amber-fg);
      display:flex;align-items:center;justify-content:center; }
    .oon-val { font-size: 22px; font-weight: 700; color: var(--ink); }
    .oon-lab { font-size: 11px; letter-spacing:0.04em; text-transform:uppercase;
      color: var(--gray-500); font-weight:600; margin-top:2px; }
  `],
})
export class ProviderTab {
  data = inject(DashboardData);
}
