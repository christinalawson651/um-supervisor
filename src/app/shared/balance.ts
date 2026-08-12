import { Injectable, inject } from '@angular/core';
import { Interaction, ConfirmBreakdownRow } from './interaction';
import { DashboardData } from '../data/dashboard-data';

export const BALANCE_STRATEGIES = [
  { label: 'Light — move 1 authorization from the busiest nurse', n: 1 },
  { label: 'Standard — rebalance 3 authorizations', n: 3 },
  { label: 'Aggressive — rebalance 6 authorizations', n: 6 },
  { label: 'Even out — level everyone toward the team average', n: 5 },
];

// Shared balance flow: choose a strategy (the "override" — how aggressively to rebalance),
// preview exactly where authorizations will land, confirm, then apply. Used by Workforce &
// Queue Management and by the Balance button on every Case Explorer drill-down, so the
// behavior is identical everywhere.
@Injectable({ providedIn: 'root' })
export class Balance {
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  /** @param nurseScope restrict the rebalance pool to these nurse names (e.g. one team) — omit to consider everyone. */
  run(scopeNote = 'across the team', nurseScope?: string[]) {
    this.ix.choose({
      title: 'Balance workload',
      body: `Choose how aggressively to rebalance authorizations from over-utilized nurses to those with capacity (${scopeNote}).`,
      label: 'Balancing strategy',
      options: BALANCE_STRATEGIES.map((s) => s.label),
      confirmLabel: 'Continue', tone: 'teal',
      onChoose: (opt) => {
        const strat = BALANCE_STRATEGIES.find((s) => s.label === opt)!;
        const plan = this.simulate(strat.n, nurseScope);
        if (!plan.length) { this.ix.toast('Workload is already balanced — nothing to move.', 'info'); return; }
        this.ix.ask({
          title: `Balance ${plan.length} authorization${plan.length > 1 ? 's' : ''}`,
          body: `Move authorizations from over-utilized nurses to nurses with capacity (${scopeNote}):`,
          breakdown: this.summarize(plan),
          confirmLabel: 'Balance', tone: 'teal',
          onConfirm: () => {
            const moves = plan.map(() => this.data.reassignBusiest(nurseScope)).filter((m): m is { from: string; to: string } => !!m);
            this.ix.toast(`Workload balanced — ${opt.split(' — ')[0].toLowerCase()} (${moves.length} authorization${moves.length > 1 ? 's' : ''} moved).`);
            const byTarget = new Map<string, number>();
            moves.forEach((m) => byTarget.set(m.to, (byTarget.get(m.to) ?? 0) + 1));
            const breakdown = [...byTarget.entries()].map(([target, count]) => `${count} → ${target}`).join(', ') || 'no moves';
            this.data.addHistory('balance', 'Workload balanced', `${opt.split(' — ')[0]} (${scopeNote}) · ${breakdown}`);
          },
        });
      },
    });
  }

  /** Mirrors reassignBusiest()'s own logic (busiest -> least-utilized) so the preview matches what actually happens. */
  private simulate(n: number, nurseScope?: string[]): { from: string; to: string }[] {
    const sim = this.data.nurses()
      .filter((x) => !nurseScope || nurseScope.includes(x.name))
      .map((x) => ({ name: x.name, utilization: x.utilization }));
    const plan: { from: string; to: string }[] = [];
    for (let i = 0; i < n && sim.length > 1; i++) {
      const from = [...sim].sort((a, b) => b.utilization - a.utilization)[0];
      const to = [...sim].sort((a, b) => a.utilization - b.utilization)[0];
      if (from.name === to.name) break;
      plan.push({ from: from.name, to: to.name });
      const fromRef = sim.find((s) => s.name === from.name)!;
      const toRef = sim.find((s) => s.name === to.name)!;
      fromRef.utilization = Math.max(0, fromRef.utilization - 4);
      toRef.utilization = Math.min(100, toRef.utilization + 4);
    }
    return plan;
  }

  private summarize(plan: { from: string; to: string }[]): ConfirmBreakdownRow[] {
    const byTarget = new Map<string, number>();
    plan.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
    return [...byTarget.entries()].map(([target, count]) => ({ count, label: count === 1 ? 'authorization' : 'authorizations', target }));
  }
}
