import { Component, computed, inject, signal } from '@angular/core';
import { Nav, ModuleId } from '../shared/nav';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';

type Cat = 'breach' | 'soon' | 'unassigned' | 'risk';

interface TriageItem {
  rank: number;                 // lower = more urgent
  cat: Cat;
  module: 'UM' | 'CM' | 'Appeals';
  id: string;
  member: string;
  issue: string;
  due: string;                  // e.g. "Overdue", "2h left"
  overdue: boolean;
  owner: string;
  goto: ModuleId;
}

const CATS: { key: Cat | 'all'; label: string; tone: string }[] = [
  { key: 'all', label: 'All', tone: 'gray' },
  { key: 'breach', label: 'Breached / Overdue', tone: 'red' },
  { key: 'soon', label: 'Due Soon', tone: 'amber' },
  { key: 'unassigned', label: 'Unassigned', tone: 'blue' },
  { key: 'risk', label: 'High Risk / Cost', tone: 'amber' },
];

@Component({
  selector: 'app-overview-dashboard',
  standalone: true,
  template: `
    <div class="tab-head">
      <h2>What needs attention now</h2>
      <span class="section-note">Prioritized across Utilization, Care Management &amp; Appeals</span>
    </div>

    <!-- actionable filter tiles -->
    <div class="tiles">
      @for (c of cats; track c.key) {
        <button class="tile" [class.active]="filter() === c.key" [attr.data-tone]="c.tone" (click)="filter.set(c.key)">
          <div class="t-val">{{ countFor(c.key) }}</div>
          <div class="t-lab">{{ c.label }}</div>
        </button>
      }
    </div>

    <!-- priority queue -->
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Priority Action Queue</h3>
        <span class="note">{{ visible().length }} items · ranked by urgency</span>
      </div>
      <table class="z-table">
        <thead>
          <tr><th>Priority</th><th>Module</th><th>Item</th><th>Member</th><th>Issue</th>
            <th>Due</th><th>Owner</th><th>Action</th></tr>
        </thead>
        <tbody>
          @for (t of visible(); track t.id) {
            <tr>
              <td><span class="prio" [attr.data-c]="t.cat">{{ prioLabel(t.cat) }}</span></td>
              <td><span class="mod" [attr.data-m]="t.module">{{ t.module }}</span></td>
              <td class="strong">{{ t.id }}</td>
              <td><a class="mlink" (click)="members.openByName(t.member)">{{ t.member }}</a></td>
              <td>{{ t.issue }}</td>
              <td [class.danger]="t.overdue">{{ t.due }}</td>
              <td>{{ t.owner }}</td>
              <td><button class="btn outline teal sm" (click)="nav.go(t.goto)">Open {{ t.module }} →</button></td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="empty">Nothing in this filter — you're clear. ✓</td></tr>
          }
        </tbody>
      </table>
    </div>

    <!-- team on track -->
    <div class="teams mt-6">
      @for (t of teams; track t.name) {
        <div class="team" (click)="nav.go(t.goto)">
          <div class="tm-top"><span class="tm-name">{{ t.name }}</span>
            <span class="tm-dot" [attr.data-tone]="t.tone"></span></div>
          <div class="tm-metrics">
            @for (m of t.metrics; track m.label) { <div class="tmm"><b>{{ m.value }}</b><span>{{ m.label }}</span></div> }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .tiles { display:grid; grid-template-columns: repeat(5, 1fr); gap:12px; }
    .tile { text-align:left; background:#fff; border:1px solid var(--border); border-left:3px solid var(--gray-300);
      border-radius:10px; padding:14px 16px; cursor:pointer; box-shadow: var(--shadow); }
    .tile:hover { box-shadow:0 4px 12px rgba(16,24,40,.10); }
    .tile.active { outline:2px solid var(--teal-600); }
    .tile[data-tone="red"]{ border-left-color:var(--red); } .tile[data-tone="amber"]{ border-left-color:var(--amber); }
    .tile[data-tone="blue"]{ border-left-color:var(--blue); } .tile[data-tone="gray"]{ border-left-color:var(--gray-400); }
    .t-val { font-size:24px; font-weight:700; color:var(--ink); }
    .t-lab { font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:600; margin-top:3px; }

    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .note { font-size:11.5px; color:var(--gray-500); }
    .mlink { color:#2563eb; font-weight:600; cursor:pointer; } .mlink:hover { text-decoration:underline; }
    .prio { font-size:11px; font-weight:700; padding:3px 9px; border-radius:6px; white-space:nowrap; }
    .prio[data-c="breach"]{ background:var(--red-bg); color:var(--red-fg); }
    .prio[data-c="soon"]{ background:var(--amber-bg); color:var(--amber-fg); }
    .prio[data-c="unassigned"]{ background:var(--blue-bg); color:var(--blue-fg); }
    .prio[data-c="risk"]{ background:#ffedd5; color:#c2410c; }
    .mod { font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; }
    .mod[data-m="UM"]{ background:var(--teal-100); color:var(--teal-900); }
    .mod[data-m="CM"]{ background:var(--blue-bg); color:var(--blue-fg); }
    .mod[data-m="Appeals"]{ background:#ede9fe; color:var(--purple); }

    .teams { display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; }
    .team { background:#fff; border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow);
      padding:16px 18px; cursor:pointer; }
    .team:hover { box-shadow:0 4px 12px rgba(16,24,40,.10); }
    .tm-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .tm-name { font-size:14px; font-weight:600; color:var(--ink); }
    .tm-dot { width:10px; height:10px; border-radius:999px; }
    .tm-dot[data-tone="green"]{ background:var(--green); } .tm-dot[data-tone="amber"]{ background:var(--amber); } .tm-dot[data-tone="red"]{ background:var(--red); }
    .tm-metrics { display:grid; grid-template-columns: repeat(3,1fr); gap:10px; }
    .tmm { text-align:center; } .tmm b { display:block; font-size:18px; color:var(--ink); }
    .tmm span { font-size:9.5px; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .empty { text-align:center; color:var(--teal-700); font-weight:600; padding:26px; }
  `],
})
export class OverviewDashboard {
  nav = inject(Nav);
  members = inject(Members);
  private ix = inject(Interaction);

  readonly cats = CATS;
  readonly filter = signal<Cat | 'all'>('all');

  readonly items: TriageItem[] = [
    { rank: 1, cat: 'breach', module: 'Appeals', id: 'AP-2025-0891', member: 'Sheryl Leonard', issue: 'L1 appeal past regulatory deadline', due: 'Overdue', overdue: true, owner: 'C. Lawson', goto: 'appeals' },
    { rank: 2, cat: 'breach', module: 'UM', id: 'IP542119', member: 'Karen Wells', issue: 'SLA breached — clinical review', due: 'Overdue', overdue: true, owner: 'A. Mitchell, RN', goto: 'um' },
    { rank: 3, cat: 'breach', module: 'UM', id: 'AUTH-4473', member: 'Foster, Daniel', issue: 'Decision rendered after SLA', due: 'Overdue', overdue: true, owner: 'MD Queue', goto: 'um' },
    { rank: 4, cat: 'soon', module: 'UM', id: 'IP543902', member: 'Robert Hayes', issue: 'High-acuity ICU — 2h to SLA', due: '2h left', overdue: false, owner: 'A. Mitchell, RN', goto: 'um' },
    { rank: 5, cat: 'soon', module: 'Appeals', id: 'AP-2026-0088', member: 'Shannon Wright', issue: 'L2 — MD review / P2P pending', due: '5d left', overdue: false, owner: 'C. Lawson', goto: 'appeals' },
    { rank: 6, cat: 'risk', module: 'UM', id: 'IP540088', member: 'George Pike', issue: 'Transplant · $310k — MD review', due: '1d left', overdue: false, owner: 'MD Queue', goto: 'um' },
    { rank: 7, cat: 'risk', module: 'CM', id: 'IP540088', member: 'George Pike', issue: 'High-risk referral — pending intake', due: 'Intake SLA 1d', overdue: false, owner: 'Unassigned', goto: 'cm' },
    { rank: 8, cat: 'risk', module: 'CM', id: 'MBR000284', member: 'Marcus Webb', issue: 'Critical — ESRD, rising risk 8.9', due: 'Assessment due', overdue: false, owner: 'S. Nguyen, RN', goto: 'cm' },
    { rank: 9, cat: 'soon', module: 'Appeals', id: 'AP-2026-0112', member: 'Maria Benitez', issue: 'L1 — clinical review in progress', due: '11d left', overdue: false, owner: 'C. Lawson', goto: 'appeals' },
    { rank: 10, cat: 'unassigned', module: 'UM', id: 'AUTH-4602', member: 'Reed, Katherine', issue: 'Intake unassigned > 24h', due: '8h left', overdue: false, owner: 'Unassigned', goto: 'um' },
    { rank: 11, cat: 'unassigned', module: 'CM', id: 'IP539774', member: 'Nina Patel', issue: 'Oncology referral — pending intake', due: 'Intake SLA 2d', overdue: false, owner: 'Unassigned', goto: 'cm' },
    { rank: 12, cat: 'unassigned', module: 'UM', id: 'AUTH-4587', member: 'Nguyen, Linda', issue: 'Clinical review unassigned', due: '6h left', overdue: false, owner: 'Unassigned', goto: 'um' },
  ];

  readonly visible = computed(() => {
    const f = this.filter();
    const rows = f === 'all' ? this.items : this.items.filter((i) => i.cat === f);
    return [...rows].sort((a, b) => a.rank - b.rank);
  });

  countFor(key: Cat | 'all') {
    return key === 'all' ? this.items.length : this.items.filter((i) => i.cat === key).length;
  }
  prioLabel(c: Cat) {
    return c === 'breach' ? 'Breached' : c === 'soon' ? 'Due soon' : c === 'unassigned' ? 'Unassigned' : 'High risk';
  }

  readonly teams = [
    { name: 'Utilization Mgmt', goto: 'um' as const, tone: 'green',
      metrics: [{ value: '94%', label: 'TAT' }, { value: '3', label: 'Breached' }, { value: '87%', label: 'Util' }] },
    { name: 'Care Mgmt', goto: 'cm' as const, tone: 'amber',
      metrics: [{ value: '96%', label: 'SLA' }, { value: '5', label: 'Overdue' }, { value: '23', label: 'High Risk' }] },
    { name: 'Appeals & Grievances', goto: 'appeals' as const, tone: 'red',
      metrics: [{ value: '1', label: 'Overdue' }, { value: '4', label: 'Near SLA' }, { value: '61%', label: 'Overturn' }] },
  ];
}
