import { Component, Input } from '@angular/core';

type Tone = 'teal' | 'green' | 'amber' | 'red' | 'blue';

const COLORS: Record<Tone, string> = {
  teal:  '#0d9488',
  green: '#10b981',
  amber: '#f59e0b',
  red:   '#ef4444',
  blue:  '#3b82f6',
};

@Component({
  selector: 'z-ring',
  standalone: true,
  template: `
    <div class="wrap" [style.width.px]="size" [style.height.px]="size">
      <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size">
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r"
          fill="none" [attr.stroke]="track" [attr.stroke-width]="thickness"/>
        <circle [attr.cx]="c" [attr.cy]="c" [attr.r]="r"
          fill="none" [attr.stroke]="stroke" [attr.stroke-width]="thickness"
          stroke-linecap="round"
          [attr.stroke-dasharray]="circ"
          [attr.stroke-dashoffset]="offset"
          [attr.transform]="'rotate(-90 ' + c + ' ' + c + ')'"/>
      </svg>
      <div class="label" [style.font-size.px]="fontSize">{{ value }}%</div>
    </div>
  `,
  styles: [`
    .wrap { position: relative; display: inline-flex; }
    .label {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; color: var(--ink);
    }
  `],
})
export class Ring {
  @Input() value = 0;
  @Input() size = 120;
  @Input() thickness = 10;
  @Input() tone: Tone = 'teal';
  @Input() track = '#e5e7eb';
  @Input() fontSize = 22;

  get c() { return this.size / 2; }
  get r() { return this.size / 2 - this.thickness / 2 - 1; }
  get circ() { return 2 * Math.PI * this.r; }
  get offset() { return this.circ * (1 - Math.min(100, Math.max(0, this.value)) / 100); }
  get stroke() { return COLORS[this.tone]; }
}
