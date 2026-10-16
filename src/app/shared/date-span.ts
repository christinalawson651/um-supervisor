import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Lookback } from './lookback';
import { CASE_POOL } from '../data/case-pool';
import { TODAY_ISO } from '../data/case-fields';

// Custom date span for the shell filter bar, beside the Today / 7 days / 30 days quick picks.
// The button always shows the active span; choosing a quick pick replaces a custom span.
@Component({
  selector: 'app-date-span',
  standalone: true,
  template: `
    <div class="ds">
      <button type="button" class="ds-btn" [class.custom]="lookback.period() === 'custom'" [attr.aria-expanded]="open()" (click)="toggle()">
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
        <span>{{ lookback.rangeLabel() }}</span><span aria-hidden="true">▾</span>
      </button>
      @if (open()) {
        <div class="ds-pop" role="dialog" aria-label="Choose a date span">
          <div class="ds-dates">
            <label>Start date<input type="date" [min]="min" [max]="max" [value]="from()" (input)="from.set($any($event.target).value)" /></label>
            <label>End date<input type="date" [min]="min" [max]="max" [value]="to()" (input)="to.set($any($event.target).value)" /></label>
          </div>
          @if (err()) { <div class="ds-err">{{ err() }}</div> }
          <div class="ds-foot">
            <button type="button" class="ds-sm" (click)="open.set(false)">Cancel</button>
            <button type="button" class="ds-apply" (click)="apply()">Apply span</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .ds { position:relative; }
    .ds-btn { display:inline-flex; gap:6px; align-items:center; border:1px solid var(--gray-300); border-radius:7px; background:#fff;
      padding:4px 10px; font-size:11px; font-weight:600; color:var(--gray-700); cursor:pointer; }
    .ds-btn.custom { border-color:var(--teal-600); background:var(--teal-100); color:var(--teal-900); }
    .ds-pop { position:absolute; top:calc(100% + 6px); left:0; z-index:70; width:min(360px, 88vw); background:#fff; border:1px solid var(--border);
      border-radius:10px; box-shadow:0 12px 30px rgba(0,0,0,.14); padding:12px; display:flex; flex-direction:column; gap:10px; }
    .ds-dates { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .ds-dates label { display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:var(--gray-500); font-weight:600; }
    .ds-dates input { border:1px solid var(--gray-300); border-radius:7px; padding:5px 8px; font-size:12.5px; color:var(--ink); }
    .ds-err { font-size:12px; color:var(--red-fg, #b42318); }
    .ds-foot { display:flex; justify-content:flex-end; gap:8px; }
    .ds-sm { border:1px solid var(--gray-300); background:#fff; border-radius:6px; padding:4px 10px; font-size:11.5px; font-weight:600; color:var(--gray-700); cursor:pointer; }
    .ds-apply { border:none; background:var(--teal-700); color:#fff; border-radius:6px; padding:4px 12px; font-size:11.5px; font-weight:600; cursor:pointer; }
  `],
})
export class DateSpan {
  readonly lookback = inject(Lookback);
  private host = inject(ElementRef<HTMLElement>);

  /** Oldest submitted date in the case pool — nothing exists before it. */
  readonly min = CASE_POOL.reduce((m, c) => (c.submitted < m ? c.submitted : m), TODAY_ISO);
  readonly max = TODAY_ISO;

  readonly open = signal(false);
  readonly from = signal('');
  readonly to = signal('');
  readonly err = signal('');

  toggle() {
    if (this.open()) { this.open.set(false); return; }
    const [f, t] = this.currentSpan();
    this.from.set(f); this.to.set(t); this.err.set(''); this.open.set(true);
  }
  private currentSpan(): [string, string] {
    const iso = (n: number) => { const d = new Date(`${TODAY_ISO}T00:00:00`); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    return [iso(this.lookback.windowDays()), iso(this.lookback.endDaysAgo())];
  }
  apply() {
    const f = this.from(), t = this.to();
    if (!f || !t) { this.err.set('Choose both a start and an end date.'); return; }
    if (t > this.max) { this.err.set('The end date cannot be after today.'); return; }
    if (f < this.min) { this.err.set(`The start date cannot be before ${this.min}.`); return; }
    if (f > t) { this.err.set('The start date must be on or before the end date.'); return; }
    this.lookback.setSpan(f, t);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) { if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false); }
  @HostListener('document:keydown.escape')
  onEsc() { this.open.set(false); }
}
