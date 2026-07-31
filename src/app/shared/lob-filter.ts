import { Injectable, signal } from '@angular/core';
import { LOBS } from '../data/case-fields';

// Shared top-level LOB filter — same treatment as Lookback: one control in the shell,
// scopes every drill-down and any tab that's LOB-aware, persists as you switch tabs.
@Injectable({ providedIn: 'root' })
export class LobFilter {
  readonly options = [{ id: 'all', label: 'All LOBs' }, ...LOBS.map((l) => ({ id: l, label: l }))];
  readonly value = signal('all');
}
