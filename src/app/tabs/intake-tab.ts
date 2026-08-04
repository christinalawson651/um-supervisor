import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveQualityBars, liveMissingFields } from '../data/dashboard-data';
import { Metrics } from '../shared/metrics';
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
  { id: 'Needing RFI', title: 'Needing RFI' }, { id: 'missing-fields', title: 'Top Missing Fields' },
];

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

    @if (!isHidden('missing-fields')) {
    <div class="panel mt-6">
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
  `,
  styles: [`
    .bar-top z-icon { color: var(--gray-400); }
    .pct { margin-left: 12px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
      font-variant-numeric: tabular-nums; }
    .clickable { cursor: pointer; transition: box-shadow .12s; }
    .clickable:hover { box-shadow: 0 4px 12px rgba(16,24,40,.10); }
    .bar-block, .tbl-head { position: relative; }
    .bar-block:hover z-widget-actions, .tbl-head:hover z-widget-actions { opacity: 1; }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
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

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or a card's × ----
  readonly vis = new WidgetVisibility('zyter-um-intake-widgets-v1', INTAKE_WIDGETS);
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
}
