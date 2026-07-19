import { Component, inject } from '@angular/core';
import { Interaction } from './interaction';

@Component({
  selector: 'app-overlays',
  standalone: true,
  template: `
    <!-- Confirm modal -->
    @if (ix.confirm(); as c) {
      <div class="scrim" (click)="ix.resolve(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h3>{{ c.title }}</h3>
          <p>{{ c.body }}</p>
          <div class="actions">
            <button class="btn outline" (click)="ix.resolve(false)">Cancel</button>
            <button class="btn primary" [attr.data-tone]="c.tone"
              (click)="ix.resolve(true)">{{ c.confirmLabel }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Toasts -->
    <div class="toasts">
      @for (t of ix.toasts(); track t.id) {
        <div class="toast" [attr.data-tone]="t.tone">
          <span class="tdot"></span>
          <span class="tmsg">{{ t.message }}</span>
          <button class="tx" (click)="ix.dismiss(t.id)">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(17,24,39,.45);
      display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal { background:#fff; border-radius: 12px; width: 420px; max-width: 92vw;
      padding: 22px 24px; box-shadow: 0 20px 40px rgba(0,0,0,.2); }
    .modal h3 { margin: 0 0 8px; font-size: 16px; color: var(--ink); }
    .modal p { margin: 0 0 20px; font-size: 13px; color: var(--gray-500); line-height: 1.55; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; }
    .btn.primary[data-tone="red"] { background: var(--red); border-color: var(--red); }
    .btn.primary[data-tone="red"]:hover { background: #dc2626; }
    .btn.primary[data-tone="amber"] { background: var(--amber); border-color: var(--amber); color:#3d2c00; }

    .toasts { position: fixed; bottom: 22px; right: 22px; z-index: 110;
      display: flex; flex-direction: column; gap: 10px; }
    .toast { display: flex; align-items: center; gap: 10px; min-width: 280px; max-width: 380px;
      background:#fff; border:1px solid var(--border); border-left: 4px solid var(--teal-700);
      border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 22px rgba(0,0,0,.12);
      animation: slidein .18s ease-out; }
    .toast[data-tone="info"] { border-left-color: var(--blue); }
    .toast[data-tone="warn"] { border-left-color: var(--amber); }
    .tdot { width: 8px; height: 8px; border-radius: 999px; background: var(--teal-700); flex: 0 0 8px; }
    .toast[data-tone="info"] .tdot { background: var(--blue); }
    .toast[data-tone="warn"] .tdot { background: var(--amber); }
    .tmsg { flex: 1; font-size: 12.5px; color: var(--ink-soft); line-height: 1.4; }
    .tx { border: none; background: none; cursor: pointer; color: var(--gray-400);
      font-size: 18px; line-height: 1; padding: 0 2px; }
    @keyframes slidein { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
  `],
})
export class Overlays {
  ix = inject(Interaction);
}
