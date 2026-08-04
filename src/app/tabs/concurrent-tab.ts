import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData, liveConcurrentRows } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Escalate, ESCALATE_TARGETS } from '../shared/escalate';
import { Exporter } from '../shared/exporter';
import { ConcurrentRow } from '../data/dashboard.models';
import { WidgetActions } from '../shared/widget-actions';
import { LobFilter } from '../shared/lob-filter';
import { Lookback } from '../shared/lookback';

@Component({
  selector: 'app-concurrent-tab',
  standalone: true,
  imports: [WidgetActions],
  template: `
    <div class="tab-head">
      <h2>Concurrent Review Monitoring</h2>
      <span class="section-note">Active inpatient authorizations under review</span>
    </div>

    @if (!isHidden('table')) {
    <div class="panel">
      <z-widget-actions (exportClick)="exportTable()" (removeClick)="hide('table')"></z-widget-actions>
      <table class="z-table">
        <thead>
          <tr>
            <th>Member</th><th>Facility</th><th>Admit Date</th><th>Next Review Due</th>
            <th>LOS</th><th>Expected LOS</th><th>Days Approved</th><th>Days Requested</th>
            <th>Overstay Risk</th>
          </tr>
        </thead>
        <tbody>
          @for (r of concurrentRows(); track r.member) {
            <tr class="clickable" (click)="open(r)">
              <td class="strong">{{ r.member }}</td>
              <td>{{ r.facility }}</td>
              <td>{{ r.admit }}</td>
              <td>{{ r.nextReview }}</td>
              <td [class.danger]="r.losFlag">{{ r.los }}</td>
              <td>{{ r.expectedLos }}</td>
              <td class="num">{{ r.daysApproved }}</td>
              <td class="num">{{ r.daysRequested }}</td>
              <td><span class="badge" [class.red]="r.overstayRisk==='red'"
                    [class.amber]="r.overstayRisk==='amber'"
                    [class.green]="r.overstayRisk==='green'">{{ r.overstayLabel }}</span></td>
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
  `],
})
export class ConcurrentTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  private esc = inject(Escalate);
  private lobFilter = inject(LobFilter);
  private lookback = inject(Lookback);
  private exporter = inject(Exporter);

  // ---- per-tile "Remove from view" — session-only, like Pulse's widgets but with no saved-view persistence ----
  private hiddenTiles = signal<Set<string>>(new Set());
  isHidden(id: string) { return this.hiddenTiles().has(id); }
  hide(id: string) { this.hiddenTiles.update((s) => new Set(s).add(id)); }

  exportTable() {
    this.exporter.open({
      title: 'Concurrent Review Monitoring', name: 'concurrent-review_2026-07-17',
      columns: ['Member', 'Facility', 'Admit', 'Next Review', 'LOS', 'Expected LOS', 'Days Approved', 'Days Requested', 'Overstay Risk'],
      rows: this.concurrentRows().map((r) => [r.member, r.facility, r.admit, r.nextReview, r.los, r.expectedLos, r.daysApproved, r.daysRequested, r.overstayLabel]),
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
      badge: { text: `${r.overstayLabel} overstay risk`, tone: r.overstayRisk as any },
      fields: [
        { label: 'Admit Date', value: r.admit },
        { label: 'Next Review Due', value: r.nextReview },
        { label: 'Length of Stay', value: r.los, tone: r.losFlag ? 'red' : undefined },
        { label: 'Expected LOS', value: r.expectedLos },
        { label: 'Days Approved', value: String(r.daysApproved) },
        { label: 'Days Requested', value: String(r.daysRequested) },
        { label: 'Additional Days Pending', value: String(Math.max(0, r.daysRequested - r.daysApproved)), tone: 'amber' },
      ],
      note: r.daysRequested > r.daysApproved
        ? `Provider has requested ${r.daysRequested - r.daysApproved} additional day(s) beyond what is currently approved. This dashboard cannot approve additional days — route to a formal reviewer.`
        : 'All requested days are approved.',
      // No determination — including concurrent-review day extensions — is ever made from this dashboard.
      // Additional days always route to a formal reviewer instead of being approved here.
      actions: r.daysRequested > r.daysApproved
        ? [{ label: `Route ${r.daysRequested - r.daysApproved} additional day(s) to formal review`, tone: 'teal',
             run: () => this.routeForReview(r) }]
        : [],
    });
  }

  private routeForReview(r: ConcurrentRow) {
    const extra = r.daysRequested - r.daysApproved;
    this.esc.open({
      title: `Route ${r.member} for Formal Review`,
      candidates: [{
        authId: r.facility, member: r.member,
        detail: `${r.facility} · ${extra} additional day(s) requested beyond ${r.daysApproved} approved`,
        riskLabel: r.overstayLabel, risk: r.overstayRisk as 'red' | 'amber' | 'green',
      }],
      targets: ESCALATE_TARGETS,
      apply: (_ids, who) => {
        this.ix.toast(`${r.member} routed to ${who} for formal determination — no days approved from this dashboard.`, 'warn');
        this.data.addHistory('arrowup', 'Routed for formal review', `${r.member} — ${extra} additional day(s) requested → ${who}`);
      },
    });
  }
}
