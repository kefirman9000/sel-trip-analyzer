# Real relay file test cases

The sample files are made up. These cases are **real** relay files, scrubbed,
with the answer the summary must give. They are how we know the program is
right on real relays, and that it stays right.

Each folder is one case. The tests run every case automatically:

```
node --test "tests/*.test.js"
```

## Adding a case (2 minutes)

```
node scripts/add_fixture.js feeder-slg-zone1 path/to/event.cev path/to/settings.rdb
```

The script:

1. finds every relay ID, terminal ID, station ID and COMTRADE station/device name in the files;
2. replaces them in every file with neutral names of the **same length**
   (`RELAY 1`, `STATION A`...), so fixed-width reports keep their columns and
   binary `.RDB` files stay valid;
3. renames the files (`feeder-slg-zone1-1.cev`...), since file names often
   carry station names;
4. refuses to write anything if an original name is still in any file;
5. writes `expected.json` with what the program says today.

Other things to hide (a line name in a comment, a person's name):
`--replace "Smith Road=Road A"` (the new text is padded or cut to the same length).

Then:

- **Fill in `cause_contains`** for each event with what actually caused the
  trip, from the field report or the engineer who reviewed it. This is what
  makes the case a real check rather than a snapshot of today's answer.
- **Open the scrubbed files and read them once.** This repo is public.
- Run the tests. If one fails, the program got that relay wrong: that's the
  bug to fix.

## expected.json

Every key is optional:

```json
{
  "event_count": 1,
  "report_contains": ["QUICK SUMMARY"],
  "events": [
    {
      "file": "feeder-slg-zone1-1.cev",
      "event_type": "AG T",
      "location": "4.21",
      "targets": "INST ZONE1 A G",
      "relay_id": "RELAY 1",
      "cause_contains": ["Phase A-to-ground fault", "Z1G"]
    }
  ]
}
```

Keys starting with `_` and `program_says_today` are notes for people and are ignored.
