import { Component, Input, computed, inject, signal } from '@angular/core';
import { BHP_BY, BHP_PRODUCTS, WFM_STATES, bhpOf, bhpProductOf, bhpStateOf, stateCodeOf } from '../data/case-fields';
import { H, NOW } from '../data/wfm-work';
import { Item, QfKey, QueueFilter, UNCLAIMED, WfmStore, unclaimedHere } from '../shared/wfm-store';

// Each queue has its own filters, because different queues need different cuts of their work.
// One filter set per queue, per user: the queue's card and its worklist both read and write it,
// and saved views carry every queue's filters.

/** Breached = past the SLA; At risk = step overdue or SLA inside a day; else Routine. */
export const prioOf = (i: Item) => (i.l.slaDue < NOW ? 'Breached' : i.l.stepDue < NOW || i.l.slaDue - NOW < 24 * H ? 'At risk' : 'Routine');
export const productLabel = (id: string) => `${bhpStateOf(id) === 'Arizona' ? 'AZ' : 'FL'} · ${BHP_BY[id].name}`;

/** Does this line pass its queue's filters? */
export function matchQueueFilter(f: QueueFilter, i: Item, actor: string): boolean {
  const any = (k: QfKey, ok: (v: string) => boolean) => !f[k]?.length || f[k]!.some(ok);
  return any('holder', (v) => (v === 'Unclaimed' ? unclaimedHere(i) : v === 'Mine' ? i.holder === actor : i.holder !== UNCLAIMED))
    && any('due', (v) => (v === 'SLA breached' ? i.l.slaDue < NOW : v === 'SLA < 24h' ? i.l.slaDue >= NOW && i.l.slaDue - NOW < 24 * H : i.l.stepDue < NOW))
    && any('urg', (v) => v === i.l.urgency) && any('prio', (v) => v === prioOf(i)) && any('state', (v) => v === stateCodeOf(i.c.authId))
    && any('plan', (v) => v === bhpProductOf(bhpOf(i.c.authId)));
}
export const qfCount = (f?: QueueFilter) => (f ? Object.values(f).reduce((n, v) => n + (v?.length ?? 0), 0) : 0);
export function qfSummary(f?: QueueFilter): string {
  if (!f) return '';
  const order: QfKey[] = ['plan', 'urg', 'state', 'prio', 'due', 'holder'];
  return order.filter((k) => f[k]?.length).map((k) => {
    const v = f[k]!;
    return k === 'plan' ? (v.length === 1 ? productLabel(v[0]) : `${v.length} plans`) : v.join(' or ');
  }).join(' · ');
}

/** The filter chips for one queue. */
@Component({
  selector: 'app-wfm-queue-filter',
  standalone: true,
  template: `
    @for (d of dims(); track d.key) {
      <div class="fg"><span class="fl">{{ d.label }}</span>
        @for (o of d.options; track o.id) {
          <button type="button" class="chip" [class.on]="has(d.key, o.id)" (click)="toggle(d.key, o.id)">{{ o.label }}</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display:flex; flex-wrap:wrap; gap:6px 16px; }
    :host(.stack) { flex-direction:column; gap:6px; }
    .fg { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
    .fl { font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--gray-500); font-weight:700; margin-right:2px; min-width:52px; }
    .chip { border:1px solid var(--gray-300); background:#fff; border-radius:999px; padding:2px 9px; font-size:11.5px; color:var(--gray-500); cursor:pointer; }
    .chip.on { background:var(--teal-700); border-color:var(--teal-700); color:#fff; font-weight:600; }
  `],
})
export class WfmQueueFilter {
  private store = inject(WfmStore);
  @Input({ required: true }) queueId!: string;
  /** Show the Holder filter (the worklist does; a card counts unclaimed work only). */
  @Input() holder = true;
  private readonly itemsSig = signal<Item[]>([]);
  /** The queue's work, so Plan only offers plans that have work in it. */
  @Input() set items(v: Item[]) { this.itemsSig.set(v); }

  readonly dims = computed(() => {
    const plans = new Set(this.itemsSig().map((i) => bhpProductOf(bhpOf(i.c.authId))));
    const o = (xs: string[]) => xs.map((x) => ({ id: x, label: x }));
    const dims = [
      { key: 'plan' as QfKey, label: 'Plan', options: BHP_PRODUCTS.filter((p) => plans.has(p.id) || this.has('plan', p.id)).map((p) => ({ id: p.id, label: productLabel(p.id) })) },
      { key: 'urg' as QfKey, label: 'Urgency', options: o(['Expedited', 'Standard']) },
      { key: 'state' as QfKey, label: 'State', options: o(WFM_STATES) },
      { key: 'prio' as QfKey, label: 'Priority', options: o(['Breached', 'At risk', 'Routine']) },
      { key: 'due' as QfKey, label: 'Due', options: o(['SLA breached', 'SLA < 24h', 'Step overdue']) },
    ];
    if (this.holder) dims.push({ key: 'holder' as QfKey, label: 'Holder', options: o(this.store.isReviewer() ? ['Unclaimed', 'Mine'] : ['Unclaimed', 'Assigned', 'Mine']) });
    return dims;
  });
  has(k: QfKey, v: string) { return !!this.store.state().qf[this.queueId]?.[k]?.includes(v); }
  toggle(k: QfKey, v: string) {
    this.store.patch((s) => {
      const cur = s.qf[this.queueId] ?? {}, vals = cur[k] ?? [];
      cur[k] = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v];
      if (!cur[k]!.length) delete cur[k];
      if (Object.keys(cur).length) s.qf[this.queueId] = cur; else delete s.qf[this.queueId];
    });
  }
}
