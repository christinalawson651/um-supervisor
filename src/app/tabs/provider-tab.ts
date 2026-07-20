import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { ProviderRow } from '../data/dashboard.models';
import { compareRows, caretFor, SortDir } from '../shared/sort';
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

    <div class="oon clickable" (click)="metrics.open('prov.oon')">
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
          <tr>
            <th class="sortable" (click)="sortBy('provider')">Provider{{ caret('provider') }}</th>
            <th>NPI</th>
            <th class="sortable" (click)="sortBy('requests')">Requests (MTD){{ caret('requests') }}</th>
            <th class="sortable" (click)="sortBy('approvalRate')">Approval Rate{{ caret('approvalRate') }}</th>
            <th class="sortable" (click)="sortBy('rfiRate')">RFI Rate{{ caret('rfiRate') }}</th>
          </tr>
        </thead>
        <tbody>
          @for (p of sortedRows(); track p.npi) {
            <tr class="clickable" (click)="open(p)">
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
    .clickable { cursor: pointer; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
  `],
})
export class ProviderTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);

  readonly sortKey = signal<keyof ProviderRow | ''>('');
  readonly sortDir = signal<SortDir>(1);
  readonly sortedRows = computed(() => compareRows(this.data.providers, this.sortKey(), this.sortDir()));
  sortBy(k: keyof ProviderRow) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(k); this.sortDir.set(1); }
  }
  caret(k: keyof ProviderRow) { return caretFor(this.sortKey(), k, this.sortDir()); }

  open(p: ProviderRow) {
    this.ix.openDrawer({
      title: p.provider,
      subtitle: `NPI ${p.npi}`,
      badge: { text: `${p.approvalRate}% approval`, tone: p.approvalRate >= 80 ? 'green' : 'amber' },
      fields: [
        { label: 'Requests (MTD)', value: String(p.requests) },
        { label: 'Approval Rate', value: `${p.approvalRate}%`, tone: p.approvalRate >= 80 ? 'green' : 'amber' },
        { label: 'RFI Rate', value: `${p.rfiRate}%`, tone: p.rfiHigh ? 'red' : undefined },
        { label: 'Network Status', value: 'In-Network' },
      ],
      note: p.rfiHigh
        ? 'Elevated RFI rate — submissions from this provider frequently require additional information. Consider provider outreach.'
        : 'Provider performance is within expected thresholds.',
      actions: [{ label: 'Send provider outreach', tone: 'teal',
        run: () => this.ix.toast(`Outreach note queued for ${p.provider}.`, 'info') }],
    });
  }
}
