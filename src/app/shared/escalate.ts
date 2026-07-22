import { Injectable, signal } from '@angular/core';

export interface EscalateCandidate {
  authId: string;
  member: string;
  detail: string;                       // stage · drivers
  riskLabel: string;                    // e.g. "98 · High"
  risk: 'red' | 'amber' | 'green';
}
export interface EscalateConfig {
  title: string;
  candidates: EscalateCandidate[];
  targets: string[];
  apply: (ids: string[], target: string) => void;
}

@Injectable({ providedIn: 'root' })
export class Escalate {
  readonly config = signal<EscalateConfig | null>(null);
  open(c: EscalateConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
