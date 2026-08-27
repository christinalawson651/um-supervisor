import { Injectable, signal } from '@angular/core';
import type { ExportMeta } from './export-csv';
export type { ExportMeta } from './export-csv';

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
  /** Set when `sections` holds every table of one generated report (Reports module), rather than
   *  several unrelated per-tab datasets meant to be picked one at a time. The dialog skips the
   *  Section dropdown/column-filter UI and always exports every section together — one CSV with a
   *  "## Label" marker per table, one workbook with a worksheet per table, or one printable page
   *  with every table in sequence. */
  combineAll?: boolean;
  /** Provenance to stamp onto the export itself — which filters were applied, and who/when
   *  generated it. Reports sets this; other callers omit it and exports look exactly as before. */
  meta?: ExportMeta;
}

@Injectable({ providedIn: 'root' })
export class Exporter {
  readonly config = signal<ExportConfig | null>(null);
  open(c: ExportConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
