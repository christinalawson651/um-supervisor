import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveComplianceBars } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { Exporter } from '../shared/exporter';
import { AuditFlag } from '../data/dashboard.models';
import { WidgetActions } from '../shared/widget-actions';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

@Component({
  selector: 'app-audit-tab',
  standalone: true,
  imports: [WidgetActions],
  template: `
    <div class="tab-head">
      <h2>Audit &amp; Compliance</h2>
      <span class="section-note">Compliance metrics and audit trail</span>
    </div>

    <div class="grid-3">
      @for (b of complianceBars(); track b.label; let i = $index) {
        @if (!isHidden(b.label)) {
          <div class="panel panel-pad bar-block clickable" (click)="metrics.open(barKeys[i])">
            <z-widget-actions (exportClick)="exportBar(b)" (removeClick)="hide(b.label)"></z-widget-actions>
            <div class="clab">{{ b.label }}</div>
            <div class="cval">{{ b.pct }}%</div>
            <div class="pbar"><span [style.width.%]="b.pct"></span></div>
          </div>
        }
      }
    </div>

    @if (!isHidden('audit-flags')) {
    <div class="panel mt-6">
      <div class="panel-pad tbl-head"><h3 class="panel-title">Audit Flags</h3>
        <z-widget-actions (exportClick)="exportFlags()" (removeClick)="hide('audit-flags')"></z-widget-actions>
      </div>
      <table class="z-table">
        <thead>
          <tr><th>ID</th><th>Type</th><th>Description</th><th>Date</th><th>Severity</th></tr>
        </thead>
        <tbody>
          @for (f of data.auditFlags(); track f.id) {
            <tr class="clickable" (click)="open(f)">
              <td class="strong">{{ f.id }}</td>
              <td>{{ f.type }}</td>
              <td>{{ f.description }}</td>
              <td>{{ f.date }}</td>
              <td><span class="badge" [class.red]="f.severity==='red'"
                    [class.amber]="f.severity==='amber'"
                    [class.green]="f.severity==='green'">{{ f.severityLabel }}</span></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">No open audit flags — all resolved. ✓</td></tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .clab { font-size: 12.5px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
    .cval { font-size: 26px; font-weight: 700; color: var(--ink); margin-bottom: 14px; }
    .clickable { cursor: pointer; }
    .empty { text-align:center; color: var(--teal-700); font-weight:600; padding: 26px; }
    .bar-block, .tbl-head { position: relative; }
    .bar-block:hover z-widget-actions, .tbl-head:hover z-widget-actions { opacity: 1; }
  `],
})
export class AuditTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);
  readonly barKeys = ['audit.doc', 'audit.guideline', 'audit.rationale'];

  readonly complianceBars = computed(() => {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return liveComplianceBars(lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays());
  });

  // ---- per-tile "Remove from view" — session-only, like Pulse's widgets but with no saved-view persistence ----
  private hiddenTiles = signal<Set<string>>(new Set());
  isHidden(id: string) { return this.hiddenTiles().has(id); }
  hide(id: string) { this.hiddenTiles.update((s) => new Set(s).add(id)); }

  exportBar(b: { label: string; pct: number }) {
    this.exporter.open({ title: b.label, name: `audit-${b.label.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`, columns: ['Metric', 'Value'], rows: [[b.label, `${b.pct}%`]] });
  }
  exportFlags() {
    this.exporter.open({
      title: 'Audit Flags', name: 'audit-flags_2026-07-17',
      columns: ['ID', 'Type', 'Description', 'Date', 'Severity'],
      rows: this.data.auditFlags().map((f) => [f.id, f.type, f.description, f.date, f.severityLabel]),
    });
  }

  open(f: AuditFlag) {
    this.ix.openDrawer({
      title: `${f.id} · ${f.type}`,
      subtitle: `Flagged ${f.date}`,
      badge: { text: `${f.severityLabel} severity`, tone: f.severity as any },
      fields: [
        { label: 'Flag ID', value: f.id },
        { label: 'Type', value: f.type },
        { label: 'Date', value: f.date },
        { label: 'Severity', value: f.severityLabel, tone: f.severity as any },
      ],
      note: f.description,
      actions: [{
        label: 'Mark as resolved', tone: 'teal',
        run: () => {
          this.data.resolveAuditFlag(f.id);
          this.ix.toast(`Audit flag ${f.id} marked resolved.`);
          this.data.addHistory('check', 'Audit flag resolved', `${f.id} — ${f.type}`);
        },
      }],
    });
  }
}
