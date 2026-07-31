import { Injectable, inject } from '@angular/core';
import { Interaction } from './interaction';
import { DashboardData } from '../data/dashboard-data';

export const BALANCE_STRATEGIES = [
  { label: 'Light — move 1 case from the busiest nurse', n: 1 },
  { label: 'Standard — rebalance 3 cases', n: 3 },
  { label: 'Aggressive — rebalance 6 cases', n: 6 },
  { label: 'Even out — level everyone toward the team average', n: 5 },
];

// Shared balance flow: choose a strategy (the "override" — how aggressively to rebalance),
// confirm the exact impact, then apply. Used by Workforce & Queue Management and by the
// Balance button on every Case Explorer drill-down, so the behavior is identical everywhere.
@Injectable({ providedIn: 'root' })
export class Balance {
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  run(scopeNote = 'across the team') {
    this.ix.choose({
      title: 'Balance workload',
      body: `Choose how aggressively to rebalance cases from over-utilized nurses to those with capacity (${scopeNote}).`,
      label: 'Balancing strategy',
      options: BALANCE_STRATEGIES.map((s) => s.label),
      confirmLabel: 'Continue', tone: 'teal',
      onChoose: (opt) => {
        const strat = BALANCE_STRATEGIES.find((s) => s.label === opt)!;
        this.ix.ask({
          title: 'Confirm rebalance',
          body: `This will move ${strat.n} case${strat.n > 1 ? 's' : ''} from over-utilized nurses to nurses with capacity (${scopeNote}). Continue?`,
          confirmLabel: 'Balance', tone: 'teal',
          onConfirm: () => {
            for (let i = 0; i < strat.n; i++) this.data.reassignBusiest();
            this.ix.toast(`Workload balanced — ${opt.split(' — ')[0].toLowerCase()} (${strat.n} case${strat.n > 1 ? 's' : ''} moved).`);
            this.data.addHistory('balance', 'Workload balanced', `${opt.split(' — ')[0]} · ${strat.n} case(s) moved`);
          },
        });
      },
    });
  }
}
