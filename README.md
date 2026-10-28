<img src="assets/icon.png" width="72" align="left" alt="">

# SEL Trip Event Analyzer

Drop in SEL relay event files and get a plain-English summary of **what tripped
and why**, ready to paste into an outage report or export to Word. Open any
`.CEV` or COMTRADE record on the **Waveform analysis** page to see the
waveforms, phasors, harmonics and every relay element, and to check the
overcurrent elements against the relay's own settings.

| | |
|---|---|
| **[▶ Open it online](https://kefirman9000.github.io/sel-trip-analyzer/)** | Runs in your browser on any computer, nothing to install |
| **[⬇ Download SEL_Trip_Analyzer.html](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_Trip_Analyzer.html)** | The whole program in one file: double-click it to use it offline (Chrome, Edge, Firefox, Safari) |
| [Windows program (optional)](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_Trip_Analyzer.exe) | The same page in its own window, with Windows Save dialogs and automatic updates |

Latest version: see [Releases](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest) · [Report a problem or suggest something](https://github.com/kefirman9000/sel-trip-analyzer/issues/new)

![Trip summary](docs/screenshots/main.png)

## What's new in 2.0

- **Waveform analysis page.** Synchronized current, voltage and relay-element
  graphs with zoom, scroll and a cursor; phasor diagram; sequence components;
  harmonic spectrum; fault type from the waveforms (compared with what the relay
  reported); a check of each 50/51 element against the relay's settings and
  curve; and every relay element with a plain-English meaning.
- **Reference waveforms.** Step through nine built-in examples: normal load,
  each fault type, a high-impedance fault, transformer inrush, CT saturation and
  an evolving fault, each with "what to look for".
- **COMTRADE** records (`.CFG` + `.DAT`, or `.CFF`), 1991 to 2013, ASCII or binary.
- **Notes on the graph**, pinned to a point in time, included in exports.
- **Notes per event**, added to the summary, Word and spreadsheet exports.
- **Weather at the time of each event** (optional): thunderstorms, high wind,
  ice and heavy rain are added to the probable cause.
- **Two ends of a line** paired up, **incidents** (events close together)
  grouped, and **repeat trips** on the same relay flagged.
- **Real Word (.docx) export** in both versions, with a waveform picture for
  every event that has one.
- **One program.** Everything is now one web page you can use online or
  download. The optional Windows program shows that same page in its own window.

## Get started

1. **[Open it online](https://kefirman9000.github.io/sel-trip-analyzer/)**, or
   **download [SEL_Trip_Analyzer.html](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_Trip_Analyzer.html)**
   and double-click it. It works offline, on Windows, Mac or Linux, and your
   files are read on your computer and never uploaded.
2. **Drag your event files** (or a whole folder) onto the page. The summary
   appears straight away.

Want to see it work first? Click **Try samples**, or download the
[sample files](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_sample_files.zip).

### Optional: the Windows program

`SEL_Trip_Analyzer.exe` is the same page in its own window. It adds Windows
**Save As** dialogs, opening files dropped on its icon, and **automatic
updates**. Put it in a folder you own (Desktop or Documents, not Program
Files). The first time, Windows may say *"Windows protected your PC"*: click
**More info → Run anyway** (the program isn't code-signed). It uses Microsoft
Edge, which comes with Windows, to draw its window.

## Which files to use

| File | What it is | How much it helps |
|---|---|---|
| `.CEV` | Compressed event report | **Best.** Element timeline, currents, voltages, waveforms, and usually the settings |
| `.CFG` + `.DAT` (or `.CFF`) | COMTRADE record | Waveforms and elements for the Waveform analysis page |
| `.RDB` | QuickSet settings database | Adds the trip equation (TR), line length (LL), CT ratio and 50/51 settings |
| `.EVE` `.TXT` | Text event report or saved terminal capture | Good: event type, targets, location |
| `.SUM` `.HDR` | Event summary / COMTRADE header | Good: same as above |
| `.HIS` | Event history list | Basic: one line per event |
| `.SER` | Sequential events recorder | Shows element on/off times |

**For the most reliable result, load the event's `.CEV` together with the
relay's `.RDB`.** Settings are matched to events by relay ID (RID), so you can
load files from several relays at once.

To get a CEV file, download the event from the relay with AcSELerator QuickSet
and choose the compressed (CEV) format, or save the output of the `CEV` command
from a terminal session.

## The trip summary

The summary starts with a **Quick summary** (one line per event, oldest first)
and an **Overview**, then the **Event details**:

- **Event type, targets, location, currents, voltages**, as recorded by the relay.
- **Probable cause**: which element tripped and why. With a CEV and settings,
  this comes from the trip equation and the element timeline. Otherwise it's
  read from the front-panel targets.
- **Confidence**: **High** (element data and settings, nothing looked wrong),
  **Medium** (some data missing, or one item to check), **Low** (history row
  only, or several items to check).
- **`CHECK:` lines** say exactly what to confirm. They're shown in amber, and
  the quick summary shows `[n to check]` for each event.

It also connects events to each other:

- **Two-ended events**: the same fault seen by the relays at both ends of a
  line (within a second, same phases). When the two fault locations add up to
  the line length it says so.
- **Incidents**: events within a few minutes of each other, such as a storm
  hitting several feeders, or a reclose sequence.
- **Repeat trips**: three or more trips on the same relay within 30 days.

| You'll see a CHECK like... | What to do |
|---|---|
| *No settings for this relay* | Add the relay's `.RDB` so the trip equation and line length can be checked |
| *No relay element data / History row only* | Load the `.CEV` for that event |
| *Targets show phase B but the event type says A* | The record disagrees with itself. Open it on the Waveform analysis page |
| *Highest fault current is on phase …* | Fault type may be misclassified. Check the waveforms |
| *Location beyond the end of the line* / *Negative location* | Fault was likely past the remote bus or behind the relay. Check directionality and adjacent sections |
| *Breaker took … cycles to open* | Check the breaker and trip circuit |
| *Tripped without identifying a fault type* | Confirm transfer trip, manual/SCADA open, or external trip input |
| *Settings assumed / none match relay* | Make sure the right `.RDB` is loaded |

### Organizing the summary

| Control | Choices |
|---|---|
| **Show** | All events · Trips only · Needs review · Faults only · No-trip events |
| **Relay** | All relays, or one relay |
| **Sort** | Oldest first · Newest first · By relay · Needs review first |
| **Detail** | **Summary only** · **Standard** (adds details and CHECKs) · **Full** (adds element timeline, settings and SER) |
| **Hide duplicates** | Skips history rows that repeat an event you also loaded as a detailed report |
| **Search** | Only events whose details or notes contain the text (`Ctrl+F`) |

The summary box is **fully editable**: whatever you change is what gets copied
or exported. **Export** gives Word (`.docx`, with a waveform picture for each
event that has one), PDF (through the print window), a spreadsheet for Excel
(`.csv`, one row per event) or plain text. Each export first shows a short list
of **what to include**: sections (overview, quick summary, two-ended and
incidents, event details, SER, settings), what goes in each event (CHECK lines,
notes, weather, element sequence), waveform pictures (none, compact or large,
with or without your graph notes), paper size (Letter or A4), or, for the
spreadsheet, which columns. Your choices are remembered. Files are named after
what's in them, for example *FEEDER 12 trip summary 2026-10-11 to 2026-10-27 (5
events).docx* or *FEEDER 3 2026-10-21 14-22-05 CG waveform analysis.docx*, and you
can change the name before saving.

### Event notes

Open **Event notes & waveforms** under the summary to add a note to any event
(for example *"Crew found a burned crossarm at pole 112"*). Notes are saved on
your computer, appear in the event's details, and are searchable. The
**Waveforms ›** button opens that event on the Waveform analysis page.

### Weather at the time of the event

Open **Station locations & weather** and type where each relay is (a town such
as *Ocala, FL*, or *latitude, longitude*). To set several at once, tick them (or
**Select all**), type one location and click **Apply to ticked** (or **Apply to
all**). Then click **Look up weather**. Each event
gets a *Weather* line (conditions, temperature, wind and gusts, rain or snow
for that hour), and when the weather could explain the trip it's added to the
probable cause:

| Weather | Added to the cause |
|---|---|
| Thunderstorm | Lightning is a likely cause; check arresters and look for flashed insulators |
| Gusts of 30 to 40+ mph | Wind: conductor slap, galloping, or trees and limbs contacting the line |
| Freezing rain or snow below freezing | Ice or snow loading, sagging conductors, limbs breaking |
| Heavy rain | Flashover across dirty or cracked insulators, wet trees |
| Very hot | High load and conductor sag |

**Add weather to event notes** copies it into each event's notes. The weather
comes from [Open-Meteo](https://open-meteo.com/), a free service; only the
station location and the event date are sent. It reports conditions in the
area, not individual lightning strikes.

## Waveform analysis

Click the **Waveform analysis** tab (`Ctrl+G`). Pick a record from your files,
or one of the **reference waveforms**, and step through them with ◀ ▶
(`Page Up` / `Page Down`).

![Waveform analysis](docs/screenshots/wave.png)

- **Fault type** found from the currents and voltages, with the evidence
  (which currents rose, ground current, which voltages sagged), and whether it
  agrees with what the relay reported. Warnings for DC offset, CT saturation,
  inrush, evolving and high-impedance faults.
- **Graphs** of currents, voltages and relay elements on one time line.
  Click to set the cursor, drag to zoom in, `Shift`+drag to pan, `Ctrl`+wheel
  to zoom, double-click to go back to the fault. Click a channel to hide it.
  **Show** switches between the raw samples, the fundamental only (filters out
  DC offset and harmonics) and an RMS trend.
- **Phasors** and **sequence components** at the cursor, with what each one
  means (negative sequence = unbalance, zero sequence = ground involved).
- **Harmonics**: 2nd (inrush), 3rd (arcing, saturation), 5th, THD and DC offset.
- **Overcurrent elements vs. the relay's settings**: each 50 element's pickup
  against the measured current, and each 51 element's expected curve time
  (from its curve and time dial) against when it actually timed out.
- **Relay elements**: every element in the record with a plain-English
  meaning and its on/off times. Search, filter by group, and tick to add it to
  the graph.
- **Notes on the graph**: **✎ Add note**, then click where it goes. Notes are
  drawn on the graph and included in the picture and Word exports.
- **Simple / Advanced**: Advanced adds angles, secondary amps, multiples of
  pickup, all harmonics, every element and a samples export.
- **Export**: Word report (choose which parts: fault type, graph, notes,
  phasors, sequence, harmonics, overcurrent check, elements), picture of the
  graph (on-screen range, the fault or the whole record; three sizes), or the
  samples as a spreadsheet (whole record or the range on screen).

![Reference waveforms](docs/screenshots/reference.png)

## Web page or Windows program?

They are the same program and give the same results. The differences:

| | Web page (`.html` or online) | Windows program (`.exe`) |
|---|---|---|
| Runs on | Any computer with a browser | Windows |
| Saving exports | To your Downloads folder | Asks where, with a Save As dialog |
| Opening files | Drag onto the page, or Add files | Also drag onto the program's icon |
| Updates | The online copy is always current; a downloaded copy shows a banner with a link to the new file | Installs the update itself when you say yes |

## Updates

The online version is always the latest. A downloaded `.html` checks GitHub
when it opens and shows a banner when there's a newer file to download. The
Windows program checks for a new version when it starts. When one is
available, a banner appears and **Check for updates** turns into **Update to
vX.Y.Z**. Click **Install and restart**: it downloads the new version, checks
it hasn't been tampered with, and reopens. Your notes and settings are kept.

## Help and shortcuts

Press **F1** (or click **Help**) for the built-in guide.

`Ctrl+O` add files · `F5` generate · `Ctrl+F` search · `Ctrl+Shift+C` copy ·
`Ctrl+S` Word · `Ctrl+P` PDF · `Ctrl+G` waveform page · `Ctrl+D` dark mode

On the graph: `←` `→` move the cursor (`Shift` = one cycle) · `+` `−` zoom ·
`F` back to the fault · `0` whole record · `N` add a note

## Troubleshooting

**The program opens in a browser tab instead of its own window.**
It uses Microsoft Edge to draw its window. If Edge isn't installed it falls
back to your default browser; everything still works.

**"No event data recognized."**
The file isn't in a format the program knows, or it's empty. Try the `.CEV`
version of the event. If a real SEL file isn't recognized, please send feedback
so support can be added.

**A COMTRADE record doesn't appear on the Waveform analysis page.**
Load both the `.CFG` and the `.DAT` (same name), or the single `.CFF` file.

**The overcurrent check says "No settings".**
Load the relay's `.RDB`. Settings are matched by relay ID; for COMTRADE the
relay ID is the device name in the `.CFG`. You can also pick the settings in
the list above the table.

**Weather says it couldn't be looked up.**
It needs an internet connection. Events dated in the future (a relay clock set
wrong) have no weather.

**The update fails with a permission error.**
The program is in a protected folder such as Program Files. Move
`SEL_Trip_Analyzer.exe` to your Desktop or Documents and try again.

**My antivirus removed or quarantined the program.**
Single-file Python programs are sometimes flagged by mistake. Restore it, or
ask IT to allow it. You can check the file came from this page's Releases.

## Privacy

Your files are only read on your own computer; nothing is uploaded. The program
contacts the internet only to check GitHub for updates, to look up weather when
you ask it to (location and date only), and when you choose to send feedback.
Feedback is posted as a public GitHub issue, so only attach the summary if it
can be shared.

## Limitations

The analysis is automated and is meant to speed up your review, not replace it.
Always confirm against the relay's own event report and settings. SEL file
formats vary between relay models and firmware, and the `.RDB` reader is
best-effort. The waveform classification uses the fundamental currents and
voltages and can be fooled by unusual systems (for example ungrounded or
resonant-grounded). If something looks wrong for your relays, use **Send
feedback**.

---

Developers: see [DEVELOPING.md](DEVELOPING.md) for building, testing and releasing.
