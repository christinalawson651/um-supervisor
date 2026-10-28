import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';

import { routes } from './app.routes';

// Swapped in for app.config.ts by the "standalone" build configuration (angular.json).
// Identical except for hash routing: the single-file pulse-app.html is opened from disk,
// where path routing has no server to fall back to and would render a blank page.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation())
  ]
};
