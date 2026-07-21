import { Component, computed, inject, signal } from '@angular/core';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';
import { DashboardData } from '../data/dashboard-data';

interface CaseManager {
  name: string; discipline: string; active: number;
  highRisk: number; highAcuity: number; highCost: number; slaAtRisk: number; utilization: number;
}
interface CmMemberRow {
  name: string; risk: number; level: 'Low' | 'Moderate' | 'High' | 'Critical';
  acuity: 'Low' | 'Medium' | 'High'; cost: string; sla: string; slaTone: string; cm: string; dx: string;
}
interface Referral { authId: string; member: string; reason: string; from: string; sla: string; slaTone: string; }

@Component({
  selector: 'app-cm-dashboard',
  standalone: true,
  imports: [KpiStrip],
  template: `
    <app-kpi-strip [items]="kpis" />

    <div class="tab-head">
      <h2>Caseload &amp; Workload Balancing</h2>
      <div class="flex gap-8">
        <button class="btn primary" (click)="rebalance()">Balance caseloads</button>
      </div>
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr><th>Care Manager</th><th>Active</th><th>High Risk</th><th>High Acuity</th>
            <th>High Cost</th><th>SLA At-Risk</th><th>Utilization</th><th>Action</th></tr>
        </thead>
        <tbody>
          @for (c of caseManagers(); track c.name) {
            <tr>
              <td class="strong">{{ c.name }}<div class="disc">{{ c.discipline }}</div></td>
              <td class="num">{{ c.active }}</td>
              <td><span class="cnt" [class.hot]="c.highRisk >= 5">{{ c.highRisk }}</span></td>
              <td><span class="cnt" [class.hot]="c.highAcuity >= 4">{{ c.highAcuity }}</span></td>
              <td><span class="cnt" [class.hot]="c.highCost >= 3">{{ c.highCost }}</span></td>
              <td><span class="cnt" [class.warn]="c.slaAtRisk > 0">{{ c.slaAtRisk }}</span></td>
              <td>
                <span class="mini-bar" [class.teal]="c.utilization < 80" [class.red]="c.utilization >= 90">
                  <span [style.width.%]="c.utilization"></span></span>
                <span class="util">{{ c.utilization }}%</span>
              </td>
              <td><button class="btn outline sm" (click)="reassignTo(c)">Reassign</button></td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="tab-head mt-6">
      <h2>High-Risk / High-Acuity / High-Cost Members</h2>
      <span class="section-note">Members driving the most attention and spend</span>
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr><th>Member</th><th>Primary Dx</th><th>Risk</th><th>Acuity</th><th>Annual Cost</th>
            <th>SLA</th><th>Care Manager</th></tr>
        </thead>
        <tbody>
          @for (m of worklist; track m.name) {
            <tr class="clickable" (click)="members.openByName(m.name)">
              <td><a class="mlink">{{ m.name }}</a></td>
              <td>{{ m.dx }}</td>
              <td><span class="score" [attr.data-l]="m.level">{{ m.risk }} · {{ m.level }}</span></td>
              <td><span class="ac" [attr.data-a]="m.acuity">{{ m.acuity }}</span></td>
              <td class="strong">{{ m.cost }}</td>
              <td><span class="sla" [attr.data-t]="m.slaTone">{{ m.sla }}</span></td>
              <td>{{ m.cm }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="tab-head mt-6">
      <h2>Referral Intake &amp; SLA</h2>
      <span class="section-note">Incoming referrals (incl. UM → CM) and time-to-intake</span>
    </div>

    <div class="panel">
      <table class="z-table">
        <thead>
          <tr><th>Source</th><th>Member</th><th>Reason</th><th>Referred By</th><th>Intake SLA</th><th>Action</th></tr>
        </thead>
        <tbody>
          @for (r of referrals(); track r.authId) {
            <tr>
              <td class="strong">{{ r.authId }}</td>
              <td><a class="mlink" (click)="members.openByName(r.member)">{{ r.member }}</a></td>
              <td>{{ r.reason }}</td>
              <td>{{ r.from }}</td>
              <td><span class="sla" [attr.data-t]="r.slaTone">{{ r.sla }}</span></td>
              <td><button class="btn outline teal sm" (click)="accept(r)">Accept &amp; assign</button></td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="empty">All referrals accepted. ✓</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .flex { display:flex; } .gap-8 { gap:8px; }
    .disc { font-size:11px; color:var(--gray-500); font-weight:400; margin-top:2px; }
    .cnt { font-weight:600; font-variant-numeric:tabular-nums; }
    .cnt.hot { color:#c2410c; } .cnt.warn { color:var(--amber-fg); }
    .util { margin-left:10px; font-size:12.5px; font-weight:600; color:var(--ink-soft); font-variant-numeric:tabular-nums; }
    .clickable { cursor:pointer; }
    .mlink { color:#2563eb; font-weight:600; cursor:pointer; } .mlink:hover { text-decoration:underline; }
    .score { font-weight:600; font-size:12px; padding:2px 9px; border-radius:6px; }
    .score[data-l="Critical"]{ background:var(--red-bg); color:var(--red-fg); }
    .score[data-l="High"]{ background:#ffedd5; color:#c2410c; }
    .score[data-l="Moderate"]{ background:var(--amber-bg); color:var(--amber-fg); }
    .score[data-l="Low"]{ background:var(--green-bg); color:var(--green-fg); }
    .ac { font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--gray-100); color:var(--gray-500); }
    .ac[data-a="High"]{ background:#f3e8ff; color:#7e22ce; } .ac[data-a="Medium"]{ background:#ffedd5; color:#c2410c; }
    .sla { font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:6px; }
    .sla[data-t="red"]{ background:var(--red-bg); color:var(--red-fg); }
    .sla[data-t="amber"]{ background:var(--amber-bg); color:var(--amber-fg); }
    .sla[data-t="green"]{ background:var(--green-bg); color:var(--green-fg); }
    .empty { text-align:center; color:var(--teal-700); font-weight:600; padding:22px; }
  `],
})
export class CmDashboard {
  members = inject(Members);
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  readonly kpis: KpiItem[] = [
    { icon: 'alert',  value: '23',  label: 'High-Risk Members', tone: 'red' },
    { icon: 'shield', value: '14',  label: 'High-Acuity',       tone: 'amber' },
    { icon: 'dollar', value: '9',   label: 'High-Cost (>$100k)', tone: 'amber' },
    { icon: 'clock',  value: '5',   label: 'SLA At-Risk',       tone: 'red' },
    { icon: 'folder', value: '68',  label: 'Active Care Plans', tone: 'teal' },
    { icon: 'inbox',  value: '14',  label: 'New Referrals',     tone: 'blue' },
    { icon: 'users',  value: '128', label: 'Members Managed',   tone: 'green' },
    { icon: 'check',  value: '96%', label: 'Intake SLA',        tone: 'green' },
  ];

  readonly caseManagers = signal<CaseManager[]>([
    { name: 'Sara Nguyen, RN',   discipline: 'Complex Care',      active: 34, highRisk: 8, highAcuity: 6, highCost: 4, slaAtRisk: 2, utilization: 94 },
    { name: 'David Patel, MSW',  discipline: 'Behavioral Health', active: 28, highRisk: 5, highAcuity: 3, highCost: 1, slaAtRisk: 1, utilization: 82 },
    { name: 'Maria Torres, RN',  discipline: 'Transitional Care', active: 31, highRisk: 6, highAcuity: 4, highCost: 2, slaAtRisk: 1, utilization: 88 },
    { name: 'James Wong, PharmD', discipline: 'Medication Mgmt',  active: 22, highRisk: 2, highAcuity: 1, highCost: 1, slaAtRisk: 0, utilization: 71 },
    { name: 'Angela Ruiz, RN',   discipline: 'Complex Care',      active: 26, highRisk: 4, highAcuity: 3, highCost: 2, slaAtRisk: 1, utilization: 79 },
  ]);

  readonly worklist: CmMemberRow[] = [
    { name: 'Marcus Webb',      dx: 'ESRD on dialysis',        risk: 8.9, level: 'Critical', acuity: 'High',   cost: '$412k', sla: 'Assessment overdue', slaTone: 'red',   cm: 'Sara Nguyen, RN' },
    { name: 'Gloria Simmons',   dx: 'Breast cancer',           risk: 8.2, level: 'Critical', acuity: 'High',   cost: '$286k', sla: 'On track',           slaTone: 'green', cm: 'David Patel, MSW' },
    { name: 'Kristina Anderson', dx: 'Congestive heart failure', risk: 7.8, level: 'High',    acuity: 'Medium', cost: '$198k', sla: 'Review due 2d',      slaTone: 'amber', cm: 'Sara Nguyen, RN' },
    { name: 'Yolanda Reyes',    dx: 'High-risk pregnancy',     risk: 6.9, level: 'High',     acuity: 'Medium', cost: '$142k', sla: 'On track',           slaTone: 'green', cm: 'Maria Torres, RN' },
    { name: 'Denise Holloway',  dx: 'COPD, severe',            risk: 6.4, level: 'High',     acuity: 'Medium', cost: '$118k', sla: 'Outreach overdue',   slaTone: 'red',   cm: 'Maria Torres, RN' },
    { name: 'Ronald Pierce',    dx: 'Type 2 diabetes',         risk: 5.1, level: 'Moderate', acuity: 'Medium', cost: '$74k',  sla: 'On track',           slaTone: 'green', cm: 'Angela Ruiz, RN' },
  ];

  readonly referrals = signal<Referral[]>([
    { authId: 'IP540088', member: 'George Pike',  reason: 'Transplant — complex care coordination', from: 'UM · MD Review',       sla: 'Intake due 1d', slaTone: 'amber' },
    { authId: 'IP539774', member: 'Nina Patel',   reason: 'Oncology — high-dollar, symptom mgmt',    from: 'UM · Concurrent',      sla: 'Intake due 2d', slaTone: 'green' },
    { authId: 'IP543902', member: 'Robert Hayes', reason: 'ICU step-down — transitional care',       from: 'UM · Clinical Review', sla: 'Overdue',       slaTone: 'red' },
    { authId: 'OP329910', member: 'Frank Doyle',  reason: 'Denied auth — appeal + CM support',       from: 'UM · OON Review',      sla: 'Intake due 3d', slaTone: 'green' },
  ]);

  private clampUtil(active: number, ref: CaseManager) {
    const perCase = ref.active > 0 ? ref.utilization / ref.active : 3;
    return Math.max(0, Math.min(100, Math.round(active * perCase)));
  }

  rebalance() {
    this.ix.ask({
      title: 'Balance CM caseloads',
      body: 'Move members from over-utilized care managers to those with capacity, prioritizing high-risk/high-acuity work?',
      confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => {
        this.caseManagers.update((list) => {
          const from = list.reduce((a, b) => (b.utilization > a.utilization ? b : a));
          const to = list.reduce((a, b) => (b.utilization < a.utilization ? b : a));
          return list.map((c) => {
            if (c.name === from.name) return { ...c, active: c.active - 2, utilization: this.clampUtil(c.active - 2, c) };
            if (c.name === to.name) return { ...c, active: c.active + 2, utilization: this.clampUtil(c.active + 2, c) };
            return c;
          });
        });
        this.ix.toast('CM caseloads rebalanced.');
        this.data.addHistory('balance', 'CM caseload balanced', 'Rebalanced across care managers');
      },
    });
  }

  reassignTo(c: CaseManager) {
    const others = this.caseManagers().filter((x) => x.name !== c.name).map((x) => x.name);
    this.ix.choose({
      title: `Reassign a member from ${c.name}`,
      body: `${c.name} is at ${c.utilization}% utilization. Move a member to another care manager.`,
      label: 'Reassign to', options: others,
      confirmLabel: 'Reassign', tone: 'teal',
      onChoose: (to) => {
        this.caseManagers.update((list) => list.map((x) => {
          if (x.name === c.name) return { ...x, active: x.active - 1, utilization: this.clampUtil(x.active - 1, x) };
          if (x.name === to) return { ...x, active: x.active + 1, utilization: this.clampUtil(x.active + 1, x) };
          return x;
        }));
        this.ix.toast(`Member reassigned from ${c.name} to ${to}.`);
        this.data.addHistory('swap', 'CM member reassigned', `${c.name} → ${to}`);
      },
    });
  }

  accept(r: Referral) {
    this.ix.choose({
      title: `Accept referral ${r.authId}`,
      body: `Accept ${r.member} into care management and assign to a care manager.`,
      label: 'Assign to', options: this.caseManagers().map((c) => c.name),
      confirmLabel: 'Accept & assign', tone: 'teal',
      onChoose: (to) => {
        this.referrals.update((rows) => rows.filter((x) => x.authId !== r.authId));
        this.ix.toast(`${r.member} accepted into CM — assigned to ${to}.`);
        this.data.addHistory('inbox', 'CM referral accepted', `${r.member} → ${to}`);
      },
    });
  }
}
