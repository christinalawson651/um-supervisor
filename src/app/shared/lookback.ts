import { Injectable, signal } from '@angular/core';

// Shared lookback period across module KPI strips.
@Injectable({ providedIn: 'root' })
export class Lookback {
  readonly periods = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'qtd', label: 'QTD' },
  ];
  readonly period = signal('30d');
}
