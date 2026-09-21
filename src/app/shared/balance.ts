import { Injectable, inject } from '@angular/core';
import { Interaction, ConfirmPick } from './interaction';
import { DashboardData } from '../data/dashboard-data';
import { CASE_POOL, CaseRec } from '../data/case-pool';
import { urgencyOf } from '../data/case-fields';

/** `n` is a fixed number of moves; `n: null` means "keep going until the team is level", which is
 *  a different kind of instruction and the reason the type allows both.
 *
 *  "Even out" previously carried n: 5. The label promised levelling and the code moved five
 *  authorizations regardless of how far apart the team actually was — so on a tight spread it
 *  overshot, and on a wide one (96% down to 55%) it did not come close. Raised by QA as NGP-4393
 *  against the build; the build was faithful and the reference was wrong. */
export const BALANCE_STRATEGIES: { label: string; n: number | null }[] = [
  { label: 'Light — move 1 authorization from the busiest nurse', n: 1 },
  { label: 'Standard — rebalance 3 authorizations', n: 3 },
  { label: 'Aggressive — rebalance 6 authorizations', n: 6 },
  { label: 'Even out — level everyone toward the team average', n: null },
];

/** One move shifts four points off the busiest and onto the lightest, so it closes the spread by
 *  eight. Stopping at eight points is therefore the tightest honest target: chasing a smaller gap
 *  would move an authorization, overshoot, and move it back. */
const LEVEL_TOLERANCE_PTS = 8;
/** Nothing should ever move a whole caseload in one action, however wide the spread. */
const LEVEL_MAX_MOVES = 40;

/** One planned move, named down to the authorization. */
interface PlannedMove {
  authId: string;
  member: string;
  from: string;
  to: string;
  why: string;
}

// Shared balance flow: choose a strategy (the "override" — how aggressively to rebalance), review
// exactly which authorizations move and to whom, switch off any that should stay put, then apply.
// Used by Workforce & Queue Management and by the Balance button on every Case Explorer drill-down,
// so the behavior is identical everywhere.
@Injectable({ providedIn: 'root' })
export class Balance {
  private ix = inject(Interaction);
  private data = inject(DashboardData);

  /** @param nurseScope restrict the rebalance pool to these nurse names (e.g. one team) — omit to consider everyone. */
  run(scopeNote = 'across the team', nurseScope?: string[]) {
    this.ix.choose({
      title: 'Balance workload',
      body: `Choose how aggressively to rebalance authorizations from over-utilized nurses to those with capacity (${scopeNote}). You will see every move before anything is applied.`,
      label: 'Balancing strategy',
      options: BALANCE_STRATEGIES.map((s) => s.label),
      confirmLabel: 'Preview moves', tone: 'teal',
      onChoose: (opt) => {
        const strat = BALANCE_STRATEGIES.find((s) => s.label === opt)!;
        const plan = this.simulate(strat.n, nurseScope);
        if (!plan.length) { this.ix.toast('Workload is already balanced — nothing to move.', 'info'); return; }

        const picks: ConfirmPick[] = plan.map((m, i) => ({
          id: `${m.authId}-${i}`,
          ref: m.authId,
          label: m.member,
          from: m.from,
          to: m.to,
          note: m.why,
          selected: true,
        }));

        this.ix.ask({
          title: `Review ${plan.length} proposed move${plan.length > 1 ? 's' : ''}`,
          body: `Each authorization below moves from an over-utilized nurse to one with capacity (${scopeNote}). Switch off anything that should stay where it is.`,
          picks,
          confirmLabel: 'Balance', tone: 'teal',
          onConfirm: (selectedIds) => {
            // Apply exactly what survived the review. The previous version re-derived the busiest
            // nurse on each move at commit time, so the moves that happened were not necessarily the
            // moves that were shown — the preview was a forecast rather than a promise.
            const chosen = picks.filter((p) => selectedIds?.includes(p.id));
            if (!chosen.length) { this.ix.toast('Nothing selected — no authorizations moved.', 'info'); return; }
            chosen.forEach((p) => this.data.moveOneCase(p.from, p.to));

            const byTarget = new Map<string, number>();
            chosen.forEach((p) => byTarget.set(p.to, (byTarget.get(p.to) ?? 0) + 1));
            const breakdown = [...byTarget.entries()].map(([target, count]) => `${count} → ${target}`).join(', ');
            const dropped = picks.length - chosen.length;

            this.ix.toast(`Workload balanced — ${chosen.length} authorization${chosen.length > 1 ? 's' : ''} moved${dropped ? `, ${dropped} kept in place` : ''}.`);
            this.data.addHistory(
              'balance', 'Workload balanced',
              `${opt.split(' — ')[0]} (${scopeNote}) · ${breakdown}${dropped ? ` · ${dropped} declined at review` : ''}`,
              undefined,
              {
                members: [...new Set(chosen.map((p) => p.label))],
                refs: chosen.map((p) => p.ref),
                // Only meaningful when every move came off the same nurse; otherwise the history row
                // would claim a single source that did not exist.
                fromStaff: new Set(chosen.map((p) => p.from)).size === 1 ? chosen[0].from : undefined,
                toStaff: byTarget.size === 1 ? chosen[0].to : undefined,
              },
            );
          },
        });
      },
    });
  }

  /** Candidate authorizations for moving off `nurse`, least-disruptive first.
   *
   *  The ordering is a clinical judgement, not an implementation detail, so it is stated rather than
   *  buried: standard before expedited (an expedited case has a running clock and a handover costs
   *  more), un-breached before breached (a breached case needs continuity, not a new owner), then
   *  most recently submitted — least work invested, least context lost in the handover. */
  private candidatesFor(nurse: string): CaseRec[] {
    const rank = (c: CaseRec) =>
      (urgencyOf(c) === 'Expedited' ? 4 : 0)
      + (c.tags.includes('breached') ? 2 : 0)
      + (c.tags.includes('mdReview') ? 1 : 0);
    return CASE_POOL
      .filter((c) => c.phase === 'pending' && c.nurse === nurse)
      .sort((a, b) => rank(a) - rank(b) || (a.submitted < b.submitted ? 1 : -1));
  }

  private reasonFor(c: CaseRec): string {
    if (urgencyOf(c) === 'Expedited') return 'Expedited — moved only because nothing lighter was available';
    if (c.tags.includes('breached')) return 'Past deadline — confirm the new owner can pick it up today';
    if (c.tags.includes('mdReview')) return 'Awaiting MD review — little nurse work in flight';
    return 'Standard, recently submitted — least context lost in a handover';
  }

  /** Mirrors the live utilization arithmetic (busiest → least-utilized, four points a move) so the
   *  preview matches what applying it actually does.
   *  @param n a fixed number of moves, or null to level the team toward its average. */
  private simulate(n: number | null, nurseScope?: string[]): PlannedMove[] {
    const sim = this.data.nurses()
      .filter((x) => !nurseScope || nurseScope.includes(x.name))
      .map((x) => ({ name: x.name, utilization: x.utilization }));
    const plan: PlannedMove[] = [];
    const spread = () => {
      const u = sim.map((s) => s.utilization);
      return Math.max(...u) - Math.min(...u);
    };
    // Each nurse's candidate list is consumed as the plan is built, so one authorization can never
    // be planned into two different moves.
    const pools = new Map<string, CaseRec[]>();
    const nextFor = (nurse: string): CaseRec | undefined => {
      if (!pools.has(nurse)) pools.set(nurse, this.candidatesFor(nurse));
      return pools.get(nurse)!.shift();
    };

    // Levelling runs until the spread closes rather than for a set number of moves, so the size of
    // the plan follows the size of the problem — which is what the strategy's name claims.
    const limit = n ?? LEVEL_MAX_MOVES;
    for (let i = 0; i < limit && sim.length > 1; i++) {
      if (n === null && spread() <= LEVEL_TOLERANCE_PTS) break;
      const from = [...sim].sort((a, b) => b.utilization - a.utilization)[0];
      const to = [...sim].sort((a, b) => a.utilization - b.utilization)[0];
      if (from.name === to.name) break;

      const c = nextFor(from.name);
      // A nurse can be the busiest by utilization and still have nothing movable — every case
      // decided, or already planned. Stopping is right; inventing a move is not.
      if (!c) break;

      plan.push({ authId: c.authId, member: c.member, from: from.name, to: to.name, why: this.reasonFor(c) });
      const fromRef = sim.find((s) => s.name === from.name)!;
      const toRef = sim.find((s) => s.name === to.name)!;
      fromRef.utilization = Math.max(0, fromRef.utilization - 4);
      toRef.utilization = Math.min(100, toRef.utilization + 4);
    }
    return plan;
  }
}
