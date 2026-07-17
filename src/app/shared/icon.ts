import { Component, Input, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Minimal inline stroke-icon set (Lucide-style 24x24 paths).
const ICONS: Record<string, string> = {
  folder:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  check:    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  bolt:     '<path d="M13 2L3 14h7l-1 8 10-12h-7z"/>',
  alert:    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  inbox:    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  xcircle:  '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  minus:    '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  user:     '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  phone:    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  dollar:   '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  shield:   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  barchart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/>',
  mail:     '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
  swap:     '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  arrowup:  '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  mappin:   '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  wifi:     '<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.03a6 6 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  chevron:  '<path d="m6 9 6 6 6-6"/>',
  balance:  '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
};

@Component({
  selector: 'z-icon',
  standalone: true,
  template: `<span class="ic" [innerHTML]="safe"></span>`,
  styles: [':host{display:inline-flex;line-height:0} .ic{display:inline-flex;line-height:0}'],
})
export class Icon {
  private san = inject(DomSanitizer);
  private _name = '';
  @Input() size = 16;
  @Input() stroke = 2;
  @Input() set name(v: string) { this._name = v; this.build(); }
  safe: SafeHtml = '';

  private build() {
    const body = ICONS[this._name] || '';
    const svg = `<svg width="${this.size}" height="${this.size}" viewBox="0 0 24 24" ` +
      `fill="none" stroke="currentColor" stroke-width="${this.stroke}" ` +
      `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    this.safe = this.san.bypassSecurityTrustHtml(svg);
  }
}
