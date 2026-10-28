"""Build the single-file Trip History page: dist/SEL_Trip_History.html

    python scripts/build_history.py [output.html]

Inlines web/core.js, analysis.js, docx.js and history.js into web/history.html,
plus the history samples (sample_history/, made by make_history_samples.py) and
the icon, so the result is one file with no outside dependencies.
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "SEL_Trip_History.html")
    with open(os.path.join(ROOT, "sel_trip_analyzer.py"), encoding="utf-8") as f:
        version = re.search(r'^VERSION = "([^"]+)"', f.read(), re.M).group(1)
    with open(os.path.join(ROOT, "web", "history.html"), encoding="utf-8") as f:
        page = f.read()
    with open(os.path.join(ROOT, "assets", "icon-128.png"), "rb") as f:
        icon = "data:image/png;base64," + base64.b64encode(f.read()).decode()

    samples = []
    folder = os.path.join(ROOT, "sample_history")
    if os.path.isdir(folder):
        for dirpath, dirs, names in os.walk(folder):
            dirs.sort()
            for name in sorted(names):
                if name.upper().startswith("README"):
                    continue
                full = os.path.join(dirpath, name)
                with open(full, "rb") as f:
                    samples.append({"name": name, "path": os.path.relpath(full, ROOT).replace(os.sep, "/"),
                                    "b64": base64.b64encode(f.read()).decode()})

    page = (page.replace("{{VERSION}}", version).replace("{{ICON}}", icon)
                .replace("{{SAMPLES_JSON}}", json.dumps(samples).replace("</", "<\\/")))
    for key, name in [("CORE_JS", "core.js"), ("ANALYSIS_JS", "analysis.js"), ("DOCX_JS", "docx.js"), ("HISTORY_JS", "history.js")]:
        with open(os.path.join(ROOT, "web", name), encoding="utf-8") as f:
            code = f.read()
        if "</script" in code.lower():
            raise SystemExit(f"{name} must not contain '</script'")
        marker = "/*{{%s}}*/" % key
        if marker not in page:
            raise SystemExit(f"placeholder {marker} missing in web/history.html")
        page = page.replace(marker, code)
    left = re.findall(r"\{\{[A-Z_]+\}\}", page)
    if left:
        raise SystemExit(f"unfilled placeholders: {left}")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print(f"wrote {out_path} ({len(page.encode()) // 1024} KB, {len(samples)} sample files, v{version})")


if __name__ == "__main__":
    main()
