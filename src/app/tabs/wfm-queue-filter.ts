import { Component, Input, computed, inject } from '@angular/core';
import { BHP_BY, WFM_STATES, bhpOf, bhpProductOf, bhpStateOf, stateCodeOf } from '../data/case-fields';
import { NOW } from '../data/wfm-work';
import { Item, QfKey, QueueFilter, UNCLAIMED, WfmStore, unclaimedHere } from '../shared/wfm-store';
import { BhpPicker } from '../shared/bhp-picker';
import { summarize } from '../shared/lob-filter';

// Each queue has its own filters, set inside the opened queue and saved per queue, per user (and in
// saved views). Work always presents by due date, so there is no priority or due filter.

/** TAT status for exports: Overdue (past TAT), At risk (step overdue or TAT inside a day), On track. */
export const prioOf = (i: Item) => (i.l.slaDue < NOW ? 'Overdue' : i.l.stepDue < NOW || i.l.slaDue - NOW < 24 * 3600e3 ? 'At risk' : 'On track');
export const productLabel = (id: string) => `${bhpStateOf(id) === 'Arizona' ? 'AZ' : 'FL'} · ${BHP_BY[id].name}`;
export const planLabel = (authId: string) => productLabel(bhpProductOf(bhpOf(authId)));

/** Assignment filter values. Queued = an open line in this queue with no holder; No owner = the
 *  authorization has no Auth Owner (um-03 addendum 01); Mine = I hold a line or own the authorization. */
export const ASSIGNMENT = ['Queued', 'No owner', 'Assigned', 'Mine'] as const;

/** Does this line pass its queue's filters? */
export function matchQueueFilter(f: QueueFilter, i: Item, actor: string, owner: string): boolean {
  const any = (k: QfKey, ok: (v: string) => boolean) => !f[k]?.length || f[k]!.some(ok);
  return any('plan', (v) => v === bhpOf(i.c.authId))
    && any('urg', (v) => v === i.l.urgency) && any('state', (v) => v === stateCodeOf(i.c.authId))
    && any('holder', (v) => (v === 'Queued' ? unclaimedHere(i) : v === 'No owner' ? owner === UNCLAIMED
      : v === 'Mine' ? i.holder === actor || owner === actor : i.holder !== UNCLAIMED));
}
const KEYS: QfKey[] = ['plan', 'urg', 'state', 'holder'];
export const qfCount = (f?: QueueFilter) => (f ? KEYS.reduce((n, k) => n + (f[k]?.length ? 1 : 0), 0) : 0);
export function qfSummary(f?: QueueFilter): string {
  if (!f) return '';
  return KEYS.filter((k) => f[k]?.length).map((k) => (k === 'plan' ? summarize(new Set(f[k])) : f[k]!.join(' or '))).join(' · ');
}

/** The filter panel for one queue. */
@Component({
  selector: 'app-wfm-queue-filter',
  standalone: true,
  imports: [BhpPicker],
  template: `
    <div class="sec">
      <div class="lab">Plans (BHP)</div>
      <app-bhp-picker class="block" [value]="val('plan')" (valueChange)="set('plan', $event)"></app-bhp-picker>
    </div>
    <div class="sec">
      <div class="lab">Urgency</div>
      <div class="seg">
        @for (v of urgencies; track v) { <button type="button" [class.on]="has('urg', v)" (click)="toggle('urg', v)">{{ v }}</button> }
      </div>
    </div>
    <div class="sec">
      <div class="lab">State</div>
      <div class="seg">
        @for (v of states; track v) { <button type="button" [class.on]="has('state', v)" (click)="toggle('state', v)">{{ v }}</button> }
      </div>
    </div>
    <div class="sec">
      <div class="lab">Assignment</div>
      <div class="opts">
        @for (v of assignment(); track v.id) {
          <label class="opt"><input type="checkbox" [checked]="has('holder', v.id)" (change)="toggle('holder', v.id)" />
            <span><b>{{ v.id }}</b><small>{{ v.hint }}</small></span></label>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; gap:14px; }
    .lab { font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-bottom:6px; }
    .seg { display:flex; border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; }
    .seg button { flex:1; border:none; background:#fff; padding:6px 8px; font-size:12px; color:var(--ink-soft); cursor:pointer; }
    .seg button + button { border-left:1px solid var(--gray-300); }
    .seg button.on { background:var(--teal-700); color:#fff; font-weight:600; }
    .opts { display:flex; flex-direction:column; gap:4px; }
    .opt { display:flex; gap:8px; align-items:flex-start; padding:5px 6px; border-radius:6px; cursor:pointer; font-size:12px; }
    .opt:hover { background:var(--gray-50); }
    .opt input { margin-top:2px; accent-color:var(--teal-700); }
    .opt b { display:block; font-weight:600; color:var(--ink); } .opt small { display:block; font-size:10.5px; color:var(--gray-500); }
  `],
})
export class WfmQueueFilter {
  private store = inject(WfmStore);
  @Input({ required: true }) queueId!: string;
  readonly urgencies = ['Expedited', 'Standard'];
  readonly states = WFM_STATES;
  readonly assignment = computed(() => [
    { id: 'Queued', hint: 'Open lines in this queue with no one holding them' },
    { id: 'No owner', hint: 'Authorizations without an Auth Owner' },
    { id: 'Assigned', hint: 'Lines someone holds' },
    { id: 'Mine', hint: `Held or owned by ${this.store.actor()}` },
  ]);
  private f() { return this.store.state().qf[this.queueId] ?? {}; }
  val(k: QfKey) { return this.f()[k] ?? []; }
  has(k: QfKey, v: string) { return !!this.f()[k]?.includes(v); }
  set(k: QfKey, vals: string[]) {
    this.store.patch((s) => {
      const cur = s.qf[this.queueId] ?? {};
      if (vals.length) cur[k] = vals; else delete cur[k];
      if (Object.keys(cur).length) s.qf[this.queueId] = cur; else delete s.qf[this.queueId];
    });
  }
  toggle(k: QfKey, v: string) { const vals = this.val(k); this.set(k, vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v]); }
}
