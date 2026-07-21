import { Component, computed, inject, signal } from '@angular/core';
import { Nav, BizModule } from '../shared/nav';
import { Metrics } from '../shared/metrics';
import { Donut, Trend, Segment } from '../shared/charts';
import { Icon } from '../shared/icon';

interface WidgetDef {
  id: string; title: string; category: string; scope: BizModule[]; size: 'half' | 'full';
}

const WIDGETS: WidgetDef[] = [
  // top 2x2 pies
  { id: 'um-decisions',    title: 'UM Decisions',            category: 'Outcomes & Quality', scope: ['um'],      size: 'half' },
  { id: 'appeal-outcomes', title: 'Appeal Outcomes',         category: 'Outcomes & Quality', scope: ['appeals'], size: 'half' },
  { id: 'cm-adherence',    title: 'Care-Plan Adherence',     category: 'Outcomes & Quality', scope: ['cm'],      size: 'half' },
  { id: 'case-mix',        title: 'Case Mix by Module',      category: 'Outcomes & Quality', scope: [],          size: 'half' },
  // trends & everything else
  { id: 'tat-trend',       title: 'TAT / SLA Compliance Trend', category: 'Outcomes & Quality', scope: ['um'],  size: 'full' },
  { id: 'overturn-trend',  title: 'Appeal Overturn Trend',   category: 'Outcomes & Quality', scope: ['appeals'], size: 'half' },
  { id: 'cost-heroes',     title: 'Cost Headlines',          category: 'Cost & Financial',   scope: [],          size: 'full' },
  { id: 'cost-trend',      title: 'Cost Avoided — 6-Month Trend', category: 'Cost & Financial', scope: [],       size: 'half' },
  { id: 'cost-by-module',  title: 'Cost Avoided by Module',  category: 'Cost & Financial',   scope: [],          size: 'half' },
  { id: 'pmpm',            title: 'PMPM (Medical)',          category: 'Cost & Financial',   scope: [],          size: 'half' },
  { id: 'volume-trend',    title: 'Case Volume Trend',       category: 'Volume & Throughput', scope: [],         size: 'half' },
  { id: 'automation',      title: 'Automation Rate',         category: 'Outcomes & Quality', scope: ['um'],      size: 'half' },
  { id: 'denial-reasons',  title: 'Top Denial Reasons',      category: 'Outcomes & Quality', scope: ['um'],      size: 'half' },
  { id: 'appeals-aging',   title: 'Appeals Aging',           category: 'Volume & Throughput', scope: ['appeals'], size: 'half' },
  { id: 'provider-outliers', title: 'Provider RFI Outliers', category: 'Volume & Throughput', scope: ['um'],    size: 'half' },
  { id: 'risk-distribution', title: 'Member Risk Distribution', category: 'Risk & Population', scope: ['cm'],    size: 'half' },
  { id: 'program-outcomes', title: 'Program Enrollment',      category: 'Risk & Population', scope: ['cm'],       size: 'half' },
];

// default view: the four pies (2x2) + cost headline + cost trend
const DEFAULT_ENABLED = ['um-decisions', 'appeal-outcomes', 'cm-adherence', 'case-mix', 'cost-heroes', 'cost-trend'];
const KEY = 'zyter-exec-widgets-v1';

@Component({
  selector: 'app-overview-dashboard',
  standalone: true,
  imports: [Donut, Trend, Icon],
  template: `
    <div class="ex-head">
      <span class="section-note">Showing {{ scopeLabel() }} · your saved view</span>
      <button class="btn outline" (click)="customizing.set(!customizing())">
        <z-icon name="barchart" [size]="14"></z-icon> Customize
      </button>
    </div>

    @if (customizing()) {
      <div class="customize">
        <div class="cz-head"><b>Choose your widgets</b>
          <span class="cz-hint">Tailor this view — your selection is saved for you.</span>
          <button class="cz-x" (click)="customizing.set(false)">Done</button></div>
        @for (cat of categories; track cat) {
          <div class="cz-cat">{{ cat }}</div>
          <div class="cz-grid">
            @for (w of widgetsIn(cat); track w.id) {
              <label class="cz-item" [class.disabled]="!scopeOk(w)">
                <input type="checkbox" [checked]="enabled().includes(w.id)" [disabled]="!scopeOk(w)"
                  (change)="toggle(w.id)" />
                {{ w.title }}
                @if (!scopeOk(w)) { <span class="req">needs {{ scopeReq(w) }}</span> }
              </label>
            }
          </div>
        }
      </div>
    }

    <div class="wgrid">
      @for (w of shown(); track w.id) {
        <div class="widget" [class.full]="w.size === 'full'" [class.pie]="isPie(w.id)">
          <div class="w-head"><h3>{{ w.title }}</h3>
            <button class="w-x" title="Remove from view" (click)="toggle(w.id)">×</button>
          </div>

          @switch (w.id) {
            @case ('um-decisions') {
              <z-donut [clickable]="true" [segments]="umMix" [size]="120" centerValue="247" centerLabel="decisions"
                (segClick)="drillDecision($event)" />
              <div class="foot"><span class="up">▲ 3 pts</span> approval vs last month · click a slice to drill</div>
            }
            @case ('appeal-outcomes') {
              <z-donut [clickable]="true" [segments]="appealMix" [size]="120" centerValue="61%" centerLabel="overturn"
                (segClick)="nav.go('appeals')" />
              <div class="foot">High overturn signals upstream UM gaps · click to open Appeals</div>
            }
            @case ('cm-adherence') {
              <z-donut [clickable]="true" [segments]="cmMix" [size]="120" centerValue="91%" centerLabel="adherent"
                (segClick)="nav.go('cm')" />
              <div class="foot"><span class="up">▲ 2 pts</span> vs last month · click to open CM</div>
            }
            @case ('case-mix') {
              <z-donut [clickable]="true" [segments]="caseMix()" [size]="120" [centerValue]="caseMixTotal()" centerLabel="open items"
                (segClick)="goModule($event)" />
              <div class="foot">Share of active work across your modules · click a slice to open</div>
            }
            @case ('tat-trend') {
              <div class="w-big">{{ tat[tat.length-1] }}%</div>
              <z-trend [points]="tat" [labels]="months" color="#0d9488" />
            }
            @case ('overturn-trend') {
              <div class="w-big">{{ overturn[overturn.length-1] }}%</div>
              <z-trend [points]="overturn" [labels]="months" color="#8b5cf6" />
            }
            @case ('cost-heroes') {
              <div class="heroes">
                @for (h of heroes; track h.label) {
                  <div class="hero" [attr.data-tone]="h.tone">
                    <div class="h-val">{{ h.value }}</div><div class="h-lab">{{ h.label }}</div>
                    <div class="h-delta" [attr.data-dir]="h.dir">{{ h.delta }}</div>
                  </div>
                }
              </div>
            }
            @case ('cost-trend') {
              <div class="w-big green">$1.8M</div>
              <z-trend [points]="savings" [labels]="months" color="#10b981" />
            }
            @case ('cost-by-module') {
              <div class="bars">
                @for (b of costByModule(); track b.label) {
                  <div class="bar-row"><span class="bl">{{ b.label }}</span>
                    <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
                    <span class="bv">{{ b.value }}</span></div>
                }
              </div>
            }
            @case ('pmpm') {
              <div class="w-big">$412</div>
              <div class="foot"><span class="up">▼ 2%</span> medical PMPM vs last month (lower is better)</div>
            }
            @case ('volume-trend') {
              <div class="w-big">{{ volume[volume.length-1] }}</div>
              <z-trend [points]="volume" [labels]="months" color="#3b82f6" />
            }
            @case ('risk-distribution') {
              <div class="bars">
                @for (b of riskDist; track b.label) {
                  <div class="bar-row"><span class="bl">{{ b.label }}</span>
                    <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
                    <span class="bv">{{ b.value }}</span></div>
                }
              </div>
            }
            @case ('automation') {
              <z-donut [clickable]="true" [segments]="autoMix" [size]="120" centerValue="38%" centerLabel="automated"
                (segClick)="metrics.open('kpi.auto')" />
              <div class="foot">Auto-approved by rules vs. manual review · click to view</div>
            }
            @case ('denial-reasons') {
              <div class="bars">
                @for (b of denialReasons; track b.label) {
                  <div class="bar-row"><span class="bl wide">{{ b.label }}</span>
                    <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
                    <span class="bv">{{ b.value }}</span></div>
                }
              </div>
            }
            @case ('appeals-aging') {
              <div class="bars">
                @for (b of appealsAging; track b.label) {
                  <div class="bar-row"><span class="bl">{{ b.label }}</span>
                    <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
                    <span class="bv">{{ b.value }}</span></div>
                }
              </div>
            }
            @case ('provider-outliers') {
              <div class="bars">
                @for (b of providerOutliers; track b.label) {
                  <div class="bar-row"><span class="bl wide">{{ b.label }}</span>
                    <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
                    <span class="bv">{{ b.value }}</span></div>
                }
              </div>
            }
            @case ('program-outcomes') {
              <div class="bars">
                @for (b of programOutcomes; track b.label) {
                  <div class="bar-row"><span class="bl wide">{{ b.label }}</span>
                    <span class="bt"><span class="bf" [style.width.%]="b.pct" [style.background]="b.color"></span></span>
                    <span class="bv">{{ b.value }}</span></div>
                }
              </div>
            }
          }
        </div>
      } @empty {
        <div class="empty">No widgets selected — click <b>Customize</b> to add reports.</div>
      }
    </div>
  `,
  styles: [`
    .ex-head { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }
    .ex-head h2 { font-size:17px; font-weight:600; margin:0; }
    .customize { background:#fff; border:1px solid var(--teal-600); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
    .cz-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
    .cz-hint { font-size:12px; color:var(--gray-500); }
    .cz-x { margin-left:auto; border:none; background:var(--teal-700); color:#fff; border-radius:8px; padding:6px 14px; font-weight:600; cursor:pointer; font-size:12.5px; }
    .cz-cat { font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin:12px 0 8px; }
    .cz-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .cz-item { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-soft); cursor:pointer; }
    .cz-item.disabled { color:var(--gray-400); cursor:not-allowed; }
    .req { font-size:10px; color:var(--gray-400); background:var(--gray-100); padding:1px 6px; border-radius:5px; }

    .wgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:14px; align-items:start; }
    .widget { background:#fff; border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); padding:16px 18px; }
    .widget.full { grid-column:1 / -1; }
    .widget.pie { min-height:210px; display:flex; flex-direction:column; }
    .widget.pie .foot { margin-top:auto; }
    .widget.pie z-donut { flex:1; align-items:center; }
    .w-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .w-head h3 { font-size:14px; font-weight:600; color:var(--ink); margin:0; }
    .w-x { border:none; background:none; color:var(--gray-400); font-size:18px; line-height:1; cursor:pointer; padding:0 2px; }
    .w-x:hover { color:var(--red); }
    .w-big { font-size:24px; font-weight:700; color:var(--teal-700); margin-bottom:6px; } .w-big.green { color:var(--green); }
    .foot { margin-top:14px; font-size:11.5px; color:var(--gray-500); } .up { color:var(--green); font-weight:600; }
    .empty { grid-column:1/-1; text-align:center; padding:36px; color:var(--gray-500);
      background:#fff; border:1px dashed var(--gray-300); border-radius:12px; }

    .heroes { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .hero { border:1px solid var(--border); border-top:3px solid var(--gray-300); border-radius:10px; padding:14px 16px; }
    .hero[data-tone="green"]{ border-top-color:var(--green); } .hero[data-tone="red"]{ border-top-color:var(--red); } .hero[data-tone="amber"]{ border-top-color:var(--amber); }
    .h-val { font-size:26px; font-weight:700; color:var(--ink); } .h-lab { font-size:11.5px; color:var(--gray-500); margin-top:2px; }
    .h-delta { font-size:11px; font-weight:600; margin-top:6px; }
    .h-delta[data-dir="up"]{ color:var(--green); } .h-delta[data-dir="down"]{ color:var(--red); } .h-delta[data-dir="flat"]{ color:var(--gray-500); }

    .bars { display:flex; flex-direction:column; gap:14px; }
    .bar-row { display:grid; grid-template-columns:90px 1fr 60px; align-items:center; gap:12px; font-size:12.5px; }
    .bl { color:var(--ink-soft); font-weight:600; } .bl.wide { font-size:11.5px; }
    .bar-row:has(.bl.wide) { grid-template-columns:120px 1fr 48px; }
    .bt { height:10px; border-radius:999px; background:var(--gray-100); overflow:hidden; }
    .bf { display:block; height:100%; border-radius:999px; } .bv { text-align:right; font-weight:700; color:var(--ink); font-variant-numeric:tabular-nums; }
  `],
})
export class OverviewDashboard {
  nav = inject(Nav);
  metrics = inject(Metrics);

  readonly customizing = signal(false);
  readonly enabled = signal<string[]>(this.load());
  readonly categories = ['Outcomes & Quality', 'Cost & Financial', 'Volume & Throughput', 'Risk & Population'];

  readonly months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  readonly tat = [90, 91, 92, 93, 94, 94];
  readonly overturn = [55, 58, 60, 59, 61, 61];
  readonly savings = [1.1, 1.3, 1.4, 1.5, 1.7, 1.8];
  readonly volume = [220, 240, 235, 250, 247, 258];

  readonly umMix: Segment[] = [
    { label: 'Approved', value: 153, color: '#10b981', key: 'dec.approved' },
    { label: 'Partial',  value: 50,  color: '#f59e0b', key: 'dec.partial' },
    { label: 'Denied',   value: 44,  color: '#ef4444', key: 'dec.denied' },
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
    { value: '$1.8M', label: 'Cost Avoided (MTD)', delta: '▲ 12% vs last month', dir: 'up', tone: 'green' },
    { value: '$4.3M', label: 'Estimated Pending Cost', delta: '▲ 4% vs last month', dir: 'down', tone: 'red' },
    { value: '$2.1M', label: 'High-Dollar Exposure (>$100k)', delta: '9 open cases', dir: 'flat', tone: 'amber' },
  ];
  readonly riskDist = [
    { label: 'Low', value: 120, pct: 100, color: '#10b981' },
    { label: 'Moderate', value: 64, pct: 53, color: '#f59e0b' },
    { label: 'High', value: 38, pct: 32, color: '#f97316' },
    { label: 'Critical', value: 20, pct: 17, color: '#ef4444' },
  ];
  readonly autoMix: Segment[] = [
    { label: 'Auto-approved', value: 38, color: '#0d9488' },
    { label: 'Manual review', value: 62, color: '#9ca3af' },
  ];
  readonly denialReasons = [
    { label: 'Not med. necessary', value: '38%', pct: 100, color: '#ef4444' },
    { label: 'Missing docs', value: '27%', pct: 71, color: '#f59e0b' },
    { label: 'Out of network', value: '18%', pct: 47, color: '#f97316' },
    { label: 'Experimental', value: '10%', pct: 26, color: '#8b5cf6' },
    { label: 'Other', value: '7%', pct: 18, color: '#9ca3af' },
  ];
  readonly appealsAging = [
    { label: '0–7 days', value: 6, pct: 100, color: '#10b981' },
    { label: '8–14 days', value: 5, pct: 83, color: '#f59e0b' },
    { label: '15–30 days', value: 4, pct: 67, color: '#f97316' },
    { label: '> 30 days', value: 3, pct: 50, color: '#ef4444' },
  ];
  readonly providerOutliers = [
    { label: 'Memorial Ortho', value: '24%', pct: 100, color: '#ef4444' },
    { label: 'Coastal Neuro', value: '22%', pct: 92, color: '#f97316' },
    { label: 'Dr. James Parker', value: '18%', pct: 75, color: '#f59e0b' },
    { label: 'Dr. S. Mitchell', value: '12%', pct: 50, color: '#3b82f6' },
  ];
  readonly programOutcomes = [
    { label: 'CHF DM', value: 42, pct: 100, color: '#0d9488' },
    { label: 'Diabetes', value: 38, pct: 90, color: '#3b82f6' },
    { label: 'Complex Care', value: 28, pct: 67, color: '#8b5cf6' },
    { label: 'BH Integration', value: 20, pct: 48, color: '#f59e0b' },
  ];

  // ---- widget selection ----
  private load(): string[] {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {}
    return [...DEFAULT_ENABLED];
  }
  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.enabled())); } catch {} }
  toggle(id: string) {
    this.enabled.update((e) => e.includes(id) ? e.filter((x) => x !== id) : [...e, id]);
    this.save();
  }
  scopeOk(w: WidgetDef) { return w.scope.every((m) => this.nav.scope().includes(m)); }
  widgetsIn(cat: string) { return WIDGETS.filter((w) => w.category === cat); }
  scopeReq(w: WidgetDef) { return w.scope.map((m) => m.toUpperCase()).join('/'); }
  isPie(id: string) { return ['um-decisions', 'appeal-outcomes', 'cm-adherence', 'case-mix', 'automation'].includes(id); }
  readonly shown = computed(() =>
    WIDGETS.filter((w) => this.enabled().includes(w.id) && w.scope.every((m) => this.nav.scope().includes(m))));

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
    return all.filter((b) => this.nav.scope().includes(b.key as BizModule));
  });

  drillDecision(seg: Segment) { if (seg.key) this.metrics.open(seg.key); }

  readonly caseMix = computed<Segment[]>(() => {
    const all: Segment[] = [
      { label: 'UM', value: 247, color: '#0d9488', key: 'um' },
      { label: 'CM', value: 68, color: '#3b82f6', key: 'cm' },
      { label: 'Appeals', value: 18, color: '#8b5cf6', key: 'appeals' },
    ];
    return all.filter((s) => this.nav.scope().includes(s.key as BizModule));
  });
  caseMixTotal() { return String(this.caseMix().reduce((n, s) => n + s.value, 0)); }
  goModule(seg: Segment) { if (seg.key) this.nav.go(seg.key as any); }
}
