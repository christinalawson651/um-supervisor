import { Component, inject } from '@angular/core';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Nav } from '../shared/nav';
import { Members } from '../shared/members';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-overview-dashboard',
  standalone: true,
  imports: [KpiStrip, Icon],
  template: `
    <app-kpi-strip [items]="kpis" />

    <div class="tab-head"><h2>Modules</h2>
      <span class="section-note">Utilization, Care Management &amp; Appeals — one operational view</span></div>

    <div class="mods">
      @for (m of modules; track m.id) {
        <div class="mod" [attr.data-tone]="m.tone">
          <div class="mod-top">
            <span class="mod-ic"><z-icon [name]="m.icon" [size]="18"></z-icon></span>
            <h3>{{ m.name }}</h3>
          </div>
          <div class="mod-metrics">
            @for (s of m.stats; track s.label) {
              <div class="ms"><b>{{ s.value }}</b><span>{{ s.label }}</span></div>
            }
          </div>
          <button class="btn primary" (click)="nav.go(m.id)">Open {{ m.short }} →</button>
        </div>
      }
    </div>

    <div class="grid-2 mt-6">
      <div class="panel panel-pad">
        <h3 class="panel-title">Cross-Module Case Journeys</h3>
        <div class="journeys">
          @for (j of journeys; track j.authId) {
            <div class="journey">
              <span class="jid">{{ j.authId }}</span>
              <span class="jmem"><a class="mlink" (click)="members.openByName(j.member)">{{ j.member }}</a></span>
              <span class="flow">
                <span class="chip um">UM</span>
                <span class="arrow">→</span>
                <span class="chip" [class.cm]="j.to==='CM'" [class.ap]="j.to==='Appeal'">{{ j.to }}</span>
              </span>
              <span class="jreason">{{ j.reason }}</span>
            </div>
          }
        </div>
      </div>

      <div class="panel panel-pad">
        <h3 class="panel-title">Needs Attention Today</h3>
        <ul class="attn">
          @for (a of attention; track a.text) {
            <li><span class="dot" [attr.data-tone]="a.tone"></span>{{ a.text }}
              <a class="go" (click)="nav.go(a.go)">View →</a></li>
          }
        </ul>
      </div>
    </div>
  `,
  styles: [`
    .mods { display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; }
    .mod { background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300);
      border-radius:12px; box-shadow: var(--shadow); padding:18px 20px; }
    .mod[data-tone="teal"]{ border-top-color:var(--teal-600); } .mod[data-tone="teal"] .mod-ic{ background:var(--teal-50); color:var(--teal-700); }
    .mod[data-tone="blue"]{ border-top-color:var(--blue); } .mod[data-tone="blue"] .mod-ic{ background:var(--blue-bg); color:var(--blue-fg); }
    .mod[data-tone="purple"]{ border-top-color:var(--purple); } .mod[data-tone="purple"] .mod-ic{ background:#ede9fe; color:var(--purple); }
    .mod-top { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
    .mod-ic { width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center; }
    .mod-top h3 { margin:0; font-size:15px; }
    .mod-metrics { display:grid; grid-template-columns: repeat(3,1fr); gap:10px; margin-bottom:16px; }
    .ms { text-align:center; } .ms b { display:block; font-size:20px; color:var(--ink); } .ms span { font-size:10px; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .mod .btn { width:100%; justify-content:center; }

    .journeys { display:flex; flex-direction:column; gap:10px; }
    .journey { display:grid; grid-template-columns: 90px 130px 130px 1fr; align-items:center; gap:10px;
      padding:10px 12px; background:var(--gray-50); border-radius:8px; font-size:12.5px; }
    .jid { font-weight:700; color:var(--teal-700); }
    .mlink { color:#2563eb; font-weight:600; cursor:pointer; } .mlink:hover { text-decoration:underline; }
    .flow { display:flex; align-items:center; gap:8px; }
    .chip { font-size:11px; font-weight:700; padding:2px 9px; border-radius:6px; background:var(--gray-200); color:var(--gray-500); }
    .chip.um { background:var(--teal-100); color:var(--teal-900); }
    .chip.cm { background:var(--blue-bg); color:var(--blue-fg); }
    .chip.ap { background:#ede9fe; color:var(--purple); }
    .arrow { color:var(--gray-400); font-weight:700; }
    .jreason { color:var(--gray-500); }
    .attn { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
    .attn li { display:flex; align-items:center; gap:10px; font-size:12.5px; color:var(--ink-soft); }
    .dot { width:8px;height:8px;border-radius:999px;flex:0 0 8px; }
    .dot[data-tone="red"]{ background:var(--red); } .dot[data-tone="amber"]{ background:var(--amber); } .dot[data-tone="blue"]{ background:var(--blue); }
    .go { margin-left:auto; color:var(--teal-700); font-weight:600; cursor:pointer; white-space:nowrap; }
    .go:hover { text-decoration:underline; }
  `],
})
export class OverviewDashboard {
  nav = inject(Nav);
  members = inject(Members);

  readonly kpis: KpiItem[] = [
    { icon: 'folder', value: '358', label: 'Total Open Cases', tone: 'teal' },
    { icon: 'alert',  value: '35',  label: 'At Risk / SLA',    tone: 'amber' },
    { icon: 'xcircle', value: '6',   label: 'Breached',         tone: 'red' },
    { icon: 'swap',   value: '11',  label: 'Cross-Module Referrals', tone: 'blue' },
    { icon: 'users',  value: '242', label: 'Members Managed',   tone: 'green' },
    { icon: 'check',  value: '93%', label: 'Overall Compliance', tone: 'green' },
  ];

  readonly modules = [
    { id: 'um' as const, name: 'Utilization Management', short: 'UM', icon: 'shield', tone: 'teal',
      stats: [{ value: '247', label: 'Pending' }, { value: '12', label: 'At Risk' }, { value: '94%', label: 'TAT' }] },
    { id: 'cm' as const, name: 'Care Management', short: 'CM', icon: 'users', tone: 'blue',
      stats: [{ value: '68', label: 'Care Plans' }, { value: '23', label: 'High Risk' }, { value: '14', label: 'Referrals' }] },
    { id: 'appeals' as const, name: 'Appeals & Grievances', short: 'Appeals', icon: 'balance', tone: 'purple',
      stats: [{ value: '18', label: 'Open' }, { value: '61%', label: 'Overturn' }, { value: '4', label: 'At Deadline' }] },
  ];

  readonly journeys = [
    { authId: 'IP540088', member: 'George Pike',  to: 'CM',     reason: 'Transplant — complex care coordination' },
    { authId: 'OP329910', member: 'Frank Doyle',  to: 'Appeal', reason: 'Denied OON — member appeal filed' },
    { authId: 'IP539774', member: 'Nina Patel',   to: 'CM',     reason: 'Oncology — symptom management' },
    { authId: 'BH300966', member: 'Anderson, Kristina', to: 'Appeal', reason: 'BH IOP denial — Level 1 appeal' },
  ];

  readonly attention = [
    { text: '3 UM auths breached SLA and require documentation', tone: 'red', go: 'um' as const },
    { text: '4 appeals within 48h of regulatory deadline', tone: 'amber', go: 'appeals' as const },
    { text: '14 new CM referrals pending intake', tone: 'blue', go: 'cm' as const },
    { text: '2 high-dollar cases (>$100k) awaiting MD review', tone: 'amber', go: 'um' as const },
  ];
}
