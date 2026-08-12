import { Routes } from '@angular/router';
import { Shell } from './shell/shell';
import { CmRosterView } from './roster/cm-roster-view';

export const routes: Routes = [
  { path: '', component: Shell },
  { path: 'roster/cm/:name', component: CmRosterView },
];
