import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { NurseRow } from '../data/dashboard.models';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-workforce-tab',
  standalone: true,
  imports: [Icon, FormsModule],
  template: `
    <div class="tab-head">
      <h2>Workforce &amp; Queue Management</h2>
      <div class="flex gap-8">
        <button class="btn primary" (click)="reassign()"><z-icon name="swap" [size]="14"></z-icon> Reassign</button>
        <button class="btn outline" (click)="balance()"><z-icon name="balance" [size]="14"></z-icon> Balance</button>
        <button class="btn outline esc" (click)="escalate()"><z-icon name="arrowup" [size]="14"></z-icon> Escalate</button>
      </div>
    </div>

    <div class="queues">
      @for (q of data.queues(); track q.name) {
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
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Workload per Nurse</h3>
        <input class="search" type="text" placeholder="Search nurses…"
          [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </div>
      <table class="z-table">
        <thead>
          <tr>
            <th class="sortable" (click)="sortBy('name')">Nurse{{ caret('name') }}</th>
            <th class="sortable" (click)="sortBy('active')">Active Cases{{ caret('active') }}</th>
            <th class="sortable" (click)="sortBy('pending')">Pending{{ caret('pending') }}</th>
            <th class="sortable" (click)="sortBy('completed')">Completed (MTD){{ caret('completed') }}</th>
            <th class="sortable" (click)="sortBy('avgTat')">Avg TAT{{ caret('avgTat') }}</th>
            <th class="sortable" (click)="sortBy('utilization')">Utilization{{ caret('utilization') }}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (n of visibleNurses(); track n.name) {
            <tr class="clickable" (click)="openNurse(n)">
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
              <td><button class="btn outline sm" (click)="reassignTo(n); $event.stopPropagation()">Reassign</button></td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">No nurses match "{{ search() }}".</td></tr>
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
    .clickable { cursor: pointer; }
    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px;
      width: 220px; outline:none; }
    .search:focus { border-color: var(--teal-600); }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
    .empty { text-align:center; color: var(--gray-500); padding: 22px; }
  `],
})
export class WorkforceTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);

  readonly search = signal('');
  readonly sortKey = signal<keyof NurseRow | ''>('');
  readonly sortDir = signal<1 | -1>(1);

  readonly visibleNurses = computed(() => {
    const q = this.search().trim().toLowerCase();
    let rows = this.data.nurses().filter((n) => !q || n.name.toLowerCase().includes(q));
    const key = this.sortKey();
    if (key) {
      const dir = this.sortDir();
      rows = [...rows].sort((a, b) => {
        const av = a[key], bv = b[key];
        const an = parseFloat(String(av)), bn = parseFloat(String(bv));
        const cmp = !isNaN(an) && !isNaN(bn)
          ? an - bn
          : String(av).localeCompare(String(bv));
        return cmp * dir;
      });
    }
    return rows;
  });

  sortBy(key: keyof NurseRow) {
    if (this.sortKey() === key) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(key); this.sortDir.set(1); }
  }
  caret(key: keyof NurseRow) {
    return this.sortKey() === key ? (this.sortDir() === 1 ? ' ▲' : ' ▼') : '';
  }

  openNurse(n: NurseRow) {
    this.ix.openDrawer({
      title: n.name,
      subtitle: 'Utilization Management · Nurse Reviewer',
      badge: {
        text: `${n.utilization}% utilized`,
        tone: n.utilization >= 90 ? 'red' : n.utilization < 80 ? 'green' : 'amber',
      },
      fields: [
        { label: 'Active Cases', value: String(n.active) },
        { label: 'Pending', value: String(n.pending) },
        { label: 'Completed (MTD)', value: String(n.completed) },
        { label: 'Avg TAT', value: n.avgTat },
        { label: 'Utilization', value: `${n.utilization}%`,
          tone: n.utilization >= 90 ? 'red' : n.utilization < 80 ? 'green' : 'amber' },
      ],
      note: n.utilization >= 90
        ? 'At or above capacity — consider reassigning cases to prevent TAT breaches.'
        : 'Operating within healthy capacity.',
      actions: [{ label: `Reassign a case to ${n.name.split(',')[0]}`, tone: 'teal',
        run: () => { this.data.reassignTo(n.name); this.ix.toast(`Case reassigned to ${n.name}.`); } }],
    });
  }

  reassign() {
    this.ix.ask({
      title: 'Auto-reassign a case',
      body: 'Move one case from the nurse at highest utilization to the one with the most capacity to balance the load?',
      confirmLabel: 'Reassign', tone: 'teal',
      onConfirm: () => {
        const move = this.data.reassignBusiest();
        this.ix.toast(move ? `Case reassigned from ${move.from} to ${move.to}.` : 'Nothing to reassign.');
      },
    });
  }

  balance() {
    this.ix.ask({
      title: 'Balance workload',
      body: 'Rebalance the team by moving 3 cases from over-utilized nurses to those with headroom?',
      confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => {
        for (let i = 0; i < 3; i++) this.data.reassignBusiest();
        this.ix.toast('Workload rebalanced across the team.');
      },
    });
  }

  escalate() {
    this.ix.ask({
      title: 'Escalate at-risk cases',
      body: 'Escalate the highest-risk pending cases to a supervisor for expedited review?',
      confirmLabel: 'Escalate', tone: 'amber',
      onConfirm: () => this.ix.toast('At-risk cases escalated to supervisor.', 'warn'),
    });
  }

  reassignTo(n: NurseRow) {
    this.ix.ask({
      title: `Reassign a case to ${n.name}`,
      body: `Move one case from the busiest nurse to ${n.name} (currently ${n.utilization}% utilized)?`,
      confirmLabel: 'Reassign', tone: 'teal',
      onConfirm: () => {
        this.data.reassignTo(n.name);
        this.ix.toast(`Case reassigned to ${n.name}.`);
      },
    });
  }
}
