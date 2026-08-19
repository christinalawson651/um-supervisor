import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icon } from '../shared/icon';
import { Donut, Segment } from '../shared/charts';
import { Exporter } from '../shared/exporter';
import { Interaction } from '../shared/interaction';
import {
  UM_NURSE_ROSTER, SchedulePeriod, AdherenceStatus, NurseWeekSchedule, NurseShiftDay, NurseWeekBlock, NurseAdherenceDay,
  UM_WEEK_SCHEDULES, UM_ADHERENCE, UM_ROLLING_4_WEEKS, UM_MONTHLY_WEEKS, UM_UPCOMING_WEEKS,
  UM_PTO_BALANCES, UM_TODAY_ISO,
} from '../data/um-schedule';

// Same "period + team slice and dice" shape as CM's Scheduling & Adherence tab (cm-dashboard.ts) —
// a standalone tab component here (not inline in shell.ts) since UM's tab system renders each tab
// as its own component (see shell.html's inner @switch), unlike CM/Appeals' single-file pattern.
@Component({
  selector: 'app-scheduling-tab',
  standalone: true,
  imports: [Icon, Donut, FormsModule],
  template: `
    <div class="tab-head">
      <h2>Scheduling &amp; Adherence</h2>
      <div class="flex gap-8 center">
        <label class="sortsel">
          <span>Team</span>
          <select [value]="teamFilter()" (change)="teamFilter.set($any($event.target).value)">
            <option value="all">All Teams</option>
            @for (t of teamNames; track t) { <option [value]="t">{{ t }}</option> }
          </select>
        </label>
        <div class="seg-toggle">
          <button [class.on]="period() === 'daily'" (click)="period.set('daily')">Daily</button>
          <button [class.on]="period() === 'weekly'" (click)="period.set('weekly')">Weekly</button>
          <button [class.on]="period() === 'rolling4'" (click)="period.set('rolling4')">Rolling 4 Weeks</button>
          <button [class.on]="period() === 'monthly'" (click)="period.set('monthly')">Monthly</button>
        </div>
      </div>
    </div>

    <div class="cp-grid">
      <div class="cp-tile clk" (click)="openAllAdherence()">
        <div class="cp-icon green"><z-icon name="check" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ adherenceRate() }}%</div><div class="cp-lab">Adherence Rate</div><div class="pbar"><span [style.width.%]="adherenceRate()"></span></div></div>
      </div>
      <div class="cp-tile clk" (click)="openExceptions()">
        <div class="cp-icon amber"><z-icon name="alert" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ exceptions().length }}</div><div class="cp-lab">Exceptions</div></div>
      </div>
      <div class="cp-tile clk" (click)="openScheduledNurses()">
        <div class="cp-icon blue"><z-icon name="users" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ scheduledCount() }}</div><div class="cp-lab">Nurses Scheduled</div></div>
      </div>
      <div class="cp-tile clk" (click)="openPtoDays()">
        <div class="cp-icon teal"><z-icon name="calendar" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ ptoDaysForPeriod() }}</div><div class="cp-lab">PTO Days ({{ periodLabel() }})</div></div>
      </div>
      <div class="cp-tile clk" (click)="openUpcomingPto()">
        <div class="cp-icon amber"><z-icon name="calendar" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ upcomingPto().length }}</div><div class="cp-lab">Upcoming PTO (Next 3 Weeks)</div></div>
      </div>
    </div>

    @if (period() === 'weekly' || period() === 'daily') {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="pt">{{ periodLabel() }}'s Schedule</h3><button class="btn outline sm" (click)="exportSchedule()">Export</button></div>
      <table class="z-table sched-table">
        <thead><tr><th>Nurse</th><th>Team</th>
          @if (period() === 'weekly') { @for (d of weekDayLabels; track d) { <th>{{ d }}</th> } }
          @else { <th>Today</th> }
        </tr></thead>
        <tbody>
        @for (w of scheduleRows(); track w.nurse) {
          <tr><td class="strong">{{ w.nurse }}</td><td>{{ w.team }}</td>
            @if (period() === 'weekly') {
              @for (d of w.days; track d.date) {
                <td><span class="shift-chip" [attr.data-type]="d.type">{{ d.type === 'Off' ? '—' : d.type === 'PTO' ? 'PTO' : d.start + '–' + d.end }}</span></td>
              }
            } @else {
              @let today = todayDayOf(w);
              <td><span class="shift-chip" [attr.data-type]="today.type">{{ today.type === 'Off' ? '—' : today.type === 'PTO' ? 'PTO' : today.start + '–' + today.end }}</span></td>
            }
          </tr>
        }
        </tbody>
      </table>
    </div>
    } @else {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="pt">{{ periodLabel() }} Schedule Summary</h3><button class="btn outline sm" (click)="exportSchedule()">Export</button></div>
      <table class="z-table sched-table">
        <thead><tr><th>Nurse</th><th>Team</th>@for (w of weekBlocks(); track w.weekOffset) { <th>Week of {{ w.weekStart }}</th> }</tr></thead>
        <tbody>
        @for (row of weekRollup(); track row.nurse) {
          <tr><td class="strong">{{ row.nurse }}</td><td>{{ row.team }}</td>
            @for (w of row.weeks; track w.weekStart) { <td>{{ w.shifts }} shifts{{ w.pto ? ' · ' + w.pto + ' PTO' : '' }}</td> }
          </tr>
        }
        </tbody>
      </table>
    </div>
    }

    <div class="cp-donut-row mt-6">
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="pt">Adherence Breakdown</h3></div>
        <div class="panel-pad" style="padding-top:0">
          <z-donut [segments]="adherenceDonutSegments()" [centerValue]="adherenceRateLabel()" centerLabel="On Time" [clickable]="true" (segClick)="onSegClick($event)"></z-donut>
        </div>
      </div>
      <div class="panel">
        <div class="panel-pad tbl-head">
          <h3 class="pt">{{ statusFilter() === 'all' ? 'Exceptions' : statusFilter() }} ({{ searchedAdherence().length }})</h3>
          <div class="flex gap-8 center">
            <input class="search sm" type="text" placeholder="Search nurse…" [ngModel]="adherenceSearch()" (ngModelChange)="adherenceSearch.set($event)" />
            @if (statusFilter() !== 'all') { <button class="btn outline sm" (click)="statusFilter.set('all')">Show Exceptions</button> }
          </div>
        </div>
        <table class="z-table">
          <thead><tr><th>Nurse</th><th>Day</th><th>Scheduled</th><th>Actual</th><th>Status</th><th>Variance</th></tr></thead>
          <tbody>
          @for (a of searchedAdherence(); track a.nurse + a.date) {
            <tr><td class="strong">{{ a.nurse }}</td><td>{{ a.day }}</td><td>{{ a.scheduledStart }}–{{ a.scheduledEnd }}</td>
              <td>{{ a.actualStart ?? '—' }}{{ a.actualEnd ? '–' + a.actualEnd : '' }}</td>
              <td><span class="badge" [class.red]="a.status==='Absence'" [class.amber]="a.status==='Late Start' || a.status==='Early Leave'" [class.blue]="a.status==='Overtime'" [class.green]="a.status==='On Time'">{{ a.status }}</span></td>
              <td>{{ a.varianceMin === 0 ? '—' : (a.varianceMin > 0 ? '+' : '') + a.varianceMin + 'm' }}</td></tr>
          } @empty { <tr><td colspan="6" class="empty">No records for this filter.</td></tr> }
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="pt">Adherence &amp; PTO by Nurse</h3><button class="btn outline sm" (click)="exportPtoBalances()">Export</button></div>
      <table class="z-table">
        <thead><tr><th>Nurse</th><th>Team</th><th>Adherence Rate ({{ periodLabel() }})</th><th>PTO Accrued (YTD)</th><th>PTO Used</th><th>PTO Remaining</th></tr></thead>
        <tbody>
        @for (p of nurseSummaryRows(); track p.nurse) {
          <tr><td class="strong">{{ p.nurse }}</td><td>{{ p.team }}</td>
            <td><span class="badge" [class.red]="p.adherenceRate < 70" [class.amber]="p.adherenceRate >= 70 && p.adherenceRate < 90" [class.green]="p.adherenceRate >= 90">{{ p.adherenceRate }}%</span></td>
            <td>{{ p.accruedDays }}d</td><td>{{ p.usedDays }}d</td>
            <td><span class="badge" [class.red]="p.remainingDays <= 2" [class.amber]="p.remainingDays > 2 && p.remainingDays <= 5" [class.green]="p.remainingDays > 5">{{ p.remainingDays }}d</span></td></tr>
        }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .tab-head { flex-wrap: wrap; row-gap: 8px; }
    .flex { display:flex; } .gap-8 { gap:8px; } .center { align-items:center; }
    .sortsel { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .sortsel select { font-size:12.5px; font-weight:500; color:var(--ink); text-transform:none; letter-spacing:0; padding:6px 8px; border:1px solid var(--gray-300); border-radius:8px; background:#fff; cursor:pointer; }
    .seg-toggle { display: inline-flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; }
    .seg-toggle button { border:none; background:#fff; padding:7px 14px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .seg-toggle button.on { background:var(--teal-700); color:#fff; }
    .clk { cursor:pointer; }
    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:190px; outline:none; }
    .search:focus { border-color:var(--teal-600); }
    .search.sm { width:160px; padding:5px 10px; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 4px; }
    .empty { text-align:center; color:var(--gray-500); padding:22px; }
    .cp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px,1fr)); gap:14px; }
    .cp-tile { display:flex; gap:12px; align-items:flex-start; background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; transition: box-shadow .12s, transform .12s; }
    .cp-tile:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); transform: translateY(-1px); }
    .cp-icon { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:0 0 36px; }
    .cp-icon.teal { background:var(--teal-50); color:var(--teal-700); }
    .cp-icon.amber { background:var(--amber-bg); color:var(--amber-fg); }
    .cp-icon.red { background:var(--red-bg); color:var(--red-fg); }
    .cp-icon.green { background:var(--green-bg); color:var(--green-fg); }
    .cp-icon.blue { background:#eff6ff; color:#2563eb; }
    .cp-icon.gray { background:var(--gray-100); color:var(--gray-500); }
    .cp-body { flex:1; min-width:0; }
    .cp-val { font-size:22px; font-weight:700; color:var(--ink); line-height:1.15; }
    .cp-lab { font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; margin-top:2px; }
    .cp-body .pbar { margin-top:8px; }
    .cp-donut-row { display:grid; grid-template-columns:repeat(2, 1fr); gap:14px; align-items:start; }
    @media (max-width: 900px) { .cp-donut-row { grid-template-columns:1fr; } }
    .sched-table th, .sched-table td { text-align:center; }
    .sched-table th:first-child, .sched-table td:first-child, .sched-table th:nth-child(2), .sched-table td:nth-child(2) { text-align:left; }
    .shift-chip { display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:600; white-space:nowrap; }
    .shift-chip[data-type="Day"] { background:#eff6ff; color:#2563eb; }
    .shift-chip[data-type="Evening"] { background:#f3e8ff; color:#7e22ce; }
    .shift-chip[data-type="Off"] { background:var(--gray-100); color:var(--gray-400); }
    .shift-chip[data-type="PTO"] { background:var(--amber-bg); color:var(--amber-fg); }
  `],
})
export class SchedulingTab {
  private exporter = inject(Exporter);
  private ix = inject(Interaction);

  readonly weekDayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly teamNames = [...new Set(UM_NURSE_ROSTER.map((n) => n.team))];
  readonly teamFilter = signal('all');
  private team = computed(() => this.teamFilter() === 'all' ? undefined : this.teamFilter());
  readonly period = signal<SchedulePeriod>('weekly');
  readonly periodLabel = computed(() => {
    const p = this.period();
    return p === 'daily' ? 'Today' : p === 'weekly' ? 'This Week' : p === 'rolling4' ? 'Rolling 4 Weeks' : 'Monthly (~5 Weeks)';
  });
  private nurseTeamOf(name: string): string | undefined { return UM_NURSE_ROSTER.find((n) => n.name === name)?.team; }
  readonly scheduledCount = computed(() => UM_NURSE_ROSTER.filter((n) => !this.team() || n.team === this.team()).length);
  readonly scheduleRows = computed(() => {
    const team = this.team();
    return team ? UM_WEEK_SCHEDULES.filter((w) => w.team === team) : UM_WEEK_SCHEDULES;
  });
  todayDayOf(w: NurseWeekSchedule): NurseShiftDay { return w.days.find((d) => d.date === UM_TODAY_ISO) ?? w.days[0]; }
  readonly weekBlocks = computed((): NurseWeekBlock[] => {
    const p = this.period();
    if (p === 'rolling4') return UM_ROLLING_4_WEEKS;
    if (p === 'monthly') return UM_MONTHLY_WEEKS;
    return [{ weekOffset: 0, weekStart: UM_TODAY_ISO, schedules: UM_WEEK_SCHEDULES, adherence: UM_ADHERENCE }];
  });
  readonly weekRollup = computed(() => {
    const team = this.team();
    return UM_NURSE_ROSTER.filter((n) => !team || n.team === team).map((n) => ({
      nurse: n.name, team: n.team,
      weeks: this.weekBlocks().map((b) => {
        const sched = b.schedules.find((s) => s.nurse === n.name);
        const shifts = sched ? sched.days.filter((d) => d.type === 'Day' || d.type === 'Evening').length : 0;
        const pto = sched ? sched.days.filter((d) => d.type === 'PTO').length : 0;
        return { weekStart: b.weekStart, shifts, pto };
      }),
    }));
  });
  private adherenceForPeriod(): NurseAdherenceDay[] {
    const all = this.period() === 'daily' ? UM_ADHERENCE.filter((a) => a.date === UM_TODAY_ISO) : this.weekBlocks().flatMap((b) => b.adherence);
    const team = this.team();
    return team ? all.filter((a) => a.team === team) : all;
  }
  readonly adherenceRate = computed(() => {
    const recs = this.adherenceForPeriod();
    const total = recs.length || 1;
    return Math.round((recs.filter((a) => a.status === 'On Time').length / total) * 100);
  });
  readonly adherenceRateLabel = computed(() => `${this.adherenceRate()}%`);
  readonly exceptions = computed(() => this.adherenceForPeriod().filter((a) => a.status !== 'On Time'));
  readonly breakdown = computed(() => {
    const recs = this.adherenceForPeriod();
    const statuses: AdherenceStatus[] = ['On Time', 'Late Start', 'Early Leave', 'Overtime', 'Absence'];
    return statuses.map((status) => ({ status, count: recs.filter((a) => a.status === status).length }));
  });
  readonly statusFilter = signal<AdherenceStatus | 'all'>('all');
  readonly filteredAdherence = computed(() => {
    const f = this.statusFilter();
    return f === 'all' ? this.exceptions() : this.adherenceForPeriod().filter((a) => a.status === f);
  });
  private readonly ADHERENCE_COLORS: Record<AdherenceStatus, string> = { 'On Time': '#10b981', 'Late Start': '#f59e0b', 'Early Leave': '#f97316', 'Overtime': '#3b82f6', 'Absence': '#ef4444' };
  readonly adherenceDonutSegments = computed((): Segment[] => this.breakdown().map((b) => ({ label: b.status, value: b.count, color: this.ADHERENCE_COLORS[b.status] })));
  readonly adherenceSearch = signal('');
  readonly searchedAdherence = computed(() => {
    const q = this.adherenceSearch().trim().toLowerCase();
    const rows = this.filteredAdherence();
    return q ? rows.filter((a) => a.nurse.toLowerCase().includes(q) || a.day.toLowerCase().includes(q) || a.status.toLowerCase().includes(q)) : rows;
  });
  private readonly ADHERENCE_ROW_COLUMNS = ['Nurse', 'Day', 'Scheduled', 'Actual', 'Status', 'Variance'];
  private adherenceRow(a: NurseAdherenceDay): (string | number)[] {
    return [a.nurse, a.day, `${a.scheduledStart}–${a.scheduledEnd}`, a.actualStart ? `${a.actualStart}–${a.actualEnd}` : '—', a.status, a.varianceMin === 0 ? '—' : (a.varianceMin > 0 ? '+' : '') + a.varianceMin + 'm'];
  }
  private openScheduleExplorer(title: string, columns: string[], rows: (string | number)[][], exportSlug: string, context?: string) {
    this.ix.openExplorer({ title, context: context ?? `${rows.length} record(s)`, columns, rows, exportName: `um-schedule-${exportSlug}_2026-07-17` });
  }
  openAllAdherence() {
    const rows = this.adherenceForPeriod().map((a) => this.adherenceRow(a));
    this.openScheduleExplorer(`Adherence — ${this.periodLabel()}`, this.ADHERENCE_ROW_COLUMNS, rows, 'all-adherence');
  }
  openExceptions() {
    const rows = this.exceptions().map((a) => this.adherenceRow(a));
    this.openScheduleExplorer(`Exceptions — ${this.periodLabel()}`, this.ADHERENCE_ROW_COLUMNS, rows, 'exceptions');
  }
  openScheduledNurses() {
    const team = this.team();
    const counts = new Map<string, { shifts: number; pto: number }>();
    const schedules = this.period() === 'daily' ? UM_WEEK_SCHEDULES : this.weekBlocks().flatMap((b) => b.schedules);
    schedules.forEach((s) => {
      if (team && s.team !== team) return;
      const rec = counts.get(s.nurse) ?? { shifts: 0, pto: 0 };
      s.days.forEach((d) => {
        if (this.period() === 'daily' && d.date !== UM_TODAY_ISO) return;
        if (d.type === 'Day' || d.type === 'Evening') rec.shifts++;
        if (d.type === 'PTO') rec.pto++;
      });
      counts.set(s.nurse, rec);
    });
    const rows = this.nurseSummaryRows().map((p) => {
      const c = counts.get(p.nurse) ?? { shifts: 0, pto: 0 };
      return [p.nurse, p.team, c.shifts, c.pto, `${p.adherenceRate}%`];
    });
    this.openScheduleExplorer(`Nurses Scheduled — ${this.periodLabel()}`, ['Nurse', 'Team', 'Scheduled Shifts', 'PTO Days', 'Adherence Rate'], rows, 'scheduled');
  }
  openPtoDays() {
    const team = this.team();
    const schedules = this.period() === 'daily' ? UM_WEEK_SCHEDULES : this.weekBlocks().flatMap((b) => b.schedules);
    const filtered = team ? schedules.filter((s) => s.team === team) : schedules;
    const rows: (string | number)[][] = [];
    filtered.forEach((s) => s.days.forEach((d) => {
      if (d.type !== 'PTO') return;
      if (this.period() === 'daily' && d.date !== UM_TODAY_ISO) return;
      rows.push([s.nurse, s.team, d.day, d.date]);
    }));
    this.openScheduleExplorer(`PTO Days — ${this.periodLabel()}`, ['Nurse', 'Team', 'Day', 'Date'], rows, 'pto-days');
  }
  openUpcomingPto() {
    const rows = this.upcomingPto().map((p) => [p.nurse, p.date, p.day]);
    this.openScheduleExplorer('Upcoming PTO (Next 3 Weeks)', ['Nurse', 'Date', 'Day'], rows, 'upcoming-pto');
  }
  onSegClick(s: Segment) {
    this.statusFilter.set(s.label as AdherenceStatus);
    const rows = this.adherenceForPeriod().filter((a) => a.status === s.label).map((a) => this.adherenceRow(a));
    this.openScheduleExplorer(`${s.label} — ${this.periodLabel()}`, this.ADHERENCE_ROW_COLUMNS, rows, `status-${s.label.toLowerCase().replace(/\s+/g, '-')}`);
  }
  readonly ptoDaysForPeriod = computed(() => {
    const team = this.team();
    const schedules = (this.period() === 'daily' ? UM_WEEK_SCHEDULES : this.weekBlocks().flatMap((b) => b.schedules))
      .filter((s) => !team || s.team === team);
    return schedules.reduce((sum, s) => sum + s.days.filter((d) => d.type === 'PTO' && (this.period() !== 'daily' || d.date === UM_TODAY_ISO)).length, 0);
  });
  readonly upcomingPto = computed(() => {
    const team = this.team();
    const out: { nurse: string; date: string; day: string }[] = [];
    UM_UPCOMING_WEEKS.forEach((block) => block.schedules.forEach((s) => {
      if (team && s.team !== team) return;
      s.days.forEach((d) => { if (d.type === 'PTO' && d.date >= UM_TODAY_ISO) out.push({ nurse: s.nurse, date: d.date, day: d.day }); });
    }));
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });
  readonly nurseSummaryRows = computed(() => {
    const team = this.team();
    const byNurse = new Map<string, NurseAdherenceDay[]>();
    this.adherenceForPeriod().forEach((a) => { if (!byNurse.has(a.nurse)) byNurse.set(a.nurse, []); byNurse.get(a.nurse)!.push(a); });
    const balances = new Map(UM_PTO_BALANCES.map((p) => [p.nurse, p]));
    return UM_NURSE_ROSTER.filter((n) => !team || n.team === team).map((n) => {
      const mine = byNurse.get(n.name) ?? [];
      const rate = mine.length ? Math.round((mine.filter((r) => r.status === 'On Time').length / mine.length) * 100) : 100;
      const bal = balances.get(n.name);
      return { nurse: n.name, team: n.team, adherenceRate: rate, accruedDays: bal?.accruedDays ?? 0, usedDays: bal?.usedDays ?? 0, remainingDays: bal?.remainingDays ?? 0 };
    });
  });
  exportSchedule() {
    if (this.period() === 'weekly' || this.period() === 'daily') {
      const rows = this.scheduleRows().map((w) => [w.nurse, w.team, ...w.days.map((d) => (d.type === 'Off' ? '—' : d.type === 'PTO' ? 'PTO' : `${d.start}–${d.end}`))]);
      this.exporter.open({ title: `${this.periodLabel()}'s Schedule`, name: 'um-schedule_2026-07-17', columns: ['Nurse', 'Team', ...this.weekDayLabels], rows });
      return;
    }
    const rows = this.weekRollup().map((r) => [r.nurse, r.team, ...r.weeks.map((w) => `${w.shifts} shifts${w.pto ? ` · ${w.pto} PTO` : ''}`)]);
    this.exporter.open({ title: `${this.periodLabel()} Schedule Summary`, name: 'um-schedule-summary_2026-07-17',
      columns: ['Nurse', 'Team', ...this.weekBlocks().map((b) => `Week of ${b.weekStart}`)], rows });
  }
  exportPtoBalances() {
    this.exporter.open({ title: 'Adherence & PTO by Nurse', name: 'um-adherence-pto_2026-07-17',
      columns: ['Nurse', 'Team', 'Adherence Rate %', 'PTO Accrued (YTD)', 'PTO Used', 'PTO Remaining'],
      rows: this.nurseSummaryRows().map((p) => [p.nurse, p.team, p.adherenceRate, p.accruedDays, p.usedDays, p.remainingDays]) });
  }
}
