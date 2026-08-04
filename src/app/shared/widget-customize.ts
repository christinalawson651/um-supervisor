import { Component, Input } from '@angular/core';
import { WidgetVisibility } from './widget-visibility';

/** The picker panel behind each tab's "Customize" button — same Choose-your-widgets pattern as Pulse's Overview, just scoped to one tab's own small widget list (no categories needed). */
@Component({
  selector: 'z-widget-customize',
  standalone: true,
  template: `
    @if (vis.customizing()) {
      <div class="cz">
        <div class="cz-head">
          <b>Choose your widgets</b>
          <span class="cz-hint">Toggle widgets to preview, then Save to keep your view.</span>
          @if (vis.dirty()) { <span class="cz-dirty">● Unsaved changes</span> }
          <span class="cz-actions">
            <button class="cz-reset" (click)="vis.resetDefault()">Reset to default</button>
            <button class="cz-cancel" (click)="vis.cancel()">Cancel</button>
            <button class="cz-save" (click)="vis.save()">Save view</button>
          </span>
        </div>
        <div class="cz-grid">
          @for (w of vis.defs; track w.id) {
            <label class="cz-item">
              <input type="checkbox" [checked]="vis.draft().includes(w.id)" (change)="vis.toggleDraft(w.id)" />
              {{ w.title }}
            </label>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .cz { background:#fff; border:1px solid var(--border); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
    .cz-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .cz-hint { font-size:12px; color:var(--gray-500); }
    .cz-dirty { font-size:12px; color:var(--amber-fg); font-weight:600; }
    .cz-actions { margin-left:auto; display:flex; gap:8px; }
    .cz-reset, .cz-cancel { border:1px solid var(--border); background:#fff; color:var(--gray-600); font-size:12.5px; font-weight:600; padding:6px 12px; border-radius:8px; cursor:pointer; }
    .cz-save { border:none; background:var(--teal-700); color:#fff; font-size:12.5px; font-weight:600; padding:6px 14px; border-radius:8px; cursor:pointer; }
    .cz-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:10px; }
    .cz-item { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink); cursor:pointer; }
  `],
})
export class WidgetCustomize {
  @Input({ required: true }) vis!: WidgetVisibility;
}
