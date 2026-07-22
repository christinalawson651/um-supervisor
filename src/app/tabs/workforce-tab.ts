import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Reassign, ReassignCase } from '../shared/reassign';
import { Escalate } from '../shared/escalate';
import { NurseRow } from '../data/dashboard.models';
import { CASE_POOL } from '../data/case-pool';
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

    <div class="qhint">Bars show <b>case age in queue</b> (time waiting since the request was received). Click a band to see those cases. <b>Breach</b> = past the SLA deadline.</div>
    <div class="queues">
      @for (q of data.queues(); track q.name) {
        <div class="qcard">
          <div class="qtop">
            <span class="qname">{{ q.name }}</span>
            <span class="qcount">{{ q.count }}</span>
          </div>
          <div class="seg">
            <span class="s-fresh"  [style.width.%]="q.buckets.fresh"  title="0–24h in queue" (click)="openBucket(q.name, 'fresh')"></span>
            <span class="s-day2"   [style.width.%]="q.buckets.day2"   title="24–48h in queue" (click)="openBucket(q.name, 'day2')"></span>
            <span class="s-over48" [style.width.%]="q.buckets.over48" title="Over 48h in queue" (click)="openBucket(q.name, 'over48')"></span>
            <span class="s-breach" [style.width.%]="q.buckets.breach" title="Past SLA deadline" (click)="openBucket(q.name, 'breach')"></span>
          </div>
          <div class="legend">
            <span (click)="openBucket(q.name, 'fresh')"><i class="d-fresh"></i>0-24h</span>
            <span (click)="openBucket(q.name, 'day2')"><i class="d-day2"></i>24-48h</span>
            <span (click)="openBucket(q.name, 'over48')"><i class="d-over48"></i>&gt;48h</span>
            <span (click)="openBucket(q.name, 'breach')"><i class="d-breach"></i>Breach</span>
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
    .qhint { font-size: 12px; color: var(--gray-500); margin-bottom: 12px; } .qhint b { color: var(--ink-soft); }
    .seg > span { cursor: pointer; }
    .legend span { cursor: pointer; } .legend span:hover { color: var(--ink-soft); }
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
  private rx = inject(Reassign);
  private esc = inject(Escalate);

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

  private readonly ESCALATE_TARGETS = [
    'Dr. Patel — Medical Director', 'Dr. Nguyen — MD Review', 'Dr. Rivera — MD Review',
    'Peer-to-Peer Review Queue', 'Supervisor — Christina Lawson',
  ];

  reassign() {
    const cases: ReassignCase[] = CASE_POOL
      .filter((c) => c.phase === 'pending')
      .map((c) => ({
        authId: c.authId, member: c.member, type: c.serviceType, queue: c.status,
        priority: c.tags.includes('breached') ? 'Breached' : c.tags.includes('atRisk') ? 'At risk' : 'Routine',
        owner: c.nurse === '—' ? 'Unassigned' : c.nurse,
      }));
    const nurses = this.data.nurses().map((n) => ({ name: n.name, utilization: n.utilization, active: n.active }));
    this.rx.open({
      title: 'Reassign cases',
      cases, nurses,
      apply: (ids, target) => {
        ids.forEach((id) => {
          const cs = cases.find((x) => x.authId === id);
          this.data.moveOneCase(cs && cs.owner !== 'Unassigned' ? cs.owner : null, target);
        });
        this.ix.toast(`${ids.length} case(s) reassigned to ${target}.`);
        this.data.addHistory('swap', 'Cases reassigned', `${ids.length} case(s) → ${target}`);
      },
    });
  }

  balance() {
    this.ix.choose({
      title: 'Balance workload',
      body: 'Choose how aggressively to rebalance cases from over-utilized nurses to those with capacity.',
      label: 'Balancing strategy',
      options: [
        'Light — move 1 case from the busiest nurse',
        'Standard — rebalance 3 cases',
        'Aggressive — rebalance 6 cases',
        'Even out — level everyone toward the team average',
      ],
      confirmLabel: 'Balance', tone: 'teal',
      onChoose: (opt) => {
        const n = opt.startsWith('Light') ? 1 : opt.startsWith('Aggressive') ? 6 : opt.startsWith('Even') ? 5 : 3;
        for (let i = 0; i < n; i++) this.data.reassignBusiest();
        this.ix.toast(`Workload balanced — ${opt.split(' — ')[0].toLowerCase()} (${n} case${n > 1 ? 's' : ''} moved).`);
        this.data.addHistory('balance', 'Workload balanced', `${opt.split(' — ')[0]} · ${n} case(s) moved`);
      },
    });
  }

  private ageH(authId: string) { return 6 + (Number(authId.slice(-2)) % 90); }
  private bandOf(authId: string, breached: boolean) {
    if (breached) return 'breach';
    const h = this.ageH(authId);
    return h < 24 ? 'fresh' : h < 48 ? 'day2' : 'over48';
  }
  private ageLabel(h: number) { return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`; }

  /** Drill a queue's age band -> Case Explorer of those cases. */
  openBucket(queue: string, band: string) {
    const labels: Record<string, string> = { fresh: '0–24h in queue', day2: '24–48h in queue', over48: '>48h in queue', breach: 'Breach (past SLA)' };
    const rows = CASE_POOL
      .filter((c) => c.phase === 'pending' && c.status === queue && this.bandOf(c.authId, c.tags.includes('breached')) === band)
      .map((c) => [c.authId, c.member, c.procedure, this.ageLabel(this.ageH(c.authId)), c.nurse === '—' ? 'Unassigned' : c.nurse] as (string | number)[]);
    this.ix.openExplorer({
      title: `${queue} — ${labels[band]}`,
      context: `${rows.length} case(s) in ${queue} · ${labels[band]}`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Age in Queue', 'Owner'],
      rows, exportName: `${queue.toLowerCase().replace(/\s+/g, '-')}-${band}_2026-07-17`, memberColumn: 1,
    });
  }

  escalate() {
    const candidates = this.data.riskCases().map((r) => ({
      authId: r.authId, member: r.member,
      detail: `${r.stage} · ${r.drivers.join(', ')}`,
      riskLabel: `${r.score} · ${r.risk === 'red' ? 'High' : 'Med'}`,
      risk: r.risk as 'red' | 'amber' | 'green',
    }));
    this.esc.open({
      title: 'Escalate cases',
      candidates,
      targets: this.ESCALATE_TARGETS,
      apply: (ids, who) => {
        ids.forEach((id) => this.data.resolveRiskCase(id));
        this.ix.toast(`${ids.length} case(s) escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Cases escalated', `${ids.length} case(s) → ${who}`);
      },
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
        this.data.addHistory('swap', 'Case reassigned', `Reassigned to ${n.name}`);
      },
    });
  }
}
