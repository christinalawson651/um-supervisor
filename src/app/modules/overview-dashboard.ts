import { Component, computed, inject } from '@angular/core';
import { Nav } from '../shared/nav';
import { Donut, Trend, Segment } from '../shared/charts';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-overview-dashboard',
  standalone: true,
  imports: [Donut, Trend, Icon],
  template: `
    <!-- Outcomes & Quality -->
    <div class="tab-head">
      <h2>Outcomes &amp; Quality</h2>
      <span class="section-note">Decision quality across {{ scopeLabel() }}</span>
    </div>

    <div class="cards">
      @if (has('um')) {
        <div class="panel panel-pad">
          <h3 class="ptitle">UM Decisions</h3>
          <z-donut [segments]="umMix" [size]="128" centerValue="247" centerLabel="decisions" />
          <div class="foot"><span class="up">▲ 3 pts</span> approval rate vs last month</div>
        </div>
      }
      @if (has('appeals')) {
        <div class="panel panel-pad">
          <h3 class="ptitle">Appeal Outcomes</h3>
          <z-donut [segments]="appealMix" [size]="128" centerValue="61%" centerLabel="overturn" />
          <div class="foot">High overturn signals upstream UM review gaps</div>
        </div>
      }
      @if (has('cm')) {
        <div class="panel panel-pad">
          <h3 class="ptitle">Care-Plan Adherence</h3>
          <z-donut [segments]="cmMix" [size]="128" centerValue="91%" centerLabel="adherent" />
          <div class="foot"><span class="up">▲ 2 pts</span> adherence vs last month</div>
        </div>
      }
    </div>

    <div class="panel panel-pad mt-6">
      <div class="tbl-head"><h3 class="ptitle">Quality Trend — TAT / SLA Compliance</h3>
        <span class="big">{{ trendPoints[trendPoints.length-1] }}%</span></div>
      <z-trend [points]="trendPoints" [labels]="months" color="#0d9488" />
    </div>

    <!-- Cost & Savings -->
    <div class="tab-head mt-6">
      <h2>Cost &amp; Savings</h2>
      <span class="section-note">Financial impact across {{ scopeLabel() }}</span>
    </div>

    <div class="heroes">
      @for (h of heroes; track h.label) {
        <div class="hero" [attr.data-tone]="h.tone">
          <div class="h-ic"><z-icon [name]="h.icon" [size]="18"></z-icon></div>
          <div class="h-val">{{ h.value }}</div>
          <div class="h-lab">{{ h.label }}</div>
          <div class="h-delta" [attr.data-dir]="h.dir">{{ h.delta }}</div>
        </div>
      }
    </div>

    <div class="grid-2 mt-6">
      <div class="panel panel-pad">
        <div class="tbl-head"><h3 class="ptitle">Cost Avoided — 6 Month Trend</h3><span class="big green">$1.8M</span></div>
        <z-trend [points]="savings" [labels]="months" color="#10b981" />
      </div>
      <div class="panel panel-pad">
        <h3 class="ptitle">Cost Avoided by Module (MTD)</h3>
        <div class="bars">
          @for (b of costByModule(); track b.label) {
            <div class="bar-row">
              <span class="bl">{{ b.label }}</span>
              <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
              <span class="bv">{{ b.value }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cards { display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; }
    .ptitle { font-size:14px; font-weight:600; color:var(--ink); margin:0 0 14px; }
    .foot { margin-top:14px; font-size:11.5px; color:var(--gray-500); }
    .up { color:var(--green); font-weight:600; }
    .tbl-head { display:flex; align-items:center; justify-content:space-between; }
    .big { font-size:22px; font-weight:700; color:var(--teal-700); } .big.green { color:var(--green); }

    .heroes { display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; }
    .hero { background:#fff; border:1px solid var(--border); border-top:3px solid var(--gray-300);
      border-radius:12px; box-shadow:var(--shadow); padding:18px 20px; }
    .hero[data-tone="green"]{ border-top-color:var(--green); } .hero[data-tone="green"] .h-ic{ background:var(--green-bg); color:var(--green-fg); }
    .hero[data-tone="red"]{ border-top-color:var(--red); } .hero[data-tone="red"] .h-ic{ background:var(--red-bg); color:var(--red-fg); }
    .hero[data-tone="amber"]{ border-top-color:var(--amber); } .hero[data-tone="amber"] .h-ic{ background:var(--amber-bg); color:var(--amber-fg); }
    .h-ic { width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:10px; }
    .h-val { font-size:30px; font-weight:700; color:var(--ink); }
    .h-lab { font-size:12px; color:var(--gray-500); margin-top:2px; }
    .h-delta { font-size:11.5px; font-weight:600; margin-top:8px; }
    .h-delta[data-dir="up"]{ color:var(--green); } .h-delta[data-dir="down"]{ color:var(--red); } .h-delta[data-dir="flat"]{ color:var(--gray-500); }

    .bars { display:flex; flex-direction:column; gap:14px; margin-top:4px; }
    .bar-row { display:grid; grid-template-columns: 90px 1fr 60px; align-items:center; gap:12px; font-size:12.5px; }
    .bl { color:var(--ink-soft); font-weight:600; }
    .bt { height:10px; border-radius:999px; background:var(--gray-100); overflow:hidden; }
    .bf { display:block; height:100%; border-radius:999px; }
    .bv { text-align:right; font-weight:700; color:var(--ink); font-variant-numeric:tabular-nums; }
  `],
})
export class OverviewDashboard {
  nav = inject(Nav);

  readonly months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  readonly trendPoints = [90, 91, 92, 93, 94, 94];
  readonly savings = [1.1, 1.3, 1.4, 1.5, 1.7, 1.8];

  readonly umMix: Segment[] = [
    { label: 'Approved', value: 153, color: '#10b981' },
    { label: 'Partial',  value: 50,  color: '#f59e0b' },
    { label: 'Denied',   value: 44,  color: '#ef4444' },
  ];
  readonly appealMix: Segment[] = [
    { label: 'Overturned', value: 61, color: '#0d9488' },
    { label: 'Upheld',     value: 39, color: '#9ca3af' },
  ];
  readonly cmMix: Segment[] = [
    { label: 'Adherent', value: 91, color: '#0d9488' },
    { label: 'Gap',      value: 9,  color: '#e5e7eb' },
  ];

  readonly heroes = [
    { icon: 'shield', value: '$1.8M', label: 'Cost Avoided (MTD)', delta: '▲ 12% vs last month', dir: 'up', tone: 'green' },
    { icon: 'dollar', value: '$4.3M', label: 'Estimated Pending Cost', delta: '▲ 4% vs last month', dir: 'down', tone: 'red' },
    { icon: 'barchart', value: '$2.1M', label: 'High-Dollar Exposure (>$100k)', delta: '9 open cases', dir: 'flat', tone: 'amber' },
  ];

  has(m: 'um' | 'cm' | 'appeals') { return this.nav.scope().includes(m); }
  scopeLabel() {
    const names: Record<string, string> = { um: 'UM', cm: 'CM', appeals: 'Appeals' };
    return this.nav.scope().map((m) => names[m]).join(' · ');
  }

  readonly costByModule = computed(() => {
    const all = [
      { key: 'um', label: 'UM', value: '$1.2M', pct: 100, color: '#0d9488' },
      { key: 'cm', label: 'CM', value: '$0.4M', pct: 33, color: '#3b82f6' },
      { key: 'appeals', label: 'Appeals', value: '$0.2M', pct: 17, color: '#8b5cf6' },
    ];
    return all.filter((b) => this.nav.scope().includes(b.key as any));
  });
}
