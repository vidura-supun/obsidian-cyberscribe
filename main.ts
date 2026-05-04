import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  Plugin,
  PluginSettingTab,
  Setting,
} from 'obsidian';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { Annotation, RangeSetBuilder, StateEffect } from '@codemirror/state';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColorRule {
  id: string;
  regex: string;
  color: string;
  enabled: boolean;
}

interface DefangRule {
  regex: string;
  enabled: boolean;
}

interface PluginSettings {
  colorRules: ColorRule[];
  plainTextPaste: boolean;
  dateTokens: boolean;
  defang: {
    ips: DefangRule;
    domains: DefangRule;
    emails: DefangRule;
    urls: DefangRule;
    scopeStart: string;
    scopeEnd: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FLAT_COLORS = [
  { name: 'Red',     value: '#e74c3c' },
  { name: 'Orange',  value: '#e67e22' },
  { name: 'Yellow',  value: '#f1c40f' },
  { name: 'Green',   value: '#2ecc71' },
  { name: 'Teal',    value: '#1abc9c' },
  { name: 'Blue',    value: '#3498db' },
  { name: 'Purple',  value: '#9b59b6' },
  { name: 'Pink',    value: '#fd79a8' },
  { name: 'Crimson', value: '#c0392b' },
  { name: 'Lime',    value: '#a8e063' },
  { name: 'Cyan',    value: '#00cec9' },
  { name: 'Indigo',  value: '#6c5ce7' },
] as const;

const VALID_COLORS = new Set(FLAT_COLORS.map((c) => c.value));

const DEFAULT_SETTINGS: PluginSettings = {
  colorRules: [],
  plainTextPaste: false,
  dateTokens: true,
  defang: {
    ips: {
      regex: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b`,
      enabled: true,
    },
    domains: {
      regex: String.raw`\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|sh|gov|edu|co|uk|de|fr|ru|cn|jp|au|ca|info|biz|xyz|top|site|online|tech|me|tv|cc|app|dev|mil|int|us|in|br|nl|se|no|fi|dk|pl|ch|at|be|nz|sg|hk|tw|kr|za|mx|ar|cl|pe|ph|id|th|vn|pk|bd|ng|ke|eg|ma|dz|tn|ly|sd|gh|tz|ci|cm|sn|ug|zm|zw)\b`,
      enabled: true,
    },
    emails: {
      regex: String.raw`\b[a-zA-Z0-9._%+\-]+@(?:[a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}\b`,
      enabled: true,
    },
    urls: {
      regex: String.raw`https?://[^\s<>"'\]]+`,
      enabled: true,
    },
    scopeStart: '',
    scopeEnd: '',
  },
};

// ─── CM6 effects and annotations ─────────────────────────────────────────────

// Dispatched after saving settings to trigger decoration rebuild in all open editors
const settingsChangedEffect = StateEffect.define<void>();

const defangTx = Annotation.define<true>();
const dateTx   = Annotation.define<true>();

// ─── Scope helper ─────────────────────────────────────────────────────────────

function getScopeRanges(
  docText: string,
  scopeStart: string,
  scopeEnd: string
): { from: number; to: number }[] {
  const len = docText.length;

  if (!scopeStart && !scopeEnd) return [{ from: 0, to: len }];

  let startRe: RegExp | null = null;
  let endRe: RegExp | null = null;
  try { if (scopeStart) startRe = new RegExp(scopeStart, 'g'); } catch { /* invalid */ }
  try { if (scopeEnd)   endRe   = new RegExp(scopeEnd,   'g'); } catch { /* invalid */ }

  if (scopeStart && !startRe && scopeEnd && !endRe) return [{ from: 0, to: len }];

  if (!startRe && endRe) {
    const m = safeExec(endRe, docText);
    return [{ from: 0, to: m ? m.index : len }];
  }

  if (startRe && !endRe) {
    const m = safeExec(startRe, docText);
    return m ? [{ from: m.index + m[0].length, to: len }] : [];
  }

  // Both provided: find all paired start→end regions
  const ranges: { from: number; to: number }[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = safeExec(startRe!, docText)) !== null) {
    // Guard zero-width start match to prevent infinite loop (#1)
    if (sm[0].length === 0) { startRe!.lastIndex++; continue; }
    const from = sm.index + sm[0].length;
    endRe!.lastIndex = from;
    const em = safeExec(endRe!, docText);
    if (em) {
      if (em[0].length === 0) endRe!.lastIndex++;
      ranges.push({ from, to: em.index });
      startRe!.lastIndex = Math.max(startRe!.lastIndex, em.index + em[0].length);
    } else {
      ranges.push({ from, to: len });
      break;
    }
  }
  return ranges;
}

// Wraps exec and advances lastIndex on zero-width match to prevent infinite loops (#27)
function safeExec(re: RegExp, text: string): RegExpExecArray | null {
  const m = re.exec(text);
  if (m && m[0].length === 0) re.lastIndex++;
  return m;
}

// ─── Defang helpers ───────────────────────────────────────────────────────────

function defangText(text: string, type: 'ips' | 'domains' | 'emails' | 'urls'): string {
  if (type === 'urls') {
    return text.replace(/^https?/i, (m) => m.replace(/http/i, 'hxxp'));
  }
  if (type === 'ips' || type === 'domains') {
    return text.replace(/\./g, '[.]');
  }
  const atIdx = text.lastIndexOf('@');
  if (atIdx === -1) return text;
  return text.slice(0, atIdx) + '[@]' + text.slice(atIdx + 1).replace(/\./g, '[.]');
}

function isDefanged(text: string, type?: 'ips' | 'domains' | 'emails' | 'urls'): boolean {
  // For URLs, only the scheme matters — a URL with [.] in its host but a live
  // http(s):// scheme must still be defanged. Conversely a URL whose scheme is
  // already hxxp(s):// should be skipped regardless of bracketed host.
  if (type === 'urls') return /^hxxps?:\/\//i.test(text);
  return text.includes('[.]') || text.includes('[@]') || /hxxps?:\/\//i.test(text);
}

// ─── Date token helpers ───────────────────────────────────────────────────────

function utcDateString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

function utcDateTimeString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  return `${date} ${time} UTC`;
}

// Returns true if a DOM node is inside a code block, pre, or anchor — used to
// skip coloring inside those elements in reading view (#17)
function isInsideCodeOrLink(node: Node): boolean {
  let p = node.parentElement;
  while (p) {
    const tag = p.tagName.toLowerCase();
    if (tag === 'code' || tag === 'pre' || tag === 'a') return true;
    p = p.parentElement;
  }
  return false;
}

// ─── Main Plugin ──────────────────────────────────────────────────────────────

export default class CyberScribe extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SettingsTab(this.app, this));
    this.registerEditorExtension(this.buildEditorExtensions());
    this.registerMarkdownPostProcessor(this.processReadingView.bind(this));

    // ── Commands ─────────────────────────────────────────────────────────────

    this.addCommand({
      id: 'process-date-tokens',
      name: 'Process date tokens in note',
      editorCallback: (editor: Editor) => {
        const tokens = [
          { pattern: /<\$ datetime-now \$>/g, value: utcDateTimeString },
          { pattern: /<\$ date-now \$>/g,     value: utcDateString },
        ];
        const content = editor.getValue();
        const changes: { from: number; to: number; text: string }[] = [];

        // Snapshot one timestamp per token type so all replacements share the same instant
        for (const { pattern, value } of tokens) {
          const snapshot = value();
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(content)) !== null) {
            if (m[0].length === 0) { pattern.lastIndex++; continue; }
            changes.push({ from: m.index, to: m.index + m[0].length, text: snapshot });
          }
        }

        if (!changes.length) return;
        // Apply in reverse order so earlier positions stay valid (#13/#26 — avoids setValue)
        changes.sort((a, b) => b.from - a.from);
        for (const { from, to, text } of changes) {
          editor.replaceRange(text, editor.offsetToPos(from), editor.offsetToPos(to));
        }
      },
    });

    this.addCommand({
      id: 'insert-date',
      name: 'Insert current date (YYYY-MM-DD)',
      editorCallback: (editor: Editor) => {
        editor.replaceSelection(utcDateString());
      },
    });

    this.addCommand({
      id: 'insert-datetime',
      name: 'Insert current datetime (YYYY-MM-DD HH:mm:ss UTC)',
      editorCallback: (editor: Editor) => {
        editor.replaceSelection(utcDateTimeString());
      },
    });

    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor: Editor) => {
        if (!this.settings.plainTextPaste) return;
        const text = evt.clipboardData?.getData('text/plain');
        // Guard: empty or missing means non-text content (e.g. image) — don't swallow it (#22)
        if (!text) return;
        evt.preventDefault();
        editor.replaceSelection(text);
      })
    );
  }

  buildEditorExtensions() {
    const plugin = this;

    // ── Live Preview coloring ────────────────────────────────────────────────

    const colorPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = buildDecorations(view); }
        update(u: ViewUpdate) {
          // Rebuild on doc/viewport change OR when settings were saved (#19)
          if (
            u.docChanged ||
            u.viewportChanged ||
            u.transactions.some((tr) => tr.effects.some((e) => e.is(settingsChangedEffect)))
          ) {
            this.decorations = buildDecorations(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );

    function buildDecorations(view: EditorView): DecorationSet {
      const rules = plugin.settings.colorRules.filter((r) => r.enabled && r.regex);
      const hits: { from: number; to: number; color: string }[] = [];

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const rule of rules) {
          let re: RegExp;
          try { re = new RegExp(rule.regex, 'g'); } catch { continue; }
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            // Guard zero-width match to prevent infinite loop (#27)
            if (m[0].length === 0) { re.lastIndex++; continue; }
            hits.push({ from: from + m.index, to: from + m.index + m[0].length, color: rule.color });
          }
        }
      }

      hits.sort((a, b) => a.from - b.from);
      const builder = new RangeSetBuilder<Decoration>();
      let cursor = 0;
      for (const { from, to, color } of hits) {
        if (from >= cursor) {
          builder.add(from, to, Decoration.mark({ attributes: { style: `color:${color};font-weight:600` } }));
          cursor = to;
        }
      }
      return builder.finish();
    }

    // ── Auto-defang on type ──────────────────────────────────────────────────

    const defangListener = EditorView.updateListener.of((u: ViewUpdate) => {
      if (!u.docChanged) return;
      if (u.transactions.some((tr) => tr.annotation(defangTx))) return;

      const docText = u.state.doc.toString();
      const scopeRanges = getScopeRanges(
        docText,
        plugin.settings.defang.scopeStart,
        plugin.settings.defang.scopeEnd
      );

      function inScope(from: number, to: number): boolean {
        return scopeRanges.some((r) => from >= r.from && to <= r.to);
      }

      const changes: { from: number; to: number; insert: string }[] = [];
      const taken: { from: number; to: number }[] = [];

      function overlaps(from: number, to: number): boolean {
        return taken.some((r) => r.from < to && r.to > from);
      }

      // URLs first (contain domains/emails), then emails (contain domains), then IPs, then domains
      const types: Array<['urls' | 'emails' | 'ips' | 'domains', DefangRule]> = [
        ['urls',    plugin.settings.defang.urls],
        ['emails',  plugin.settings.defang.emails],
        ['ips',     plugin.settings.defang.ips],
        ['domains', plugin.settings.defang.domains],
      ];

      u.changes.iterChangedRanges((_fa, _ta, fb, tb) => {
        const lo = Math.max(0, fb - 100);
        const hi = Math.min(u.state.doc.length, tb + 100);
        const text = u.state.doc.sliceString(lo, hi);

        for (const [type, rule] of types) {
          if (!rule.enabled || !rule.regex) continue;
          let re: RegExp;
          try { re = new RegExp(rule.regex, 'g'); } catch { continue; }
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            // Guard zero-width match (#27)
            if (m[0].length === 0) { re.lastIndex++; continue; }
            const abs = lo + m.index;
            const absEnd = abs + m[0].length;
            if (!inScope(abs, absEnd) || overlaps(abs, absEnd) || isDefanged(m[0], type)) continue;
            taken.push({ from: abs, to: absEnd });
            changes.push({ from: abs, to: absEnd, insert: defangText(m[0], type) });
          }
        }
      });

      if (!changes.length) return;
      changes.sort((a, b) => b.from - a.from);
      u.view.dispatch({ changes, annotations: defangTx.of(true) });
    });

    // ── Date token replacement ────────────────────────────────────────────────

    const DATE_TOKENS = [
      { pattern: /<\$ datetime-now \$>/g, value: utcDateTimeString },
      { pattern: /<\$ date-now \$>/g,     value: utcDateString },
    ];

    const dateListener = EditorView.updateListener.of((u: ViewUpdate) => {
      if (!u.docChanged) return;
      if (!plugin.settings.dateTokens) return;
      if (u.transactions.some((tr) => tr.annotation(dateTx))) return;

      const changes: { from: number; to: number; insert: string }[] = [];

      u.changes.iterChangedRanges((_fa, _ta, fb, tb) => {
        const lo = Math.max(0, fb - 30);
        const hi = Math.min(u.state.doc.length, tb + 30);
        const text = u.state.doc.sliceString(lo, hi);

        for (const { pattern, value } of DATE_TOKENS) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          // Date token patterns are fixed literals — zero-width guard included for safety (#27)
          while ((m = pattern.exec(text)) !== null) {
            if (m[0].length === 0) { pattern.lastIndex++; continue; }
            changes.push({ from: lo + m.index, to: lo + m.index + m[0].length, insert: value() });
          }
        }
      });

      if (!changes.length) return;
      changes.sort((a, b) => b.from - a.from);
      u.view.dispatch({ changes, annotations: dateTx.of(true) });
    });

    return [colorPlugin, defangListener, dateListener];
  }

  // ── Reading View coloring ─────────────────────────────────────────────────

  processReadingView(el: HTMLElement, _ctx: MarkdownPostProcessorContext) {
    const rules = this.settings.colorRules.filter((r) => r.enabled && r.regex);
    if (!rules.length) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);

    for (const node of nodes) {
      // Skip text inside code blocks, pre, and links (#17)
      if (isInsideCodeOrLink(node)) continue;

      const text = node.nodeValue ?? '';
      const spans = buildSpans(text, rules);
      if (spans.length === 1 && !spans[0].color) continue;

      const frag = document.createDocumentFragment();
      for (const { text: t, color } of spans) {
        if (color) {
          const s = document.createElement('span');
          s.style.color = color;
          s.style.fontWeight = '600';
          s.textContent = t;
          frag.appendChild(s);
        } else {
          frag.appendChild(document.createTextNode(t));
        }
      }
      node.parentNode?.replaceChild(frag, node);
    }
  }

  // ── Settings persistence ──────────────────────────────────────────────────

  async loadSettings() {
    const saved = (await this.loadData()) ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      plainTextPaste: saved.plainTextPaste ?? DEFAULT_SETTINGS.plainTextPaste,
      dateTokens:     saved.dateTokens     ?? DEFAULT_SETTINGS.dateTokens,
      // Sanitize saved color rules — guard against missing/invalid fields from old versions (#10)
      colorRules: ((saved.colorRules ?? []) as any[]).map((r) => ({
        id:      typeof r.id      === 'string'  ? r.id      : (crypto.randomUUID?.() ?? Math.random().toString(36)),
        regex:   typeof r.regex   === 'string'  ? r.regex   : '',
        color:   VALID_COLORS.has(r.color)      ? r.color   : FLAT_COLORS[0].value,
        enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
      })),
      defang: {
        ips:        { ...DEFAULT_SETTINGS.defang.ips,     ...(saved.defang?.ips     ?? {}) },
        domains:    { ...DEFAULT_SETTINGS.defang.domains, ...(saved.defang?.domains ?? {}) },
        emails:     { ...DEFAULT_SETTINGS.defang.emails,  ...(saved.defang?.emails  ?? {}) },
        urls:       { ...DEFAULT_SETTINGS.defang.urls,    ...(saved.defang?.urls    ?? {}) },
        scopeStart: saved.defang?.scopeStart ?? '',
        scopeEnd:   saved.defang?.scopeEnd   ?? '',
      },
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Push settingsChangedEffect to all open CM6 editors to trigger decoration rebuild (#19)
    this.app.workspace.iterateAllLeaves((leaf: any) => {
      const cm = leaf.view?.editor?.cm as EditorView | undefined;
      if (cm) cm.dispatch({ effects: settingsChangedEffect.of() });
    });
  }
}

// ─── Reading view span builder ────────────────────────────────────────────────

function buildSpans(text: string, rules: ColorRule[]): { text: string; color: string | null }[] {
  const hits: { start: number; end: number; color: string }[] = [];

  for (const rule of rules) {
    let re: RegExp;
    try { re = new RegExp(rule.regex, 'g'); } catch { continue; }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Guard zero-width match to prevent infinite loop (#27)
      if (m[0].length === 0) { re.lastIndex++; continue; }
      hits.push({ start: m.index, end: m.index + m[0].length, color: rule.color });
    }
  }

  if (!hits.length) return [{ text, color: null }];

  // Sort by start position; on equal start, first rule (earlier in array) wins (#16)
  hits.sort((a, b) => a.start - b.start || 0);
  const out: { text: string; color: string | null }[] = [];
  let pos = 0, cursor = 0;
  for (const { start, end, color } of hits) {
    if (start < cursor) continue;
    if (pos < start) out.push({ text: text.slice(pos, start), color: null });
    out.push({ text: text.slice(start, end), color });
    pos = cursor = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), color: null });
  return out;
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: CyberScribe) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'CyberScribe' });

    new Setting(containerEl)
      .setName('Paste as plain text')
      .setDesc("Strip all formatting when pasting. Overrides Obsidian's default paste behaviour.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.plainTextPaste).onChange(async (v) => {
          this.plugin.settings.plainTextPaste = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Date tokens')
      .setDesc('Auto-replace <$ date-now $> with YYYY-MM-DD and <$ datetime-now $> with YYYY-MM-DD HH:mm:ss UTC.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.dateTokens).onChange(async (v) => {
          this.plugin.settings.dateTokens = v;
          await this.plugin.saveSettings();
        })
      );

    // ── Color Rules ──────────────────────────────────────────────────────────

    containerEl.createEl('h3', { text: 'Color Rules' });
    containerEl.createEl('p', {
      text: 'Highlight matched text in the editor and reading view. Up to 12 rules.',
      attr: { style: 'color: var(--text-muted); margin-top: 0;' },
    });

    const rules = this.plugin.settings.colorRules;

    for (const rule of rules) {
      const colorMeta = FLAT_COLORS.find((c) => c.value === rule.color) ?? FLAT_COLORS[0];
      let swatch: HTMLElement;

      new Setting(containerEl)
        .addText((t) =>
          t
            .setPlaceholder('Regex pattern  e.g.  ---OODA---')
            .setValue(rule.regex)
            .onChange(async (v) => { rule.regex = v; await this.plugin.saveSettings(); })
        )
        .addDropdown((d) => {
          FLAT_COLORS.forEach((c) => d.addOption(c.value, c.name));
          // Don't call display() on color change — update swatch in-place to preserve scroll (#24)
          d.setValue(rule.color).onChange(async (v) => {
            rule.color = v;
            await this.plugin.saveSettings();
            if (swatch) swatch.style.background = v;
          });
        })
        .addToggle((t) =>
          t.setValue(rule.enabled).onChange(async (v) => { rule.enabled = v; await this.plugin.saveSettings(); })
        )
        .addButton((b) =>
          // Use rule.id to find the rule rather than captured index to avoid race on double-click (#25)
          b.setButtonText('✕').setWarning().onClick(async () => {
            const idx = rules.findIndex((r) => r.id === rule.id);
            if (idx !== -1) rules.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
          })
        )
        .then((s) => {
          swatch = s.controlEl.createEl('span', {
            attr: {
              style: `display:inline-block;width:14px;height:14px;border-radius:50%;background:${rule.color};margin-left:6px;vertical-align:middle;`,
              title: colorMeta.name,
            },
          });
        });
    }

    if (rules.length < 12) {
      new Setting(containerEl).addButton((b) =>
        b.setButtonText('+ Add Rule').setCta().onClick(async () => {
          rules.push({
            id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
            regex: '',
            color: FLAT_COLORS[rules.length % FLAT_COLORS.length].value,
            enabled: true,
          });
          await this.plugin.saveSettings();
          this.display();
        })
      );
    }

    // ── Defang Rules ─────────────────────────────────────────────────────────

    containerEl.createEl('h3', { text: 'Auto-Defang' });
    containerEl.createEl('p', {
      text: 'Automatically rewrites matching IOCs as you type. Modifies file content.',
      attr: { style: 'color: var(--text-muted); margin-top: 0;' },
    });

    containerEl.createEl('h3', { text: 'Scope' });
    containerEl.createEl('p', {
      text: 'Limit defanging to the region between two regex markers. Leave blank to apply to the whole note.',
      attr: { style: 'color: var(--text-muted); margin-top: 0;' },
    });

    new Setting(containerEl)
      .setName('Scope start')
      .setDesc('Defang begins after the first match of this regex')
      .addText((t) =>
        t
          .setPlaceholder('e.g.  ---IOC-START---')
          .setValue(this.plugin.settings.defang.scopeStart)
          .onChange(async (v) => { this.plugin.settings.defang.scopeStart = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Scope end')
      .setDesc('Defang stops before the first match of this regex after the start')
      .addText((t) =>
        t
          .setPlaceholder('e.g.  ---IOC-END---')
          .setValue(this.plugin.settings.defang.scopeEnd)
          .onChange(async (v) => { this.plugin.settings.defang.scopeEnd = v; await this.plugin.saveSettings(); })
      );

    containerEl.createEl('h3', { text: 'IOC Types' });

    const defangEntries: Array<[keyof Pick<PluginSettings['defang'], 'ips' | 'domains' | 'emails' | 'urls'>, string, string]> = [
      ['urls',    'URLs',         'https://evil.com  →  hxxps://evil.com'],
      ['ips',     'IP Addresses', '1.2.3.4  →  1[.]2[.]3[.]4'],
      ['domains', 'Domains',      'evil.sh  →  evil[.]sh'],
      ['emails',  'Emails',       'a@evil.com  →  a[@]evil[.]com'],
    ];

    for (const [key, name, example] of defangEntries) {
      const rule = this.plugin.settings.defang[key];
      new Setting(containerEl)
        .setName(name)
        .setDesc(example)
        .addText((t) =>
          t
            .setValue(rule.regex)
            .onChange(async (v) => { rule.regex = v; await this.plugin.saveSettings(); })
        )
        .addToggle((t) =>
          t.setValue(rule.enabled).onChange(async (v) => { rule.enabled = v; await this.plugin.saveSettings(); })
        );
    }
  }
}
