import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Interaction, DrawerAction, ConfirmPick, ConfirmRequest } from './interaction';

@Component({
  selector: 'app-overlays',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- Confirm modal -->
    @if (ix.confirm(); as c) {
      <div class="scrim" (click)="ix.resolve(false)">
        <div class="modal" [class.wide]="!!c.picks?.length" (click)="$event.stopPropagation()">
          <h3>{{ c.title }}</h3>
          <p>{{ c.body }}</p>
          @if (c.breakdown?.length) {
            <ul class="breakdown">
              @for (row of c.breakdown; track row.target) {
                <li><span class="bcount">{{ row.count }}</span> {{ row.label }} <span class="barrow">→</span> <span class="btarget">{{ row.target }}</span></li>
              }
            </ul>
          }
          @if (c.picks?.length) {
            <div class="pick-head">
              <span class="pick-count">{{ chosen().length }} of {{ c.picks!.length }} selected</span>
              <button type="button" class="pick-link" (click)="allPicks(true)">Select all</button>
              <button type="button" class="pick-link" (click)="allPicks(false)">Clear</button>
            </div>
            <ul class="picks">
              @for (pk of c.picks; track pk.id) {
                <li [class.off]="!pk.selected">
                  <label>
                    <input type="checkbox" [checked]="pk.selected" (change)="togglePick(pk)" />
                    <span class="pk-main">
                      <span class="pk-ref">{{ pk.ref }}</span>
                      <span class="pk-label">{{ pk.label }}</span>
                    </span>
                    <span class="pk-move">{{ pk.from }} <span class="barrow">→</span> <b>{{ pk.to }}</b></span>
                  </label>
                  @if (pk.note) { <span class="pk-note">{{ pk.note }}</span> }
                </li>
              }
            </ul>
          }
          <div class="actions">
            <button class="btn outline" (click)="ix.resolve(false)">Cancel</button>
            <button class="btn primary" [attr.data-tone]="c.tone"
              [disabled]="!!c.picks?.length && !chosen().length"
              (click)="ix.resolve(true, c.picks ? chosen() : undefined)">{{ confirmLabel(c) }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Chooser modal (pick an assignee) -->
    @if (ix.chooser(); as c) {
      <div class="scrim" (click)="ix.resolveChoice(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <h3>{{ c.title }}</h3>
          <p>{{ c.body }}</p>
          <label class="flabel">{{ c.label }}</label>
          <select class="fselect" [ngModel]="choice()" (ngModelChange)="choice.set($event)">
            @for (o of c.options; track o) { <option [value]="o">{{ o }}</option> }
          </select>
          <div class="actions">
            <button class="btn outline" (click)="ix.resolveChoice(null)">Cancel</button>
            <button class="btn primary" [attr.data-tone]="c.tone"
              (click)="ix.resolveChoice(choice())">{{ c.confirmLabel }}</button>
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
      display: flex; align-items: center; justify-content: center; z-index: 200; }
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
    /* A pick list needs room for a reference, a name and a from/to on one line — at 420px those
       wrap into mush, which defeats the point of showing them individually. */
    .modal.wide { width: 620px; }
    .modal h3 { margin: 0 0 8px; font-size: 16px; color: var(--ink); }
    .modal p { margin: 0 0 20px; font-size: 13px; color: var(--gray-500); line-height: 1.55; }
    .pick-head { display:flex; align-items:center; gap:14px; margin:-8px 0 8px; }
    .pick-count { font-size:11px; font-weight:700; color:var(--gray-500); text-transform:uppercase;
      letter-spacing:.04em; margin-right:auto; }
    .pick-link { background:none; border:none; padding:0; cursor:pointer; font-size:12px;
      font-weight:600; color:var(--teal-700); }
    .pick-link:hover { text-decoration:underline; }
    .picks { list-style:none; margin:0 0 20px; padding:0; display:flex; flex-direction:column; gap:4px;
      max-height:44vh; overflow-y:auto; }
    .picks li { background:var(--gray-50); border-radius:8px; padding:9px 12px; }
    .picks li.off { opacity:.45; }
    .picks label { display:flex; align-items:center; gap:10px; cursor:pointer; }
    .picks input { width:15px; height:15px; accent-color:var(--teal-600); flex:none; cursor:pointer; }
    .pk-main { display:flex; flex-direction:column; min-width:0; }
    .pk-ref { font-size:12.5px; font-weight:700; color:var(--ink); }
    .pk-label { font-size:12px; color:var(--gray-500); }
    .pk-move { margin-left:auto; font-size:12px; color:var(--gray-500); white-space:nowrap; }
    .pk-move b { color:var(--ink); font-weight:600; }
    .pk-note { display:block; margin:5px 0 0 25px; font-size:11.5px; color:var(--gray-400); }
    .btn[disabled] { opacity:.45; cursor:not-allowed; }
    .breakdown { list-style:none; margin:-8px 0 20px; padding:0; display:flex; flex-direction:column; gap:6px; }
    .breakdown li { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-soft);
      background:var(--gray-50); border-radius:8px; padding:9px 12px; }
    .bcount { font-weight:700; color:var(--teal-900); background:var(--teal-100); border-radius:6px;
      padding:1px 8px; font-size:12.5px; min-width:20px; text-align:center; }
    .barrow { color:var(--gray-400); }
    .btarget { font-weight:600; color:var(--ink); margin-left:auto; }
    .flabel { display:block; font-size:11px; font-weight:600; color:var(--gray-500);
      text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
    .fselect { width:100%; padding:9px 12px; border:1px solid var(--gray-300); border-radius:8px;
      font-size:13px; margin-bottom:20px; outline:none; background:#fff; }
    .fselect:focus { border-color: var(--teal-600); }
    .actions { display: flex; justify-content: flex-end; gap: 10px; }
    .btn.primary[data-tone="red"] { background: var(--red); border-color: var(--red); }
    .btn.primary[data-tone="red"]:hover { background: #dc2626; }
    .btn.primary[data-tone="amber"] { background: var(--amber); border-color: var(--amber); color:#3d2c00; }

    .toasts { position: fixed; bottom: 22px; right: 22px; z-index: 210;
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
  readonly choice = signal('');

  constructor() {
    // default the select to the first option each time a chooser opens
    effect(() => {
      const c = this.ix.chooser();
      if (c && c.options.length) this.choice.set(c.options[0]);
    });
  }

  /** Ticking a box mutates the ConfirmPick in place. The dialog owns the selection while it is open
   *  and hands the surviving ids back on confirm — so nothing recomputes between preview and apply,
   *  which is the whole reason the list is trustworthy. */
  togglePick(pk: ConfirmPick) {
    pk.selected = !pk.selected;
    this.pickTick.update((n) => n + 1);
  }
  allPicks(on: boolean) {
    this.ix.confirm()?.picks?.forEach((p) => (p.selected = on));
    this.pickTick.update((n) => n + 1);
  }
  /** Mutating the pick objects does not touch a signal, so the count and the button state would not
   *  re-render on their own. This bumps on every change to make the view follow. */
  private readonly pickTick = signal(0);
  readonly chosen = computed(() => {
    this.pickTick();
    return (this.ix.confirm()?.picks ?? []).filter((p) => p.selected).map((p) => p.id);
  });
  /** "Balance 3" rather than a fixed label, so the button says what it will actually do after the
   *  supervisor has switched some rows off. */
  confirmLabel(c: ConfirmRequest): string {
    if (!c.picks?.length) return c.confirmLabel;
    return `${c.confirmLabel} ${this.chosen().length}`;
  }

  runDrawer(a: DrawerAction) { this.ix.closeDrawer(); a.run(); }
}
