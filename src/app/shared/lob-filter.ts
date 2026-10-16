import { Injectable, computed, signal } from '@angular/core';
import { BHP_BY, BHP_LEAVES, bhpChildren, bhpLeavesUnder } from '../data/case-fields';

// Shared top-level plan (BHP) filter — same treatment as Lookback: one control in the shell,
// scopes every drill-down and every plan-aware tab, persists as you switch tabs.
// `value()` is 'all' when nothing is ticked, otherwise the ticked leaf plan codes; every
// consumer passes it straight to inPlanScope() / the live* derivations.
@Injectable({ providedIn: 'root' })
export class LobFilter {
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly value = computed<'all' | string[]>(() => (this.selected().size ? [...this.selected()] : 'all'));

  /** "All plans", one plan, "Florida (all)", "Florida LTC-LF (all)" or "Florida · 3 plans". */
  readonly summary = computed(() => summarize(this.selected()));
}

export function summarize(set: ReadonlySet<string>): string {
  if (!set.size) return 'All plans';
  if (set.size === 1) { const id = [...set][0]; return `${BHP_BY[id].name} · ${id}`; }
  const parts: string[] = [];
  for (const s of bhpChildren(null)) {
    const leaves = bhpLeavesUnder(s.id), on = leaves.filter((id) => set.has(id));
    if (!on.length) continue;
    if (on.length === leaves.length) { parts.push(`${s.name} (all)`); continue; }
    let rest = 0;
    for (const c of bhpChildren(s.id)) {
      const l2 = bhpLeavesUnder(c.id), o2 = l2.filter((id) => set.has(id));
      if (l2.length > 1 && o2.length === l2.length) parts.push(`${s.name} ${c.name} (all)`); else rest += o2.length;
    }
    if (rest) parts.push(`${s.name} · ${rest} plan${rest > 1 ? 's' : ''}`);
  }
  return parts.join(', ') || `${set.size} of ${BHP_LEAVES.length} plans`;
}
