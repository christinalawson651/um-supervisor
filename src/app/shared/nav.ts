import { Injectable, computed, signal } from '@angular/core';

export type ModuleId = 'overview' | 'um' | 'cm' | 'appeals';
export type BizModule = 'um' | 'cm' | 'appeals';

export interface Role { id: string; label: string; modules: BizModule[]; }

export const ROLES: Role[] = [
  { id: 'exec',        label: 'Executive / Ops Leader', modules: ['um', 'cm', 'appeals'] },
  { id: 'um',          label: 'UM Supervisor',          modules: ['um'] },
  { id: 'cm',          label: 'CM Supervisor',          modules: ['cm'] },
  { id: 'appeals',     label: 'Appeals Supervisor',     modules: ['appeals'] },
  { id: 'um_cm',       label: 'UM + CM Lead',           modules: ['um', 'cm'] },
  { id: 'um_appeals',  label: 'UM + Appeals Lead',      modules: ['um', 'appeals'] },
  { id: 'cm_appeals',  label: 'CM + Appeals Lead',      modules: ['cm', 'appeals'] },
];

@Injectable({ providedIn: 'root' })
export class Nav {
  readonly role = signal<Role>(ROLES[0]);
  readonly module = signal<ModuleId>('overview');

  /** Modules the current role can see; Overview is present only for multi-module roles. */
  readonly visibleModules = computed<ModuleId[]>(() => {
    const biz = this.role().modules;
    return biz.length > 1 ? ['overview', ...biz] : [...biz];
  });

  /** Business modules (no overview) the role owns — drives the exec Overview scope. */
  readonly scope = computed<BizModule[]>(() => this.role().modules);

  go(m: ModuleId) {
    if (this.visibleModules().includes(m)) this.module.set(m);
  }

  setRole(label: string) {
    const r = ROLES.find((x) => x.label === label);
    if (!r) return;
    this.role.set(r);
    const visible = this.visibleModules();
    if (!visible.includes(this.module())) this.module.set(visible[0]);
  }
}
