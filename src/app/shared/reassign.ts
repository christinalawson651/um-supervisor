import { Injectable, signal } from '@angular/core';

export interface ReassignCase {
  authId: string; member: string; type: string; queue: string; priority: string; owner: string;
}
export interface ReassignNurse { name: string; utilization: number; active: number; }
export interface ReassignConfig {
  title: string;
  cases: ReassignCase[];
  nurses: ReassignNurse[];
  /** mode reflects the panel's "Assign to: Assignee / Queue" toggle — 'assignee' means target is a
   *  nurse name (as before); 'queue' means target is one of the queue names (Intake, RFI Pending, etc.). */
  apply: (caseIds: string[], target: string, mode: 'assignee' | 'queue') => void;
  /** Pre-check every case (used when the caller already selected specific cases, e.g. from a drill-down). */
  preselectAll?: boolean;
}

@Injectable({ providedIn: 'root' })
export class Reassign {
  readonly config = signal<ReassignConfig | null>(null);
  open(c: ReassignConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
