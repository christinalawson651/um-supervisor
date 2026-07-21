import { Component, Input, output, signal } from '@angular/core';

export interface Segment { label: string; value: number; color: string; key?: string; }

/** Multi-segment donut with hover tooltip, click-to-drill, center figure, labeled legend. */
@Component({
  selector: 'z-donut',
  standalone: true,
  template: `
    <div class="wrap">
      <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size">
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r" fill="none" stroke="var(--gray-100)" [attr.stroke-width]="tw" />
        @for (s of arcs; track s.label; let i = $index) {
          <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r" fill="none"
            [attr.stroke]="s.color" [attr.stroke-width]="hover() === i ? tw + 4 : tw"
            [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset"
            [attr.transform]="'rotate(-90 ' + c + ' ' + c + ')'" stroke-linecap="butt"
            [class.hot]="clickable"
            (mouseenter)="hover.set(i)" (mouseleave)="hover.set(-1)" (click)="pick(i)" />
        }
      </svg>
      <div class="mid">
        @if (hover() >= 0) {
          <div class="cv">{{ pctOf(segments[hover()].value) }}%</div>
          <div class="cl">{{ segments[hover()].label }}</div>
        } @else {
          <div class="cv">{{ centerValue }}</div><div class="cl">{{ centerLabel }}</div>
        }
      </div>
      @if (hover() >= 0) {
        <div class="tip">{{ segments[hover()].label }}: {{ segments[hover()].value }} ({{ pctOf(segments[hover()].value) }}%)@if (clickable) { <span class="tap"> · click to view</span> }</div>
      }
    </div>
    <div class="legend">
      @for (s of segments; track s.label; let i = $index) {
        <div class="lg" [class.hot]="clickable" (mouseenter)="hover.set(i)" (mouseleave)="hover.set(-1)" (click)="pick(i)">
          <span class="sw" [style.background]="s.color"></span>{{ s.label }}<b>{{ pctOf(s.value) }}%</b>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display:flex; align-items:center; gap:18px; }
    .wrap { position:relative; flex:0 0 auto; }
    circle.hot { cursor:pointer; transition: stroke-width .1s; }
    .mid { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; }
    .cv { font-size:22px; font-weight:700; color:var(--ink); line-height:1; }
    .cl { font-size:10px; color:var(--gray-500); text-transform:uppercase; letter-spacing:.04em; margin-top:3px; text-align:center; }
    .tip { position:absolute; top:-10px; left:50%; transform:translate(-50%,-100%); white-space:nowrap;
      background:var(--ink); color:#fff; font-size:11px; font-weight:600; padding:5px 9px; border-radius:6px; pointer-events:none; z-index:5; }
    .tap { opacity:.7; font-weight:400; }
    .legend { display:flex; flex-direction:column; gap:8px; }
    .lg { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-soft); }
    .lg.hot { cursor:pointer; } .lg.hot:hover { color:var(--ink); }
    .lg b { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--ink); }
    .sw { width:10px; height:10px; border-radius:3px; flex:0 0 10px; }
  `],
})
export class Donut {
  @Input() size = 120;
  @Input() tw = 16;
  @Input() centerValue = '';
  @Input() centerLabel = '';
  @Input() clickable = false;
  @Input() set segments(v: Segment[]) { this._segs = v; this.build(); }
  get segments() { return this._segs; }
  private _segs: Segment[] = [];
  arcs: { label: string; color: string; dash: string; offset: number }[] = [];
  readonly hover = signal(-1);
  segClick = output<Segment>();

  get c() { return this.size / 2; }
  get r() { return this.size / 2 - this.tw / 2 - 1; }
  get circ() { return 2 * Math.PI * this.r; }
  get total() { return this._segs.reduce((s, x) => s + x.value, 0) || 1; }
  pctOf(v: number) { return Math.round((v / this.total) * 100); }
  pick(i: number) { if (this.clickable) this.segClick.emit(this._segs[i]); }

  private build() {
    let cum = 0;
    const gap = 2;
    this.arcs = this._segs.map((s) => {
      const len = (s.value / this.total) * this.circ;
      const dashLen = Math.max(0, len - gap);
      const arc = { label: s.label, color: s.color, dash: `${dashLen} ${this.circ - dashLen}`, offset: -cum };
      cum += len;
      return arc;
    });
  }
}

/** Single-series area + line trend with axis labels and a value marker. */
@Component({
  selector: 'z-trend',
  standalone: true,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="chart">
      <defs>
        <linearGradient [attr.id]="gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color" stop-opacity="0.22" />
          <stop offset="100%" [attr.stop-color]="color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path [attr.d]="areaPath" [attr.fill]="'url(#' + gid + ')'" />
      <path [attr.d]="linePath" fill="none" [attr.stroke]="color" stroke-width="2" stroke-linejoin="round" />
      <circle [attr.cx]="lastX" [attr.cy]="lastY" r="3.5" [attr.fill]="color" />
    </svg>
    <div class="xlabels">@for (l of labels; track l) { <span>{{ l }}</span> }</div>
  `,
  styles: [`
    :host { display:block; }
    .chart { width:100%; height:90px; display:block; }
    .xlabels { display:flex; justify-content:space-between; margin-top:6px; font-size:10px; color:var(--gray-400); }
  `],
})
export class Trend {
  @Input() labels: string[] = [];
  @Input() color = '#0d9488';
  @Input() set points(v: number[]) { this._pts = v; }
  get points() { return this._pts; }
  private _pts: number[] = [];
  readonly W = 300; readonly H = 90;
  readonly gid = 'g' + Math.floor(performance.now() % 100000);

  private xy() {
    const p = this._pts;
    if (!p.length) return [] as { x: number; y: number }[];
    const min = Math.min(...p), max = Math.max(...p);
    const span = max - min || 1;
    const pad = 8;
    return p.map((v, i) => ({
      x: (i / (p.length - 1 || 1)) * this.W,
      y: this.H - pad - ((v - min) / span) * (this.H - pad * 2),
    }));
  }
  get linePath() { const pts = this.xy(); return pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' '); }
  get areaPath() { const pts = this.xy(); if (!pts.length) return ''; return `M${pts[0].x} ${this.H} ` + pts.map((q) => `L${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ') + ` L${pts[pts.length - 1].x} ${this.H} Z`; }
  get lastX() { const pts = this.xy(); return pts.length ? pts[pts.length - 1].x : 0; }
  get lastY() { const pts = this.xy(); return pts.length ? pts[pts.length - 1].y : 0; }
}
