# CyberScribe

An [Obsidian](https://obsidian.md) plugin for threat intelligence and security analysts that highlights text by regex and automatically defangs IOCs (Indicators of Compromise) as you type.

## Features

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
| IP Address | `1.2.3.4` | `1[.]2[.]3[.]4` |
| Domain | `evil.sh` | `evil[.]sh` |
| Email | `user@evil.com` | `user[@]evil[.]com` |

- Default regexes provided for IPs, domains, and emails — fully customizable
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

## Installation

### From Community Plugins
1. Open Obsidian Settings → Community plugins
2. Disable Restricted mode
3. Browse community plugins, search for **CyberScribe**
4. Install and enable

### Manual
1. Download `main.js` and `manifest.json` from the [latest release](../../releases/latest)
2. Copy both files to `<vault>/.obsidian/plugins/ioc-highlighter/`
3. Reload Obsidian and enable the plugin under Community plugins

## Configuration

Open **Settings → CyberScribe** to configure:

- **Color Rules** — Add/remove regex → color pairs (up to 12)
- **Auto-Defang → Scope** — Optional start/end regex to limit defang region
- **Auto-Defang → IOC Types** — Per-type regex and enable/disable toggle

## Use Case

Ideal for OSINT analysts, threat hunters, and incident responders working in Obsidian who need to:
- Visually tag structured intelligence (OODA loops, MITRE ATT&CK phases, severity levels)
- Safely paste and store IOCs in defanged form to prevent accidental clicks or execution
