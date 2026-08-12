import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Pto } from './pto';
import { TODAY } from '../data/case-fields';

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }

@Component({
  selector: 'app-pto-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (pto.config(); as c) {
      <div class="scrim" (click)="pto.close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="mh">
            <div><h3>{{ c.title }}</h3><div class="sub">Choose who's going on PTO — their whole active caseload hands off to teammates with capacity on their own team.</div></div>
            <button class="x" (click)="pto.close()">×</button>
          </div>

          <label class="flabel">Going on PTO</label>
          <select class="fsel" [ngModel]="person()" (ngModelChange)="person.set($event)">
            @for (p of c.people; track p.name) { <option [value]="p.name">{{ p.name }} — {{ p.team }} ({{ p.active }} active, {{ p.utilization }}% utilized)</option> }
          </select>

          <div class="drow">
            <div>
              <label class="flabel">Start date</label>
              <input class="fsel" type="date" [ngModel]="start()" (ngModelChange)="start.set($event)" />
            </div>
            <div>
              <label class="flabel">Return date</label>
              <input class="fsel" type="date" [ngModel]="end()" (ngModelChange)="end.set($event)" />
            </div>
          </div>

          @if (teammates().length) {
            <label class="flabel">Send caseload to</label>
            <button class="nrec" [class.on]="target() === null" (click)="target.set(null)">
              <div class="nrow"><b>Automatic</b><span class="recbadge">★ Recommended</span></div>
              <div class="nmeta">Distributes to teammates with the most capacity as each case moves — no single person absorbs it all.</div>
            </button>
            <div class="ovr">Or send everything to:</div>
            <div class="nlist">
              @for (t of teammates(); track t.name) {
                <button class="ni" [class.on]="target() === t.name" (click)="target.set(t.name)">
                  <div class="nrow"><b>{{ t.name }}</b>
                    @if (t.utilization < 85) { <span class="cap">capacity</span> } @else { <span class="full">near full</span> }
                  </div>
                  <div class="ubar"><span [style.width.%]="t.utilization" [attr.data-t]="tone(t.utilization)"></span></div>
                  <div class="upct">{{ t.utilization }}% · {{ t.active }} active</div>
                </button>
              }
            </div>
          }

          @if (selected(); as p) {
            @if (teammateCount() === 0) {
              <div class="warn">No other teammates on {{ p.team }} to receive this caseload.</div>
            } @else if (p.active === 0) {
              <div class="warn">{{ p.name }} has no active caseload to redistribute.</div>
            } @else {
              <div class="note">Moving all <b>{{ p.active }}</b> {{ c.itemLabel }}{{ p.active === 1 ? '' : 's' }} from <b>{{ p.name }}</b> to {{ target() ? target() : 'teammates on ' + p.team + ' with capacity' }}, {{ start() }} – {{ end() }}.</div>
            }
          }

          <div class="mf">
            <span class="spacer"></span>
            <button class="btn outline" (click)="pto.close()">Cancel</button>
            <button class="btn primary" [attr.data-tone]="'teal'" [disabled]="!canApply()" (click)="apply(c)">Redistribute</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .scrim { position:fixed; inset:0; background:rgba(17,24,39,.45); z-index:120; display:flex; align-items:center; justify-content:center; }
    .modal { background:#fff; border-radius:12px; width:460px; max-width:92vw; max-height:90vh; overflow-y:auto; padding:20px 22px; box-shadow:0 20px 40px rgba(0,0,0,.2); }
    .mh { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
    .mh h3 { margin:0; font-size:16px; } .sub { font-size:12.5px; color:var(--gray-500); margin-top:4px; line-height:1.5; }
    .x { border:none; background:none; font-size:22px; color:var(--gray-400); cursor:pointer; }
    .flabel { display:block; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-bottom:6px; }
    .fsel { width:100%; padding:9px 12px; border:1px solid var(--gray-300); border-radius:8px; font-size:13px; outline:none; margin-bottom:16px; }
    .fsel:focus { border-color:var(--teal-600); }
    .drow { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .note { font-size:12.5px; color:var(--ink-soft); background:var(--teal-50); border:1px solid var(--teal-100); border-radius:8px; padding:10px 12px; margin-bottom:16px; line-height:1.5; }
    .warn { font-size:12.5px; color:var(--amber-fg); background:var(--amber-bg); border-radius:8px; padding:10px 12px; margin-bottom:16px; line-height:1.5; }
    .mf { display:flex; align-items:center; gap:10px; }
    .spacer { flex:1; }
    .btn[disabled] { opacity:.45; cursor:default; }

    .nrec { text-align:left; width:100%; border:2px solid var(--teal-600); background:#fff; border-radius:10px; padding:12px 14px; cursor:pointer; margin-bottom:12px; }
    .nrec.on { background:var(--teal-50); }
    .recbadge { font-size:10.5px; font-weight:700; color:var(--teal-700); background:var(--teal-100); padding:2px 8px; border-radius:999px; }
    .nmeta { font-size:11.5px; color:var(--gray-500); margin-top:4px; line-height:1.4; }
    .ovr { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-bottom:8px; }
    .nlist { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
    .ni { text-align:left; width:100%; border:1px solid var(--gray-300); background:#fff; border-radius:10px; padding:10px 12px; cursor:pointer; }
    .ni.on { border-color:var(--teal-600); background:var(--teal-50); }
    .nrow { display:flex; align-items:center; justify-content:space-between; }
    .nrow b { font-size:13px; color:var(--ink); }
    .cap { font-size:10.5px; font-weight:700; color:var(--green-fg); background:var(--green-bg); padding:2px 8px; border-radius:999px; }
    .full { font-size:10.5px; font-weight:700; color:var(--amber-fg); background:var(--amber-bg); padding:2px 8px; border-radius:999px; }
    .ubar { height:6px; border-radius:999px; background:var(--gray-200); overflow:hidden; margin:8px 0 4px; }
    .ubar > span { display:block; height:100%; border-radius:999px; }
    .ubar > span[data-t="green"]{ background:var(--green); } .ubar > span[data-t="amber"]{ background:var(--amber); } .ubar > span[data-t="red"]{ background:var(--red); }
    .upct { font-size:11px; color:var(--gray-500); }
  `],
})
export class PtoPanel {
  pto = inject(Pto);
  readonly person = signal('');
  readonly start = signal('');
  readonly end = signal('');
  readonly target = signal<string | null>(null);

  constructor() {
    effect(() => {
      const c = this.pto.config();
      this.person.set(c?.people[0]?.name ?? '');
      this.start.set(isoDate(TODAY));
      this.end.set(isoDate(addDays(TODAY, 7)));
      this.target.set(null);
    });
  }

  selected() { return this.pto.config()?.people.find((p) => p.name === this.person()); }
  teammates() {
    const c = this.pto.config(); const p = this.selected();
    if (!c || !p) return [];
    return c.people.filter((x) => x.team === p.team && x.name !== p.name);
  }
  teammateCount() { return this.teammates().length; }
  canApply() {
    const p = this.selected();
    return !!p && p.active > 0 && this.teammateCount() > 0 && !!this.start() && !!this.end();
  }
  tone(u: number) { return u >= 90 ? 'red' : u < 80 ? 'green' : 'amber'; }
  apply(c: { apply: (person: string, start: string, end: string, target: string | null) => void }) {
    c.apply(this.person(), this.start(), this.end(), this.target());
    this.pto.close();
  }
}
