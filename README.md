# CyberScribe

An [Obsidian](https://obsidian.md) plugin for threat intelligence and security analysts that highlights text by regex, automatically defangs IOCs as you type, and tracks investigation time with a built-in countdown timer.

## Features

### Investigation Timer

A two-phase countdown timer designed for incident response workflows.

**Auto-start:** The timer starts automatically when you paste content into an empty note — no manual trigger needed.

| Phase | Icon | Duration | Trigger |
|---|---|---|---|
| Investigation | 🔍 | 45 minutes | Auto on paste into empty note |
| Taking Action | ✏️ | 20 minutes | Click the status bar item |

- **Click** the status bar item while investigating → switches to Taking Action (fresh 20-min countdown)
- **Click again** → stops and resets
- A notice fires when either timer expires
- Can be limited to a specific vault folder (e.g. `Investigations`)
- Can be fully disabled vault-wide from Settings or the timer panel

**Timer Panel:** Open the dedicated sidebar panel via the clock icon in the ribbon or the command `Open investigation timer panel`. The panel shows the current phase, a large countdown display, and action buttons. The disable toggle is available directly in the panel.

---

### Color Rules
- Define up to **12 regex → color** rules to highlight matching text inline
- Works in both **Live Preview** and **Reading view**
- Pick from 12 flat colors: Red, Orange, Yellow, Green, Teal, Blue, Purple, Pink, Crimson, Lime, Cyan, Indigo
- Each rule can be toggled on/off independently

**Example:** Add a rule with regex `---OODA---` and color Yellow to highlight OODA loop markers.

### Auto-Defang
Automatically rewrites IOCs to defanged format as you type — modifying the file in place.

| IOC Type | Input | Output |
|---|---|---|
| URL | `https://evil.com` | `hxxps://evil.com` |
| IP Address | `1.2.3.4` | `1[.]2[.]3[.]4` |
| Domain | `evil.sh` | `evil[.]sh` |
| Email | `user@evil.com` | `user[@]evil[.]com` |

- Default regexes provided for IPs, domains, emails, and URLs — fully customizable
- Domain regex covers 60+ TLDs including `.sh`, `.io`, `.app`, `.dev`, and country codes
- Each IOC type can be toggled independently

### Defang Scope
Limit defanging to a specific region of your note using start/end regex markers.

```
Normal text: 1.2.3.4  ← NOT defanged

---IOC-START---
1.2.3.4        ← defanged → 1[.]2[.]3[.]4
evil.sh        ← defanged → evil[.]sh
---IOC-END---

1.2.3.4  ← NOT defanged
```

Leave both fields blank to apply defanging to the entire note.

### Date Tokens
Insert the current UTC date or datetime with a token or command.

| Token | Output |
|---|---|
| `<$ date-now $>` | `2025-01-15` |
| `<$ datetime-now $>` | `2025-01-15 14:32:00 UTC` |

Tokens are replaced automatically as you type, or use the commands **Insert current date** / **Insert current datetime**.

### Paste as Plain Text
Strips all rich-text formatting when pasting. Useful when copying from browsers, PDFs, or other tools. Toggle on/off in settings.

---

## Installation

### From Community Plugins
1. Open Obsidian Settings → Community plugins
2. Disable Restricted mode
3. Browse community plugins, search for **CyberScribe**
4. Install and enable

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Copy all three files to `<vault>/.obsidian/plugins/cyberscribe/`
3. Reload Obsidian and enable the plugin under Community plugins

## Configuration

Open **Settings → CyberScribe** to configure:

| Setting | Description |
|---|---|
| Paste as plain text | Strip formatting on paste |
| Date tokens | Enable/disable auto-replace of date tokens |
| Investigation timer | Enable/disable the countdown timer |
| Investigation timer folder | Limit auto-start to notes inside a specific folder (blank = vault-wide) |
| Color rules | Add/remove regex → color pairs (up to 12) |
| Auto-defang → Scope | Optional start/end regex to limit defang region |
| Auto-defang → IOC types | Per-type regex and enable/disable toggle |

## Use Case

Ideal for OSINT analysts, threat hunters, and incident responders working in Obsidian who need to:
- Visually tag structured intelligence (OODA loops, MITRE ATT&CK phases, severity levels)
- Safely paste and store IOCs in defanged form to prevent accidental clicks or execution
- Track investigation and response time during active incidents
