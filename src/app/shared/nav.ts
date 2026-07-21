import { Injectable, signal } from '@angular/core';

export type ModuleId = 'overview' | 'um' | 'cm' | 'appeals';

@Injectable({ providedIn: 'root' })
export class Nav {
  readonly module = signal<ModuleId>('overview');
  go(m: ModuleId) { this.module.set(m); }
}
