# Notes for Claude

- **Release every update.** The owner wants each change published as a GitHub release, not just pushed to `main`:
  bump `VERSION` in `sel_trip_analyzer.py` (minor for features, patch for fixes), write `docs/releases/vX.Y.Z.md`,
  push to `main`, then start the release workflow with Publish on:
  `gh api -X POST repos/kefirman9000/sel-trip-analyzer/actions/workflows/release.yml/dispatches -f ref=main -F 'inputs[publish]=true'`
  (Claude sessions can't create releases or push tags directly; the workflow creates both.) Check the release appears with its files.
- Before pushing: `node --test "tests/*.test.js"`, `python -m unittest discover -s tests`, and the browser test
  (`python scripts/build_html.py && node tests/browser_test.js`). See DEVELOPING.md.
