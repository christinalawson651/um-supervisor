import { Component, Input, output } from '@angular/core';
import { Icon } from './icon';

export interface KpiItem { icon: string; value: string; label: string; tone: string; key?: string; }

@Component({
  selector: 'app-kpi-strip',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="kpi-strip" [style.grid-template-columns]="'repeat(' + items.length + ', 1fr)'">
      @for (k of items; track k.label) {
        <div class="kpi" [class.clickable]="!!k.key" [attr.data-tone]="k.tone"
          (click)="k.key && drill.emit(k.key)">
          <div class="kpi-ic"><z-icon [name]="k.icon" [size]="16" [stroke]="1.8"></z-icon></div>
          <div class="kpi-body">
            <div class="kpi-val">{{ k.value }}</div>
            <div class="kpi-lab">{{ k.label }}</div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .kpi-strip { display:grid; gap:12px; padding: 0 0 16px; }
    .kpi { background:#fff; border:1px solid var(--border); border-left:3px solid var(--gray-300);
      border-radius:8px; padding:12px 14px; display:flex; align-items:center; gap:10px; box-shadow: var(--shadow); }
    .kpi.clickable { cursor:pointer; transition: box-shadow .12s, transform .12s; }
    .kpi.clickable:hover { box-shadow:0 4px 12px rgba(16,24,40,.10); transform: translateY(-1px); }
    .kpi-ic { width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 30px; }
    .kpi-val { font-size:19px; font-weight:700; color:var(--ink); line-height:1.1; }
    .kpi-lab { font-size:9.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:600; margin-top:2px; }
    .kpi[data-tone="green"]{ border-left-color:var(--green); } .kpi[data-tone="green"] .kpi-ic{ background:var(--green-bg); color:var(--green-fg); }
    .kpi[data-tone="teal"]{ border-left-color:var(--teal-600); } .kpi[data-tone="teal"] .kpi-ic{ background:var(--teal-50); color:var(--teal-700); }
    .kpi[data-tone="amber"]{ border-left-color:var(--amber); } .kpi[data-tone="amber"] .kpi-ic{ background:var(--amber-bg); color:var(--amber-fg); }
    .kpi[data-tone="red"]{ border-left-color:var(--red); } .kpi[data-tone="red"] .kpi-ic{ background:var(--red-bg); color:var(--red-fg); }
    .kpi[data-tone="blue"]{ border-left-color:var(--blue); } .kpi[data-tone="blue"] .kpi-ic{ background:var(--blue-bg); color:var(--blue-fg); }
    .kpi[data-tone="purple"]{ border-left-color:var(--purple); } .kpi[data-tone="purple"] .kpi-ic{ background:#ede9fe; color:var(--purple); }
  `],
})
export class KpiStrip {
  @Input() items: KpiItem[] = [];
  drill = output<string>();
}
