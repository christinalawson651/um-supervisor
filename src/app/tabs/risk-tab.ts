import { Component, inject, signal } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Members } from '../shared/members';
import { RiskCase } from '../data/dashboard.models';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-risk-tab',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="tab-head">
      <h2>Risk &amp; Escalation Panel</h2>
      <button class="btn primary" [disabled]="selected().size === 0" (click)="escalateSelected()">
        <z-icon name="arrowup" [size]="14"></z-icon> Escalate selected@if (selected().size) { ({{ selected().size }}) }
      </button>
    </div>

    <div class="rtiles">
      @for (t of data.riskTiles; track t.label) {
        <div class="rtile" [attr.data-tone]="t.tone">
          <div class="rt-lab"><span class="rt-ic" [attr.data-tone]="t.tone"><z-icon [name]="t.icon" [size]="14"></z-icon></span>{{ t.label }}</div>
          <div class="rt-val">{{ t.value }}</div>
          <div class="rt-foot" [attr.data-tone]="t.footerTone || null">{{ t.footer }}</div>
        </div>
      }
    </div>

    <div class="panel mt-6">
      <div class="panel-pad tbl-head">
        <h3 class="panel-title"><z-icon name="alert" [size]="14"></z-icon> Cases Requiring Attention</h3>
        <span class="note">Prioritized by risk score</span>
      </div>
      <table class="z-table">
        <thead>
          <tr>
            <th class="chk"><input type="checkbox" [checked]="allChecked()" (change)="toggleAll($event)" /></th>
            <th>Auth ID</th><th>Member</th><th>Risk Drivers</th><th>$ Amount</th>
            <th>Stage</th><th>Risk</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          @for (r of data.riskCases(); track r.authId) {
            <tr>
              <td class="chk"><input type="checkbox" [checked]="selected().has(r.authId)" (change)="toggle(r.authId)" /></td>
              <td class="authid">{{ r.authId }}</td>
              <td><a class="mlink" (click)="members.openByName(r.member)">{{ r.member }}</a></td>
              <td><span class="chips">@for (d of r.drivers; track d) { <span class="chip">{{ d }}</span> }</span></td>
              <td class="strong">{{ r.amount }}</td>
              <td>{{ r.stage }}</td>
              <td><span class="score" [class.red]="r.risk==='red'" [class.amber]="r.risk==='amber'">{{ r.score }}</span></td>
              <td><button class="btn outline teal sm" (click)="escalate(r)">Escalate</button></td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="empty">No cases requiring attention — all clear. ✓</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .rtiles { display:grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .rtile { background:#fff; border:1px solid var(--border); border-left:4px solid var(--gray-300);
      border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; }
    .rt-lab { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--gray-500); font-weight:600; }
    .rt-ic { width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center; }
    .rt-ic[data-tone="red"]{background:var(--red-bg);color:var(--red-fg);}
    .rt-ic[data-tone="amber"]{background:var(--amber-bg);color:var(--amber-fg);}
    .rt-ic[data-tone="blue"]{background:var(--blue-bg);color:var(--blue-fg);}
    .rt-val { font-size:26px; font-weight:700; color:var(--ink); margin:8px 0 4px; }
    .rt-foot { font-size:11px; color:var(--gray-500); }
    .rt-foot[data-tone="red"]{ color:var(--red); font-weight:600; }
    .rtile[data-tone="red"]{ border-left-color:var(--red); }
    .rtile[data-tone="amber"]{ border-left-color:var(--amber); }
    .rtile[data-tone="blue"]{ border-left-color:var(--purple); }
    .rtile[data-tone="blue"] .rt-ic{ background:#ede9fe; color:var(--purple); }

    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .panel-title { display:flex; align-items:center; gap:7px; }
    .note { font-size:11.5px; color:var(--gray-500); }
    .chk { width:36px; text-align:center; }
    .authid { color:var(--teal-700); font-weight:700; }
    .mlink { color:var(--blue-fg); font-weight:600; cursor:pointer; text-decoration:none; }
    .mlink:hover { text-decoration:underline; }
    .chips { display:flex; gap:6px; flex-wrap:wrap; }
    .chip { background:var(--gray-100); color:var(--gray-500); font-size:11px; font-weight:600;
      padding:2px 8px; border-radius:6px; white-space:nowrap; }
    .score { display:inline-block; min-width:34px; text-align:center; font-weight:700; font-size:12.5px;
      padding:3px 9px; border-radius:999px; }
    .score.red { background:var(--red-bg); color:var(--red-fg); }
    .score.amber { background:var(--amber-bg); color:var(--amber-fg); }
    .empty { text-align:center; color: var(--teal-700); font-weight:600; padding: 26px; }
  `],
})
export class RiskTab {
  data = inject(DashboardData);
  members = inject(Members);
  private ix = inject(Interaction);

  readonly selected = signal<Set<string>>(new Set());

  private readonly TARGETS = ['Dr. Patel — Medical Director', 'Dr. Nguyen — MD Review',
    'Dr. Rivera — MD Review', 'Peer-to-Peer Review Queue', 'Supervisor — Christina Lawson'];

  toggle(id: string) {
    this.selected.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  allChecked() { const c = this.data.riskCases(); return c.length > 0 && c.every((r) => this.selected().has(r.authId)); }
  toggleAll(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.selected.set(on ? new Set(this.data.riskCases().map((r) => r.authId)) : new Set());
  }

  escalate(r: RiskCase) {
    this.ix.choose({
      title: `Escalate ${r.authId}`,
      body: `Escalate this case (${r.member}, risk ${r.score}) for expedited review. Drivers: ${r.drivers.join(', ')}.`,
      label: 'Escalate to', options: this.TARGETS,
      confirmLabel: 'Escalate', tone: r.risk === 'red' ? 'red' : 'amber',
      onChoose: (who) => {
        this.data.resolveRiskCase(r.authId);
        this.selected.update((s) => { const n = new Set(s); n.delete(r.authId); return n; });
        this.ix.toast(`${r.authId} escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Case escalated', `${r.authId} (${r.member}) → ${who}`);
      },
    });
  }

  escalateSelected() {
    const ids = [...this.selected()];
    if (!ids.length) return;
    this.ix.choose({
      title: `Escalate ${ids.length} case(s)`,
      body: `Escalate the ${ids.length} selected case(s) for expedited review. Choose who to assign them to.`,
      label: 'Escalate to', options: this.TARGETS,
      confirmLabel: 'Escalate', tone: 'red',
      onChoose: (who) => {
        ids.forEach((id) => this.data.resolveRiskCase(id));
        this.ix.toast(`${ids.length} case(s) escalated to ${who}.`, 'warn');
        this.data.addHistory('arrowup', 'Cases escalated', `${ids.length} cases → ${who}`);
        this.selected.set(new Set());
      },
    });
  }
}
