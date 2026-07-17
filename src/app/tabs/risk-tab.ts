import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';

@Component({
  selector: 'app-risk-tab',
  standalone: true,
  template: `
    <div class="tab-head">
      <h2>Risk &amp; Escalation Panel</h2>
      <span class="section-note note-warn">Cases requiring attention and escalation</span>
    </div>

    <div class="rsum">
      @for (s of data.riskSummary; track s.label) {
        <div class="rbox" [attr.data-tone]="s.tone">
          <div class="val">{{ s.value }}</div>
          <div class="lab">{{ s.label }}</div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">At-Risk &amp; Escalated Cases</h3></div>
      <table class="z-table">
        <thead>
          <tr>
            <th>Auth ID</th><th>Member</th><th>Type</th><th>Reason</th>
            <th>Owner</th><th>SLA Remaining</th><th>Risk</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          @for (r of data.riskCases; track r.authId) {
            <tr>
              <td class="strong">{{ r.authId }}</td>
              <td>{{ r.member }}</td>
              <td>{{ r.type }}</td>
              <td>{{ r.reason }}</td>
              <td>{{ r.owner }}</td>
              <td [class.danger]="r.slaRemaining === 'Overdue'">{{ r.slaRemaining }}</td>
              <td><span class="badge" [class.red]="r.risk==='red'" [class.amber]="r.risk==='amber'"
                    [class.green]="r.risk==='green'">{{ r.riskLabel }}</span></td>
              <td><button class="btn outline teal sm">Escalate</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .note-warn { color: var(--amber-fg); }
    .rsum { display:grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .rbox { background:#fff; border:1px solid var(--border); border-left:3px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; }
    .rbox .val { font-size: 28px; font-weight: 700; color: var(--ink); }
    .rbox .lab { font-size: 10.5px; letter-spacing:0.05em; text-transform:uppercase;
      color: var(--gray-500); font-weight:600; margin-top: 4px; }
    .rbox[data-tone="amber"] { border-left-color: var(--amber); }
    .rbox[data-tone="red"]   { border-left-color: var(--red); }
    .rbox[data-tone="blue"]  { border-left-color: var(--blue); }
  `],
})
export class RiskTab {
  data = inject(DashboardData);
}
