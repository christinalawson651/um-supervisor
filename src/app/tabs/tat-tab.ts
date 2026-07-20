import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Metrics } from '../shared/metrics';
import { Ring } from '../shared/ring';

@Component({
  selector: 'app-tat-tab',
  standalone: true,
  imports: [Ring],
  template: `
    <div class="tab-head">
      <h2>TAT &amp; SLA Compliance</h2>
      <span class="section-note">Strong compliance — your team is meeting targets</span>
    </div>

    <div class="panel panel-pad">
      <div class="tat-grid">
        <div class="left">
          <div class="donut clickable" (click)="metrics.open('tat.compliance')">
            <z-ring [value]="data.tatCompliance" [size]="120" [thickness]="12" tone="teal"></z-ring>
            <div class="donut-lab">TAT Compliance</div>
          </div>
          <div class="rows">
            @for (b of data.tatBuckets; track b.label; let i = $index) {
              <div class="row clickable" [attr.data-tone]="b.tone" (click)="metrics.open(bucketKeys[i])">
                <span><i></i>{{ b.label }}</span>
                <b>{{ b.count }}</b>
              </div>
            }
          </div>
        </div>

        <div class="stats">
          @for (s of data.tatStats; track s.label; let i = $index) {
            <div class="stat-box clickable" (click)="metrics.open(statKeys[i])">
              <div class="val">{{ s.value }}</div><div class="lab">{{ s.label }}</div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tat-grid { display:grid; grid-template-columns: 1.15fr 1fr; gap: 26px; align-items:center; }
    .left { display:flex; gap: 22px; align-items:center; }
    .donut { text-align:center; flex: 0 0 auto; }
    .donut-lab { font-size:12px; color: var(--gray-500); margin-top: 8px; font-weight:600; }
    .rows { flex:1; display:flex; flex-direction:column; gap:12px; }
    .row { display:flex; align-items:center; justify-content:space-between;
      padding: 12px 16px; border-radius: 8px; font-size: 13px; font-weight:500; }
    .row i { width:8px; height:8px; border-radius:999px; display:inline-block; margin-right:8px; }
    .row span { display:flex; align-items:center; }
    .row b { font-weight:700; font-variant-numeric: tabular-nums; }
    .row[data-tone="green"] { background:#e7f8f0; color: var(--green-fg); }
    .row[data-tone="green"] i { background: var(--green); }
    .row[data-tone="amber"] { background:#fdf6e3; color: var(--amber-fg); }
    .row[data-tone="amber"] i { background: var(--amber); }
    .row[data-tone="red"] { background:#fdecec; color: var(--red-fg); }
    .row[data-tone="red"] i { background: var(--red); }
    .stats { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .clickable { cursor: pointer; transition: box-shadow .12s, transform .12s; }
    .stat-box.clickable:hover, .row.clickable:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); }
    .donut.clickable:hover { transform: scale(1.03); }
  `],
})
export class TatTab {
  data = inject(DashboardData);
  metrics = inject(Metrics);
  readonly bucketKeys = ['tat.onTrack', 'tat.atRisk', 'tat.breached'];
  readonly statKeys = ['tat.expedited', 'tat.standard', 'tat.paused', 'tat.turnaround'];
}
