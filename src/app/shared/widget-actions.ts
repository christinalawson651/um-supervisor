import { Component, EventEmitter, Output } from '@angular/core';
import { Icon } from './icon';

/**
 * The same lightweight per-card actions TruCare Pulse's Overview widgets have — "Report / export
 * this widget" and "Remove from view" — reusable on any tile so every UM tab can offer them without
 * each tab re-implementing the buttons or duplicating Pulse's whole customizable-widget-grid system.
 * Drop into a `position: relative` tile and add a `<tile-class>:hover z-widget-actions { opacity: 1 }`
 * rule in that tab's styles to reveal on hover, matching Pulse's hover treatment.
 */
@Component({
  selector: 'z-widget-actions',
  standalone: true,
  imports: [Icon],
  template: `
    <div class="w-actions">
      <button class="w-rep" title="Report / export this widget" (click)="exportClick.emit(); $event.stopPropagation()">
        <z-icon name="download" [size]="13"></z-icon>
      </button>
      <button class="w-x" title="Remove from view" (click)="removeClick.emit(); $event.stopPropagation()">×</button>
    </div>
  `,
  styles: [`
    :host { position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity .12s; z-index: 2; }
    .w-actions { display: flex; align-items: center; gap: 4px; }
    .w-rep, .w-x { border: none; background: #fff; cursor: pointer; border-radius: 5px; color: var(--gray-400); }
    .w-rep { padding: 3px; line-height: 0; }
    .w-rep:hover { color: var(--teal-700); background: var(--teal-50); }
    .w-x { font-size: 16px; line-height: 1; padding: 0 3px; }
    .w-x:hover { color: var(--red); background: var(--red-bg); }
  `],
})
export class WidgetActions {
  @Output() exportClick = new EventEmitter<void>();
  @Output() removeClick = new EventEmitter<void>();
}
