import { Injectable, signal } from '@angular/core';
import { daysAgo } from '../data/case-fields';

// Shared lookback period across module KPI strips — a real date-range filter (same treatment as
// LobFilter is a category filter). '30d' is the baseline: every pending case falls within it by
// construction, so the default view matches the unfiltered case pool exactly.
@Injectable({ providedIn: 'root' })
export class Lookback {
  readonly periods = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'qtd', label: 'QTD' },
  ];
  readonly period = signal('30d');

  private static readonly WINDOW: Record<string, number> = { today: 0, '7d': 6, '30d': 29, qtd: 90 };

  /** Days back from "today" the current period covers (inclusive). */
  windowDays(): number {
    return Lookback.WINDOW[this.period()] ?? 29;
  }

  /** True if a yyyy-mm-dd date string falls within the selected lookback window. */
  includes(dateStr: string): boolean {
    const d = daysAgo(dateStr);
    return d >= 0 && d <= this.windowDays();
  }
}
