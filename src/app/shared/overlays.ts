import { Component, inject } from '@angular/core';
import { Interaction, DrawerAction } from './interaction';

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

    <!-- Detail drawer -->
    @if (ix.drawer(); as d) {
      <div class="scrim right" (click)="ix.closeDrawer()">
        <aside class="drawer" (click)="$event.stopPropagation()">
          <div class="dhead">
            <div>
              <h3>{{ d.title }}</h3>
              @if (d.subtitle) { <p class="dsub">{{ d.subtitle }}</p> }
            </div>
            <button class="dx" (click)="ix.closeDrawer()">×</button>
          </div>
          @if (d.badge) {
            <span class="badge" [class.green]="d.badge.tone==='green'" [class.amber]="d.badge.tone==='amber'"
              [class.red]="d.badge.tone==='red'" [class.blue]="d.badge.tone==='blue'"
              [class.teal]="d.badge.tone==='teal'">{{ d.badge.text }}</span>
          }
          @if (d.formula) { <div class="formula">{{ d.formula }}</div> }
          @if (d.fields?.length) {
            <dl class="dfields">
              @for (f of d.fields; track f.label) {
                <div class="drow">
                  <dt>{{ f.label }}</dt>
                  <dd [attr.data-tone]="f.tone || null">{{ f.value }}</dd>
                </div>
              }
            </dl>
          }
          @if (d.table) {
            @if (d.table.caption) { <div class="tcap">{{ d.table.caption }}</div> }
            <div class="dtable-wrap">
              <table class="dtable">
                <thead><tr>@for (c of d.table.columns; track c) { <th>{{ c }}</th> }</tr></thead>
                <tbody>
                  @for (row of d.table.rows; track $index) {
                    <tr>@for (cell of row; track $index) { <td>{{ cell }}</td> }</tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (d.note) { <p class="dnote">{{ d.note }}</p> }
          @if (d.actions?.length) {
            <div class="dactions">
              @for (a of d.actions; track a.label) {
                <button class="btn primary" [attr.data-tone]="a.tone"
                  (click)="runDrawer(a)">{{ a.label }}</button>
              }
            </div>
          }
        </aside>
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
    .scrim.right { justify-content: flex-end; align-items: stretch; }

    .drawer { width: 420px; max-width: 92vw; background:#fff; height:100%; overflow-y:auto;
      padding: 22px 24px; box-shadow: -12px 0 30px rgba(0,0,0,.15);
      animation: slidein-r .2s ease-out; }
    @keyframes slidein-r { from { transform: translateX(30px); opacity:.6; } to { transform:none; opacity:1; } }
    .dhead { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 14px; }
    .dhead h3 { margin:0; font-size:16px; color:var(--ink); }
    .dsub { margin:4px 0 0; font-size:12.5px; color:var(--gray-500); }
    .dx { border:none; background:none; cursor:pointer; color:var(--gray-400); font-size:22px; line-height:1; }
    .dfields { margin: 16px 0 0; }
    .drow { display:flex; justify-content:space-between; gap:16px; padding:11px 0;
      border-bottom:1px solid var(--gray-100); }
    .drow dt { color:var(--gray-500); font-size:12px; }
    .drow dd { margin:0; font-weight:600; color:var(--ink); font-size:12.5px; text-align:right; }
    .drow dd[data-tone="green"]{ color:var(--green-fg); } .drow dd[data-tone="red"]{ color:var(--red); }
    .drow dd[data-tone="amber"]{ color:var(--amber-fg); } .drow dd[data-tone="blue"]{ color:var(--blue-fg); }
    .formula { margin:14px 0 4px; font-size:14px; font-weight:700; color:var(--teal-900);
      background:var(--teal-50); border:1px solid var(--teal-100); border-radius:8px; padding:12px 14px; }
    .tcap { margin:16px 0 8px; font-size:11px; letter-spacing:.05em; text-transform:uppercase;
      color:var(--gray-500); font-weight:600; }
    .dtable-wrap { overflow-x:auto; border:1px solid var(--gray-100); border-radius:8px; }
    .dtable { width:100%; border-collapse:collapse; font-size:12px; }
    .dtable thead th { text-align:left; padding:8px 10px; background:var(--gray-50);
      color:var(--gray-500); font-size:10px; letter-spacing:.04em; text-transform:uppercase;
      font-weight:600; white-space:nowrap; border-bottom:1px solid var(--gray-100); }
    .dtable tbody td { padding:8px 10px; border-bottom:1px solid var(--gray-100); color:var(--ink-soft);
      white-space:nowrap; }
    .dtable tbody tr:last-child td { border-bottom:none; }
    .dnote { margin-top:16px; font-size:12px; color:var(--gray-500); line-height:1.5;
      background:var(--gray-50); border-radius:8px; padding:12px; }
    .dactions { margin-top:20px; display:flex; flex-direction:column; gap:10px; }
    .dactions .btn { justify-content:center; }
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
  runDrawer(a: DrawerAction) { this.ix.closeDrawer(); a.run(); }
}
