# Real relay file test cases

Each folder here is one case: scrubbed relay files plus an `expected.json`
describing what the summary must say. The test suite runs every case
automatically (`python -m unittest discover -s tests -v`).

**This repo is public.** Before committing, replace relay IDs, terminal and
substation names, and anything else identifying in the files.

```
tests/fixtures/
  feeder-slg-zone1/
    event.cev
    settings.rdb          (optional)
    expected.json
```

`expected.json` (every key is optional):

```json
{
  "event_count": 1,
  "report_contains": ["QUICK SUMMARY"],
  "events": [
    {
      "file": "event.cev",
      "event_type": "AG T",
      "location": "4.21",
      "targets": "INST ZONE1 A G",
      "relay_id": "RELAY 1",
      "cause_contains": ["Phase A-to-ground fault", "Z1G"]
    }
  ]
}
```

`cause_contains` is the important one: write down what actually caused the
trip (from the field report), and the test fails if the summary stops saying it.
