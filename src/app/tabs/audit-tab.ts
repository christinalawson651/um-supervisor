import { Component, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Metrics } from '../shared/metrics';
import { AuditFlag } from '../data/dashboard.models';

@Component({
  selector: 'app-audit-tab',
  standalone: true,
  template: `
    <div class="tab-head">
      <h2>Audit &amp; Compliance</h2>
      <span class="section-note">Compliance metrics and audit trail</span>
    </div>

    <div class="grid-3">
      @for (b of data.complianceBars; track b.label; let i = $index) {
        <div class="panel panel-pad clickable" (click)="metrics.open(barKeys[i])">
          <div class="clab">{{ b.label }}</div>
          <div class="cval">{{ b.pct }}%</div>
          <div class="pbar"><span [style.width.%]="b.pct"></span></div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad"><h3 class="panel-title">Audit Flags</h3></div>
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
  `,
  styles: [`
    .clab { font-size: 12.5px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
    .cval { font-size: 26px; font-weight: 700; color: var(--ink); margin-bottom: 14px; }
    .clickable { cursor: pointer; }
    .empty { text-align:center; color: var(--teal-700); font-weight:600; padding: 26px; }
  `],
})
export class AuditTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);
  metrics = inject(Metrics);
  readonly barKeys = ['audit.doc', 'audit.guideline', 'audit.rationale'];

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
