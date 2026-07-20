import { Component, computed, inject, signal } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { DecisionRow } from '../data/dashboard.models';
import { compareRows, caretFor, SortDir } from '../shared/sort';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-clinical-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Clinical Decision Insights</h2>
      <span class="section-note">Decision quality remains strong across service types</span>
    </div>

    <div class="dstats">
      @for (s of data.decisionStats; track s.label; let i = $index) {
        <div class="dstat clickable" [attr.data-tone]="s.tone" (click)="metrics.open(decKeys[i])">
          <div class="dic"><z-icon [name]="s.icon" [size]="20" [stroke]="1.8"></z-icon></div>
          <div class="dval">{{ s.value }}</div>
          <div class="dlab">{{ s.label }}</div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">Decision Drilldown by Service</h3></div>
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
  `,
  styles: [`
    .dstats { display:grid; grid-template-columns: repeat(6, 1fr); gap: 14px; }
    .dstat { background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 12px; text-align:center; }
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
  `],
})
export class ClinicalTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  readonly decKeys = ['dec.approved', 'dec.denied', 'dec.partial', 'dec.auto', 'dec.md', 'dec.p2p'];

  readonly sortKey = signal<keyof DecisionRow | ''>('');
  readonly sortDir = signal<SortDir>(1);
  readonly sortedRows = computed(() => compareRows(this.data.decisionRows, this.sortKey(), this.sortDir()));
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
        run: () => this.ix.toast(`Opening decision log for ${r.procedure}…`, 'info') }],
    });
  }
}
