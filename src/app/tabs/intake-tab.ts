import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-intake-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Intake &amp; Documentation Quality</h2>
      <span class="section-note">Documentation quality is tracking positively</span>
    </div>

    <div class="grid-3">
      @for (b of data.qualityBars; track b.label) {
        <div class="panel panel-pad bar-block">
          <div class="bar-top"><z-icon [name]="b.icon" [size]="15" [stroke]="1.8"></z-icon>{{ b.label }}</div>
          <div class="bar-val" [class.amber]="b.tone==='amber'">{{ b.pct }}%</div>
          <div class="pbar" [class.amber]="b.tone==='amber'">
            <span [style.width.%]="b.pct"></span>
          </div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">Top Missing Fields</h3></div>
      <table class="z-table">
        <thead>
          <tr><th>Field</th><th>Missing Count</th><th>% of Submissions</th></tr>
        </thead>
        <tbody>
          @for (f of data.missingFields; track f.field) {
            <tr>
              <td class="strong">{{ f.field }}</td>
              <td class="num">{{ f.count }}</td>
              <td>
                <span class="mini-bar"><span [style.width.%]="f.pct"></span></span>
                <span class="pct">{{ f.pct }}%</span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .bar-top z-icon { color: var(--gray-400); }
    .pct { margin-left: 12px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
      font-variant-numeric: tabular-nums; }
  `],
})
export class IntakeTab {
  data = inject(DashboardData);
}
