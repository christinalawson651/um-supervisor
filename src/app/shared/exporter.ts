import { Injectable, signal } from '@angular/core';

export interface ExportSection {
  label: string;                // shown in the Section picker
  name: string;                 // file base name for this section
  columns: string[];
  rows: (string | number)[][];
}

export interface ExportConfig {
  title: string;
  name: string;                 // file base name — used when `sections` is omitted
  columns: string[];
  rows: (string | number)[][];
  /** When a tab has more than one distinct exportable dataset (e.g. Workload, Cases by Case
   *  Type, Queues), pass them here — the dialog shows a Section dropdown and everything else
   *  (columns checklist, filter, row count) follows whichever section is selected. Omit for the
   *  common single-dataset case; the dialog then just uses columns/rows/name above as before. */
  sections?: ExportSection[];
}

@Injectable({ providedIn: 'root' })
export class Exporter {
  readonly config = signal<ExportConfig | null>(null);
  open(c: ExportConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
