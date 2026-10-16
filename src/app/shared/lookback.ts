import { Injectable, signal } from '@angular/core';
import { SPAN_END, TODAY, daysAgo } from '../data/case-fields';

export type PeriodId = 'today' | '7d' | '30d' | 'custom';

// Shared date span across module KPI strips — a real date-range filter (same treatment as
// LobFilter is a category filter). Quick picks Today / 7 days / 30 days, or a custom start–end
// span. '30d' is the baseline: every pending case falls within it by construction, so the default
// view matches the unfiltered case pool exactly.
@Injectable({ providedIn: 'root' })
export class Lookback {
  readonly periods: { id: PeriodId; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
  ];
  readonly period = signal<PeriodId>('30d');
  /** Custom span, yyyy-mm-dd, inclusive. Only read when period() is 'custom'. */
  readonly from = signal<string | null>(null);
  readonly to = signal<string | null>(null);

  private static readonly WINDOW: Record<string, number> = { today: 0, '7d': 6, '30d': 29 };

  setQuick(id: PeriodId) {
    this.period.set(id);
    SPAN_END.daysAgo = 0;
  }
  setSpan(from: string, to: string) {
    this.from.set(from);
    this.to.set(to);
    this.period.set('custom');
    SPAN_END.daysAgo = Math.max(0, daysAgo(to));
  }

  /** Days back from "today" the span starts (inclusive). */
  windowDays(): number {
    if (this.period() === 'custom') { this.to(); return daysAgo(this.from()!); }
    return Lookback.WINDOW[this.period()] ?? 29;
  }
  /** Days back from "today" the span ends (0 = today). */
  endDaysAgo(): number {
    return this.period() === 'custom' ? Math.max(0, daysAgo(this.to()!)) : 0;
  }

  /** True if a yyyy-mm-dd date string falls within the selected span. */
  includes(dateStr: string): boolean {
    const d = daysAgo(dateStr);
    return d >= this.endDaysAgo() && d <= this.windowDays();
  }

  /** "30 days", or for a custom span "Sep 16 – Oct 15, 2026 · 30 days". */
  label(): string {
    if (this.period() !== 'custom') return this.periods.find((p) => p.id === this.period())?.label ?? '30 days';
    return spanLabel(this.from()!, this.to()!);
  }
  /** The span's own dates, for the picker button. */
  rangeLabel(): string {
    const back = this.windowDays(), end = this.endDaysAgo();
    const iso = (n: number) => { const d = new Date(TODAY); d.setDate(d.getDate() - n); return isoOf(d); };
    return spanLabel(iso(back), iso(end));
  }
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function spanLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`), t = new Date(`${to}T00:00:00`);
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${md(f)}${days > 1 ? ' – ' + md(t) : ''}, ${t.getFullYear()} · ${days} day${days > 1 ? 's' : ''}`;
}
