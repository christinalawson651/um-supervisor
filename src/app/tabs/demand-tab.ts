import { Component, computed, inject } from '@angular/core';
import { signal } from '@angular/core';
import { Icon } from '../shared/icon';
import { Trend } from '../shared/charts';
import { Exporter } from '../shared/exporter';
import { DashboardData } from '../data/dashboard-data';
import { CASE_POOL } from '../data/case-pool';
import { TODAY } from '../data/case-fields';
import { UM_NURSE_ROSTER } from '../data/um-schedule';

// Same "weekly volume + trailing-average projection + capacity coverage" shape as CM's Demand &
// Forecasting tab, using UM's own real intake dates (CaseRec.submitted) instead of a fabricated
// series — UM's case pool already has genuine historical submission dates, unlike Appeals' 8
// hand-authored records.
const CAPACITY_PER_NURSE = 25; // nominal active-authorization capacity per nurse

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function mondayOf(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }

@Component({
  selector: 'app-demand-tab',
  standalone: true,
  imports: [Icon, Trend],
  template: `
    <div class="tab-head">
      <h2>Demand &amp; Forecasting</h2>
      <label class="sortsel">
        <span>Team</span>
        <select [value]="teamFilter()" (change)="teamFilter.set($any($event.target).value)">
          <option value="all">All Teams</option>
          @for (t of teamNames; track t) { <option [value]="t">{{ t }}</option> }
        </select>
      </label>
    </div>
    <div class="cp-grid">
      <div class="cp-tile">
        <div class="cp-icon blue"><z-icon name="inbox" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ forecast().history[forecast().history.length - 1].count }}</div><div class="cp-lab">Submissions This Week (to date)</div></div>
      </div>
      <div class="cp-tile">
        <div class="cp-icon teal"><z-icon name="barchart" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ forecast().projected }}</div><div class="cp-lab">Projected Next Week</div></div>
      </div>
      <div class="cp-tile">
        <div class="cp-icon gray"><z-icon name="users" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ forecast().teamCapacity }}</div><div class="cp-lab">{{ teamFilter() === 'all' ? 'Total Nurse Capacity' : 'Caseload Headroom' }}</div></div>
      </div>
      <div class="cp-tile">
        <div class="cp-icon" [class.red]="forecast().overCapacity" [class.green]="!forecast().overCapacity"><z-icon [name]="forecast().overCapacity ? 'alert' : 'check'" [size]="18"></z-icon></div>
        <div class="cp-body"><div class="cp-val">{{ forecast().overCapacity ? 'At Risk' : 'Adequate' }}</div><div class="cp-lab">Coverage Outlook</div></div>
      </div>
    </div>

    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="pt">Weekly Submission Volume (8 Weeks){{ teamFilter() === 'all' ? '' : ' — ' + teamFilter() }}</h3><button class="btn outline sm" (click)="exportDemand()">Export</button></div>
      <div class="panel-pad" style="padding-top:0">
        <z-trend [points]="trendPoints()" [labels]="trendLabels()" color="#0d9488"></z-trend>
      </div>
    </div>

    <div class="qhint mt-6">
      Projection is a trailing 4-week average of completed weeks (excludes the current partial week), bucketed from each authorization's actual submission date.
      @if (teamFilter() === 'all') { Total Nurse Capacity is the nominal active-authorization load all {{ UM_NURSE_ROSTER.length }} nurses can carry at once. }
      @else { Caseload Headroom is how many more active authorizations {{ teamFilter() }} could take on right now (capacity minus current active). }
    </div>
  `,
  styles: [`
    .tab-head { display:flex; align-items:center; justify-content:space-between; }
    .sortsel { display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; }
    .sortsel select { font-size:12.5px; font-weight:500; color:var(--ink); text-transform:none; letter-spacing:0; padding:6px 8px; border:1px solid var(--gray-300); border-radius:8px; background:#fff; cursor:pointer; }
    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 4px; }
    .cp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px,1fr)); gap:14px; }
    .cp-tile { display:flex; gap:12px; align-items:flex-start; background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; }
    .cp-icon { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:0 0 36px; }
    .cp-icon.teal { background:var(--teal-50); color:var(--teal-700); }
    .cp-icon.gray { background:var(--gray-100); color:var(--gray-500); }
    .cp-icon.red { background:var(--red-bg); color:var(--red-fg); }
    .cp-icon.green { background:var(--green-bg); color:var(--green-fg); }
    .cp-icon.blue { background:#eff6ff; color:#2563eb; }
    .cp-body { flex:1; min-width:0; }
    .cp-val { font-size:22px; font-weight:700; color:var(--ink); line-height:1.15; }
    .cp-lab { font-size:11px; font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.03em; margin-top:2px; }
    .qhint { font-size:12px; color:var(--gray-500); background:var(--gray-50, #f9fafb); border:1px solid var(--border); border-radius:8px; padding:10px 14px; }
  `],
})
export class DemandTab {
  private exporter = inject(Exporter);
  private data = inject(DashboardData);
  readonly UM_NURSE_ROSTER = UM_NURSE_ROSTER;
  readonly teamNames = [...new Set(UM_NURSE_ROSTER.map((n) => n.team))];
  readonly teamFilter = signal('all');

  private nurseTeamOf(name: string): string | undefined { return UM_NURSE_ROSTER.find((n) => n.name === name)?.team; }

  readonly forecast = computed(() => {
    const team = this.teamFilter() === 'all' ? undefined : this.teamFilter();
    const weeksBack = 9;
    const thisMonday = mondayOf(TODAY);
    const buckets = Array.from({ length: weeksBack }, (_, i) => {
      const start = addDays(thisMonday, -(weeksBack - 1 - i) * 7);
      return { start, end: addDays(start, 6), count: 0 };
    });
    const cases = team ? CASE_POOL.filter((c) => this.nurseTeamOf(c.nurse) === team) : CASE_POOL;
    cases.forEach((c) => {
      const d = new Date(`${c.submitted}T00:00:00`);
      const b = buckets.find((bk) => d >= bk.start && d <= bk.end);
      if (b) b.count++;
    });
    const history = buckets.map((b) => ({ label: `${b.start.getMonth() + 1}/${b.start.getDate()}`, start: isoDate(b.start), count: b.count }));
    const complete = history.slice(0, -1);
    const recentBasis = complete.slice(-4).map((w) => w.count);
    const projected = recentBasis.length ? Math.round(recentBasis.reduce((s, v) => s + v, 0) / recentBasis.length) : 0;
    let teamCapacity: number;
    if (team) {
      const teamNurses = this.data.nurses().filter((n) => n.team === team);
      const active = teamNurses.reduce((s, n) => s + n.active, 0);
      teamCapacity = Math.max(0, teamNurses.length * CAPACITY_PER_NURSE - active);
    } else {
      teamCapacity = UM_NURSE_ROSTER.length * CAPACITY_PER_NURSE;
    }
    return { history, projected, teamCapacity, overCapacity: projected > teamCapacity };
  });
  readonly trendPoints = computed(() => this.forecast().history.map((h) => h.count));
  readonly trendLabels = computed(() => this.forecast().history.map((h) => h.label));
  exportDemand() {
    const f = this.forecast();
    const capacityLabel = this.teamFilter() === 'all' ? 'Total Nurse Capacity' : 'Caseload Headroom';
    this.exporter.open({ title: 'Demand & Forecasting', name: 'um-demand-forecast_2026-07-17',
      columns: ['Week Of', 'Submissions'], rows: f.history.map((h) => [h.start, h.count]),
      sections: [
        { label: 'Weekly Volume', name: 'um-demand-weekly_2026-07-17', columns: ['Week Of', 'Submissions'], rows: f.history.map((h) => [h.start, h.count]) },
        { label: 'Forecast Summary', name: 'um-demand-summary_2026-07-17', columns: ['Metric', 'Value'],
          rows: [['Projected Next Week', f.projected], [capacityLabel, f.teamCapacity], ['Over Capacity', f.overCapacity ? 'Yes' : 'No']] },
      ] });
  }
}
