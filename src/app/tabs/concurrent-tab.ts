import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveConcurrentRows } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Escalate, ESCALATE_TARGETS } from '../shared/escalate';
import { Exporter } from '../shared/exporter';
import { ConcurrentRow } from '../data/dashboard.models';
import { WidgetActions } from '../shared/widget-actions';
import { WidgetVisibility } from '../shared/widget-visibility';
import { WidgetCustomize } from '../shared/widget-customize';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

const CONCURRENT_WIDGETS = [{ id: 'table', title: 'Concurrent Review Monitoring' }];

@Component({
  selector: 'app-concurrent-tab',
  standalone: true,
  imports: [WidgetActions, WidgetCustomize],
  template: `
    <div class="tab-head">
      <h2>Concurrent Review Monitoring</h2>
      <span class="section-note">Active inpatient authorizations under review</span>
      <button class="btn outline cz-btn" (click)="vis.customizing() ? vis.cancel() : vis.open()">Customize</button>
    </div>

    <z-widget-customize [vis]="vis"></z-widget-customize>

    @if (!isHidden('table')) {
    <div class="panel">
      <z-widget-actions (exportClick)="exportTable()" (removeClick)="hide('table')"></z-widget-actions>
      <table class="z-table">
        <thead>
          <tr>
            <th>Member</th><th>Facility</th><th>LOS</th>
            <th>Total Certified Days</th><th>Certified Through</th><th>Days Remaining</th><th>Uncertified Days</th>
            <th>Next Review Due</th><th>Requested/Approved</th><th>Status</th><th>Reviewer</th>
            <th>Expected Discharge</th><th>Next Action</th>
          </tr>
        </thead>
        <tbody>
          @for (r of concurrentRows(); track r.member) {
            <tr class="clickable" (click)="open(r)">
              <td class="strong">{{ r.member }}</td>
              <td>{{ r.facility }}</td>
              <td [class.danger]="r.losFlag">{{ r.los }}</td>
              <td class="num">{{ r.totalCertifiedDays }}</td>
              <td>{{ r.certifiedThrough }}</td>
              <td class="num" [class.danger]="r.daysRemaining <= 1" [class.warn]="r.daysRemaining > 1 && r.daysRemaining <= 3">{{ r.daysRemaining }}</td>
              <td class="num" [class.danger]="r.uncertifiedDays > 0">{{ r.uncertifiedDays }}</td>
              <td>{{ r.nextReview }}</td>
              <td class="num">{{ r.daysRequested }} / {{ r.totalCertifiedDays }}</td>
              <td><span class="badge" [class.red]="r.statusTone==='red'"
                    [class.amber]="r.statusTone==='amber'"
                    [class.green]="r.statusTone==='green'">{{ r.status }}</span></td>
              <td>{{ r.reviewer }}</td>
              <td>{{ r.expectedDischarge }}</td>
              <td class="na">{{ r.nextAction }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    }
  `,
  styles: [`
    .clickable { cursor: pointer; }
    .panel { position: relative; }
    .panel:hover z-widget-actions { opacity: 1; }
    .tab-head { flex-wrap: wrap; justify-content: flex-start; gap: 12px 16px; }
    .cz-btn { margin-left: auto; flex-shrink: 0; }
    .warn { color: var(--amber-fg); font-weight: 600; }
    .na { color: var(--ink-soft); font-size: 12.5px; white-space: normal; min-width: 220px; }
  `],
})
export class ConcurrentTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private esc = inject(Escalate);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);

  // ---- widget visibility — persisted (saved/reset), toggled via the Customize picker or the panel's × ----
  readonly vis = new WidgetVisibility('zyter-um-concurrent-widgets-v1', CONCURRENT_WIDGETS);
  isHidden(id: string) { return this.vis.isHidden(id); }
  hide(id: string) { this.vis.remove(id); }

  exportTable() {
    this.exporter.open({
      title: 'Concurrent Review Monitoring', name: 'concurrent-review_2026-07-17',
      columns: ['Member', 'Facility', 'LOS', 'Total Certified Days', 'Certified Through', 'Days Remaining',
        'Uncertified Days', 'Next Review Due', 'Requested/Approved', 'Status', 'Reviewer', 'Expected Discharge', 'Next Action'],
      rows: this.concurrentRows().map((r) => [r.member, r.facility, r.los, r.totalCertifiedDays, r.certifiedThrough,
        r.daysRemaining, r.uncertifiedDays, r.nextReview, `${r.daysRequested} / ${r.totalCertifiedDays}`, r.status, r.reviewer, r.expectedDischarge, r.nextAction]),
    });
  }

  /** Real concurrent-review rows derived from the case pool, scoped by the shared LOB + Lookback filters. */
  readonly concurrentRows = computed(() => {
    const lob = this.lobFilter.value();
    const period = this.lookback.period();
    return liveConcurrentRows(lob === 'all' ? undefined : lob, period === '30d' ? undefined : this.lookback.windowDays());
  });

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
