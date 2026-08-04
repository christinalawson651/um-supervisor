import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveConcurrentRows } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Escalate, ESCALATE_TARGETS } from '../shared/escalate';
import { Exporter } from '../shared/exporter';
import { ConcurrentRow } from '../data/dashboard.models';
import { Members } from '../shared/members';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

const CONCURRENT_WIDGETS = [{ id: 'stats', title: 'Concurrent Review Stats' }, { id: 'table', title: 'Concurrent Review Monitoring' }];
const STATUS_ORDER = ['Uncertified Days', 'Extension Requested', 'Recert Due', 'Certified'] as const;
type StatusFilter = 'all' | (typeof STATUS_ORDER)[number];

const TABLE_COLUMNS = ['Member', 'Facility', 'LOS', 'Total Certified Days', 'Certified Through', 'Days Remaining',
  'Uncertified Days', 'Next Review Due', 'Requested/Approved', 'Status', 'Reviewer', 'Expected Discharge', 'Next Action'];
function toTableRow(r: ConcurrentRow): (string | number)[] {
  return [r.member, r.facility, r.los, r.totalCertifiedDays, r.certifiedThrough, r.daysRemaining, r.uncertifiedDays,
    r.nextReview, `${r.daysRequested} / ${r.totalCertifiedDays}`, r.status, r.reviewer, r.expectedDischarge, r.nextAction];
}

@Component({
  selector: 'app-concurrent-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Concurrent Review Monitoring</h2>
      <span class="section-note">Active inpatient authorizations under review</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('stats')) {
    <div class="dstats">
      @for (s of stats(); track s.label) {
        <div class="dstat clickable" [attr.data-tone]="s.tone" (click)="drillStatus(s.filter)">
          <z-widget-actions (exportClick)="exportStat(s)" (removeClick)="hide('stats')"></z-widget-actions>
          <div class="dic"><z-icon [name]="s.icon" [size]="20" [stroke]="1.8"></z-icon></div>
          <div class="dval">{{ s.value }}</div>
          <div class="dlab">{{ s.label }}</div>
        </div>
      }
    </div>
    }

    @if (!isHidden('table')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title">Active Concurrent Reviews</h3>
        <select class="svc-filter" [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)">
          <option value="all">All Statuses</option>
          @for (s of statusOptions; track s) { <option [value]="s">{{ s }}</option> }
        </select>
        <z-widget-actions (exportClick)="exportTable()" (removeClick)="hide('table')"></z-widget-actions>
      </div>
      <table class="z-table compact">
        <thead>
          <tr>
            <th>Member</th><th>Facility</th><th>LOS</th>
            <th>Stay Timeline</th><th>Uncert.</th>
            <th>Next Review</th><th>Req./Appr.</th><th>Status</th><th>Reviewer</th>
            <th>Next Action</th>
          </tr>
        </thead>
        <tbody>
          @for (r of filteredRows(); track r.member) {
            @let tl = timelineFor(r);
            <tr>
              <td><a class="mlink" (click)="openMember(r)">{{ r.member }}</a></td>
              <td class="fac" [title]="r.facility">{{ r.facility }}</td>
              <td [class.danger]="r.losFlag">{{ r.los }}</td>
              <td>
                <div class="stay-tl has-tip">
                  <div class="tl-track"></div>
                  <div class="tl-fill cert" [style.width.%]="tl.usedPct"></div>
                  @if (tl.riskPct > 0) { <div class="tl-fill risk" [style.left.%]="tl.riskLeft" [style.width.%]="tl.riskPct"></div> }
                  @if (tl.bufferPct > 0) { <div class="tl-fill buffer" [style.left.%]="tl.bufferLeft" [style.width.%]="tl.bufferPct"></div> }
                  <div class="tl-marker today" [style.left.%]="tl.todayPct"></div>
                  <div class="tl-marker expected" [class.overdue]="tl.expOverdue" [style.left.%]="tl.expPct"></div>
                  <span class="tip">Day {{ tl.losDay }} of stay · Certified through {{ r.certifiedThrough }} ({{ r.daysRemaining < 0 ? (-r.daysRemaining) + 'd overdue' : r.daysRemaining + 'd left' }}) · Expected discharge {{ r.expectedDischarge }}</span>
                </div>
              </td>
              <td class="num" [class.danger]="r.uncertifiedDays > 0">{{ r.uncertifiedDays }}</td>
              <td>{{ r.nextReview }}</td>
              <td class="num">{{ r.daysRequested }}/{{ r.totalCertifiedDays }}</td>
              <td><span class="badge" [class.red]="r.statusTone==='red'"
                    [class.amber]="r.statusTone==='amber'"
                    [class.green]="r.statusTone==='green'">{{ r.status }}</span></td>
              <td>{{ r.reviewer }}</td>
              <td class="na has-tip clickable" (click)="open(r)">{{ r.nextActionShort }}<span class="tip">{{ r.nextAction }}</span></td>
            </tr>
          }
          @if (!filteredRows().length) {
            <tr><td colspan="10" class="empty-row">No reviews match this filter.</td></tr>
          }
        </tbody>
      </table>
      <div class="tl-legend">
        <span><i class="sw cert"></i>Certified &amp; elapsed</span>
        <span><i class="sw risk"></i>Elapsed, uncertified</span>
        <span><i class="sw buffer"></i>Certified buffer ahead</span>
        <span><i class="sw mk today"></i>Today</span>
        <span><i class="sw mk expected"></i>Expected discharge</span>
      </div>
    </div>
    }
  `,
  styles: [`
    .clickable { cursor: pointer; }
    .panel { position: relative; }
    .panel:hover z-widget-actions { opacity: 1; }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .compact.z-table thead th, .compact.z-table tbody td { padding: 7px 9px; font-size: 12px; }
    .fac { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 11px; color: var(--gray-500); margin-top: 2px; }
    .sub.warn { color: var(--amber-fg); font-weight: 600; }
    .sub.danger { color: var(--red); font-weight: 600; }
    .na { color: var(--ink-soft); font-weight: 600; }
    .na.has-tip { cursor: pointer; }
    .mlink { color: #2563eb; font-weight: 600; cursor: pointer; }
    .mlink:hover { text-decoration: underline; }
    .has-tip { position: relative; cursor: help; text-decoration: underline dotted var(--gray-400); text-underline-offset: 3px; }
    .has-tip .tip { visibility: hidden; opacity: 0; position: absolute; top: 100%; left: 0; margin-top: 6px;
      background: var(--ink); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
      white-space: normal; width: 240px; line-height: 1.4; z-index: 30; transition: opacity .1s; pointer-events: none; }
    .has-tip:hover .tip { visibility: visible; opacity: 1; }
    .dstats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
    .dstat { position: relative; background: #fff; border: 1px solid var(--border); border-top: 3px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 12px; text-align: center; }
    .dstat:hover z-widget-actions { opacity: 1; }
    .dic { display: flex; justify-content: center; margin-bottom: 10px; }
    .dval { font-size: 26px; font-weight: 700; color: var(--ink); }
    .dlab { font-size: 10.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--gray-500); font-weight: 600; margin-top: 4px; }
    .dstat[data-tone="green"] { border-top-color: var(--green); } .dstat[data-tone="green"] .dic { color: var(--green); }
    .dstat[data-tone="red"]   { border-top-color: var(--red); }   .dstat[data-tone="red"] .dic { color: var(--red); }
    .dstat[data-tone="amber"] { border-top-color: var(--amber); } .dstat[data-tone="amber"] .dic { color: var(--amber); }
    .dstat[data-tone="teal"]  { border-top-color: var(--teal-600); } .dstat[data-tone="teal"] .dic { color: var(--teal-700); }
    .tbl-head { position: relative; display: flex; align-items: center; justify-content: flex-start; gap: 10px 16px; padding-right: 44px; }
    .svc-filter { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: #fff;
      font-size: 12.5px; color: var(--ink-soft); margin-left: auto; margin-right: 12px; }
    .empty-row { text-align: center; color: var(--gray-500); padding: 20px; }
    .stay-tl { position: relative; width: 84px; height: 16px; }
    .tl-track { position: absolute; left: 0; right: 0; top: 5px; height: 6px; background: var(--gray-100); border-radius: 3px; }
    .tl-fill { position: absolute; top: 5px; height: 6px; border-radius: 3px; }
    .tl-fill.cert { left: 0; background: var(--teal-600); }
    .tl-fill.risk { background: var(--red); }
    .tl-fill.buffer { background: var(--teal-100); }
    .tl-marker { position: absolute; top: 0; width: 2px; height: 16px; background: var(--ink); transform: translateX(-1px); }
    .tl-marker.expected { background: var(--gray-400); }
    .tl-marker.expected.overdue { background: var(--red); }
    .tl-legend { display: flex; gap: 16px; flex-wrap: wrap; padding: 4px 16px 14px; font-size: 11px; color: var(--gray-500); }
    .tl-legend .sw { display: inline-block; width: 10px; height: 6px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
    .tl-legend .sw.cert { background: var(--teal-600); }
    .tl-legend .sw.risk { background: var(--red); }
    .tl-legend .sw.buffer { background: var(--teal-100); border: 1px solid var(--teal-600); }
    .tl-legend .sw.mk { width: 2px; height: 10px; border-radius: 0; background: var(--ink); }
    .tl-legend .sw.mk.expected { background: var(--gray-400); }
  `],
})
export class ConcurrentTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private esc = inject(Escalate);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);
  private members = inject(Members);

  readonly statusOptions = STATUS_ORDER;

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or the panel's × ----
  readonly vis = new WidgetVisibility('zyter-um-concurrent-widgets-v2', CONCURRENT_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  /** Real concurrent-review rows derived from the case pool, scoped by the shared LOB + Lookback filters. */
  readonly concurrentRows = computed(() => {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return liveConcurrentRows(lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays());
  });

  /** Headline stats — the same status buckets that drive the table's Status column and filter, so a
   *  tile's count, its drill-down, and the table's own filter can never drift apart. */
  readonly stats = computed(() => {
    const rows = this.concurrentRows();
    const of = (status: string) => rows.filter((r) => r.status === status).length;
    return [
      { label: 'Active Reviews', value: String(rows.length), icon: 'folder', tone: 'teal', filter: 'all' as StatusFilter },
      { label: 'Uncertified Days', value: String(of('Uncertified Days')), icon: 'xcircle', tone: 'red', filter: 'Uncertified Days' as StatusFilter },
      { label: 'Extension Requested', value: String(of('Extension Requested')), icon: 'clock', tone: 'amber', filter: 'Extension Requested' as StatusFilter },
      { label: 'Recert Due', value: String(of('Recert Due')), icon: 'alert', tone: 'amber', filter: 'Recert Due' as StatusFilter },
      { label: 'Certified', value: String(of('Certified')), icon: 'check', tone: 'green', filter: 'Certified' as StatusFilter },
    ];
  });

  readonly statusFilter = signal<StatusFilter>('all');
  readonly filteredRows = computed(() => {
    const f = this.statusFilter();
    const rows = this.concurrentRows();
    return f === 'all' ? rows : rows.filter((r) => r.status === f);
  });

  /** A tile sets the same filter the table uses, so drilling in stays on this page instead of a modal. */
  drillStatus(filter: StatusFilter) {
    this.statusFilter.set(filter);
  }

  exportStat(s: { label: string; filter: StatusFilter }) {
    const rows = s.filter === 'all' ? this.concurrentRows() : this.concurrentRows().filter((r) => r.status === s.filter);
    this.exporter.open({
      title: s.label, name: `concurrent-${s.label.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      columns: TABLE_COLUMNS, rows: rows.map(toTableRow),
    });
  }

  exportTable() {
    this.exporter.open({
      title: 'Concurrent Review Monitoring', name: 'concurrent-review_2026-07-17',
      columns: TABLE_COLUMNS, rows: this.filteredRows().map(toTableRow),
    });
  }

  /**
   * Stay Timeline — a compact visual replacing the old separate Certified Through/Expected
   * Discharge text columns. All positions are day-offsets from admission, scaled to the longest
   * of LOS/certified/expected so every bar uses the same relative scale within its own row:
   *  - teal "cert" fill = certified days already elapsed (0 .. min(LOS, certified))
   *  - red "risk" fill  = elapsed but NOT certified yet (only when LOS has outpaced certification)
   *  - light "buffer" fill = certified ahead of the current stay day (a comfortable cushion)
   *  - dark tick = today (day `los`); gray/red tick = expected discharge day (red if already past).
   */
  timelineFor(r: ConcurrentRow) {
    const losDay = parseInt(r.los, 10);
    const expectedDay = parseInt(r.expectedLos, 10);
    const certified = r.totalCertifiedDays;
    const maxDay = Math.max(losDay, certified, expectedDay, 1);
    const pct = (d: number) => Math.min(100, Math.max(0, (d / maxDay) * 100));
    const losPct = pct(losDay);
    const certPct0 = pct(certified);

    let usedPct: number; let riskLeft = 0; let riskPct = 0; let bufferLeft = 0; let bufferPct = 0;
    if (losDay <= certified) {
      usedPct = losPct;
      bufferLeft = losPct; bufferPct = Math.max(0, certPct0 - losPct);
    } else {
      usedPct = certPct0;
      riskLeft = certPct0; riskPct = Math.max(0, losPct - certPct0);
    }

    return {
      losDay, usedPct, riskLeft, riskPct, bufferLeft, bufferPct,
      todayPct: losPct, expPct: pct(expectedDay), expOverdue: expectedDay < losDay,
    };
  }

  openMember(r: ConcurrentRow) {
    this.members.openByName(r.member);
  }

  open(r: ConcurrentRow) {
    this.ix.openDrawer({
      title: r.member,
      subtitle: `${r.facility} · Inpatient concurrent review`,
      badge: { text: r.status, tone: r.statusTone as any },
      fields: [
        { label: 'Admit Date', value: r.admit },
        { label: 'Length of Stay', value: r.los, tone: r.losFlag ? 'red' : undefined },
        { label: 'Total Certified Days', value: String(r.totalCertifiedDays) },
        { label: 'Certified Through', value: r.certifiedThrough, tone: r.daysRemaining <= 1 ? 'red' : undefined },
        { label: 'Days Remaining', value: String(r.daysRemaining), tone: r.daysRemaining <= 1 ? 'red' : r.daysRemaining <= 3 ? 'amber' : undefined },
        { label: 'Uncertified Days', value: String(r.uncertifiedDays), tone: r.uncertifiedDays > 0 ? 'red' : undefined },
        { label: 'Next Review Due', value: r.nextReview },
        { label: 'Requested / Approved', value: `${r.daysRequested} / ${r.totalCertifiedDays}` },
        { label: 'Reviewer', value: r.reviewer },
        { label: 'Expected Discharge', value: r.expectedDischarge },
      ],
      note: r.nextAction,
      // No determination — including concurrent-review day extensions — is ever made from this dashboard.
      // Additional days always route to a formal reviewer instead of being approved here.
      actions: r.daysRequested > r.totalCertifiedDays
        ? [{ label: `Route ${r.daysRequested - r.totalCertifiedDays} additional day(s) to formal review`, tone: 'teal',
             run: () => this.routeForReview(r) }]
        : [],
    });
  }

  private routeForReview(r: ConcurrentRow) {
    const extra = r.daysRequested - r.totalCertifiedDays;
    this.esc.open({
      title: `Route ${r.member} for Formal Review`,
      candidates: [{
        authId: r.facility, member: r.member,
        detail: `${r.facility} · ${extra} additional day(s) requested beyond ${r.totalCertifiedDays} certified`,
        riskLabel: r.status, risk: r.statusTone as 'red' | 'amber' | 'green',
      }],
      targets: ESCALATE_TARGETS,
      apply: (_ids, who) => {
        this.ix.toast(`${r.member} routed to ${who} for formal determination — no days approved from this dashboard.`, 'warn');
        this.data.addHistory('arrowup', 'Routed for formal review', `${r.member} — ${extra} additional day(s) requested → ${who}`);
      },
    });
  }
}
