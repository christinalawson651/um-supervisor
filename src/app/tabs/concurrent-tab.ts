import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { ConcurrentRow } from '../data/dashboard.models';

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
          @for (r of data.concurrentRows(); track r.member) {
            <tr class="clickable" (click)="open(r)">
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
  styles: [`.clickable { cursor: pointer; }`],
})
export class ConcurrentTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);

  open(r: ConcurrentRow) {
    this.ix.openDrawer({
      title: r.member,
      subtitle: `${r.facility} · Inpatient concurrent review`,
      badge: { text: `${r.overstayLabel} overstay risk`, tone: r.overstayRisk as any },
      fields: [
        { label: 'Admit Date', value: r.admit },
        { label: 'Next Review Due', value: r.nextReview },
        { label: 'Length of Stay', value: r.los, tone: r.losFlag ? 'red' : undefined },
        { label: 'Expected LOS', value: r.expectedLos },
        { label: 'Days Approved', value: String(r.daysApproved) },
        { label: 'Days Requested', value: String(r.daysRequested) },
        { label: 'Additional Days Pending', value: String(Math.max(0, r.daysRequested - r.daysApproved)), tone: 'amber' },
      ],
      note: r.daysRequested > r.daysApproved
        ? `Provider has requested ${r.daysRequested - r.daysApproved} additional day(s) beyond what is currently approved.`
        : 'All requested days are approved.',
      actions: r.daysRequested > r.daysApproved
        ? [{ label: `Approve ${r.daysRequested - r.daysApproved} additional day(s)`, tone: 'teal',
             run: () => { this.data.approveConcurrentDays(r.member); this.ix.toast(`Approved requested days for ${r.member}.`); } }]
        : [],
    });
  }
}
