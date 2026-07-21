import { Injectable, signal } from '@angular/core';

export interface ReassignCase {
  authId: string; member: string; type: string; queue: string; priority: string; owner: string;
}
export interface ReassignNurse { name: string; utilization: number; active: number; }
export interface ReassignConfig {
  title: string;
  cases: ReassignCase[];
  nurses: ReassignNurse[];
  apply: (caseIds: string[], target: string) => void;
}

@Injectable({ providedIn: 'root' })
export class Reassign {
  readonly config = signal<ReassignConfig | null>(null);
  open(c: ReassignConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
