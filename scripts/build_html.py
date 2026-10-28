"""Build the single-file browser version: dist/SEL_Trip_Analyzer.html

    python scripts/build_html.py [output.html]

Inlines web/core.js (the analysis), the app page (web/app.html), the sample
files and the icon, so the result is one file with no outside dependencies.
Version and GitHub repo come from sel_trip_analyzer.py.
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "SEL_Trip_Analyzer.html")
    with open(os.path.join(ROOT, "sel_trip_analyzer.py"), encoding="utf-8") as f:
        py = f.read()
    version = re.search(r'^VERSION = "([^"]+)"', py, re.M).group(1)
    repo = re.search(r'^GITHUB_REPO = "([^"]+)"', py, re.M).group(1)

    with open(os.path.join(ROOT, "web", "app.html"), encoding="utf-8") as f:
        page = f.read()
    with open(os.path.join(ROOT, "web", "core.js"), encoding="utf-8") as f:
        core = f.read()
    with open(os.path.join(ROOT, "assets", "icon-128.png"), "rb") as f:
        icon = "data:image/png;base64," + base64.b64encode(f.read()).decode()

    folder = os.path.join(ROOT, "sample_files")
    samples = []
    for name in sorted(os.listdir(folder)):
        if name.upper().startswith("README"):
            continue
        with open(os.path.join(folder, name), "rb") as f:
            samples.append({"name": name, "b64": base64.b64encode(f.read()).decode()})

    page = (page.replace("{{VERSION}}", version).replace("{{REPO}}", repo).replace("{{ICON}}", icon)
                .replace("{{SAMPLES_JSON}}", json.dumps(samples).replace("</", "<\\/")))
    scripts = {"CORE_JS": core}
    for key, name in [("ANALYSIS_JS", "analysis.js"), ("REFERENCE_JS", "reference.js"), ("DOCX_JS", "docx.js"),
                      ("WAVE_JS", "wave_ui.js"), ("WEATHER_JS", "weather.js")]:
        path = os.path.join(ROOT, "web", name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                scripts[key] = f.read()
    for key, code in scripts.items():
        if "</script" in code.lower():
            raise SystemExit(f"{key} must not contain '</script'")
        marker = "/*{{%s}}*/" % key
        if marker not in page:
            raise SystemExit(f"placeholder {marker} missing in web/app.html")
        page = page.replace(marker, code)
    left = re.findall(r"\{\{[A-Z_]+\}\}", page)
    if left:
        raise SystemExit(f"unfilled placeholders: {left}")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print(f"wrote {out_path} ({len(page.encode()) // 1024} KB, v{version})")


if __name__ == "__main__":
    main()
