<img src="assets/icon.png" width="72" align="left" alt="">

# SEL Trip Event Analyzer

Drop in SEL relay event files and get a plain-English summary of **what tripped
and why**, ready to paste into an outage report or export to Word or PDF.

| | |
|---|---|
| **[⬇ Windows program](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_Trip_Analyzer.exe)** | `SEL_Trip_Analyzer.exe`: download and double-click, no install |
| **[▶ Browser version](https://kefirman9000.github.io/sel-trip-analyzer/)** | Opens in your browser on any computer, nothing to install. [Download it](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_Trip_Analyzer.html) to use offline |
| **[⬇ Sample files](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_sample_files.zip)** | Made-up SEL events in every supported format, to try it out |

Latest version: see [Releases](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest) · [Report a problem or suggest something](https://github.com/kefirman9000/sel-trip-analyzer/issues/new)

![Trip summary](docs/screenshots/main.png)

## What it does

- Reads SEL event reports (`.CEV`, `.EVE`, `.TXT`, `.SUM`, `.HIS`, `.SER`, COMTRADE `.HDR`)
  and QuickSet settings files (`.RDB`), as many as you like at once.
- Works out the fault type, faulted phases, fault location, the element that
  tripped, how fast the breaker opened, and the likely cause.
- **Flags anything it isn't sure about** with a `CHECK:` line and rates each
  event's confidence High, Medium or Low, so you know what to verify.
- Lets you **filter, sort and search** the results (trips only, needs review,
  one relay, newest first…) and choose how much detail to show.
- Gives you an editable summary you can copy, or export as a formatted Word or
  PDF report, or as a spreadsheet for Excel.
- Runs entirely on your computer. No install, no account, nothing uploaded.
  Use the Windows program or the [browser version](#browser-version).

## Get started

1. **Download** `SEL_Trip_Analyzer.exe` and put it in a folder you own, such as
   Desktop or Documents. Avoid Program Files, because the program updates
   itself in place.
2. **Open it.** The first time, Windows may say *"Windows protected your PC"*.
   Click **More info → Run anyway**. This appears because the program isn't
   code-signed.
3. **Drag your event files** (or a whole folder) onto the drop zone. The summary
   appears straight away.

Want to see it work first? Click **Try samples** in the program, or download the
[sample files](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_sample_files.zip).

## Browser version

Can't run `.exe` files, or not on Windows? Use **`SEL_Trip_Analyzer.html`**, a
single file that does the same analysis inside your web browser.

1. [Open it online](https://kefirman9000.github.io/sel-trip-analyzer/), or [download SEL_Trip_Analyzer.html](https://github.com/kefirman9000/sel-trip-analyzer/releases/latest/download/SEL_Trip_Analyzer.html)
   to keep a copy that works offline.
2. Double-click it. It opens in Chrome, Edge, Firefox or Safari, on Windows, Mac
   or Linux. It also works offline.
3. Drag your event files or a folder onto the page, exactly like the Windows program.

Your files are read inside the browser tab and **never uploaded**. The summary,
the CHECK flags and the confidence ratings are identical to the Windows program
(automated tests compare the two on every change).

A few things differ from the Windows program:

| | Windows program | Browser version |
|---|---|---|
| Word export | `.docx` | `.doc` (opens in Word) |
| PDF export | Saves a PDF file | Opens the print window: choose **Save as PDF** |
| Updates | Installs itself after you say yes | Shows a banner with a download link; save the new file over the old one (the online copy is always current) |
| Feedback log | Also saved on your PC | Opened on GitHub only |

## Which files to use

| File | What it is | How much it helps |
|---|---|---|
| `.CEV` | Compressed event report | **Best.** Element timeline, currents, voltages, and usually the settings |
| `.RDB` | QuickSet settings database | Adds the trip equation (TR) and line length (LL) |
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

## Reading the summary

The summary starts with a **Quick summary** (one line per event, oldest first),
then the **Event details**:

- **Event type, targets, location, currents, voltages**, as recorded by the relay.
- **Probable cause**: which element tripped and why. With a CEV and settings,
  this comes from the trip equation and the element timeline. Otherwise it's
  read from the front-panel targets.
- **Confidence**:
  - **High**: element data and settings, and nothing looked wrong.
  - **Medium**: some data is missing, or one item needs checking.
  - **Low**: only a history row, or several items need checking.
- **`CHECK:` lines** say exactly what to confirm. They're shown in amber, and
  the quick summary shows `[n to check]` for each event.

| You'll see a CHECK like... | What to do |
|---|---|
| *No settings for this relay* | Add the relay's `.RDB` so the trip equation and line length can be checked |
| *No relay element data / History row only* | Load the `.CEV` for that event |
| *Targets show phase B but the event type says A* | The record disagrees with itself. Look at the oscillography |
| *Highest fault current is on phase …* | Fault type may be misclassified. Check the waveforms |
| *Location beyond the end of the line* / *Negative location* | Fault was likely past the remote bus or behind the relay. Check directionality and adjacent sections |
| *Zone 1 operated … beyond typical reach* | Possible overreach or a location error |
| *Breaker took … cycles to open* | Check the breaker and trip circuit |
| *Tripped without identifying a fault type* | Confirm transfer trip, manual/SCADA open, or external trip input |
| *Settings assumed / none match relay* | Make sure the right `.RDB` is loaded |

### Event types

| Code | Meaning |
|---|---|
| `AG` `BG` `CG` | Single phase-to-ground fault |
| `AB` `BC` `CA` | Phase-to-phase fault |
| `ABG` `BCG` `CAG` | Two phases to ground |
| `ABC` | Three-phase fault |
| `TRIP` | Tripped, but no fault type found (transfer trip, manual/SCADA, external input) |
| `ER` | Event recorded by the ER trigger; no trip |
| `TRIG` | Manually triggered event |
| `… T` | A trailing **T** (for example `AG T`) means the relay tripped |

### Common targets

`INST` instantaneous · `TIME` time-delayed · `COMM` communications-assisted ·
`ZONE1/2/3` distance zones · `50` instantaneous overcurrent · `51` time-overcurrent ·
`81` frequency · `SOTF` switch-onto-fault · `A B C G N` faulted phases / ground ·
`RS` recloser reset (ready) · `CY` recloser cycling · `LO` recloser locked out

**Fault location** is in the relay's line-length units (miles or km, as set by
LL). With settings loaded it's also shown as a percentage of the line. `$$$$$`
means the relay couldn't calculate it.

## Organizing the summary

The row of controls above the summary changes what it shows and in what order.
The summary always says which view it is showing (for example *Showing: 7 of
11 events (needs review; newest first)*).

| Control | Choices |
|---|---|
| **Show** | All events · Trips only · Needs review · Faults only · No-trip events. Each shows how many events it includes |
| **Relay** | All relays, or one relay (with its event count) |
| **Sort** | Oldest first · Newest first · By relay · Needs review first |
| **Detail** | **Summary only**: overview + one line per event · **Standard**: adds each event's details and CHECKs · **Full**: adds the element timeline, settings and SER |
| **Hide duplicates** | Skips history rows that repeat an event you also loaded as a detailed report (on by default) |
| **Search** | Only events whose details contain the text, e.g. a relay, `zone 2`, `81` or `breaker` (`Ctrl+F`) |

When two or more events are shown, the summary starts with an **Overview**:
counts of trips, fault types, events per relay and confidence levels.

For heavy sorting and filtering, use **Export → Spreadsheet for Excel (.csv)**.
It gives one row per event (date, relay, event type, cause, tripping elements,
location and % of line, currents, breaker clearing time, confidence and every
CHECK), using the same filter and order as the summary.

Changing the view rebuilds the summary. If you've edited the text, the program
asks first, so copy or export your edits before switching views.

## Comments, export and feedback

- **Comments & suggestions** box: anything you type is added to the top of the
  summary.
- The summary box is **fully editable**. Whatever you change is what gets
  copied or exported.
- **Export** → Word (`.docx`), PDF, spreadsheet (`.csv`), or plain text. Word
  and PDF open automatically once saved. Shortcuts: `Ctrl+S` Word, `Ctrl+P` PDF.
- **Feedback on this output**: tell us what was wrong or missing. **Send
  feedback** opens a pre-filled issue on this page (you'll need a free GitHub
  account to submit it), and a copy is always saved on your PC.
  *Issues are public*, so only tick **Attach summary** if the content can be
  shared.

## Updates

The program checks for a new version when it starts. When one is available, the
**Check for updates** button turns blue and reads **Update to vX.Y.Z**. Click
it, read what's new, and choose **Yes**. It downloads the new version, checks
it hasn't been tampered with, and restarts.

## Help and shortcuts

Press **F1** (or click **Help**) for the built-in guide.

`Ctrl+O` add files · `F5` generate · `Ctrl+F` search · `Ctrl+Shift+C` copy ·
`Ctrl+S` Word · `Ctrl+P` PDF · `Ctrl+D` dark mode · `Delete` remove the selected files

## Troubleshooting

**Dragging files onto the window does nothing.**
Windows blocks drag-and-drop into programs running *as administrator*. Open the
program normally (not "Run as administrator"), or use **Add files**.

**"No event data recognized."**
The file isn't in a format the program knows, or it's empty. Try the `.CEV`
version of the event. If a real SEL file isn't recognized, please send feedback
so support can be added.

**The update fails with a permission error.**
The program is in a protected folder such as Program Files. Move
`SEL_Trip_Analyzer.exe` to your Desktop or Documents and try again.

**Export fails.**
The file is probably open in Word or a PDF viewer. Close it and export again.

**My antivirus removed or quarantined the program.**
Single-file Python programs are sometimes flagged by mistake. Restore it, or
ask IT to allow it. You can check the file came from this page's Releases.

## Privacy

Your files are only read on your own PC; nothing is uploaded. The program
contacts the internet only to check GitHub for updates, and when you choose to
send feedback.

## Limitations

The analysis is automated and is meant to speed up your review, not replace it.
Always confirm against the oscillography and settings. SEL file formats vary
between relay models and firmware, and the `.RDB` reader is best-effort. If
something looks wrong for your relays, use **Send feedback**.

---

Developers: see [DEVELOPING.md](DEVELOPING.md) for building, testing and releasing.
