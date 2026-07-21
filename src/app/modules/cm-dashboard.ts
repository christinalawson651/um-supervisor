import { Component, inject } from '@angular/core';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';

interface CmRow {
  name: string; risk: number; level: 'Low' | 'Moderate' | 'High' | 'Critical';
  acuity: 'Low' | 'Medium' | 'High'; carePlan: string; programs: string; openCases: number; pcm: string; dx: string;
}
interface Referral { authId: string; member: string; reason: string; from: string; received: string; status: string; }

@Component({
  selector: 'app-cm-dashboard',
  standalone: true,
  imports: [KpiStrip],
  template: `
    <app-kpi-strip [items]="kpis" />

    <div class="tab-head">
      <h2>Care Management Worklist</h2>
      <span class="section-note">Members enrolled in care management, prioritized by risk</span>
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr><th>Member</th><th>Primary Dx</th><th>Risk</th><th>Acuity</th><th>Care Plan</th>
            <th>Programs</th><th>Open Cases</th><th>Care Manager</th></tr>
        </thead>
        <tbody>
          @for (m of worklist; track m.name) {
            <tr class="clickable" (click)="members.openByName(m.name)">
              <td><a class="mlink">{{ m.name }}</a></td>
              <td>{{ m.dx }}</td>
              <td><span class="score" [attr.data-l]="m.level">{{ m.risk }} · {{ m.level }}</span></td>
              <td><span class="ac" [attr.data-a]="m.acuity">{{ m.acuity }}</span></td>
              <td><span class="cp" [attr.data-s]="m.carePlan">{{ m.carePlan }}</span></td>
              <td>{{ m.programs }}</td>
              <td class="num">{{ m.openCases }}</td>
              <td>{{ m.pcm }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="tab-head mt-6">
      <h2>Referrals from Utilization Management</h2>
      <span class="section-note">Cases routed from UM into care management</span>
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr><th>Source Auth</th><th>Member</th><th>Referral Reason</th><th>Referred By</th>
            <th>Received</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          @for (r of referrals; track r.authId) {
            <tr>
              <td class="strong">{{ r.authId }}</td>
              <td><a class="mlink" (click)="members.openByName(r.member)">{{ r.member }}</a></td>
              <td>{{ r.reason }}</td>
              <td>{{ r.from }}</td>
              <td>{{ r.received }}</td>
              <td><span class="badge blue">{{ r.status }}</span></td>
              <td><button class="btn outline teal sm" (click)="accept(r)">Accept &amp; assign</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .clickable { cursor:pointer; }
    .mlink { color:#2563eb; font-weight:600; cursor:pointer; } .mlink:hover { text-decoration:underline; }
    .score { font-weight:600; font-size:12px; padding:2px 9px; border-radius:6px; }
    .score[data-l="Critical"]{ background:var(--red-bg); color:var(--red-fg); }
    .score[data-l="High"]{ background:#ffedd5; color:#c2410c; }
    .score[data-l="Moderate"]{ background:var(--amber-bg); color:var(--amber-fg); }
    .score[data-l="Low"]{ background:var(--green-bg); color:var(--green-fg); }
    .ac { font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--gray-100); color:var(--gray-500); }
    .ac[data-a="High"]{ background:#f3e8ff; color:#7e22ce; } .ac[data-a="Medium"]{ background:#ffedd5; color:#c2410c; }
    .cp { font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--gray-100); color:var(--gray-500); }
    .cp[data-s="Active"]{ background:var(--green-bg); color:var(--green-fg); }
    .cp[data-s="In Progress"]{ background:var(--amber-bg); color:var(--amber-fg); }
  `],
})
export class CmDashboard {
  members = inject(Members);
  private ix = inject(Interaction);

  readonly kpis: KpiItem[] = [
    { icon: 'folder', value: '68',  label: 'Active Care Plans', tone: 'teal' },
    { icon: 'alert',  value: '23',  label: 'High-Risk Members', tone: 'amber' },
    { icon: 'inbox',  value: '14',  label: 'New Referrals',     tone: 'blue' },
    { icon: 'clock',  value: '5',   label: 'Overdue Assessments', tone: 'red' },
    { icon: 'users',  value: '128', label: 'Program Enrollments', tone: 'green' },
    { icon: 'check',  value: '91%', label: 'Care Plan Adherence', tone: 'green' },
    { icon: 'swap',   value: '7',   label: 'Transitions of Care', tone: 'teal' },
    { icon: 'barchart', value: '4.6', label: 'Avg Risk Score',   tone: 'amber' },
  ];

  readonly worklist: CmRow[] = [
    { name: 'Kristina Anderson', risk: 7.8, level: 'High',     acuity: 'Medium', carePlan: 'Active',      programs: 'CHF DM, Diabetes', openCases: 3, pcm: 'Christina Lawson', dx: 'Congestive heart failure' },
    { name: 'Marcus Webb',       risk: 8.9, level: 'Critical', acuity: 'High',   carePlan: 'Active',      programs: 'Complex Care',     openCases: 4, pcm: 'Sara Nguyen, RN',   dx: 'ESRD on dialysis' },
    { name: 'Denise Holloway',   risk: 6.4, level: 'High',     acuity: 'Medium', carePlan: 'Active',      programs: 'COPD DM',          openCases: 2, pcm: 'Maria Torres, RN',  dx: 'COPD, severe' },
    { name: 'Ronald Pierce',     risk: 5.1, level: 'Moderate', acuity: 'Medium', carePlan: 'In Progress', programs: 'Diabetes',         openCases: 1, pcm: 'Sara Nguyen, RN',   dx: 'Type 2 diabetes' },
    { name: 'Gloria Simmons',    risk: 8.2, level: 'Critical', acuity: 'High',   carePlan: 'Active',      programs: 'Oncology, BH',     openCases: 5, pcm: 'David Patel, MSW',  dx: 'Breast cancer' },
    { name: 'Terrence Blake',    risk: 4.3, level: 'Moderate', acuity: 'Low',    carePlan: 'In Progress', programs: 'BH Integration',   openCases: 1, pcm: 'David Patel, MSW',  dx: 'Major depressive disorder' },
    { name: 'Yolanda Reyes',     risk: 6.9, level: 'High',     acuity: 'Medium', carePlan: 'Active',      programs: 'Maternal Care',    openCases: 2, pcm: 'Maria Torres, RN',  dx: 'High-risk pregnancy' },
    { name: 'Harold Nguyen',     risk: 3.6, level: 'Low',      acuity: 'Low',    carePlan: 'In Progress', programs: 'Transitional Care', openCases: 1, pcm: 'Sara Nguyen, RN',  dx: 'Post-CABG recovery' },
  ];

  readonly referrals: Referral[] = [
    { authId: 'IP540088', member: 'George Pike',   reason: 'Transplant — complex care coordination', from: 'UM · MD Review',      received: '2026-07-16', status: 'Pending intake' },
    { authId: 'IP539774', member: 'Nina Patel',    reason: 'Oncology — high-dollar, symptom mgmt',    from: 'UM · Concurrent',    received: '2026-07-15', status: 'Pending intake' },
    { authId: 'IP543902', member: 'Robert Hayes',  reason: 'ICU step-down — transitional care',       from: 'UM · Clinical Review', received: '2026-07-15', status: 'Assessment scheduled' },
    { authId: 'OP329910', member: 'Frank Doyle',   reason: 'Denied auth — appeal + CM support',       from: 'UM · OON Review',    received: '2026-07-14', status: 'Pending intake' },
  ];

  accept(r: Referral) {
    this.ix.ask({
      title: `Accept referral ${r.authId}`,
      body: `Accept ${r.member} into care management and route to the appropriate care manager queue?`,
      confirmLabel: 'Accept & assign', tone: 'teal',
      onConfirm: () => this.ix.toast(`${r.member} accepted into CM — routed to Complex Care queue.`),
    });
  }
}
