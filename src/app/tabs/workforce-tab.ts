import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-workforce-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Workforce &amp; Queue Management</h2>
      <div class="flex gap-8">
        <button class="btn primary"><z-icon name="swap" [size]="14"></z-icon> Reassign</button>
        <button class="btn outline"><z-icon name="balance" [size]="14"></z-icon> Balance</button>
        <button class="btn outline esc"><z-icon name="arrowup" [size]="14"></z-icon> Escalate</button>
      </div>
    </div>

    <div class="queues">
      @for (q of data.queues; track q.name) {
        <div class="qcard">
          <div class="qtop">
            <span class="qname">{{ q.name }}</span>
            <span class="qcount">{{ q.count }}</span>
          </div>
          <div class="seg">
            <span class="s-fresh"  [style.width.%]="q.buckets.fresh"></span>
            <span class="s-day2"   [style.width.%]="q.buckets.day2"></span>
            <span class="s-over48" [style.width.%]="q.buckets.over48"></span>
            <span class="s-breach" [style.width.%]="q.buckets.breach"></span>
          </div>
          <div class="legend">
            <span><i class="d-fresh"></i>0-24h</span>
            <span><i class="d-day2"></i>24-48h</span>
            <span><i class="d-over48"></i>&gt;48h</span>
            <span><i class="d-breach"></i>Breach</span>
          </div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">Workload per Nurse</h3></div>
      <table class="z-table">
        <thead>
          <tr>
            <th>Nurse</th><th>Active Cases</th><th>Pending</th><th>Completed (MTD)</th>
            <th>Avg TAT</th><th>Utilization</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (n of data.nurses; track n.name) {
            <tr>
              <td class="strong">{{ n.name }}</td>
              <td class="num">{{ n.active }}</td>
              <td class="num">{{ n.pending }}</td>
              <td class="num">{{ n.completed }}</td>
              <td class="num">{{ n.avgTat }}</td>
              <td>
                <span class="mini-bar" [class.teal]="n.utilization < 80"
                  [class.red]="n.utilization >= 90">
                  <span [style.width.%]="n.utilization"></span>
                </span>
                <span class="util-pct">{{ n.utilization }}%</span>
              </td>
              <td><button class="btn outline sm">Reassign</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .esc { color: var(--amber-fg); border-color: var(--gray-300); }
    .queues { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .qcard { background:#fff; border:1px solid var(--border); border-radius: var(--radius);
      box-shadow: var(--shadow); padding: 16px 18px; }
    .qtop { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
    .qname { font-size: 14px; font-weight: 600; color: var(--ink); }
    .qcount { font-size: 15px; font-weight: 700; color: var(--ink); }
    .seg { display:flex; height: 8px; border-radius: 999px; overflow:hidden; background: var(--gray-100); }
    .seg > span { display:block; height:100%; }
    .s-fresh  { background:#10b981; }
    .s-day2   { background:#f59e0b; }
    .s-over48 { background:#f97316; }
    .s-breach { background:#ef4444; }
    .legend { display:flex; gap:14px; margin-top:10px; font-size: 10.5px; color: var(--gray-500); }
    .legend span { display:flex; align-items:center; gap:4px; }
    .legend i { width:8px; height:8px; border-radius:2px; display:inline-block; }
    .d-fresh{background:#10b981}.d-day2{background:#f59e0b}
    .d-over48{background:#f97316}.d-breach{background:#ef4444}
    .util-pct { margin-left: 10px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
      font-variant-numeric: tabular-nums; }
  `],
})
export class WorkforceTab {
  data = inject(DashboardData);
}
