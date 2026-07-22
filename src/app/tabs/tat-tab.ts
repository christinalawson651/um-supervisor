import { Component, computed, inject } from '@angular/core';
import { DashboardData } from '../data/dashboard-data';
import { Interaction } from '../shared/interaction';
import { Ring } from '../shared/ring';
import { CASE_POOL, CaseRec } from '../data/case-pool';

const LOBS = ['Medicaid', 'Medicare Advantage', 'Commercial PPO', 'ACA Exchange'];
function lobOf(id: string) { return LOBS[Number(id.slice(-2)) % LOBS.length]; }
function programOf(c: CaseRec) {
  if (c.serviceType === 'Inpatient') return 'Inpatient';
  if (c.serviceType === 'Behavioral') return 'Behavioral Health';
  const h = Number(c.authId.slice(-1)) % 3;
  return h === 0 ? 'Pharmacy' : h === 1 ? 'DME / Home Health' : 'Outpatient';
}
function tatStatus(c: CaseRec) {
  return c.tags.includes('onTrack') ? 'On Track' : c.tags.includes('atRisk') ? 'At Risk' : c.tags.includes('breached') ? 'Breached' : 'On Track';
}

@Component({
  selector: 'app-tat-tab',
  standalone: true,
  imports: [Ring],
  template: `
    <div class="tab-head">
      <h2>TAT &amp; SLA Compliance</h2>
      <span class="section-note">Strong compliance — your team is meeting targets</span>
    </div>

    <div class="panel panel-pad">
      <div class="tat-grid">
        <div class="left">
          <div class="donut">
            <z-ring [value]="data.tatCompliance" [size]="120" [thickness]="12" tone="teal"></z-ring>
            <div class="donut-lab">TAT Compliance</div>
          </div>
          <div class="rows">
            @for (b of data.tatBuckets; track b.label) {
              <div class="row" [attr.data-tone]="b.tone"><span><i></i>{{ b.label }}</span><b>{{ b.count }}</b></div>
            }
          </div>
        </div>
        <div class="stats">
          @for (s of data.tatStats; track s.label) {
            <div class="stat-box"><div class="val">{{ s.value }}</div><div class="lab">{{ s.label }}</div></div>
          }
        </div>
      </div>
    </div>

    <div class="grid-2 mt-6">
      <div class="panel">
        <div class="panel-pad"><h3 class="pt">TAT Compliance by Line of Business</h3></div>
        <table class="z-table">
          <thead><tr><th>Line of Business</th><th>Volume</th><th>On Track</th><th>At Risk</th><th>Breached</th><th>Compliance</th></tr></thead>
          <tbody>
            @for (r of byLob(); track r.name) {
              <tr class="clk" (click)="drill('lob', r.name)">
                <td class="strong">{{ r.name }}</td>
                <td class="num">{{ r.total }}</td>
                <td class="num">{{ r.onTrack }}</td>
                <td class="num">{{ r.atRisk }}</td>
                <td class="num" [class.danger]="r.breached > 0">{{ r.breached }}</td>
                <td class="comp">
                  <span class="mini-bar" [class.teal]="r.compliance >= 90" [class.red]="r.compliance < 85"><span [style.width.%]="r.compliance"></span></span>
                  <span class="rate-pill" [class.good]="r.compliance >= 90" [class.mid]="r.compliance < 90">{{ r.compliance }}%</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-pad"><h3 class="pt">TAT Compliance by Program</h3></div>
        <table class="z-table">
          <thead><tr><th>Program</th><th>Volume</th><th>On Track</th><th>At Risk</th><th>Breached</th><th>Compliance</th></tr></thead>
          <tbody>
            @for (r of byProgram(); track r.name) {
              <tr class="clk" (click)="drill('program', r.name)">
                <td class="strong">{{ r.name }}</td>
                <td class="num">{{ r.total }}</td>
                <td class="num">{{ r.onTrack }}</td>
                <td class="num">{{ r.atRisk }}</td>
                <td class="num" [class.danger]="r.breached > 0">{{ r.breached }}</td>
                <td class="comp">
                  <span class="mini-bar" [class.teal]="r.compliance >= 90" [class.red]="r.compliance < 85"><span [style.width.%]="r.compliance"></span></span>
                  <span class="rate-pill" [class.good]="r.compliance >= 90" [class.mid]="r.compliance < 90">{{ r.compliance }}%</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .tat-grid { display:grid; grid-template-columns: 1.15fr 1fr; gap: 26px; align-items:center; }
    .left { display:flex; gap: 22px; align-items:center; }
    .donut { text-align:center; flex: 0 0 auto; }
    .donut-lab { font-size:12px; color: var(--gray-500); margin-top: 8px; font-weight:600; }
    .rows { flex:1; display:flex; flex-direction:column; gap:12px; }
    .row { display:flex; align-items:center; justify-content:space-between; padding: 12px 16px; border-radius: 8px; font-size: 13px; font-weight:500; }
    .row i { width:8px; height:8px; border-radius:999px; display:inline-block; margin-right:8px; }
    .row span { display:flex; align-items:center; } .row b { font-weight:700; font-variant-numeric: tabular-nums; }
    .row[data-tone="green"] { background:#e7f8f0; color: var(--green-fg); } .row[data-tone="green"] i { background: var(--green); }
    .row[data-tone="amber"] { background:#fdf6e3; color: var(--amber-fg); } .row[data-tone="amber"] i { background: var(--amber); }
    .row[data-tone="red"] { background:#fdecec; color: var(--red-fg); } .row[data-tone="red"] i { background: var(--red); }
    .stats { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .pt { font-size:14px; font-weight:600; color:var(--ink); margin:0; }
    .clk { cursor:pointer; }
    .comp { white-space:nowrap; } .comp .rate-pill { margin-left:10px; }
  `],
})
export class TatTab {
  data = inject(DashboardData);
  private ix = inject(Interaction);

  private decided = CASE_POOL.filter((c) => c.phase === 'decided');

  private breakdown(keyFn: (c: CaseRec) => string) {
    const map = new Map<string, CaseRec[]>();
    for (const c of this.decided) { if (!map.has(keyFn(c))) map.set(keyFn(c), []); map.get(keyFn(c))!.push(c); }
    return [...map.entries()].map(([name, cs]) => {
      const onTrack = cs.filter((c) => c.tags.includes('onTrack')).length;
      const atRisk = cs.filter((c) => c.tags.includes('atRisk')).length;
      const breached = cs.filter((c) => c.tags.includes('breached')).length;
      // compliance = decisions that met TAT (did not breach)
      return { name, total: cs.length, onTrack, atRisk, breached, compliance: Math.round(((cs.length - breached) / cs.length) * 100) };
    }).sort((a, b) => b.total - a.total);
  }
  readonly byLob = computed(() => this.breakdown((c) => lobOf(c.authId)));
  readonly byProgram = computed(() => this.breakdown((c) => programOf(c)));

  drill(dim: 'lob' | 'program', value: string) {
    const keyFn = dim === 'lob' ? (c: CaseRec) => lobOf(c.authId) : (c: CaseRec) => programOf(c);
    const cases = this.decided.filter((c) => keyFn(c) === value);
    const label = dim === 'lob' ? 'Line of Business' : 'Program';
    this.ix.openExplorer({
      title: `TAT — ${value}`,
      context: `${cases.length} decisions · ${label} ${value}`,
      columns: ['Auth ID', 'Member', 'Procedure', label, 'TAT Status', 'Est. Cost'],
      rows: cases.map((c) => [c.authId, c.member, c.procedure, value, tatStatus(c), `$${c.cost.toLocaleString()}`]),
      exportName: `tat-${dim}-${value.toLowerCase().replace(/[^a-z]+/g, '-')}_2026-07-17`,
      memberColumn: 1,
    });
  }
}
