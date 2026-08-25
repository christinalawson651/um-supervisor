import { Injectable, computed, signal } from '@angular/core';
import { FOLLOW_THROUGH_POOL, FollowThroughItem, FOLLOW_THROUGH_STAFF, FOLLOW_THROUGH_TYPES } from '../data/follow-through-pool';

export type SourceScope = 'all' | 'UM' | 'CM';

/** One shared pool + one shared service, injected by both the UM and CM modules' Follow-Through
 *  Board tab — a member drawn from the UM side is drawn from the exact same pool a CM-side viewer
 *  would see, not two independent copies. */
@Injectable({ providedIn: 'root' })
export class FollowThroughData {
  // Whoever is signed in to work this board for the demo — a support-staff seat, distinct from the
  // supervisor identity (Christina Lawson) shown in the app's own topbar.
  readonly me = 'Priya Anand';
  readonly staffRoster = FOLLOW_THROUGH_STAFF;
  readonly taskTypes = FOLLOW_THROUGH_TYPES;

  readonly items = signal<FollowThroughItem[]>(FOLLOW_THROUGH_POOL.map((i) => ({ ...i })));

  // Which source modules feed this board — a client configures this once in a real deployment; here
  // it's a live toggle so the configurability itself is demonstrable.
  readonly sourceScope = signal<SourceScope>('all');

  readonly scoped = computed(() => {
    const scope = this.sourceScope();
    return scope === 'all' ? this.items() : this.items().filter((i) => i.sourceModule === scope);
  });

  readonly queued = computed(() => this.scoped().filter((i) => i.status === 'Queued'));
  readonly myBoard = computed(() => this.scoped().filter((i) => i.status === 'Drawn' && i.drawnBy === this.me));
  readonly completed = computed(() => this.scoped().filter((i) => i.status === 'Completed'));
  readonly dueOrOverdue = computed(() => {
    const today = this.items().length ? this.todayIso() : '';
    return this.queued().filter((i) => i.dueDate <= today);
  });

  readonly byType = computed(() => {
    const q = this.queued();
    return this.taskTypes.map((t) => ({ type: t, count: q.filter((i) => i.taskType === t).length }));
  });

  private todayIso(): string {
    // Matches case-fields.ts's fixed demo anchor rather than the real clock, so "due or overdue"
    // stays stable across reloads like every other date-derived figure in this app.
    return '2026-07-17';
  }

  activeCountFor(name: string): number {
    return this.items().filter((i) => i.status === 'Drawn' && i.drawnBy === name).length;
  }

  drawNext(): FollowThroughItem | null {
    const pool = this.queued();
    if (!pool.length) return null;
    const next = [...pool].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'Urgent' ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    })[0];
    this.items.update((all) => all.map((i) => (i.id === next.id ? { ...i, status: 'Drawn', drawnBy: this.me, drawnAt: 'Just now' } : i)));
    return next;
  }

  returnItem(id: string) {
    this.items.update((all) => all.map((i) => (i.id === id ? { ...i, status: 'Queued', drawnBy: null, drawnAt: null } : i)));
  }

  reassign(id: string, target: string) {
    this.items.update((all) => all.map((i) => (i.id === id ? { ...i, status: 'Drawn', drawnBy: target, drawnAt: 'Just now' } : i)));
  }

  complete(id: string) {
    this.items.update((all) => all.map((i) => (i.id === id ? { ...i, status: 'Completed' } : i)));
  }
}
