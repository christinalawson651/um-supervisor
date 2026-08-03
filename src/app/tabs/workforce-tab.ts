import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Reassign, ReassignCase } from '../shared/reassign';
import { Escalate, ESCALATE_TARGETS } from '../shared/escalate';
import { Balance } from '../shared/balance';
import { NurseRow, QueueCard } from '../data/dashboard.models';
import { CASE_POOL } from '../data/case-pool';
import { urgencyOf, lobOf, LOBS, ageH, bandOf } from '../data/case-fields';
import { COLUMNS, toRow } from '../shared/metrics';
import { LobFilter } from '../shared/lob-filter';
import { Icon } from '../shared/icon';

interface DisplayQueue extends QueueCard { baseName: string; lob?: string; }
type QueueSort = 'volume' | 'breach' | 'name';

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
        <button class="btn outline" (click)="openAssignmentHistory()"><z-icon name="clock" [size]="14"></z-icon> Assignment History</button>
      </div>
    </div>

    <div class="qhint">Cards show <b>unclaimed authorizations available to pull next</b> — work already claimed by a nurse shows in Workload below. Bars show how long each has been waiting. Click a band to see those authorizations. <b>Breach</b> = past the SLA deadline.</div>

    <div class="qtoolbar">
      <input class="search" type="text" placeholder="Search queues…" [ngModel]="queueSearch()" (ngModelChange)="queueSearch.set($event)" />
      <label class="sortsel">
        <span>Sort</span>
        <select [value]="queueSort()" (change)="queueSort.set($any($event.target).value)">
          <option value="volume">Most authorizations</option>
          <option value="breach">Highest breach %</option>
          <option value="name">Name A–Z</option>
        </select>
      </label>
      <button class="btn outline sm" [class.on]="splitByLob()" (click)="splitByLob.set(!splitByLob())">
        {{ splitByLob() ? 'Split by LOB ✓' : 'Split by LOB' }}
      </button>
      <span class="qtotal">{{ displayQueues().length }} queue{{ displayQueues().length === 1 ? '' : 's' }}</span>
    </div>

    <div class="queues">
      @for (q of displayQueues(); track q.name) {
        <div class="qcard">
          <div class="qtop">
            <span class="qname">{{ q.name }}</span>
            <span class="qcount">{{ q.count }}</span>
          </div>
          <div class="seg">
            <span class="s-fresh"  [style.width.%]="q.buckets.fresh"  title="0–24h in queue" (click)="openBucket(q.baseName, 'fresh', q.lob)"></span>
            <span class="s-day2"   [style.width.%]="q.buckets.day2"   title="24–48h in queue" (click)="openBucket(q.baseName, 'day2', q.lob)"></span>
            <span class="s-over48" [style.width.%]="q.buckets.over48" title="Over 48h in queue" (click)="openBucket(q.baseName, 'over48', q.lob)"></span>
            <span class="s-breach" [style.width.%]="q.buckets.breach" title="Past SLA deadline" (click)="openBucket(q.baseName, 'breach', q.lob)"></span>
          </div>
          <div class="legend">
            <span (click)="openBucket(q.baseName, 'fresh', q.lob)"><i class="d-fresh"></i>0-24h</span>
            <span (click)="openBucket(q.baseName, 'day2', q.lob)"><i class="d-day2"></i>24-48h</span>
            <span (click)="openBucket(q.baseName, 'over48', q.lob)"><i class="d-over48"></i>&gt;48h</span>
            <span (click)="openBucket(q.baseName, 'breach', q.lob)"><i class="d-breach"></i>Breach</span>
          </div>
        </div>
      } @empty {
        <div class="qempty">No queues match "{{ queueSearch() }}".</div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Workload {{ groupBy() === 'team' ? '— by Team' : 'per Nurse' }}{{ lob() === 'all' ? '' : ' · ' + lob() }}</h3>
        <div class="flex gap-8 center">
          <div class="seg-toggle">
            <button [class.on]="groupBy() === 'nurse'" (click)="groupBy.set('nurse')">By Nurse</button>
            <button [class.on]="groupBy() === 'team'" (click)="groupBy.set('team')">By Team</button>
          </div>
          @if (groupBy() === 'nurse') {
            <input class="search" type="text" placeholder="Search nurses…" [ngModel]="search()" (ngModelChange)="search.set($event)" />
          } @else {
            <label class="sortsel">
              <span>Team</span>
              <select [value]="teamFilter()" (change)="teamFilter.set($any($event.target).value)">
                <option value="all">All Teams</option>
                @for (t of teams(); track t.name) { <option [value]="t.name">{{ t.name }}</option> }
              </select>
            </label>
            <label class="sortsel">
              <span>Sort</span>
              <select [value]="teamSort()" (change)="teamSort.set($any($event.target).value)">
                <option value="utilization">Highest utilization</option>
                <option value="active">Most active</option>
                <option value="name">Name A–Z</option>
              </select>
            </label>
          }
        </div>
      </div>

      @if (groupBy() === 'nurse') {
        <table class="z-table">
          <thead><tr>
            <th class="sortable" (click)="sortBy('name')">Nurse{{ caret('name') }}</th>
            <th class="sortable" (click)="sortBy('active')">Active Authorizations{{ caret('active') }}</th>
            <th class="sortable" (click)="sortBy('pending')">Pending{{ caret('pending') }}</th>
            <th class="sortable" (click)="sortBy('completed')">Completed (MTD){{ caret('completed') }}</th>
            <th class="sortable" (click)="sortBy('avgTat')">Avg TAT{{ caret('avgTat') }}</th>
            <th class="sortable" (click)="sortBy('utilization')">Utilization{{ caret('utilization') }}</th>
            <th>Team</th><th>Actions</th>
          </tr></thead>
          <tbody>
            @for (n of visibleNurses(); track n.name) {
              <tr class="clickable" (click)="openNurse(n)">
                <td class="strong">{{ n.name }}</td>
                <td class="num clk" (click)="openNurse(n); $event.stopPropagation()">{{ n.active }}</td>
                <td class="num clk" (click)="openNursePending(n); $event.stopPropagation()">{{ n.pending }}</td>
                <td class="num clk" (click)="openNurseCompleted(n); $event.stopPropagation()">{{ n.completed }}</td>
                <td class="clk" (click)="openNurseCompleted(n); $event.stopPropagation()">{{ n.avgTat }}</td>
                <td><span class="mini-bar" [class.teal]="n.utilization < 80" [class.red]="n.utilization >= 90"><span [style.width.%]="n.utilization"></span></span><span class="util-pct">{{ n.utilization }}%</span></td>
                <td><span class="tchip">{{ n.team }}</span></td>
                <td><button class="btn outline sm" (click)="reassignTo(n); $event.stopPropagation()">Reassign</button></td>
              </tr>
            } @empty { <tr><td colspan="8" class="empty">No nurses match "{{ search() }}".</td></tr> }
          </tbody>
        </table>
      } @else {
        <table class="z-table">
          <thead><tr><th>Team / Nurse</th><th>Active</th><th>Pending</th><th>Completed (MTD)</th><th>Avg TAT</th><th>Utilization</th><th>Actions</th></tr></thead>
          <tbody>
            @for (t of filteredTeams(); track t.name) {
              <tr class="team-row" (click)="toggleTeam(t.name)">
                <td class="strong"><span class="chev" [class.open]="expanded().has(t.name)">▸</span> {{ t.name }} <span class="tcount">{{ t.nurses.length }} nurses</span></td>
                <td class="num">{{ t.active }}</td><td class="num">{{ t.pending }}</td>
                <td class="num">{{ t.completed }}</td><td class="num">{{ t.avgTat }}</td>
                <td><span class="mini-bar" [class.teal]="t.utilization < 80" [class.red]="t.utilization >= 90"><span [style.width.%]="t.utilization"></span></span><span class="util-pct strong">{{ t.utilization }}%</span></td>
                <td><button class="btn outline sm" (click)="balanceTeam(t); $event.stopPropagation()">Balance</button></td>
              </tr>
              @if (expanded().has(t.name)) {
                @for (n of t.nurses; track n.name) {
                  <tr class="nurse-child clickable" (click)="openNurse(n)">
                    <td class="child-name">{{ n.name }}</td>
                    <td class="num clk" (click)="openNurse(n); $event.stopPropagation()">{{ n.active }}</td>
                    <td class="num clk" (click)="openNursePending(n); $event.stopPropagation()">{{ n.pending }}</td>
                    <td class="num clk" (click)="openNurseCompleted(n); $event.stopPropagation()">{{ n.completed }}</td>
                    <td class="clk" (click)="openNurseCompleted(n); $event.stopPropagation()">{{ n.avgTat }}</td>
                    <td><span class="mini-bar" [class.teal]="n.utilization < 80" [class.red]="n.utilization >= 90"><span [style.width.%]="n.utilization"></span></span><span class="util-pct">{{ n.utilization }}%</span></td>
                    <td><button class="btn outline sm" (click)="reassignTo(n); $event.stopPropagation()">Reassign</button></td>
                  </tr>
                }
              }
            } @empty {
              <tr><td colspan="7" class="empty">No teams match the current filter.</td></tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .esc { color: var(--amber-fg); border-color: var(--gray-300); }
    .qhint { font-size: 12px; color: var(--gray-500); margin-bottom: 12px; } .qhint b { color: var(--ink-soft); }
    .seg > span { cursor: pointer; }
    .legend span { cursor: pointer; } .legend span:hover { color: var(--ink-soft); }
    /* auto-fill instead of a fixed column count so this scales to any number of queues
       (a supervisor's queue count grows with LOB/specialty segmentation, not headcount) */
    .queues { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
    .qtoolbar { display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
    .qtoolbar .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:200px; outline:none; }
    .qtoolbar .search:focus { border-color: var(--teal-600); }
    .sortsel { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .sortsel select { font-size:12.5px; font-weight:500; color:var(--ink); text-transform:none; letter-spacing:0; padding:6px 8px; border:1px solid var(--gray-300); border-radius:8px; background:#fff; cursor:pointer; }
    .qtoolbar .btn.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; }
    .qtotal { margin-left:auto; font-size:12px; font-weight:600; color:var(--gray-500); }
    .qempty { grid-column:1/-1; text-align:center; padding:24px; color:var(--gray-500); font-size:13px; }
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
    .num.clk:hover, td.clk:hover { text-decoration: underline; }
    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px;
      width: 220px; outline:none; }
    .search:focus { border-color: var(--teal-600); }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
    .empty { text-align:center; color: var(--gray-500); padding: 22px; }
    .flex { display:flex; } .gap-8 { gap:8px; } .center { align-items:center; }
    .seg-toggle { display:inline-flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; }
    .seg-toggle button { border:none; background:#fff; padding:7px 14px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .seg-toggle button.on { background:var(--teal-700); color:#fff; }
    .tchip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--gray-100); color:var(--gray-500); }
    .team-row { cursor:pointer; background:var(--teal-50); }
    .team-row:hover { background:var(--teal-100); }
    .team-row .strong { color:var(--teal-900); }
    .chev { display:inline-block; transition:transform .12s; color:var(--teal-700); margin-right:4px; }
    .chev.open { transform:rotate(90deg); }
    .tcount { font-size:11px; font-weight:600; color:var(--gray-500); background:#fff; border:1px solid var(--border); padding:1px 8px; border-radius:999px; margin-left:6px; }
    .nurse-child td:first-child { padding-left:34px; } .child-name { color:var(--ink-soft); }
  `],
})
export class WorkforceTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private rx = inject(Reassign);
  private esc = inject(Escalate);
  private bal = inject(Balance);

  readonly search = signal('');
  readonly sortKey = signal<keyof NurseRow | ''>('');
  readonly sortDir = signal<1 | -1>(1);

  // ---- queue scaling: search/sort/split so this holds up regardless of queue count.
  // A supervisor's team stays small (3-10 direct reports is the effective span-of-control
  // range) but their queue count grows independently once queues are segmented by LOB or
  // specialty — so the queue section, not headcount, is what has to scale. ----
  readonly queueSearch = signal('');
  readonly queueSort = signal<QueueSort>('volume');
  readonly splitByLob = signal(false);
  private lobFilter = inject(LobFilter); // the shared top-bar LOB control — scopes these cards too
  readonly lob = this.lobFilter.value; // exposed for the Workload panel title

  /** Real per-LOB breakdown of one queue's unclaimed pool, computed live from the case pool. */
  private lobSplit(q: QueueCard): DisplayQueue[] {
    const cases = CASE_POOL.filter((c) => c.phase === 'pending' && c.status === q.name && c.nurse === '—');
    const byLob = new Map<string, typeof cases>();
    for (const c of cases) { const l = lobOf(c.authId); if (!byLob.has(l)) byLob.set(l, []); byLob.get(l)!.push(c); }
    return LOBS.map((l) => {
      const cs = byLob.get(l) ?? [];
      const total = cs.length || 1;
      const bands = { fresh: 0, day2: 0, over48: 0, breach: 0 };
      cs.forEach((c) => { bands[bandOf(c.authId, c.tags.includes('breached'))]++; });
      return {
        name: `${q.name} · ${l}`, baseName: q.name, lob: l, count: cs.length,
        buckets: {
          fresh: Math.round((bands.fresh / total) * 100), day2: Math.round((bands.day2 / total) * 100),
          over48: Math.round((bands.over48 / total) * 100), breach: Math.round((bands.breach / total) * 100),
        },
      };
    }).filter((dq) => dq.count > 0); // skip LOBs with no cases in this queue — no empty noise
  }

  readonly displayQueues = computed((): DisplayQueue[] => {
    const topLob = this.lobFilter.value();
    const base: DisplayQueue[] = this.data.queues().map((q) => ({ ...q, baseName: q.name }));
    let list: DisplayQueue[];
    if (this.splitByLob()) {
      // full per-LOB breakdown, narrowed further if a specific LOB is also selected up top
      list = base.flatMap((q) => this.lobSplit(q)).filter((s) => topLob === 'all' || s.lob === topLob);
    } else if (topLob !== 'all') {
      // collapse each card down to just the selected LOB's slice (0-count if none in that queue)
      list = base.map((q) => this.lobSplit(q).find((s) => s.lob === topLob) ?? {
        ...q, name: `${q.name} · ${topLob}`, baseName: q.name, lob: topLob,
        count: 0, buckets: { fresh: 0, day2: 0, over48: 0, breach: 0 },
      });
    } else {
      list = base;
    }
    const q = this.queueSearch().trim().toLowerCase();
    if (q) list = list.filter((x) => x.name.toLowerCase().includes(q));
    const sort = this.queueSort();
    return [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'breach' ? b.buckets.breach - a.buckets.breach
      : b.count - a.count);
  });

  /**
   * Active/Pending/Completed/Avg TAT recomputed live from the case pool for the selected LOB —
   * same real-count-not-flavor-text principle as the queue cards. Utilization stays whatever the
   * base row holds (including any session reassign/balance moves) since it's a whole-caseload
   * capacity indicator, not something that splits meaningfully per LOB.
   */
  readonly effectiveNurses = computed((): NurseRow[] => {
    const lob = this.lobFilter.value();
    const rows = this.data.nurses();
    if (lob === 'all') return rows;
    return rows.map((n) => ({ ...n, ...this.data.nurseStatsForLob(n.name, lob) }));
  });

  // ---- team rollup ----
  readonly groupBy = signal<'nurse' | 'team'>('team');
  readonly expanded = signal<Set<string>>(new Set());
  readonly teams = computed(() => {
    const groups = new Map<string, NurseRow[]>();
    for (const n of this.effectiveNurses()) {
      if (!groups.has(n.team)) groups.set(n.team, []);
      groups.get(n.team)!.push(n);
    }
    return [...groups.entries()].map(([name, nurses]) => {
      const sum = (f: (n: NurseRow) => number) => nurses.reduce((s, n) => s + f(n), 0);
      const avgTat = nurses.reduce((s, n) => s + parseFloat(n.avgTat), 0) / nurses.length;
      return {
        name, nurses,
        active: sum((n) => n.active), pending: sum((n) => n.pending), completed: sum((n) => n.completed),
        avgTat: `${avgTat.toFixed(1)}h`,
        utilization: Math.round(sum((n) => n.utilization) / nurses.length),
      };
    });
  });
  toggleTeam(name: string) { this.expanded.update((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; }); }

  // ---- team filter + sort dropdowns ----
  readonly teamFilter = signal('all');
  readonly teamSort = signal<'utilization' | 'active' | 'name'>('utilization');
  readonly filteredTeams = computed(() => {
    let list = this.teams();
    if (this.teamFilter() !== 'all') list = list.filter((t) => t.name === this.teamFilter());
    const s = this.teamSort();
    return [...list].sort((a, b) =>
      s === 'name' ? a.name.localeCompare(b.name)
      : s === 'active' ? b.active - a.active
      : b.utilization - a.utilization);
  });

  balanceTeam(t: { name: string; nurses: NurseRow[] }) {
    const from = t.nurses.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    const to = t.nurses.reduce((a, b) => (b.utilization < a.utilization ? b : a));
    if (from.name === to.name) { this.ix.toast(`${t.name} is already balanced.`); return; }
    this.ix.ask({
      title: `Balance ${t.name}`,
      body: `Move one authorization from ${from.name} (${from.utilization}% utilized) to ${to.name} (${to.utilization}% utilized)?`,
      confirmLabel: 'Balance', tone: 'teal',
      onConfirm: () => {
        this.data.moveOneCase(from.name, to.name);
        this.ix.toast(`Balanced ${t.name}: moved an authorization from ${from.name} to ${to.name}.`);
        this.data.addHistory('balance', 'Team balanced', `${t.name}: ${from.name} → ${to.name}`);
      },
    });
  }

  readonly visibleNurses = computed(() => {
    const q = this.search().trim().toLowerCase();
    let rows = this.effectiveNurses().filter((n) => !q || n.name.toLowerCase().includes(q));
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

  /** Same Case Explorer used by every graph/KPI drill — consistent look, not a separate summary drawer. */
  openNurse(n: NurseRow) {
    const lob = this.lobFilter.value();
    const scope = lob === 'all' ? '' : ` · ${lob}`;
    const cases = CASE_POOL.filter((c) => c.phase === 'pending' && c.nurse === n.name && (lob === 'all' || lobOf(c.authId) === lob));
    this.ix.openExplorer({
      title: `${n.name}${scope}`,
      context: `${cases.length} pending authorization(s) assigned${scope} · ${n.utilization}% utilized`,
      columns: COLUMNS,
      rows: cases.map(toRow),
      exportName: `nurse-${n.name.split(',')[0].toLowerCase()}_2026-07-17`,
      memberColumn: 1,
    });
  }

  /** The "Pending" column — the subset of this nurse's active work awaiting an external response. */
  openNursePending(n: NurseRow) {
    const lob = this.lobFilter.value();
    const scope = lob === 'all' ? '' : ` · ${lob}`;
    const cases = CASE_POOL.filter((c) => c.phase === 'pending' && c.nurse === n.name && (c.tags.includes('rfi') || c.tags.includes('p2p')) && (lob === 'all' || lobOf(c.authId) === lob));
    this.ix.openExplorer({
      title: `${n.name} — Pending External Response${scope}`,
      context: `${cases.length} authorization(s) awaiting RFI or peer-to-peer response${scope}`,
      columns: COLUMNS,
      rows: cases.map(toRow),
      exportName: `nurse-${n.name.split(',')[0].toLowerCase()}-pending_2026-07-17`,
      memberColumn: 1,
    });
  }

  /** The "Completed (MTD)" and "Avg TAT" columns — this nurse's decided authorizations. */
  openNurseCompleted(n: NurseRow) {
    const lob = this.lobFilter.value();
    const scope = lob === 'all' ? '' : ` · ${lob}`;
    const cases = CASE_POOL.filter((c) => c.phase === 'decided' && c.nurse === n.name && (lob === 'all' || lobOf(c.authId) === lob));
    this.ix.openExplorer({
      title: `${n.name} — Completed (MTD)${scope}`,
      context: `${cases.length} authorization(s) decided this month${scope}`,
      columns: COLUMNS,
      rows: cases.map(toRow),
      exportName: `nurse-${n.name.split(',')[0].toLowerCase()}-completed_2026-07-17`,
      memberColumn: 1,
    });
  }

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
      title: 'Reassign authorizations',
      cases, nurses,
      apply: (ids, target) => {
        ids.forEach((id) => {
          const cs = cases.find((x) => x.authId === id);
          this.data.moveOneCase(cs && cs.owner !== 'Unassigned' ? cs.owner : null, target);
        });
        this.ix.toast(`${ids.length} authorization(s) reassigned to ${target}.`);
        this.data.addHistory('swap', 'Authorizations reassigned', `${ids.length} authorization(s) → ${target}`);
      },
    });
  }

  balance() { this.bal.run(); }

  private ageLabel(h: number) { return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`; }

  /** Drill a queue's age band -> Case Explorer of the unclaimed authorizations in it (optionally scoped to one LOB). */
  openBucket(queue: string, band: string, lob?: string) {
    const labels: Record<string, string> = { fresh: '0–24h in queue', day2: '24–48h in queue', over48: '>48h in queue', breach: 'Breach (past SLA)' };
    const rows = CASE_POOL
      .filter((c) => c.phase === 'pending' && c.status === queue && c.nurse === '—' && (!lob || lobOf(c.authId) === lob) && bandOf(c.authId, c.tags.includes('breached')) === band)
      .map((c) => [c.authId, c.member, c.procedure, c.provider, urgencyOf(c), this.ageLabel(ageH(c.authId))] as (string | number)[]);
    const scopeLabel = lob ? `${queue} · ${lob}` : queue;
    this.ix.openExplorer({
      title: `${scopeLabel} — ${labels[band]}`,
      context: `${rows.length} unclaimed authorization(s) in ${scopeLabel} · ${labels[band]}`,
      columns: ['Auth ID', 'Member', 'Procedure', 'Provider', 'Urgency', 'Age in Queue'],
      rows, exportName: `${scopeLabel.toLowerCase().replace(/[^a-z]+/g, '-')}-${band}_2026-07-17`, memberColumn: 1,
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
      title: 'Escalate authorizations',
      candidates,
      targets: ESCALATE_TARGETS,
      apply: (ids, who) => {
        ids.forEach((id) => this.data.resolveRiskCase(id));
        this.ix.toast(`${ids.length} authorization(s) escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Authorizations escalated', `${ids.length} authorization(s) → ${who}`);
      },
    });
  }

  reassignTo(n: NurseRow) {
    this.ix.ask({
      title: `Reassign an authorization to ${n.name}`,
      body: `Move one authorization from the busiest nurse to ${n.name} (currently ${n.utilization}% utilized)?`,
      confirmLabel: 'Reassign', tone: 'teal',
      onConfirm: () => {
        this.data.reassignTo(n.name);
        this.ix.toast(`Authorization reassigned to ${n.name}.`);
        this.data.addHistory('swap', 'Authorization reassigned', `Reassigned to ${n.name}`);
      },
    });
  }

  /** All reassign/balance activity this session — same view as the Case Explorer's, scoped separately here for convenience. */
  openAssignmentHistory() {
    const rows = this.data.assignmentHistory();
    this.ix.openDrawer({
      title: 'Assignment History',
      subtitle: `${rows.length} reassignment${rows.length === 1 ? '' : 's'} & balance event${rows.length === 1 ? '' : 's'} this session`,
      table: rows.length ? { columns: ['Time', 'Action', 'Detail'], rows: rows.map((h) => [h.time, h.action, h.detail]) } : undefined,
      note: rows.length ? undefined : 'No authorizations have been reassigned or balanced yet this session.',
    });
  }
}
