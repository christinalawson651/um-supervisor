import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';

@Component({
  selector: 'app-concurrent-tab',
  standalone: true,
  template: `
    <div class="tab-head">
      <h2>Concurrent Review Monitoring</h2>
      <span class="section-note">Active inpatient cases under review</span>
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr>
            <th>Member</th><th>Facility</th><th>Admit Date</th><th>Next Review Due</th>
            <th>LOS</th><th>Expected LOS</th><th>Days Approved</th><th>Days Requested</th>
            <th>Overstay Risk</th>
          </tr>
        </thead>
        <tbody>
          @for (r of data.concurrentRows; track r.member) {
            <tr>
              <td class="strong">{{ r.member }}</td>
              <td>{{ r.facility }}</td>
              <td>{{ r.admit }}</td>
              <td>{{ r.nextReview }}</td>
              <td [class.danger]="r.losFlag">{{ r.los }}</td>
              <td>{{ r.expectedLos }}</td>
              <td class="num">{{ r.daysApproved }}</td>
              <td class="num">{{ r.daysRequested }}</td>
              <td><span class="badge" [class.red]="r.overstayRisk==='red'"
                    [class.amber]="r.overstayRisk==='amber'"
                    [class.green]="r.overstayRisk==='green'">{{ r.overstayLabel }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ConcurrentTab {
  data = inject(DashboardData);
}
