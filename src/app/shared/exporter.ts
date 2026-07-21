import { Injectable, signal } from '@angular/core';

export interface ExportConfig {
  title: string;
  name: string;                 // file base name
  columns: string[];
  rows: (string | number)[][];
}

@Injectable({ providedIn: 'root' })
export class Exporter {
  readonly config = signal<ExportConfig | null>(null);
  open(c: ExportConfig) { this.config.set(c); }
  close() { this.config.set(null); }
}
