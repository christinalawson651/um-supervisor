import { Component, computed, inject } from '@angular/core';
import { DashboardData, liveQualityBars, liveMissingFields, inScope } from '../data/dashboard-data';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import {
  urgencyOf, INTAKE_CHANNELS, intakeChannelOf, RoutingStatus, routingStatusOf,
  isDuplicateOf, duplicateResolvedOf, MissingInfoCategory, missingInfoCategoryOf,
  ReviewType, reviewTypeOf, providerIssueOf, IntakeProcessingStatus, intakeProcessingStatusOf,
} from '../data/case-fields';
import { Metrics, COLUMNS, toRow } from '../shared/metrics';
import { Interaction } from '../shared/interaction';
import { MissingField } from '../data/dashboard.models';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { Exporter } from '../shared/exporter';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

const INTAKE_WIDGETS = [
  { id: 'Complete Submissions', title: 'Complete Submissions' }, { id: 'Auto-Approved', title: 'Auto-Approved' },
  { id: 'Needing RFI', title: 'Needing RFI' },
  { id: 'channel-mix', title: 'Intake Channel Mix' },
  { id: 'routing', title: 'Routing Status' },
  { id: 'duplicates', title: 'Duplicates' },
  { id: 'tat-risk', title: 'TAT & Assignment Risk' },
  { id: 'missing-info', title: 'Missing Information' },
  { id: 'missing-fields', title: 'Top Missing Fields' },
  { id: 'review-type', title: 'Auth Type (Review Timing)' },
  { id: 'provider-issues', title: 'Provider Issues' },
  { id: 'auto-processing', title: 'Intake Auto-Processing' },
];

const ROUTING_ORDER: RoutingStatus[] = ['Smart', 'Manual', 'Late'];
const MISSING_INFO_ORDER: MissingInfoCategory[] = ['Intake Form — Illegible', 'Intake Form — Missing Fields', 'Clinicals Missing', 'Provider Info Missing'];
const REVIEW_TYPE_ORDER: ReviewType[] = ['Pre-Auth', 'Concurrent Review', 'Retro'];
const PROCESSING_ORDER: IntakeProcessingStatus[] = ['Completed', 'Failed', 'No Shell Created'];

@Component({
  selector: 'app-intake-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Intake &amp; Documentation Quality</h2>
      <span class="section-note">Documentation quality is tracking positively</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    <div class="grid-3">
      @for (b of qualityBars(); track b.label; let i = $index) {
        @if (!isHidden(b.label)) {
          <div class="panel panel-pad bar-block clickable" (click)="metrics.open(barKeys[i])">
            <z-widget-actions (exportClick)="exportBar(b)" (removeClick)="hide(b.label)"></z-widget-actions>
            <div class="bar-top"><z-icon [name]="b.icon" [size]="15" [stroke]="1.8"></z-icon>{{ b.label }}</div>
            <div class="bar-val" [class.amber]="b.tone==='amber'">{{ b.pct }}%</div>
            <div class="pbar" [class.amber]="b.tone==='amber'">
              <span [style.width.%]="b.pct"></span>
            </div>
          </div>
        }
      }
    </div>

    <div class="grid-2 mt-6">
      <!-- Intake Channel Mix -->
      @if (!isHidden('channel-mix')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Intake Channel Mix</h3>
          <z-widget-actions (exportClick)="exportChannelMix()" (removeClick)="hide('channel-mix')"></z-widget-actions>
        </div>
        <div class="ilist narrow">
          @for (c of channelMix(); track c.channel) {
            <div class="irow clk" (click)="drillChannel(c.channel)">
              <div class="ilab">{{ c.channel }}</div>
              <div class="ibar-track"><div class="ibar-fill teal" [style.width.%]="c.pct"></div></div>
              <div class="icount">{{ c.count }} · {{ c.pct }}%</div>
            </div>
          }
        </div>
      </div>
      }

      <!-- Routing Status -->
      @if (!isHidden('routing')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Routing Status</h3>
          <z-widget-actions (exportClick)="exportRouting()" (removeClick)="hide('routing')"></z-widget-actions>
        </div>
        <table class="z-table">
          <thead><tr><th>Routing</th><th class="num">Standard</th><th class="num">Expedited</th><th class="num">Total</th></tr></thead>
          <tbody>
            @for (r of routingRows(); track r.status) {
              <tr>
                <td class="strong"><span class="badge" [class.green]="r.status==='Smart'" [class.blue]="r.status==='Manual'" [class.red]="r.status==='Late'">{{ r.status }}</span></td>
                <td class="num clk" (click)="drillRouting(r.status, 'Standard')">{{ r.standard }}</td>
                <td class="num clk" (click)="drillRouting(r.status, 'Expedited')">{{ r.expedited }}</td>
                <td class="num clk strong" (click)="drillRouting(r.status)">{{ r.total }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      }
    </div>

    <div class="grid-2 mt-6">
      <!-- Duplicates -->
      @if (!isHidden('duplicates')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Duplicates</h3>
          <z-widget-actions (exportClick)="exportDuplicates()" (removeClick)="hide('duplicates')"></z-widget-actions>
        </div>
        <div class="tiles2">
          <div class="tile clk" (click)="drillDuplicates(false)">
            <div class="tval danger">{{ duplicateStats().unresolved }}</div><div class="tlab">Unresolved</div>
          </div>
          <div class="tile clk" (click)="drillDuplicates(true)">
            <div class="tval">{{ duplicateStats().resolved }}</div><div class="tlab">Resolved</div>
          </div>
        </div>
      </div>
      }

      <!-- TAT & Assignment Risk -->
      @if (!isHidden('tat-risk')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">TAT &amp; Assignment Risk</h3>
          <z-widget-actions (exportClick)="exportTatRisk()" (removeClick)="hide('tat-risk')"></z-widget-actions>
        </div>
        <div class="tiles2">
          <div class="tile clk" (click)="drillApproachingTat()">
            <div class="tval danger">{{ tatRiskStats().approachingTat }}</div><div class="tlab">Approaching TAT</div>
          </div>
          <div class="tile clk" (click)="drillUnassigned()">
            <div class="tval amber">{{ tatRiskStats().unassigned }}</div><div class="tlab">Unassigned</div>
          </div>
        </div>
      </div>
      }
    </div>

    <div class="grid-2 mt-6">
      <!-- Missing Information -->
      @if (!isHidden('missing-info')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Missing Information</h3>
          <z-widget-actions (exportClick)="exportMissingInfo()" (removeClick)="hide('missing-info')"></z-widget-actions>
        </div>
        <div class="ilist narrow">
          @for (m of missingInfoRows(); track m.category) {
            <div class="irow clk" (click)="drillMissingInfo(m.category)">
              <div class="ilab">{{ m.category }}</div>
              <div class="ibar-track"><div class="ibar-fill amber" [style.width.%]="m.pct"></div></div>
              <div class="icount">{{ m.count }} · {{ m.pct }}%</div>
            </div>
          }
          @if (!missingInfoRows().length) { <div class="iempty">No incomplete submissions in the current scope.</div> }
        </div>
      </div>
      }

      <!-- Top Missing Fields -->
      @if (!isHidden('missing-fields')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Top Missing Fields</h3>
          <z-widget-actions (exportClick)="exportMissingFields()" (removeClick)="hide('missing-fields')"></z-widget-actions>
        </div>
        <table class="z-table">
          <thead>
            <tr><th>Field</th><th>Missing Count</th><th>% of Submissions</th></tr>
          </thead>
          <tbody>
            @for (f of missingFields(); track f.field) {
              <tr class="clickable" (click)="openField(f)">
                <td class="strong">{{ f.field }}</td>
                <td class="num">{{ f.count }}</td>
                <td>
                  <span class="mini-bar"><span [style.width.%]="f.pct"></span></span>
                  <span class="pct">{{ f.pct }}%</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      }
    </div>

    <div class="grid-2 mt-6">
      <!-- Auth Type / Review Timing -->
      @if (!isHidden('review-type')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Auth Type (Review Timing)</h3>
          <z-widget-actions (exportClick)="exportReviewType()" (removeClick)="hide('review-type')"></z-widget-actions>
        </div>
        <div class="ilist pad">
          @for (r of reviewTypeMix(); track r.type) {
            <div class="irow clk" (click)="drillReviewType(r.type)">
              <div class="ilab">{{ r.type }}</div>
              <div class="ibar-track"><div class="ibar-fill teal" [style.width.%]="r.pct"></div></div>
              <div class="icount">{{ r.count }} · {{ r.pct }}%</div>
            </div>
          }
        </div>
      </div>
      }

      <!-- Provider Issues -->
      @if (!isHidden('provider-issues')) {
      <div class="panel">
        <div class="panel-pad tbl-head"><h3 class="panel-title">Provider Issues</h3>
          <z-widget-actions (exportClick)="exportProviderIssues()" (removeClick)="hide('provider-issues')"></z-widget-actions>
        </div>
        <div class="tiles2">
          <div class="tile clk" (click)="drillProviderIssue('Incomplete')">
            <div class="tval amber">{{ providerIssueStats().incomplete }}</div><div class="tlab">Incomplete</div>
          </div>
          <div class="tile clk" (click)="drillProviderIssue('Out of Network')">
            <div class="tval danger">{{ providerIssueStats().oon }}</div><div class="tlab">Out of Network</div>
          </div>
        </div>
      </div>
      }
    </div>

    <!-- Intake Auto-Processing -->
    @if (!isHidden('auto-processing')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Intake Auto-Processing</h3>
        <span class="section-note sm">Auth request received — did the system create a working authorization shell?</span>
        <z-widget-actions (exportClick)="exportProcessing()" (removeClick)="hide('auto-processing')"></z-widget-actions>
      </div>
      <div class="tiles3">
        @for (p of processingStats(); track p.status) {
          <div class="tile clk" [class.flag]="p.status==='No Shell Created'" (click)="drillProcessing(p.status)">
            <div class="tval" [class.danger]="p.status==='No Shell Created'" [class.amber]="p.status==='Failed'">{{ p.count }}</div>
            <div class="tlab">{{ p.status }}{{ p.status==='No Shell Created' ? ' — Action Needed' : '' }}</div>
          </div>
        }
      </div>
    </div>
    }
  `,
  styles: [`
    .bar-top z-icon { color: var(--gray-400); }
    .pct { margin-left: 12px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
      font-variant-numeric: tabular-nums; }
    .clickable { cursor: pointer; transition: box-shadow .12s; }
    .clickable:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); }
    .bar-block, .tbl-head { position: relative; }
    .bar-block:hover z-widget-actions, .tbl-head:hover z-widget-actions,
    .panel:hover z-widget-actions { opacity: 1; }
    .panel { position: relative; }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .tbl-head { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; padding-right: 44px; }
    .section-note.sm { font-size: 12px; color: var(--gray-500); font-weight: 500; }
    .clk { cursor: pointer; }

    .ilist { padding: 6px 20px 18px; display: flex; flex-direction: column; gap: 8px; }
    .ilist.pad { padding: 6px 20px 20px; }
    .ilist.narrow .irow { grid-template-columns: minmax(100px, 160px) 1fr 76px; gap: 10px; }
    .irow { display: grid; grid-template-columns: minmax(140px, 220px) 1fr 90px; align-items: center; gap: 14px;
      padding: 6px 8px; border-radius: 6px; }
    .irow:hover { background: var(--gray-100); }
    .ilab { font-size: 13px; color: var(--ink-soft); font-weight: 600; }
    .ibar-track { height: 8px; background: var(--gray-100); border-radius: 4px; overflow: hidden; }
    .ibar-fill { height: 100%; border-radius: 4px; }
    .ibar-fill.teal { background: var(--teal-600); }
    .ibar-fill.amber { background: var(--amber); }
    .icount { text-align: right; font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--gray-500); }
    .iempty { color: var(--gray-500); font-size: 13px; padding: 8px; }

    .tiles2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 4px 20px 20px; }
    .tiles3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 4px 20px 20px; }
    .tile { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 16px 12px; text-align: center; cursor: pointer; transition: box-shadow .12s; }
    .tile:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); }
    .tile.flag { border-color: var(--red); background: var(--red-bg); }
    .tval { font-size: 24px; font-weight: 700; color: var(--ink); }
    .tval.danger { color: var(--red); }
    .tval.amber { color: var(--amber-fg); }
    .tlab { font-size: 11.5px; color: var(--gray-500); font-weight: 600; margin-top: 4px; }

    .badge.blue { background: var(--blue-bg); color: var(--blue-fg); }
  `],
})
export class IntakeTab {
  data = inject(DashboardData);
  metrics = inject(Metrics);
  private ix = inject(Interaction);
  private exporter = inject(Exporter);
  readonly barKeys = ['intake.complete', 'intake.auto', 'intake.rfi'];

  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }
  readonly qualityBars = computed(() => liveQualityBars(...this.scopeArgs()));
  readonly missingFields = computed(() => liveMissingFields(...this.scopeArgs()));

  /** Every pending authorization in the current LOB/Lookback scope — the shared base every new
   *  Intake panel below filters/groups further, so a tile's count and its drill-down never drift. */
  readonly pendingScoped = computed(() => {
    const [lob, days] = this.scopeArgs();
    return CASE_POOL.filter((c) => c.phase === 'pending' && inScope(c, lob, days));
  });

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or a card's × ----
  readonly vis = new WidgetVisibility('zyter-um-intake-widgets-v2', INTAKE_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  exportBar(b: { label: string; pct: number }) {
    this.exporter.open({ title: b.label, name: `intake-${b.label.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`, columns: ['Metric', 'Value'], rows: [[b.label, `${b.pct}%`]] });
  }
  exportMissingFields() {
    this.exporter.open({
      title: 'Top Missing Fields', name: 'intake-missing-fields_2026-07-17',
      columns: ['Field', 'Missing Count', '% of Submissions'],
      rows: this.missingFields().map((f) => [f.field, f.count, f.pct]),
    });
  }
  openField(f: MissingField) {
    this.ix.openDrawer({
      title: f.field,
      subtitle: 'Top missing field — submissions this month',
      badge: { text: `${f.pct}% of submissions`, tone: f.pct >= 30 ? 'red' : f.pct >= 15 ? 'amber' : 'teal' },
      fields: [
        { label: 'Submissions Missing This Field', value: String(f.count) },
        { label: '% of All Submissions', value: `${f.pct}%` },
      ],
      note: 'Aggregated across the month\'s intake volume — see the current RFI Pending queue for the specific open authorizations.',
      actions: [{ label: 'View RFI Pending queue', tone: 'teal', run: () => this.metrics.open('intake.rfi') }],
    });
  }

  /** Every new Intake drill opens the standard, full-featured Case Explorer — Reassign selected
   *  (with its Assignee/Queue toggle), Escalate selected, and Balance all come for free from that
   *  one component. */
  private openCases(title: string, cs: CaseRec[], exportSlug: string, context?: string) {
    this.ix.openExplorer({
      title, context: context ?? `${cs.length} pending authorization(s)`,
      columns: COLUMNS, rows: cs.map(toRow),
      exportName: `intake-${exportSlug}_2026-07-17`, memberColumn: 1,
    });
  }

  // ---- Intake Channel Mix ----
  readonly channelMix = computed(() => {
    const cs = this.pendingScoped();
    const total = cs.length || 1;
    return INTAKE_CHANNELS.map((channel) => {
      const count = cs.filter((c) => intakeChannelOf(c) === channel).length;
      return { channel, count, pct: Math.round((count / total) * 100) };
    }).sort((a, b) => b.count - a.count);
  });
  drillChannel(channel: string) {
    const cs = this.pendingScoped().filter((c) => intakeChannelOf(c) === channel);
    this.openCases(`Intake Channel — ${channel}`, cs, `channel-${channel.toLowerCase()}`, `${cs.length} pending authorization(s) submitted via ${channel}`);
  }
  exportChannelMix() {
    this.exporter.open({ title: 'Intake Channel Mix', name: 'intake-channel-mix_2026-07-17', columns: ['Channel', 'Count', '% of Pending'], rows: this.channelMix().map((c) => [c.channel, c.count, c.pct]) });
  }

  // ---- Routing Status ----
  readonly routingRows = computed(() => {
    const cs = this.pendingScoped();
    return ROUTING_ORDER.map((status) => {
      const matched = cs.filter((c) => routingStatusOf(c) === status);
      return {
        status,
        standard: matched.filter((c) => urgencyOf(c) === 'Standard').length,
        expedited: matched.filter((c) => urgencyOf(c) === 'Expedited').length,
        total: matched.length,
      };
    });
  });
  drillRouting(status: RoutingStatus, urgency?: 'Standard' | 'Expedited') {
    let cs = this.pendingScoped().filter((c) => routingStatusOf(c) === status);
    if (urgency) cs = cs.filter((c) => urgencyOf(c) === urgency);
    const label = urgency ? `${status} Routing — ${urgency}` : `${status} Routing`;
    this.openCases(label, cs, `routing-${status.toLowerCase()}${urgency ? '-' + urgency.toLowerCase() : ''}`);
  }
  exportRouting() {
    this.exporter.open({ title: 'Routing Status', name: 'intake-routing_2026-07-17', columns: ['Routing', 'Standard', 'Expedited', 'Total'], rows: this.routingRows().map((r) => [r.status, r.standard, r.expedited, r.total]) });
  }

  // ---- Duplicates ----
  readonly duplicateStats = computed(() => {
    const cs = this.pendingScoped().filter((c) => isDuplicateOf(c));
    const resolved = cs.filter((c) => duplicateResolvedOf(c)).length;
    return { total: cs.length, resolved, unresolved: cs.length - resolved };
  });
  drillDuplicates(resolved: boolean) {
    const cs = this.pendingScoped().filter((c) => isDuplicateOf(c) && duplicateResolvedOf(c) === resolved);
    this.openCases(`Duplicates — ${resolved ? 'Resolved' : 'Unresolved'}`, cs, `duplicates-${resolved ? 'resolved' : 'unresolved'}`);
  }
  exportDuplicates() {
    const s = this.duplicateStats();
    this.exporter.open({ title: 'Duplicates', name: 'intake-duplicates_2026-07-17', columns: ['Metric', 'Value'], rows: [['Resolved', s.resolved], ['Unresolved', s.unresolved]] });
  }

  // ---- TAT & Assignment Risk ----
  readonly tatRiskStats = computed(() => {
    const cs = this.pendingScoped();
    return {
      approachingTat: cs.filter((c) => c.tags.includes('atRisk')).length,
      unassigned: cs.filter((c) => c.tags.includes('unassigned')).length,
    };
  });
  drillApproachingTat() {
    this.openCases('Approaching TAT', this.pendingScoped().filter((c) => c.tags.includes('atRisk')), 'approaching-tat');
  }
  drillUnassigned() {
    this.openCases('Unassigned', this.pendingScoped().filter((c) => c.tags.includes('unassigned')), 'unassigned');
  }
  exportTatRisk() {
    const s = this.tatRiskStats();
    this.exporter.open({ title: 'TAT & Assignment Risk', name: 'intake-tat-risk_2026-07-17', columns: ['Metric', 'Value'], rows: [['Approaching TAT', s.approachingTat], ['Unassigned', s.unassigned]] });
  }

  // ---- Missing Information (category) ----
  readonly missingInfoRows = computed(() => {
    const cs = this.pendingScoped().filter((c) => c.tags.includes('incompleteDoc'));
    const total = cs.length || 1;
    return MISSING_INFO_ORDER
      .map((category) => {
        const count = cs.filter((c) => missingInfoCategoryOf(c) === category).length;
        return { category, count, pct: Math.round((count / total) * 100) };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  });
  drillMissingInfo(category: MissingInfoCategory) {
    const cs = this.pendingScoped().filter((c) => missingInfoCategoryOf(c) === category);
    this.openCases(category, cs, `missing-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  exportMissingInfo() {
    this.exporter.open({ title: 'Missing Information', name: 'intake-missing-info_2026-07-17', columns: ['Category', 'Count', '% of Incomplete'], rows: this.missingInfoRows().map((m) => [m.category, m.count, m.pct]) });
  }

  // ---- Auth Type (review timing) ----
  readonly reviewTypeMix = computed(() => {
    const cs = this.pendingScoped();
    const total = cs.length || 1;
    return REVIEW_TYPE_ORDER.map((type) => {
      const count = cs.filter((c) => reviewTypeOf(c) === type).length;
      return { type, count, pct: Math.round((count / total) * 100) };
    });
  });
  drillReviewType(type: ReviewType) {
    const cs = this.pendingScoped().filter((c) => reviewTypeOf(c) === type);
    this.openCases(type, cs, `review-type-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  exportReviewType() {
    this.exporter.open({ title: 'Auth Type (Review Timing)', name: 'intake-review-type_2026-07-17', columns: ['Type', 'Count', '% of Pending'], rows: this.reviewTypeMix().map((r) => [r.type, r.count, r.pct]) });
  }

  // ---- Provider Issues ----
  readonly providerIssueStats = computed(() => {
    const cs = this.pendingScoped();
    return {
      incomplete: cs.filter((c) => providerIssueOf(c) === 'Incomplete').length,
      oon: cs.filter((c) => providerIssueOf(c) === 'Out of Network').length,
    };
  });
  drillProviderIssue(issue: 'Incomplete' | 'Out of Network') {
    const cs = this.pendingScoped().filter((c) => providerIssueOf(c) === issue);
    this.openCases(`Provider Issue — ${issue}`, cs, `provider-${issue.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  exportProviderIssues() {
    const s = this.providerIssueStats();
    this.exporter.open({ title: 'Provider Issues', name: 'intake-provider-issues_2026-07-17', columns: ['Metric', 'Value'], rows: [['Incomplete', s.incomplete], ['Out of Network', s.oon]] });
  }

  // ---- Intake Auto-Processing ----
  readonly processingStats = computed(() => {
    const cs = this.pendingScoped().filter((c) => c.tags.includes('intake'));
    return PROCESSING_ORDER.map((status) => ({ status, count: cs.filter((c) => intakeProcessingStatusOf(c) === status).length }));
  });
  drillProcessing(status: IntakeProcessingStatus) {
    const cs = this.pendingScoped().filter((c) => c.tags.includes('intake') && intakeProcessingStatusOf(c) === status);
    this.openCases(`Intake Auto-Processing — ${status}`, cs, `processing-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  exportProcessing() {
    this.exporter.open({ title: 'Intake Auto-Processing', name: 'intake-auto-processing_2026-07-17', columns: ['Status', 'Count'], rows: this.processingStats().map((p) => [p.status, p.count]) });
  }
}
