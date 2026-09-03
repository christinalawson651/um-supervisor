import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KpiStrip, KpiItem } from '../shared/kpi-strip';
import { Ring } from '../shared/ring';
import { Donut, Segment, Trend } from '../shared/charts';
import { Icon } from '../shared/icon';
import { Members } from '../shared/members';
import { Interaction } from '../shared/interaction';
import { Nav } from '../shared/nav';
import { DashboardData } from '../data/dashboard-data';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Exporter } from '../shared/exporter';
import { Lookback } from '../shared/lookback';
import {
  APPEALS_REVIEWERS, SchedulePeriod, AdherenceStatus, ReviewerWeekSchedule, ReviewerShiftDay, ReviewerWeekBlock, ReviewerAdherenceDay,
  APPEALS_WEEK_SCHEDULES, APPEALS_ADHERENCE, APPEALS_ROLLING_4_WEEKS, APPEALS_MONTHLY_WEEKS,
  APPEALS_UPCOMING_WEEKS, APPEALS_PTO_BALANCES, APPEALS_TODAY_ISO, APPEALS_WEEK_START, appealsIsoDate, appealsAddDays,
} from '../data/appeals-schedule';

interface Appeal {
  appealId: string; auth: string; member: string; service: string;
  level: 'L1'|'L2'|'IRO'; status: string; statusTone: string;
  nba: string; nbaTone: string; tat: string; tatTone: string; assigned: string; aiConfidence: number; queue: string;
}
interface Reviewer { name: string; role: string; open: number; nearSla: number; overdue: number; overturnRate: number; utilization: number; }

// Tabs are keyed by a stable string id, not by array position — @switch(sel()) matches on
// TAB.key, so reordering this list never requires renumbering any @case block below (same
// convention as CM's cm-dashboard.ts TAB_DEFS).
//
// Audit & Compliance is deliberately ABSENT here. UM and CM both have real audit tabs now — IRR
// against a sampled re-determination, a scored documentation file review, per-LOB regulatory
// windows — all computed off their module's case pool. Appeals has no such pool: it runs on eight
// hand-authored appeal records and five reviewers, so there is nothing to sample, aggregate or
// drill into. The tab that used to sit here was three hardcoded percentages and three static flag
// rows, which is worse than no tab at all in front of an auditor.
//
// To build it for real, an appeals pool comes first — decided appeals across levels and lines of
// business, with acknowledgment and resolution clocks, reviewer credential and independence, and
// notice-content elements — and the tab on top of that, following tabs/cm-audit-tab.ts.
interface TabDef { key: string; label: string; }
const TAB_DEFS: TabDef[] = [
  { key: 'workforce', label: 'Workforce & Queue' },
  { key: 'schedule', label: 'Scheduling & Adherence' },
  { key: 'demand', label: 'Demand & Forecasting' },
  { key: 'tat', label: 'TAT & Deadline Compliance' },
  { key: 'determination', label: 'Determination Insights' },
  { key: 'risk', label: 'Risk & Escalation' },
  { key: 'level', label: 'Level & Aging' },
  { key: 'intake', label: 'Intake & Documentation' },
  { key: 'provider', label: 'Provider Patterns' },
  { key: 'overturn', label: 'Overturn Cost Impact' },
  { key: 'ai', label: 'AI / NextGen' },
];

@Component({
  selector: 'app-appeals-dashboard',
  standalone: true,
  imports: [KpiStrip, Ring, Donut, Trend, FormsModule, Icon],
  template: `
    <app-kpi-strip [items]="displayKpis()" />

    <nav class="subtabs">
      @for (t of tabs; track t.key) {
        <button class="subtab" [class.active]="sel() === t.key" (click)="sel.set(t.key)">{{ t.label }}</button>
      }
    </nav>

    @switch (sel()) {
      <!-- Workforce & Queue -->
      @case ('workforce') {
        <div class="tab-head"><h2>Appeals Worklist</h2><span class="section-note">Prioritized by smart priority — deadline &amp; risk weighted</span></div>
        <div class="wl-tools">
          <div class="pills">
            @for (f of filters; track f.key) {
              <button class="pill" [class.active]="filter() === f.key" (click)="filter.set(f.key)"><span class="pdot" [attr.data-tone]="f.tone"></span>{{ f.label }}<span class="pcount">{{ countFor(f.key) }}</span></button>
            }
          </div>
          <div class="flex gap-8 center">
            <input class="search" type="text" placeholder="Search appeals…" [ngModel]="apSearch()" (ngModelChange)="apSearch.set($event)" />
            <button class="btn outline sm" (click)="exportAppeals()">Export</button>
          </div>
        </div>
        <div class="panel"><table class="z-table">
          <thead><tr><th>Next Action</th>
            <th class="srt" (click)="sortAp('member')">Member{{ caretAp('member') }}</th>
            <th>Appeal · Auth</th>
            <th class="srt" (click)="sortAp('level')">Level{{ caretAp('level') }}</th>
            <th>Status</th><th>TAT</th><th>Assigned To</th></tr></thead>
          <tbody>@for (a of worklistRows(); track a.appealId) {
            <tr class="clk" (click)="open(a)"><td><span class="nba" [attr.data-tone]="a.nbaTone">{{ a.nba }}</span></td>
              <td><a class="ml" (click)="members.openByName(a.member); $event.stopPropagation()">{{ a.member }}</a></td>
              <td><span class="strong">{{ a.appealId }}</span><br><span class="sub">{{ a.auth }} · {{ a.service }}</span></td>
              <td><span class="lv" [attr.data-l]="a.level">{{ a.level }}</span></td>
              <td><span class="st" [attr.data-tone]="a.statusTone">{{ a.status }}</span></td>
              <td><span class="tat" [attr.data-tone]="a.tatTone">{{ a.tat }}</span></td><td>{{ a.assigned }}</td></tr>
          } @empty { <tr><td colspan="7" class="empty">No appeals in this queue.</td></tr> }</tbody>
        </table></div>
        <div class="panel mt-6"><div class="panel-pad tbl-head"><h3 class="pt">Workload per Reviewer</h3>
          <button class="btn outline sm" (click)="exportReviewers()">Export</button></div>
          <table class="z-table"><thead><tr><th class="srt" (click)="sortRv('name')">Reviewer{{ caretRv('name') }}</th>
            <th class="srt" (click)="sortRv('open')">Open{{ caretRv('open') }}</th>
            <th class="srt" (click)="sortRv('nearSla')">Near SLA{{ caretRv('nearSla') }}</th>
            <th class="srt" (click)="sortRv('overdue')">Overdue{{ caretRv('overdue') }}</th>
            <th class="srt" (click)="sortRv('overturnRate')">Overturn Rate{{ caretRv('overturnRate') }}</th>
            <th class="srt" (click)="sortRv('utilization')">Utilization{{ caretRv('utilization') }}</th></tr></thead>
          <tbody>@for (r of sortedReviewers(); track r.name) {
            <tr><td class="strong">{{ r.name }}<div class="sub">{{ r.role }}</div></td><td class="num">{{ r.open }}</td>
              <td><b [class.warn]="r.nearSla>0">{{ r.nearSla }}</b></td><td><b [class.hot]="r.overdue>0">{{ r.overdue }}</b></td>
              <td class="num">{{ r.overturnRate }}%</td>
              <td><span class="mini-bar" [class.teal]="r.utilization<80" [class.red]="r.utilization>=90"><span [style.width.%]="r.utilization"></span></span><span class="pct">{{ r.utilization }}%</span></td></tr>
          }</tbody></table></div>
      }

      <!-- TAT & Deadline Compliance -->
      @case ('tat') {
        <div class="tab-head"><h2>TAT &amp; Deadline Compliance</h2><span class="section-note">Regulatory deadline adherence</span></div>
        <div class="panel panel-pad"><div class="sla-grid">
          <div class="donut"><z-ring [value]="88" [size]="120" [thickness]="12" tone="teal"></z-ring><div class="dlab">On-Time Rate</div></div>
          <div class="rows">
            <div class="srow green"><span><i></i>On track</span><b>14</b></div>
            <div class="srow amber"><span><i></i>Near deadline (≤5d)</span><b>4</b></div>
            <div class="srow red"><span><i></i>Overdue</span><b>1</b></div>
          </div>
          <div class="stats">
            <div class="stat-box"><div class="val">9.2d</div><div class="lab">Avg Time Remaining</div></div>
            <div class="stat-box"><div class="val">30d</div><div class="lab">Standard TAT</div></div>
            <div class="stat-box"><div class="val">72h</div><div class="lab">Expedited TAT</div></div>
            <div class="stat-box"><div class="val">6.4d</div><div class="lab">Avg Decision Time</div></div>
          </div>
        </div></div>
      }

      <!-- Determination Insights -->
      @case ('determination') {
        <div class="tab-head"><h2>Determination Insights</h2><span class="section-note">Outcome mix and overturn drivers</span></div>
        <div class="dstats">
          <div class="dstat teal"><div class="dv">61%</div><div class="dl">Overturned</div></div>
          <div class="dstat gray"><div class="dv">31%</div><div class="dl">Upheld</div></div>
          <div class="dstat amber"><div class="dv">8%</div><div class="dl">Partial</div></div>
          <div class="dstat blue"><div class="dv">15%</div><div class="dl">MD Reviewed</div></div>
          <div class="dstat purple"><div class="dv">9%</div><div class="dl">Peer-to-Peer</div></div>
          <div class="dstat teal"><div class="dv">6.4d</div><div class="dl">Avg TAT</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Overturn Drivers (why appeals succeed)</h3></div>
          <table class="z-table"><thead><tr><th>Denial Category</th><th>Appeals</th><th>Overturn Rate</th><th>Top Reason</th></tr></thead>
          <tbody>@for (d of drivers; track d.cat) {
            <tr><td class="strong">{{ d.cat }}</td><td class="num">{{ d.count }}</td>
              <td><span class="rate-pill" [class.good]="d.rate>=60" [class.mid]="d.rate<60">{{ d.rate }}%</span></td><td>{{ d.reason }}</td></tr>
          }</tbody></table></div>
      }

      <!-- Risk & Escalation -->
      @case ('risk') {
        <div class="tab-head"><h2>Risk &amp; Escalation</h2><span class="section-note note-warn">Appeals at deadline or escalation risk</span></div>
        <div class="rtiles">
          <div class="rtile red"><div class="rl">Overdue</div><div class="rv">1</div><div class="rf">immediate action</div></div>
          <div class="rtile amber"><div class="rl">Near Deadline (≤5d)</div><div class="rv">4</div><div class="rf">expedite review</div></div>
          <div class="rtile blue"><div class="rl">Pending MD / P2P</div><div class="rv">2</div><div class="rf">physician review</div></div>
          <div class="rtile amber"><div class="rl">Pending Information</div><div class="rv">1</div><div class="rf">RFI · clock paused</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad tbl-head"><h3 class="pt">Cases Requiring Attention</h3><span class="section-note">Sorted by deadline</span></div>
          <table class="z-table"><thead><tr><th>Appeal</th><th>Member</th><th>Level</th><th>Status</th><th>TAT</th><th>Action</th></tr></thead>
          <tbody>@for (a of riskCases(); track a.appealId) {
            <tr><td class="strong">{{ a.appealId }}</td><td><a class="ml" (click)="members.openByName(a.member)">{{ a.member }}</a></td>
              <td><span class="lv" [attr.data-l]="a.level">{{ a.level }}</span></td><td><span class="st" [attr.data-tone]="a.statusTone">{{ a.status }}</span></td>
              <td><span class="tat" [attr.data-tone]="a.tatTone">{{ a.tat }}</span></td>
              <td><button class="btn outline teal sm" (click)="open(a)">Review</button></td></tr>
          }</tbody></table></div>
      }

      <!-- Level & Aging -->
      @case ('level') {
        <div class="tab-head"><h2>Level &amp; Aging</h2><span class="section-note">Volume &amp; aging by appeal level</span></div>
        <div class="dstats">
          <div class="dstat blue"><div class="dv">11</div><div class="dl">Level 1 (Internal)</div></div>
          <div class="dstat purple"><div class="dv">5</div><div class="dl">Level 2</div></div>
          <div class="dstat gray"><div class="dv">2</div><div class="dl">External (IRO)</div></div>
        </div>
        <div class="panel panel-pad mt-6"><h3 class="pt">Aging by Bucket</h3>
          <div class="bars">@for (b of aging; track b.label) {
            <div class="bar-row"><span class="bl">{{ b.label }}</span><span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span><span class="bv">{{ b.value }}</span></div>
          }</div></div>
      }

      <!-- Intake & Documentation -->
      @case ('intake') {
        <div class="tab-head"><h2>Intake &amp; Documentation</h2><span class="section-note">Appeal intake completeness</span></div>
        <div class="grid-3">
          <div class="panel panel-pad bar-block"><div class="bar-top">Complete Intake</div><div class="bar-val">83%</div><div class="pbar"><span style="width:83%"></span></div></div>
          <div class="panel panel-pad bar-block"><div class="bar-top">AI Auto-Extracted</div><div class="bar-val">71%</div><div class="pbar"><span style="width:71%"></span></div></div>
          <div class="panel panel-pad bar-block"><div class="bar-top">Needing RFI</div><div class="bar-val amber">17%</div><div class="pbar amber"><span style="width:17%"></span></div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Top Missing / Low-Confidence Fields</h3></div>
          <table class="z-table"><thead><tr><th>Field</th><th>Flagged</th><th>Avg AI Confidence</th></tr></thead>
          <tbody>@for (f of intakeFields; track f.field) {
            <tr><td class="strong">{{ f.field }}</td><td class="num">{{ f.count }}</td><td>{{ f.conf }}</td></tr>
          }</tbody></table></div>
      }

      <!-- Provider Patterns -->
      @case ('provider') {
        <div class="tab-head"><h2>Provider Appeal Patterns</h2><span class="section-note">Providers driving appeals &amp; overturns</span></div>
        <div class="panel"><table class="z-table">
          <thead><tr><th>Provider</th><th>Appeals</th><th>Overturn Rate</th><th>Top Service</th></tr></thead>
          <tbody>@for (p of providerPatterns; track p.provider) {
            <tr><td class="strong">{{ p.provider }}</td><td class="num">{{ p.count }}</td>
              <td><span class="rate-pill" [class.good]="p.rate<50" [class.mid]="p.rate>=50">{{ p.rate }}%</span></td><td>{{ p.service }}</td></tr>
          }</tbody></table></div>
      }

      <!-- Overturn Cost Impact -->
      @case ('overturn') {
        <div class="tab-head"><h2>Overturn Cost Impact</h2><span class="section-note">Financial impact of appeal determinations</span></div>
        <div class="grid-3">
          <div class="metric-tile"><div class="val">$0.2M</div><div class="lab">Cost Reinstated (overturns)</div></div>
          <div class="metric-tile"><div class="val">$0.9M</div><div class="lab">Denials Upheld (avoided)</div></div>
          <div class="metric-tile"><div class="val">$14k</div><div class="lab">Avg Overturn Value</div></div>
        </div>
        <div class="panel mt-6"><div class="panel-pad"><h3 class="pt">Highest-Value Determinations</h3></div>
          <table class="z-table"><thead><tr><th>Appeal</th><th>Member</th><th>Service</th><th>Value</th><th>Outcome</th></tr></thead>
          <tbody>@for (c of highValue; track c.appeal) {
            <tr><td class="strong">{{ c.appeal }}</td><td><a class="ml" (click)="members.openByName(c.member)">{{ c.member }}</a></td><td>{{ c.service }}</td>
              <td class="strong">{{ c.value }}</td><td><span class="badge" [class.teal]="c.outcome==='Overturned'" [class.gray]="c.outcome==='Upheld'">{{ c.outcome }}</span></td></tr>
          }</tbody></table></div>
      }

      <!-- Scheduling & Adherence -->
      @case ('schedule') {
        <div class="tab-head">
          <div><h2>Scheduling &amp; Adherence</h2><span class="section-note">Reviewer shift schedule, adherence, and PTO — {{ schedulePeriodLabel() }}</span></div>
          <div class="seg-toggle">
            <button [class.on]="schedulePeriod() === 'daily'" (click)="schedulePeriod.set('daily')">Daily</button>
            <button [class.on]="schedulePeriod() === 'weekly'" (click)="schedulePeriod.set('weekly')">Weekly</button>
            <button [class.on]="schedulePeriod() === 'rolling4'" (click)="schedulePeriod.set('rolling4')">Rolling 4 Weeks</button>
            <button [class.on]="schedulePeriod() === 'monthly'" (click)="schedulePeriod.set('monthly')">Monthly</button>
          </div>
        </div>

        <div class="cp-grid">
          <div class="cp-tile clk" (click)="openAllAdherence()">
            <div class="cp-icon green"><z-icon name="check" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ teamAdherenceRate() }}%</div><div class="cp-lab">Adherence Rate</div><div class="pbar"><span [style.width.%]="teamAdherenceRate()"></span></div></div>
          </div>
          <div class="cp-tile clk" (click)="openExceptions()">
            <div class="cp-icon amber"><z-icon name="alert" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ adherenceExceptions().length }}</div><div class="cp-lab">Exceptions</div></div>
          </div>
          <div class="cp-tile clk" (click)="openScheduledReviewers()">
            <div class="cp-icon blue"><z-icon name="user" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ APPEALS_REVIEWERS.length }}</div><div class="cp-lab">Reviewers Scheduled</div></div>
          </div>
          <div class="cp-tile clk" (click)="openPtoDays()">
            <div class="cp-icon teal"><z-icon name="calendar" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ ptoDaysForPeriod() }}</div><div class="cp-lab">PTO Days ({{ schedulePeriodLabel() }})</div></div>
          </div>
          <div class="cp-tile clk" (click)="openUpcomingPto()">
            <div class="cp-icon amber"><z-icon name="calendar" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ upcomingPto().length }}</div><div class="cp-lab">Upcoming PTO (Next 3 Weeks)</div></div>
          </div>
        </div>

        @if (schedulePeriod() === 'weekly' || schedulePeriod() === 'daily') {
        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">{{ schedulePeriodLabel() }}'s Schedule</h3><button class="btn outline sm" (click)="exportSchedule()">Export</button></div>
          <table class="z-table sched-table">
            <thead><tr><th>Reviewer</th><th>Role</th>
              @if (schedulePeriod() === 'weekly') { @for (d of weekDayLabels; track d) { <th>{{ d }}</th> } }
              @else { <th>Today</th> }
            </tr></thead>
            <tbody>
            @for (w of weekSchedules(); track w.reviewer) {
              <tr><td class="strong">{{ w.reviewer }}</td><td>{{ w.role }}</td>
                @if (schedulePeriod() === 'weekly') {
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
          <div class="panel-pad tbl-head"><h3 class="pt">{{ schedulePeriodLabel() }} Schedule Summary</h3><button class="btn outline sm" (click)="exportSchedule()">Export</button></div>
          <table class="z-table sched-table">
            <thead><tr><th>Reviewer</th><th>Role</th>@for (w of weekBlocks(); track w.weekOffset) { <th>Week of {{ w.weekStart }}</th> }</tr></thead>
            <tbody>
            @for (row of weekRollup(); track row.reviewer) {
              <tr><td class="strong">{{ row.reviewer }}</td><td>{{ row.role }}</td>
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
              <z-donut [segments]="adherenceDonutSegments()" [centerValue]="teamAdherenceRateLabel()" centerLabel="On Time" [clickable]="true" (segClick)="onAdherenceSegClick($event)"></z-donut>
            </div>
          </div>
          <div class="panel">
            <div class="panel-pad tbl-head">
              <h3 class="pt">{{ adherenceStatusFilter() === 'all' ? 'Exceptions' : adherenceStatusFilter() }} ({{ searchedAdherence().length }})</h3>
              <div class="flex gap-8 center">
                <input class="search sm" type="text" placeholder="Search reviewer…" [ngModel]="adherenceSearch()" (ngModelChange)="adherenceSearch.set($event)" />
                @if (adherenceStatusFilter() !== 'all') { <button class="btn outline sm" (click)="adherenceStatusFilter.set('all')">Show Exceptions</button> }
              </div>
            </div>
            <table class="z-table">
              <thead><tr><th>Reviewer</th><th>Day</th><th>Scheduled</th><th>Actual</th><th>Status</th><th>Variance</th></tr></thead>
              <tbody>
              @for (a of searchedAdherence(); track a.reviewer + a.date) {
                <tr><td class="strong">{{ a.reviewer }}</td><td>{{ a.day }}</td><td>{{ a.scheduledStart }}–{{ a.scheduledEnd }}</td>
                  <td>{{ a.actualStart ?? '—' }}{{ a.actualEnd ? '–' + a.actualEnd : '' }}</td>
                  <td><span class="badge" [class.red]="a.status==='Absence'" [class.amber]="a.status==='Late Start' || a.status==='Early Leave'" [class.blue]="a.status==='Overtime'" [class.green]="a.status==='On Time'">{{ a.status }}</span></td>
                  <td>{{ a.varianceMin === 0 ? '—' : (a.varianceMin > 0 ? '+' : '') + a.varianceMin + 'm' }}</td></tr>
              } @empty { <tr><td colspan="6" class="empty">No records for this filter.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Adherence &amp; PTO by Reviewer</h3><button class="btn outline sm" (click)="exportPtoBalances()">Export</button></div>
          <table class="z-table">
            <thead><tr><th>Reviewer</th><th>Role</th><th>Adherence Rate</th><th>PTO Accrued (YTD)</th><th>PTO Used</th><th>PTO Remaining</th></tr></thead>
            <tbody>
            @for (p of reviewerSummaryRows(); track p.reviewer) {
              <tr><td class="strong">{{ p.reviewer }}</td><td>{{ p.role }}</td>
                <td><span class="badge" [class.red]="p.adherenceRate < 70" [class.amber]="p.adherenceRate >= 70 && p.adherenceRate < 90" [class.green]="p.adherenceRate >= 90">{{ p.adherenceRate }}%</span></td>
                <td>{{ p.accruedDays }}d</td><td>{{ p.usedDays }}d</td>
                <td><span class="badge" [class.red]="p.remainingDays <= 2" [class.amber]="p.remainingDays > 2 && p.remainingDays <= 5" [class.green]="p.remainingDays > 5">{{ p.remainingDays }}d</span></td></tr>
            }
            </tbody>
          </table>
        </div>
      }

      <!-- Demand & Forecasting -->
      @case ('demand') {
        <div class="tab-head"><h2>Demand &amp; Forecasting</h2><span class="section-note">Appeal intake volume, projected demand, and capacity coverage</span></div>
        <div class="cp-grid">
          <div class="cp-tile clk" (click)="openWeeklyVolume()">
            <div class="cp-icon blue"><z-icon name="inbox" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ demandForecast().history[demandForecast().history.length - 1].count }}</div><div class="cp-lab">Appeals This Week (to date)</div></div>
          </div>
          <div class="cp-tile clk" (click)="openForecastBasis()">
            <div class="cp-icon teal"><z-icon name="barchart" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ demandForecast().projected }}</div><div class="cp-lab">Projected Next Week</div></div>
          </div>
          <div class="cp-tile clk" (click)="openReviewerCapacity()">
            <div class="cp-icon gray"><z-icon name="users" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ demandForecast().teamCapacity }}</div><div class="cp-lab">Reviewer Capacity</div></div>
          </div>
          <div class="cp-tile clk" (click)="openCoverageOutlook()">
            <div class="cp-icon" [class.red]="demandForecast().overCapacity" [class.green]="!demandForecast().overCapacity"><z-icon [name]="demandForecast().overCapacity ? 'alert' : 'check'" [size]="18"></z-icon></div>
            <div class="cp-body"><div class="cp-val">{{ demandForecast().overCapacity ? 'At Risk' : 'Adequate' }}</div><div class="cp-lab">Coverage Outlook</div></div>
          </div>
        </div>

        <div class="panel mt-6">
          <div class="panel-pad tbl-head"><h3 class="pt">Weekly Appeal Volume (8 Weeks)</h3><button class="btn outline sm" (click)="exportDemand()">Export</button></div>
          <div class="panel-pad" style="padding-top:0">
            <z-trend [points]="demandTrendPoints()" [labels]="demandTrendLabels()" color="#5B47E0"></z-trend>
          </div>
        </div>

        <div class="qhint mt-6">Projection is a trailing 4-week average of completed weeks (excludes the current partial week). Reviewer Capacity is the nominal appeal load {{ APPEALS_REVIEWERS.length }} reviewers can carry at once.</div>
      }

      <!-- AI / NextGen -->
      @case ('ai') {
        <div class="ai-shell">
          <div class="ai-head"><h2>AI / NextGen Intelligence</h2><span class="ai-pill">AI-Powered</span></div>
          <div class="recs">
            <div class="rec teal"><div class="rt">Likely Overturn — AP-2026-0112</div><div class="rd">4 of 5 clinical criteria now met with new evidence. AI confidence 94%.</div><button class="btn primary rbtn" (click)="toast('Determination drafted: Overturn — AP-2026-0112.')">Draft overturn</button></div>
            <div class="rec red"><div class="rt">Deadline Risk — AP-2025-0891</div><div class="rd">L1 appeal is overdue. Auto-prioritized to top of queue for immediate review.</div><button class="btn primary rbtn" (click)="toast('AP-2025-0891 escalated for immediate review.')">Escalate now</button></div>
            <div class="rec amber"><div class="rt">RFI Recommended — AP-2026-0088</div><div class="rd">Missing outpatient therapy records. Provider has 24h response history.</div><button class="btn primary rbtn" (click)="toast('RFI sent for AP-2026-0088.')">Send RFI</button></div>
          </div>
          <div class="ai-bottom">
            <div class="panel panel-pad"><h3 class="pt">Predictive Gauges</h3>
              <div class="gauges">
                <div class="g"><z-ring [value]="61" [size]="90" [thickness]="9" tone="teal" [fontSize]="18"></z-ring><div class="gl">Overturn Likelihood</div></div>
                <div class="g"><z-ring [value]="12" [size]="90" [thickness]="9" tone="red" [fontSize]="18"></z-ring><div class="gl">Deadline Breach Risk</div></div>
                <div class="g"><z-ring [value]="72" [size]="90" [thickness]="9" tone="teal" [fontSize]="18"></z-ring><div class="gl">AI Intake Confidence</div></div>
              </div>
            </div>
            <div class="panel panel-pad"><h3 class="pt">AI Confidence Distribution</h3>
              <div class="bars">
                <div class="bar-row"><span class="bl">High (>90%)</span><span class="bt"><span class="bf" style="width:64%;background:#0d9488"></span></span><span class="bv">64%</span></div>
                <div class="bar-row"><span class="bl">Medium (70-90%)</span><span class="bt"><span class="bf" style="width:27%;background:#f59e0b"></span></span><span class="bv">27%</span></div>
                <div class="bar-row"><span class="bl">Low (<70%)</span><span class="bt"><span class="bf" style="width:9%;background:#ef4444"></span></span><span class="bv">9%</span></div>
              </div></div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .sub { font-size:11px; color:var(--gray-500); font-weight:400; margin-top:2px; }
    b.hot { color:#c2410c; } b.warn { color:var(--amber-fg); }
    .pct { margin-left:10px; font-size:12.5px; font-weight:600; color:var(--ink-soft); }
    .clk { cursor:pointer; } .ml { color:#5B47E0; font-weight:600; cursor:pointer; } .ml:hover { text-decoration:underline; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 4px; }
    .note-warn { color:var(--amber-fg); } .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .flex { display:flex; } .gap-8 { gap:8px; } .center { align-items:center; }
    .srt { cursor:pointer; user-select:none; } .srt:hover { color:var(--ink-soft); }
    .search { border:1px solid var(--gray-300); border-radius:8px; padding:7px 12px; font-size:12.5px; width:190px; outline:none; }
    .search:focus { border-color:var(--teal-600); }
    .search.sm { width:160px; padding:5px 10px; }
    .wl-tools { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
    .wl-tools .pills { margin-bottom:0; }
    .pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .pill { display:flex; align-items:center; gap:7px; border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:6px 12px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .pill.active { background:#5B47E0; border-color:#5B47E0; color:#fff; } .pill.active .pcount { background:rgba(255,255,255,.25); color:#fff; }
    .pdot { width:8px; height:8px; border-radius:999px; }
    .pdot[data-tone="purple"]{ background:#5B47E0; } .pdot[data-tone="blue"]{ background:#1A6BC4; } .pdot[data-tone="amber"]{ background:#C07A0A; } .pdot[data-tone="teal"]{ background:#1D9E75; } .pdot[data-tone="red"]{ background:#D94040; } .pdot[data-tone="gray"]{ background:#9CA3AF; }
    .pcount { background:var(--gray-100); color:var(--gray-500); font-size:10.5px; padding:0 6px; border-radius:999px; }
    .sub2 { font-size:11px; color:var(--gray-500); }
    .nba { font-size:11.5px; font-weight:600; padding:4px 10px; border-radius:6px; display:inline-block; }
    .nba[data-tone="red"]{ background:#FEF0F0; color:#D94040; } .nba[data-tone="purple"]{ background:#EEEAFC; color:#5B47E0; } .nba[data-tone="blue"]{ background:#EAF2FC; color:#1A6BC4; } .nba[data-tone="amber"]{ background:#FEF3E2; color:#C07A0A; } .nba[data-tone="teal"]{ background:#E1F5EE; color:#1D9E75; }
    .lv { font-size:11px; font-weight:700; padding:2px 9px; border-radius:6px; }
    .lv[data-l="L1"]{ background:#EAF2FC; color:#1A6BC4; } .lv[data-l="L2"]{ background:#EEEAFC; color:#5B47E0; } .lv[data-l="IRO"]{ background:#F3F4F6; color:#6B7280; }
    .st { font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:6px; }
    .st[data-tone="red"]{ background:#FEF0F0; color:#D94040; } .st[data-tone="purple"]{ background:#EEEAFC; color:#5B47E0; } .st[data-tone="blue"]{ background:#EAF2FC; color:#1A6BC4; } .st[data-tone="amber"]{ background:#FEF3E2; color:#C07A0A; } .st[data-tone="teal"]{ background:#E1F5EE; color:#1D9E75; } .st[data-tone="gray"]{ background:#F3F4F6; color:#6B7280; }
    .tat { font-weight:600; } .tat[data-tone="red"]{ color:#D94040; } .tat[data-tone="amber"]{ color:#C07A0A; } .tat[data-tone="teal"]{ color:#1D9E75; }
    .sub { } .empty { text-align:center; color:var(--gray-500); padding:24px; }

    .sla-grid { display:grid; grid-template-columns:auto 1fr 1fr; gap:26px; align-items:center; }
    .donut { text-align:center; } .dlab { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:8px; }
    .rows { display:flex; flex-direction:column; gap:12px; }
    .srow { display:flex; justify-content:space-between; padding:12px 16px; border-radius:8px; font-size:13px; font-weight:500; }
    .srow i { width:8px; height:8px; border-radius:999px; display:inline-block; margin-right:8px; } .srow span { display:flex; align-items:center; } .srow b { font-weight:700; }
    .srow.green { background:#e7f8f0; color:var(--green-fg); } .srow.green i { background:var(--green); }
    .srow.amber { background:#fdf6e3; color:var(--amber-fg); } .srow.amber i { background:var(--amber); }
    .srow.red { background:#fdecec; color:var(--red-fg); } .srow.red i { background:var(--red); }
    .stats { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

    .dstats { display:grid; grid-template-columns:repeat(6,1fr); gap:14px; }
    .dstat { background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:18px 12px; text-align:center; }
    .dstat.teal{border-top-color:var(--teal-600);} .dstat.amber{border-top-color:var(--amber);} .dstat.gray{border-top-color:var(--gray-400);} .dstat.blue{border-top-color:var(--blue);} .dstat.purple{border-top-color:var(--purple);}
    .dv { font-size:24px; font-weight:700; color:var(--ink); } .dl { font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:600; margin-top:4px; }

    .rtiles { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .rtile { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px 18px; }
    .rtile.red{border-left-color:var(--red);} .rtile.amber{border-left-color:var(--amber);} .rtile.blue{border-left-color:var(--blue);}
    .rl { font-size:12px; color:var(--gray-500); font-weight:600; } .rv { font-size:26px; font-weight:700; color:var(--ink); margin:8px 0 4px; } .rf { font-size:11px; color:var(--gray-500); }

    .bars { display:flex; flex-direction:column; gap:14px; }
    .bar-row { display:grid; grid-template-columns:150px 1fr 60px; align-items:center; gap:12px; font-size:12.5px; }
    .bl { color:var(--ink-soft); font-weight:600; } .bt { height:10px; border-radius:999px; background:var(--gray-100); overflow:hidden; }
    .bf { display:block; height:100%; border-radius:999px; } .bv { text-align:right; font-weight:700; color:var(--ink); }
    .clab { font-size:12.5px; font-weight:600; color:var(--ink); margin-bottom:8px; } .cval { font-size:26px; font-weight:700; color:var(--ink); margin-bottom:14px; }

    .ai-shell { border:1px solid var(--teal-600); border-radius:12px; padding:20px 22px; background:linear-gradient(180deg,#f7fdfc,#fff 40%); }
    .ai-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; } .ai-head h2 { margin:0; font-size:17px; }
    .ai-pill { background:var(--teal-700); color:#fff; font-size:11px; font-weight:700; padding:5px 12px; border-radius:999px; }
    .recs { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .rec { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; }
    .rec.red{border-left-color:var(--red);} .rec.amber{border-left-color:var(--amber);} .rec.teal{border-left-color:var(--teal-600);}
    .rt { font-size:13.5px; font-weight:700; margin-bottom:6px; } .rd { font-size:12.5px; color:var(--gray-500); line-height:1.5; margin-bottom:14px; } .rbtn { width:100%; justify-content:center; }
    .ai-bottom { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; }
    .gauges { display:flex; justify-content:space-around; padding:10px 0; } .g { text-align:center; } .gl { font-size:12px; color:var(--gray-500); font-weight:600; margin-top:10px; }

    /* ---- Scheduling & Adherence / Demand & Forecasting (same shape as CM's cm-dashboard.ts) ---- */
    .seg-toggle { display: inline-flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; }
    .seg-toggle button { border:none; background:#fff; padding:7px 14px; font-size:12px; font-weight:600; color:var(--gray-500); cursor:pointer; }
    .seg-toggle button.on { background:#5B47E0; color:#fff; }
    .cp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px,1fr)); gap:14px; }
    .cp-tile { display:flex; gap:12px; align-items:flex-start; background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:16px; transition: box-shadow .12s, transform .12s; }
    .cp-tile:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); transform: translateY(-1px); }
    .cp-icon { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:0 0 36px; }
    .cp-icon.teal { background:#E1F5EE; color:#1D9E75; }
    .cp-icon.amber { background:#FEF3E2; color:#C07A0A; }
    .cp-icon.red { background:#FEF0F0; color:#D94040; }
    .cp-icon.green { background:#E1F5EE; color:#1D9E75; }
    .cp-icon.blue { background:#EAF2FC; color:#1A6BC4; }
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
    .shift-chip[data-type="Day"] { background:#EAF2FC; color:#1A6BC4; }
    .shift-chip[data-type="Evening"] { background:#EEEAFC; color:#5B47E0; }
    .shift-chip[data-type="Off"] { background:var(--gray-100); color:var(--gray-400); }
    .shift-chip[data-type="PTO"] { background:#FEF3E2; color:#C07A0A; }
    .qhint { font-size:12px; color:var(--gray-500); background:var(--gray-50, #f9fafb); border:1px solid var(--border); border-radius:8px; padding:10px 14px; }
  `],
})
export class AppealsDashboard {
  private navSvc = inject(Nav);
  members = inject(Members);
  private ix = inject(Interaction);
  private data = inject(DashboardData);
  private exporter = inject(Exporter);
  private lookback = inject(Lookback);
  readonly tabs = TAB_DEFS;
  readonly sel = signal('workforce');

  constructor() {
    effect(() => {
      if (this.navSvc.module() !== 'appeals') return;
      const tab = this.navSvc.takeRequestedTab();
      if (tab && TAB_DEFS.some((t) => t.key === tab)) this.sel.set(tab);
    });
  }
  readonly APPEALS_REVIEWERS = APPEALS_REVIEWERS;

  private readonly PERIOD_VALUES: Record<string, string[]> = {
    today: ['3', '1', '1', '0', '0', '60%', '5.9d', '2'],
    '7d': ['6', '2', '1', '1', '1', '61%', '6.1d', '7'],
    qtd: ['22', '5', '4', '2', '2', '63%', '6.8d', '58'],
  };
  readonly displayKpis = computed(() => {
    const p = this.lookback.period();
    if (p === '30d' || !this.PERIOD_VALUES[p]) return this.kpis;
    return this.kpis.map((k, i) => ({ ...k, value: this.PERIOD_VALUES[p][i] }));
  });

  readonly kpis: KpiItem[] = [
    { icon: 'balance', value: '8',  label: 'Open Appeals',       tone: 'purple' },
    { icon: 'user',    value: '3',  label: 'Assigned for Review', tone: 'blue' },
    { icon: 'phone',   value: '2',  label: 'Pending MD / P2P',   tone: 'amber' },
    { icon: 'mail',    value: '1',  label: 'Pending Information', tone: 'teal' },
    { icon: 'xcircle', value: '1',  label: 'SLA Overdue',        tone: 'red' },
    { icon: 'check',   value: '61%', label: 'Overturn Rate',     tone: 'green' },
    { icon: 'clock',   value: '6.4d', label: 'Avg Decision Time', tone: 'teal' },
    { icon: 'folder',  value: '19', label: 'Closed (MTD)',       tone: 'green' },
  ];

  readonly filters = [
    { key: 'all', label: 'All Open', tone: 'purple' }, { key: 'assigned', label: 'Assigned', tone: 'purple' },
    { key: 'md', label: 'MD / P2P', tone: 'blue' }, { key: 'info', label: 'Pending Info', tone: 'amber' },
    { key: 'ready', label: 'Ready', tone: 'teal' }, { key: 'overdue', label: 'Overdue', tone: 'red' }, { key: 'closed', label: 'Closed', tone: 'gray' },
  ];
  readonly filter = signal('all');

  readonly appeals = signal<Appeal[]>([
    { appealId: 'AP-2025-0891', auth: 'BH656278', member: 'Sheryl Leonard', service: 'Medical necessity — BH IOP', level: 'L1', status: 'Overdue', statusTone: 'red', nba: 'Overdue — Review Now', nbaTone: 'red', tat: '352d overdue', tatTone: 'red', assigned: 'C. Lawson', aiConfidence: 71, queue: 'overdue' },
    { appealId: 'AP-2026-0112', auth: 'BH784201', member: 'Maria Benitez', service: 'Criteria not met — IP psych', level: 'L1', status: 'Assigned for Review', statusTone: 'purple', nba: 'Review Appeal Case', nbaTone: 'purple', tat: '11d left', tatTone: 'amber', assigned: 'C. Lawson', aiConfidence: 94, queue: 'assigned' },
    { appealId: 'AP-2026-0088', auth: 'BH877493', member: 'Shannon Wright', service: 'Not medically necessary', level: 'L2', status: 'Pending MD Review', statusTone: 'blue', nba: 'Complete MD Review', nbaTone: 'blue', tat: '5d left', tatTone: 'amber', assigned: 'C. Lawson', aiConfidence: 66, queue: 'md' },
    { appealId: 'AP-2026-0077', auth: 'BH300966', member: 'Marcus Webb', service: 'IOP criteria not met', level: 'L1', status: 'Pending Information', statusTone: 'amber', nba: 'Resume — Records Received?', nbaTone: 'amber', tat: '12d left', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 80, queue: 'info' },
    { appealId: 'AP-2026-0059', auth: 'RX408528', member: 'Vanessa Hernandez', service: 'Experimental — not covered', level: 'IRO', status: 'Ready for Determination', statusTone: 'teal', nba: 'Send Member & Provider Notice', nbaTone: 'teal', tat: '12d left', tatTone: 'teal', assigned: 'T. Rivera', aiConfidence: 88, queue: 'ready' },
    { appealId: 'AP-2026-0031', auth: 'IP490812', member: 'James Okafor', service: 'IP LOS extension', level: 'L1', status: 'Closed — Overturned', statusTone: 'teal', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 90, queue: 'closed' },
    { appealId: 'AP-2026-0028', auth: 'OP351953', member: 'Linda Park', service: 'OP procedure denial', level: 'L1', status: 'Closed — Upheld', statusTone: 'gray', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'C. Lawson', aiConfidence: 55, queue: 'closed' },
    { appealId: 'AP-2026-0019', auth: 'RX921945', member: 'Carlos Reyes', service: 'Specialty Rx denial', level: 'L2', status: 'Closed — Overturned', statusTone: 'teal', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal', assigned: 'T. Rivera', aiConfidence: 84, queue: 'closed' },
  ]);
  readonly visible = computed(() => { const f = this.filter(); const rows = this.appeals(); return f === 'all' ? rows.filter((a) => a.queue !== 'closed') : rows.filter((a) => a.queue === f); });
  countFor(key: string) { const rows = this.appeals(); return key === 'all' ? rows.filter((a) => a.queue !== 'closed').length : rows.filter((a) => a.queue === key).length; }
  readonly riskCases = computed(() => this.appeals().filter((a) => ['overdue', 'md', 'info'].includes(a.queue) || a.tatTone === 'amber'));

  // worklist search + sort + export
  readonly apSearch = signal('');
  readonly apSortKey = signal<keyof Appeal | ''>('');
  readonly apSortDir = signal<SortDir>(1);
  readonly worklistRows = computed(() => {
    const q = this.apSearch().trim().toLowerCase();
    const rows = this.visible().filter((a) => !q || a.member.toLowerCase().includes(q) || a.appealId.toLowerCase().includes(q) || a.auth.toLowerCase().includes(q) || a.service.toLowerCase().includes(q));
    return compareRows(rows, this.apSortKey(), this.apSortDir());
  });
  sortAp(k: keyof Appeal) { if (this.apSortKey() === k) this.apSortDir.set(this.apSortDir() === 1 ? -1 : 1); else { this.apSortKey.set(k); this.apSortDir.set(1); } }
  caretAp(k: keyof Appeal) { return caretFor(this.apSortKey(), k, this.apSortDir()); }
  exportAppeals() {
    this.exporter.open({ title: 'Appeals Worklist', name: 'appeals-worklist_2026-07-17',
      columns: ['Appeal', 'Auth', 'Member', 'Service', 'Level', 'Status', 'TAT', 'Assigned'],
      rows: this.visible().map((a) => [a.appealId, a.auth, a.member, a.service, a.level, a.status, a.tat, a.assigned]) });
  }

  // reviewers sort + export
  readonly rvSortKey = signal<keyof Reviewer | ''>('');
  readonly rvSortDir = signal<SortDir>(1);
  readonly sortedReviewers = computed(() => compareRows(this.reviewers, this.rvSortKey(), this.rvSortDir()));
  sortRv(k: keyof Reviewer) { if (this.rvSortKey() === k) this.rvSortDir.set(this.rvSortDir() === 1 ? -1 : 1); else { this.rvSortKey.set(k); this.rvSortDir.set(1); } }
  caretRv(k: keyof Reviewer) { return caretFor(this.rvSortKey(), k, this.rvSortDir()); }
  exportReviewers() {
    this.exporter.open({ title: 'Reviewer Workload', name: 'appeals-reviewers_2026-07-17',
      columns: ['Reviewer', 'Role', 'Open', 'Near SLA', 'Overdue', 'Overturn Rate %', 'Utilization %'],
      rows: this.reviewers.map((r) => [r.name, r.role, r.open, r.nearSla, r.overdue, r.overturnRate, r.utilization]) });
  }

  // ---- Scheduling & Adherence — same generalized weekOffset-parametrized shift/adherence model
  // as CM (see data/appeals-schedule.ts), sized to this 3-person roster. No team filter here (CM's
  // "slice and dice" ask) — Appeals has no team concept, just 3 named reviewers, too small a roster
  // for a team dropdown to mean anything. ----
  readonly weekDayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly schedulePeriod = signal<SchedulePeriod>('weekly');
  readonly schedulePeriodLabel = computed(() => {
    const p = this.schedulePeriod();
    return p === 'daily' ? 'Today' : p === 'weekly' ? 'This Week' : p === 'rolling4' ? 'Rolling 4 Weeks' : 'Monthly (~5 Weeks)';
  });
  readonly weekSchedules = computed(() => APPEALS_WEEK_SCHEDULES);
  todayDayOf(w: ReviewerWeekSchedule): ReviewerShiftDay { return w.days.find((d) => d.date === APPEALS_TODAY_ISO) ?? w.days[0]; }
  readonly weekBlocks = computed((): ReviewerWeekBlock[] => {
    const p = this.schedulePeriod();
    if (p === 'rolling4') return APPEALS_ROLLING_4_WEEKS;
    if (p === 'monthly') return APPEALS_MONTHLY_WEEKS;
    return [{ weekOffset: 0, weekStart: APPEALS_TODAY_ISO, schedules: APPEALS_WEEK_SCHEDULES, adherence: APPEALS_ADHERENCE }];
  });
  readonly weekRollup = computed(() => APPEALS_REVIEWERS.map((rv) => ({
    reviewer: rv.name, role: rv.role,
    weeks: this.weekBlocks().map((b) => {
      const sched = b.schedules.find((s) => s.reviewer === rv.name);
      const shifts = sched ? sched.days.filter((d) => d.type === 'Day' || d.type === 'Evening').length : 0;
      const pto = sched ? sched.days.filter((d) => d.type === 'PTO').length : 0;
      return { weekStart: b.weekStart, shifts, pto };
    }),
  })));
  private adherenceForPeriod(): ReviewerAdherenceDay[] {
    if (this.schedulePeriod() === 'daily') return APPEALS_ADHERENCE.filter((a) => a.date === APPEALS_TODAY_ISO);
    return this.weekBlocks().flatMap((b) => b.adherence);
  }
  readonly teamAdherenceRate = computed(() => {
    const recs = this.adherenceForPeriod();
    const total = recs.length || 1;
    return Math.round((recs.filter((a) => a.status === 'On Time').length / total) * 100);
  });
  readonly teamAdherenceRateLabel = computed(() => `${this.teamAdherenceRate()}%`);
  readonly adherenceExceptions = computed(() => this.adherenceForPeriod().filter((a) => a.status !== 'On Time'));
  readonly adherenceBreakdown = computed(() => {
    const recs = this.adherenceForPeriod();
    const statuses: AdherenceStatus[] = ['On Time', 'Late Start', 'Early Leave', 'Overtime', 'Absence'];
    return statuses.map((status) => ({ status, count: recs.filter((a) => a.status === status).length }));
  });
  readonly adherenceStatusFilter = signal<AdherenceStatus | 'all'>('all');
  readonly filteredAdherence = computed(() => {
    const f = this.adherenceStatusFilter();
    return f === 'all' ? this.adherenceExceptions() : this.adherenceForPeriod().filter((a) => a.status === f);
  });
  private readonly ADHERENCE_COLORS: Record<AdherenceStatus, string> = { 'On Time': '#1D9E75', 'Late Start': '#C07A0A', 'Early Leave': '#f97316', 'Overtime': '#1A6BC4', 'Absence': '#D94040' };
  readonly adherenceDonutSegments = computed((): Segment[] => this.adherenceBreakdown().map((b) => ({ label: b.status, value: b.count, color: this.ADHERENCE_COLORS[b.status] })));
  readonly adherenceSearch = signal('');
  readonly searchedAdherence = computed(() => {
    const q = this.adherenceSearch().trim().toLowerCase();
    const rows = this.filteredAdherence();
    return q ? rows.filter((a) => a.reviewer.toLowerCase().includes(q) || a.day.toLowerCase().includes(q) || a.status.toLowerCase().includes(q)) : rows;
  });
  private readonly ADHERENCE_ROW_COLUMNS = ['Reviewer', 'Day', 'Scheduled', 'Actual', 'Status', 'Variance'];
  private adherenceRow(a: ReviewerAdherenceDay): (string | number)[] {
    return [a.reviewer, a.day, `${a.scheduledStart}–${a.scheduledEnd}`, a.actualStart ? `${a.actualStart}–${a.actualEnd}` : '—', a.status, a.varianceMin === 0 ? '—' : (a.varianceMin > 0 ? '+' : '') + a.varianceMin + 'm'];
  }
  private openScheduleExplorer(title: string, columns: string[], rows: (string | number)[][], exportSlug: string, context?: string) {
    this.ix.openExplorer({ title, context: context ?? `${rows.length} record(s)`, columns, rows, exportName: `appeals-schedule-${exportSlug}_2026-07-17` });
  }
  openAllAdherence() {
    const rows = this.adherenceForPeriod().map((a) => this.adherenceRow(a));
    this.openScheduleExplorer(`Adherence — ${this.schedulePeriodLabel()}`, this.ADHERENCE_ROW_COLUMNS, rows, 'all-adherence');
  }
  openExceptions() {
    const rows = this.adherenceExceptions().map((a) => this.adherenceRow(a));
    this.openScheduleExplorer(`Exceptions — ${this.schedulePeriodLabel()}`, this.ADHERENCE_ROW_COLUMNS, rows, 'exceptions');
  }
  openScheduledReviewers() {
    const counts = new Map<string, { shifts: number; pto: number }>();
    const schedules = this.schedulePeriod() === 'daily' ? this.weekSchedules() : this.weekBlocks().flatMap((b) => b.schedules);
    schedules.forEach((s) => {
      const rec = counts.get(s.reviewer) ?? { shifts: 0, pto: 0 };
      s.days.forEach((d) => {
        if (this.schedulePeriod() === 'daily' && d.date !== APPEALS_TODAY_ISO) return;
        if (d.type === 'Day' || d.type === 'Evening') rec.shifts++;
        if (d.type === 'PTO') rec.pto++;
      });
      counts.set(s.reviewer, rec);
    });
    const rows = this.reviewerSummaryRows().map((p) => {
      const c = counts.get(p.reviewer) ?? { shifts: 0, pto: 0 };
      return [p.reviewer, p.role, c.shifts, c.pto, `${p.adherenceRate}%`];
    });
    this.openScheduleExplorer(`Reviewers Scheduled — ${this.schedulePeriodLabel()}`, ['Reviewer', 'Role', 'Scheduled Shifts', 'PTO Days', 'Adherence Rate'], rows, 'scheduled');
  }
  openPtoDays() {
    const schedules = this.schedulePeriod() === 'daily' ? this.weekSchedules() : this.weekBlocks().flatMap((b) => b.schedules);
    const rows: (string | number)[][] = [];
    schedules.forEach((s) => s.days.forEach((d) => {
      if (d.type !== 'PTO') return;
      if (this.schedulePeriod() === 'daily' && d.date !== APPEALS_TODAY_ISO) return;
      rows.push([s.reviewer, s.role, d.day, d.date]);
    }));
    this.openScheduleExplorer(`PTO Days — ${this.schedulePeriodLabel()}`, ['Reviewer', 'Role', 'Day', 'Date'], rows, 'pto-days');
  }
  openUpcomingPto() {
    const rows = this.upcomingPto().map((p) => [p.reviewer, p.date, p.day]);
    this.openScheduleExplorer('Upcoming PTO (Next 3 Weeks)', ['Reviewer', 'Date', 'Day'], rows, 'upcoming-pto');
  }
  onAdherenceSegClick(s: Segment) {
    this.adherenceStatusFilter.set(s.label as AdherenceStatus);
    const rows = this.adherenceForPeriod().filter((a) => a.status === s.label).map((a) => this.adherenceRow(a));
    this.openScheduleExplorer(`${s.label} — ${this.schedulePeriodLabel()}`, this.ADHERENCE_ROW_COLUMNS, rows, `status-${s.label.toLowerCase().replace(/\s+/g, '-')}`);
  }
  readonly ptoDaysForPeriod = computed(() => {
    const schedules = this.schedulePeriod() === 'daily' ? APPEALS_WEEK_SCHEDULES : this.weekBlocks().flatMap((b) => b.schedules);
    return schedules.reduce((sum, s) => sum + s.days.filter((d) => d.type === 'PTO' && (this.schedulePeriod() !== 'daily' || d.date === APPEALS_TODAY_ISO)).length, 0);
  });
  readonly upcomingPto = computed(() => {
    const out: { reviewer: string; date: string; day: string }[] = [];
    APPEALS_UPCOMING_WEEKS.forEach((block) => block.schedules.forEach((s) => {
      s.days.forEach((d) => { if (d.type === 'PTO' && d.date >= APPEALS_TODAY_ISO) out.push({ reviewer: s.reviewer, date: d.date, day: d.day }); });
    }));
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });
  readonly reviewerSummaryRows = computed(() => {
    const byReviewer = new Map<string, ReviewerAdherenceDay[]>();
    this.adherenceForPeriod().forEach((a) => { if (!byReviewer.has(a.reviewer)) byReviewer.set(a.reviewer, []); byReviewer.get(a.reviewer)!.push(a); });
    const balances = new Map(APPEALS_PTO_BALANCES.map((p) => [p.reviewer, p]));
    return APPEALS_REVIEWERS.map((rv) => {
      const mine = byReviewer.get(rv.name) ?? [];
      const rate = mine.length ? Math.round((mine.filter((r) => r.status === 'On Time').length / mine.length) * 100) : 100;
      const bal = balances.get(rv.name);
      return { reviewer: rv.name, role: rv.role, adherenceRate: rate, accruedDays: bal?.accruedDays ?? 0, usedDays: bal?.usedDays ?? 0, remainingDays: bal?.remainingDays ?? 0 };
    });
  });
  exportSchedule() {
    if (this.schedulePeriod() === 'weekly' || this.schedulePeriod() === 'daily') {
      const rows = this.weekSchedules().map((w) => [w.reviewer, w.role, ...w.days.map((d) => (d.type === 'Off' ? '—' : d.type === 'PTO' ? 'PTO' : `${d.start}–${d.end}`))]);
      this.exporter.open({ title: `${this.schedulePeriodLabel()}'s Schedule`, name: 'appeals-schedule_2026-07-17', columns: ['Reviewer', 'Role', ...this.weekDayLabels], rows });
      return;
    }
    const rows = this.weekRollup().map((r) => [r.reviewer, r.role, ...r.weeks.map((w) => `${w.shifts} shifts${w.pto ? ` · ${w.pto} PTO` : ''}`)]);
    this.exporter.open({ title: `${this.schedulePeriodLabel()} Schedule Summary`, name: 'appeals-schedule-summary_2026-07-17',
      columns: ['Reviewer', 'Role', ...this.weekBlocks().map((b) => `Week of ${b.weekStart}`)], rows });
  }
  exportPtoBalances() {
    this.exporter.open({ title: 'Adherence & PTO by Reviewer', name: 'appeals-adherence-pto_2026-07-17',
      columns: ['Reviewer', 'Role', 'Adherence Rate %', 'PTO Accrued (YTD)', 'PTO Used', 'PTO Remaining'],
      rows: this.reviewerSummaryRows().map((p) => [p.reviewer, p.role, p.adherenceRate, p.accruedDays, p.usedDays, p.remainingDays]) });
  }

  // ---- Demand & Forecasting — this roster's 8 hand-authored appeals are a curated worklist
  // snapshot, not a full history, so weekly volume here is a small deterministic series (same
  // "no RNG" convention as everywhere else) rather than bucketing those 8 records by date. ----
  private readonly demandHistoryRaw = Array.from({ length: 9 }, (_, i) => 2 + ((i * 5 + 3) % 4));
  readonly demandForecast = computed(() => {
    const history = this.demandHistoryRaw.map((count, i) => {
      const start = appealsAddDays(APPEALS_WEEK_START, -(this.demandHistoryRaw.length - 1 - i) * 7);
      return { label: `${start.getMonth() + 1}/${start.getDate()}`, start: appealsIsoDate(start), count };
    });
    const complete = history.slice(0, -1);
    const recentBasis = complete.slice(-4).map((w) => w.count);
    const projected = recentBasis.length ? Math.round(recentBasis.reduce((s, v) => s + v, 0) / recentBasis.length) : 0;
    const teamCapacity = APPEALS_REVIEWERS.length * 6; // nominal ~6 open appeals per reviewer at once
    return { history, projected, teamCapacity, overCapacity: projected > teamCapacity };
  });
  readonly demandTrendPoints = computed(() => this.demandForecast().history.map((h) => h.count));
  readonly demandTrendLabels = computed(() => this.demandForecast().history.map((h) => h.label));
  exportDemand() {
    const f = this.demandForecast();
    this.exporter.open({ title: 'Demand & Forecasting', name: 'appeals-demand-forecast_2026-07-17',
      columns: ['Week Of', 'Appeals'], rows: f.history.map((h) => [h.start, h.count]),
      sections: [
        { label: 'Weekly Volume', name: 'appeals-demand-weekly_2026-07-17', columns: ['Week Of', 'Appeals'], rows: f.history.map((h) => [h.start, h.count]) },
        { label: 'Forecast Summary', name: 'appeals-demand-summary_2026-07-17', columns: ['Metric', 'Value'],
          rows: [['Projected Next Week', f.projected], ['Reviewer Capacity', f.teamCapacity], ['Over Capacity', f.overCapacity ? 'Yes' : 'No']] },
      ] });
  }
  /** These 8 hand-authored appeals are a curated worklist snapshot, not a real per-item history —
   *  so unlike CM's "this week" drill (real referrals), these tiles drill into the aggregate
   *  weekly counts themselves rather than fabricating specific appeal rows that don't exist. */
  openWeeklyVolume() {
    const rows = this.demandForecast().history.map((h) => [h.start, h.count]);
    this.openScheduleExplorer('Weekly Appeal Volume (8 Weeks)', ['Week Of', 'Appeals'], rows, 'weekly-volume');
  }
  openForecastBasis() {
    const basis = this.demandForecast().history.slice(0, -1).slice(-4);
    this.openScheduleExplorer('Forecast Basis — Trailing 4 Complete Weeks', ['Week Of', 'Appeals'], basis.map((w) => [w.start, w.count]), 'forecast-basis',
      `Trailing 4-week average of ${basis.map((w) => w.count).join(', ')} = ${this.demandForecast().projected} projected`);
  }
  openReviewerCapacity() {
    const rows = this.reviewers.map((r) => [r.name, r.role, r.open, r.nearSla, r.overdue, `${r.utilization}%`]);
    this.openScheduleExplorer('Reviewer Capacity', ['Reviewer', 'Role', 'Open Appeals', 'Near SLA', 'Overdue', 'Utilization'], rows, 'reviewer-capacity');
  }
  openCoverageOutlook() {
    const f = this.demandForecast();
    const rows: (string | number)[][] = [
      ['Projected Next Week', f.projected],
      ['Reviewer Capacity', f.teamCapacity],
      ['Margin', f.teamCapacity - f.projected],
      ['Outlook', f.overCapacity ? 'At Risk' : 'Adequate'],
    ];
    this.openScheduleExplorer('Coverage Outlook', ['Metric', 'Value'], rows, 'coverage-outlook');
  }

  readonly reviewers: Reviewer[] = [
    { name: 'C. Lawson', role: 'Appeals RN', open: 5, nearSla: 2, overdue: 1, overturnRate: 63, utilization: 91 },
    { name: 'T. Rivera', role: 'Appeals RN', open: 3, nearSla: 1, overdue: 0, overturnRate: 58, utilization: 74 },
    { name: 'Dr. M. Webb', role: 'Medical Director', open: 2, nearSla: 1, overdue: 0, overturnRate: 55, utilization: 68 },
  ];
  readonly drivers = [
    { cat: 'Behavioral Health', count: 7, rate: 71, reason: 'New clinical evidence' },
    { cat: 'Inpatient LOS', count: 5, rate: 60, reason: 'Documentation submitted late' },
    { cat: 'Specialty Rx', count: 4, rate: 50, reason: 'Step-therapy exception' },
    { cat: 'Out-of-Network', count: 3, rate: 33, reason: 'Network adequacy' },
  ];
  readonly aging = [
    { label: '0–7 days', value: 6, pct: 100, color: '#10b981' },
    { label: '8–14 days', value: 5, pct: 83, color: '#f59e0b' },
    { label: '15–30 days', value: 4, pct: 67, color: '#f97316' },
    { label: '> 30 days', value: 3, pct: 50, color: '#ef4444' },
  ];
  readonly intakeFields = [
    { field: 'Provider NPI', count: 4, conf: '78%' },
    { field: 'Urgency', count: 3, conf: '81%' },
    { field: 'Denial Reason', count: 2, conf: '84%' },
  ];
  readonly providerPatterns = [
    { provider: 'City Behavioral Health', count: 6, rate: 71, service: 'BH IOP' },
    { provider: 'Memorial Orthopedic Group', count: 4, rate: 55, service: 'Spinal fusion' },
    { provider: 'Coastal Neurology', count: 3, rate: 48, service: 'Imaging' },
  ];
  readonly highValue = [
    { appeal: 'AP-2026-0031', member: 'James Okafor', service: 'IP LOS extension', value: '$48k', outcome: 'Overturned' },
    { appeal: 'AP-2026-0019', member: 'Carlos Reyes', service: 'Specialty Rx', value: '$31k', outcome: 'Overturned' },
    { appeal: 'AP-2026-0028', member: 'Linda Park', service: 'OP procedure', value: '$22k', outcome: 'Upheld' },
  ];

  open(a: Appeal) {
    const rec = a.aiConfidence >= 85 ? 'Overturn' : a.aiConfidence >= 60 ? 'Partial' : 'Uphold';
    this.ix.openDrawer({
      title: `${a.appealId} · ${a.member}`, subtitle: `${a.service} · Auth ${a.auth}`,
      badge: { text: a.level === 'IRO' ? 'External (IRO)' : `Level ${a.level.replace('L', '')}`, tone: a.level === 'L1' ? 'blue' : 'teal' },
      formula: `AI Confidence ${a.aiConfidence}% — Likely ${rec}`,
      fields: [ { label: 'Status', value: a.status }, { label: 'TAT', value: a.tat, tone: a.tatTone === 'red' ? 'red' : a.tatTone === 'amber' ? 'amber' : 'green' }, { label: 'Assigned To', value: a.assigned }, { label: 'Next Action', value: a.nba } ],
      note: `AI reviewed the denial rationale against clinical criteria and recommends "${rec}".`,
      actions: a.queue === 'closed' ? [] : [
        { label: 'Overturn — Approve appeal', tone: 'teal', run: () => this.decide(a, 'Overturned') },
        { label: 'Partial — Partially overturn', tone: 'amber', run: () => this.decide(a, 'Partially Overturned') },
        { label: 'Uphold — Deny appeal', tone: 'red', run: () => this.decide(a, 'Upheld') },
      ],
    });
  }
  private decide(a: Appeal, outcome: string) {
    const tone = outcome === 'Upheld' ? 'gray' : 'teal';
    this.appeals.update((rows) => rows.map((x) => x.appealId === a.appealId ? { ...x, status: `Closed — ${outcome}`, statusTone: tone, queue: 'closed', nba: 'Closed', nbaTone: 'teal', tat: 'Closed', tatTone: 'teal' } : x));
    this.ix.toast(`${a.appealId} determination recorded: ${outcome}.`, 'info');
    this.data.addHistory('balance', 'Appeal determination', `${a.appealId} (${a.member}) — ${outcome}`);
  }
  toast(m: string) { this.ix.toast(m, 'info'); this.data.addHistory('sparkles', 'Appeals AI action', m); }
}
