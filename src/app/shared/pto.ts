import { Injectable, signal } from '@angular/core';

export interface PtoPerson { name: string; team: string; active: number; utilization: number; }
export interface PtoConfig {
  title: string;
  itemLabel: string;   // 'authorization' | 'member' — what's being redistributed, for the confirmation copy
  people: PtoPerson[];
  /** `target` is null for the recommended automatic distribution (least-utilized teammate picked
   *  per item), or a specific teammate's name to send the ENTIRE caseload to instead. */
  apply: (person: string, startDate: string, endDate: string, target: string | null) => void;
}

// Shared "going on PTO, hand off the whole caseload" flow — used by both UM's Workforce & Queue
// Management and CM's Workforce & Caseload. Unlike Reassign/Balance (which move some cases and
// leave the rest), this always empties the selected person out completely, to teammates on their
// own team only (never redistributes across teams) — the caller supplies `people` already scoped
// to whichever roster it owns and does the actual per-item reassignment in `apply`.
@Injectable({ providedIn: 'root' })
export class Pto {
  readonly config = signal<PtoConfig | null>(null);
  open(c: PtoConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
