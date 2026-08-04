import { signal, computed } from '@angular/core';

export interface WidgetDef { id: string; title: string; }

/**
 * Per-tab widget picker — the "Customize" half of the Pulse pattern. Which cards/panels are
 * visible is saved to localStorage under its own key, so it stays until the user resets it or
 * re-selects it (not session-only, unlike the plain remove-for-now behavior this replaces).
 * Instantiated directly (`new WidgetVisibility(...)`) per tab component — not an Angular service,
 * since each tab needs its own independent state and storage key.
 */
export class WidgetVisibility {
  readonly enabled = signal<string[]>([]);
  readonly customizing = signal(false);
  readonly draft = signal<string[]>([]);
  readonly dirty = computed(() => {
    const a = [...this.enabled()].sort(), b = [...this.draft()].sort();
    return JSON.stringify(a) !== JSON.stringify(b);
  });

  constructor(private key: string, readonly defs: WidgetDef[], private defaultIds: string[] = defs.map((d) => d.id)) {
    this.enabled.set(this.load());
  }

  private load(): string[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [...this.defaultIds];
  }
  private persist() {
    try { localStorage.setItem(this.key, JSON.stringify(this.enabled())); } catch {}
  }

  /** Live-previews from the draft while the picker is open (matches the "toggle to preview" hint), otherwise the saved/committed list. */
  isHidden(id: string) {
    const source = this.customizing() ? this.draft() : this.enabled();
    return !source.includes(id);
  }

  open() { this.draft.set([...this.enabled()]); this.customizing.set(true); }
  cancel() { this.customizing.set(false); }
  toggleDraft(id: string) { this.draft.update((e) => e.includes(id) ? e.filter((x) => x !== id) : [...e, id]); }
  resetDefault() { this.draft.set([...this.defaultIds]); }
  save() { this.enabled.set([...this.draft()]); this.persist(); this.customizing.set(false); }

  /** The × on a card: edits the draft while customizing, otherwise removes and persists immediately. */
  remove(id: string) {
    if (this.customizing()) { this.toggleDraft(id); return; }
    this.enabled.update((e) => e.filter((x) => x !== id));
    this.persist();
  }
}
