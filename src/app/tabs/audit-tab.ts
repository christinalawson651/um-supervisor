import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';

@Component({
  selector: 'app-audit-tab',
  standalone: true,
  template: `
    <div class="tab-head">
      <h2>Audit &amp; Compliance</h2>
      <span class="section-note">Compliance metrics and audit trail</span>
    </div>

    <div class="grid-3">
      @for (b of data.complianceBars; track b.label) {
        <div class="panel panel-pad">
          <div class="clab">{{ b.label }}</div>
          <div class="cval">{{ b.pct }}%</div>
          <div class="pbar"><span [style.width.%]="b.pct"></span></div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">Audit Flags</h3></div>
      <table class="z-table">
        <thead>
          <tr><th>ID</th><th>Type</th><th>Description</th><th>Date</th><th>Severity</th></tr>
        </thead>
        <tbody>
          @for (f of data.auditFlags; track f.id) {
            <tr>
              <td class="strong">{{ f.id }}</td>
              <td>{{ f.type }}</td>
              <td>{{ f.description }}</td>
              <td>{{ f.date }}</td>
              <td><span class="badge" [class.red]="f.severity==='red'"
                    [class.amber]="f.severity==='amber'"
                    [class.green]="f.severity==='green'">{{ f.severityLabel }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .clab { font-size: 12.5px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
    .cval { font-size: 26px; font-weight: 700; color: var(--ink); margin-bottom: 14px; }
  `],
})
export class AuditTab {
  data = inject(DashboardData);
}
