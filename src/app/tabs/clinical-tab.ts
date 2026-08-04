import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveDecisionStats, liveDecisionRows, inScope } from '../data/dashboard-data';
import { CASE_POOL } from '../data/case-pool';
import { urgencyOf, mdReviewerOf } from '../data/case-fields';
import { Interaction } from '../shared/interaction';
import { Metrics, COLUMNS, toRow } from '../shared/metrics';
import { Exporter } from '../shared/exporter';
import { DecisionRow } from '../data/dashboard.models';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Icon } from '../shared/icon';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

const CLINICAL_WIDGETS = [
  { id: 'Approved', title: 'Approved' }, { id: 'Denied', title: 'Denied' }, { id: 'Partial', title: 'Partial' },
  { id: 'Auto-Approved', title: 'Auto-Approved' }, { id: 'MD Review', title: 'MD Review' }, { id: 'P2P Rate', title: 'P2P Rate' },
  { id: 'drilldown', title: 'Decision Drilldown by Service' },
];

@Component({
  selector: 'app-clinical-tab',
  standalone: true,
  imports: [Icon, WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Clinical Decision Insights</h2>
      <span class="section-note">Decision quality remains strong across service types</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    <div class="dstats">
      @for (s of decisionStats(); track s.label; let i = $index) {
        @if (!isHidden(s.label)) {
          <div class="dstat clickable" [attr.data-tone]="s.tone" (click)="metrics.open(decKeys[i])">
            <z-widget-actions (exportClick)="exportStat(s, decKeys[i])" (removeClick)="hide(s.label)"></z-widget-actions>
            <div class="dic"><z-icon [name]="s.icon" [size]="20" [stroke]="1.8"></z-icon></div>
            <div class="dval">{{ s.value }}</div>
            <div class="dlab">{{ s.label }}</div>
          </div>
        }
      }
    </div>

    @if (!isHidden('drilldown')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Decision Drilldown by Service</h3>
        <z-widget-actions (exportClick)="exportDrilldown()" (removeClick)="hide('drilldown')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead>
          <tr>
            <th class="sortable" (click)="sortBy('procedure')">Diagnosis / Procedure{{ caret('procedure') }}</th>
            <th class="sortable" (click)="sortBy('serviceType')">Service Type{{ caret('serviceType') }}</th>
            <th>Guideline</th>
            <th class="sortable" (click)="sortBy('approvalRate')">Approval Rate{{ caret('approvalRate') }}</th>
            <th class="sortable" (click)="sortBy('volume')">Volume{{ caret('volume') }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of sortedRows(); track r.procedure) {
            <tr class="clickable" (click)="open(r)">
              <td class="strong">{{ r.procedure }}</td>
              <td><span class="stype" [attr.data-t]="r.serviceType">{{ r.serviceType }}</span></td>
              <td class="gl">{{ r.guideline }}</td>
              <td><span class="rate-pill" [class.good]="r.approvalRate >= 80"
                    [class.mid]="r.approvalRate < 80">{{ r.approvalRate }}%</span></td>
              <td class="num">{{ r.volume }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .dstats { display:grid; grid-template-columns: repeat(6, 1fr); gap: 14px; }
    .dstat { position: relative; background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 12px; text-align:center; }
    .dstat:hover z-widget-actions, .tbl-head:hover z-widget-actions { opacity: 1; }
    .tbl-head { position: relative; display: flex; align-items: center; justify-content: space-between; }
    .dic { display:flex; justify-content:center; margin-bottom: 10px; }
    .dval { font-size: 26px; font-weight: 700; color: var(--ink); }
    .dlab { font-size: 10.5px; letter-spacing:0.05em; text-transform:uppercase;
      color: var(--gray-500); font-weight:600; margin-top: 4px; }
    .dstat[data-tone="green"]{ border-top-color: var(--green); } .dstat[data-tone="green"] .dic{ color: var(--green); }
    .dstat[data-tone="red"]  { border-top-color: var(--red); }   .dstat[data-tone="red"] .dic{ color: var(--red); }
    .dstat[data-tone="amber"]{ border-top-color: var(--amber); } .dstat[data-tone="amber"] .dic{ color: var(--amber); }
    .dstat[data-tone="teal"] { border-top-color: var(--teal-600); } .dstat[data-tone="teal"] .dic{ color: var(--teal-700); }
    .dstat[data-tone="blue"] { border-top-color: var(--blue); }  .dstat[data-tone="blue"] .dic{ color: var(--blue); }
    .dstat[data-tone="purple"]{ border-top-color: var(--purple);} .dstat[data-tone="purple"] .dic{ color: var(--purple); }
    .gl { font-style: italic; color: var(--gray-500); }
    .stype { font-weight:600; font-size:12.5px; padding:3px 10px; border-radius:6px; }
    .stype[data-t="Inpatient"]  { background: var(--teal-100); color: var(--teal-900); }
    .stype[data-t="Outpatient"] { background: var(--green-bg); color: var(--green-fg); }
    .stype[data-t="Behavioral"] { background: var(--amber-bg); color: var(--amber-fg); }
    .clickable { cursor: pointer; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: var(--ink-soft); }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
  `],
})
export class ClinicalTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  private exporter = inject(Exporter);
  readonly decKeys = ['dec.approved', 'dec.denied', 'dec.partial', 'dec.auto', 'dec.md', 'dec.p2p'];

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or a card's × ----
  readonly vis = new WidgetVisibility('zyter-um-clinical-widgets-v1', CLINICAL_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  /** Exports the real cases behind the tile's percentage (same set its own click-through drilldown
   *  shows) — not just the single headline number. */
  exportStat(s: { label: string; value: string }, key: string) {
    const cases = this.metrics.cases(key);
    this.exporter.open({
      title: s.label, name: `clinical-${s.label.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      columns: COLUMNS, rows: cases.map(toRow),
    });
  }
  exportDrilldown() {
    this.exporter.open({
      title: 'Decision Drilldown by Service', name: 'clinical-drilldown_2026-07-17',
      columns: ['Procedure', 'Service Type', 'Guideline', 'Approval Rate %', 'Volume'],
      rows: this.sortedRows().map((r) => [r.procedure, r.serviceType, r.guideline, r.approvalRate, r.volume]),
    });
  }

  // ---- shared top-bar filters — same treatment as every other converted tab ----
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private scopeArgs(): [string | undefined, number | undefined] {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return [lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays()];
  }

  /** The 6 headline tiles — same liveDecisionStats() the global Export button reads, so the tile, its drilldown, and its export can never drift apart. */
  readonly decisionStats = computed(() => liveDecisionStats(...this.scopeArgs()));

  /** Per-procedure approval rate + volume — same liveDecisionRows() the global Export button reads. */
  readonly decisionRows = computed(() => liveDecisionRows(...this.scopeArgs()));

  readonly sortKey = signal<keyof DecisionRow | ''>('');
  readonly sortDir = signal<SortDir>(1);
  readonly sortedRows = computed(() => compareRows(this.decisionRows(), this.sortKey(), this.sortDir()));
  sortBy(k: keyof DecisionRow) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(k); this.sortDir.set(1); }
  }
  caret(k: keyof DecisionRow) { return caretFor(this.sortKey(), k, this.sortDir()); }

  open(r: DecisionRow) {
    this.ix.openDrawer({
      title: r.procedure,
      subtitle: `${r.serviceType} · ${r.guideline}`,
      badge: { text: `${r.approvalRate}% approval`, tone: r.approvalRate >= 80 ? 'green' : 'amber' },
      fields: [
        { label: 'Service Type', value: r.serviceType },
        { label: 'Guideline', value: r.guideline },
        { label: 'Approval Rate', value: `${r.approvalRate}%`, tone: r.approvalRate >= 80 ? 'green' : 'amber' },
        { label: 'Volume (MTD)', value: String(r.volume) },
        { label: 'Denials (est.)', value: String(Math.round(r.volume * (1 - r.approvalRate / 100))) },
      ],
      note: r.approvalRate < 75
        ? 'Approval rate is below the service-line benchmark. Review recent denials for guideline-application consistency.'
        : 'Approval rate is tracking in line with the service-line benchmark.',
      actions: [{ label: 'View decision log', tone: 'teal',
        run: () => this.openDecisionLog(r) }],
    });
  }

  /** Every decided case for this procedure, with the nurse reviewer who handled it and the MD
   *  reviewer tied to the determination (MD Reviewer only populated for cases that actually
   *  required MD/peer-to-peer review; Reviewer is '—' for auto-approved cases — no nurse touched them). */
  openDecisionLog(r: DecisionRow) {
    const [lob, days] = this.scopeArgs();
    const cases = CASE_POOL.filter((c) => c.phase === 'decided' && c.procedure === r.procedure && inScope(c, lob, days));
    this.ix.openExplorer({
      title: `${r.procedure} — Decision Log`,
      context: `${cases.length} decision(s) for ${r.procedure} · ${r.approvalRate}% approval rate`,
      columns: ['Auth ID', 'Member', 'Decision', 'Reviewer', 'MD Reviewer', 'Provider', 'Urgency', 'Submitted', 'TAT (h)', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.decision, c.nurse, mdReviewerOf(c) ?? '—', c.provider, urgencyOf(c), c.submitted, c.tatH, `$${c.cost.toLocaleString()}`]),
      exportName: `decision-log-${r.procedure.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }
}
