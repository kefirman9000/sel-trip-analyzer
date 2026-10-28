# SEL Trip Event Analyzer

A Windows drag-and-drop tool that reads SEL relay event files and AcSELerator
QuickSet `.rdb` settings databases, then writes an editable, copy-and-paste
summary of what caused each trip.

## Download

Grab `SEL_Trip_Analyzer.exe` from the [latest release](../../releases/latest).
No install is needed. Put it in a folder you own (Desktop, Documents) so the
built-in updater can replace it.

## Using it

- Drag files or whole folders onto the blue box, or click it to browse. You can
  also drop files onto the `.exe` icon.
- Event data: `.CEV .EVE .TXT .SUM .HIS .SER .HDR`. Settings: `.RDB`.
- Anything typed in **Custom comments / suggestions** is added to the top of
  the summary. Press F5 or **Generate** to refresh.
- The summary is editable. **Copy all** puts it on the clipboard; **Save as
  .txt** writes a file.
- **Check for updates** looks at this repo's latest release. If there's a newer
  version it shows the release notes and asks before downloading. On yes, it
  downloads the new `.exe`, verifies its SHA-256, swaps it in and restarts. The
  app also checks quietly at startup and only speaks up if an update exists.

The summary covers, per event: relay ID, date/time, decoded event type
(`AG T` = A-to-ground fault, tripped), fault location (as % of line when `LL`
is known), decoded targets, fault currents and voltage sag, probable cause,
element timeline from CEV digital data, breaker clearing time, and which terms
of the `TR` trip equation asserted.

CEV files give the best results. Load the `.rdb` alongside so `TR` and `LL`
are known (matched by RID; a single loaded RDB applies to all events).

The interpretation is automated, so confirm it against the oscillography.

## Releasing a new version

1. Bump `VERSION` in `sel_trip_analyzer.py` (e.g. `1.0.1`) and commit.
2. Tag and push: `git tag v1.0.1 && git push origin main v1.0.1`
3. GitHub Actions builds the `.exe` on Windows and attaches it to a new release.
   Installed copies will offer the update.

## Building locally

Install Python 3.9+ (tick "Add python.exe to PATH"), then double-click
`build_exe.bat`. The program lands in `dist\SEL_Trip_Analyzer.exe`.

To run from source: `pip install tkinterdnd2 olefile` then
`python sel_trip_analyzer.py`. When run from source, the updater replaces the
`.py` file with the release's version instead.

Command line: `python sel_trip_analyzer.py --cli <files or folders>` prints the
report to the console.
