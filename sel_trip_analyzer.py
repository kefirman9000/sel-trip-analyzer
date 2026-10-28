#!/usr/bin/env python3
"""
SEL Trip Event Analyzer - Windows desktop app
----------------------------------------------
The program itself is the same single page as the browser version
(web/app.html + web/*.js, built into SEL_Trip_Analyzer.html). This file is a
small launcher around it, using only the Python standard library:

  * serves the page from 127.0.0.1 and opens it in a Microsoft Edge (or Chrome)
    "app" window with its own profile, so it looks and behaves like a program;
    falls back to the default browser if neither is installed
  * files dropped on the .exe (or passed on the command line) open in the app;
    a second launch hands its files to the window that's already open
  * Save dialogs are real Windows "Save As" dialogs
  * "Check for updates" downloads the new .exe from GitHub Releases and
    restarts into it

    SEL_Trip_Analyzer.exe [files or folders ...]
    python sel_trip_analyzer.py [files or folders ...]
    python sel_trip_analyzer.py --selftest        (used by the release build)
    python sel_trip_analyzer.py --browser         (use the default browser)
"""

import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "SEL Trip Event Analyzer"
VERSION = "2.0.0"
# GitHub "owner/repo" that publishes releases. Each release attaches
# SEL_Trip_Analyzer.exe and SEL_Trip_Analyzer.html (the release workflow does that).
GITHUB_REPO = "kefirman9000/sel-trip-analyzer"
EXE_ASSET_NAME = "SEL_Trip_Analyzer.exe"
HTML_ASSET_NAME = "SEL_Trip_Analyzer.html"
PORT = 47615                       # fixed, so the page keeps its saved notes and settings between runs
FILE_EXTS = {".cev", ".eve", ".txt", ".sum", ".his", ".ser", ".hdr", ".log", ".chi", ".rdb", ".cfg", ".dat", ".cff"}
MAX_FILE = 64 * 1024 * 1024
WIN = sys.platform == "win32"


# --------------------------------------------------------------------------
# Paths and settings
# --------------------------------------------------------------------------
def data_dir():
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    d = os.path.join(base, "SEL Trip Analyzer")
    os.makedirs(d, exist_ok=True)
    return d


def load_prefs():
    try:
        with open(os.path.join(data_dir(), "launcher.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_prefs(p):
    try:
        with open(os.path.join(data_dir(), "launcher.json"), "w", encoding="utf-8") as f:
            json.dump(p, f, indent=1)
    except OSError:
        pass


def here():
    return os.path.dirname(os.path.abspath(__file__))


def find_page():
    """The built page: bundled in the .exe, next to this file, in dist/, built from web/, or downloaded."""
    candidates = []
    if getattr(sys, "frozen", False):
        candidates.append(os.path.join(getattr(sys, "_MEIPASS", here()), "app", HTML_ASSET_NAME))
    candidates += [os.path.join(here(), HTML_ASSET_NAME), os.path.join(here(), "dist", HTML_ASSET_NAME)]
    web = os.path.join(here(), "web", "app.html")
    if os.path.exists(web):  # running from a source checkout: always build fresh
        out = os.path.join(data_dir(), "dev_" + HTML_ASSET_NAME)
        r = subprocess.run([sys.executable, os.path.join(here(), "scripts", "build_html.py"), out], capture_output=True, text=True)
        if r.returncode == 0:
            return out
        print(r.stderr, file=sys.stderr)
    for c in candidates:
        if os.path.exists(c):
            return c
    cached = os.path.join(data_dir(), HTML_ASSET_NAME)
    try:  # a source-only install: fetch the page that matches this version
        download_file(f"https://github.com/{GITHUB_REPO}/releases/download/v{VERSION}/{HTML_ASSET_NAME}", cached)
    except Exception as e:  # noqa: BLE001
        if not os.path.exists(cached):
            raise SystemExit(f"Couldn't find or download {HTML_ASSET_NAME}: {e}")
    return cached


# --------------------------------------------------------------------------
# Self-updater (GitHub Releases)
# --------------------------------------------------------------------------
def version_tuple(v):
    nums = re.findall(r"\d+", str(v))
    return tuple(int(n) for n in nums[:4]) or (0,)


def _http_get(url, accept="application/vnd.github+json", timeout=20):
    import urllib.request
    req = urllib.request.Request(url, headers={
        "Accept": accept, "User-Agent": f"SEL-Trip-Analyzer/{VERSION}"})
    return urllib.request.urlopen(req, timeout=timeout)


def check_for_update():
    """Return None if up to date, else dict(version, notes, url, sha256, page, source_url, html_url)."""
    with _http_get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest") as r:
        rel = json.load(r)
    tag = rel.get("tag_name", "")
    if version_tuple(tag) <= version_tuple(VERSION):
        return None
    assets = {a.get("name"): a for a in rel.get("assets", [])}
    asset = assets.get(EXE_ASSET_NAME)
    digest = (asset or {}).get("digest") or ""
    return {
        "version": tag.lstrip("vV"),
        "tag": tag,
        "notes": (rel.get("body") or "").strip(),
        "url": asset["browser_download_url"] if asset else None,
        "sha256": digest.split(":", 1)[1].lower() if digest.startswith("sha256:") else None,
        "page": rel.get("html_url", ""),
        "source_url": f"https://raw.githubusercontent.com/{GITHUB_REPO}/{tag}/sel_trip_analyzer.py",
        "html_url": assets[HTML_ASSET_NAME]["browser_download_url"] if HTML_ASSET_NAME in assets else None,
    }


def download_file(url, dest, progress=None):
    import hashlib
    h = hashlib.sha256()
    tmp = dest + ".part"
    with _http_get(url, accept="application/octet-stream", timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if progress:
                progress(done, total)
    os.replace(tmp, dest)
    return h.hexdigest()


def install_update(info, progress=None):
    """Download and stage the update. Returns a callable that finishes the
    install and restarts the app (call it after the window has closed)."""
    import tempfile

    if getattr(sys, "frozen", False):  # running as the built .exe
        if not info["url"]:
            raise RuntimeError("This release has no .exe attached yet - try again in a few minutes.")
        exe = sys.executable
        folder = os.path.dirname(exe)
        if not os.access(folder, os.W_OK):
            raise RuntimeError(f"No permission to write to {folder}. "
                               "Move SEL_Trip_Analyzer.exe to a folder you own (e.g. Desktop) and retry.")
        new_exe = exe + ".new"
        digest = download_file(info["url"], new_exe, progress)
        if info["sha256"] and digest != info["sha256"]:
            os.remove(new_exe)
            raise RuntimeError("Downloaded file failed its checksum - update cancelled.")
        bat = os.path.join(tempfile.gettempdir(), "sel_trip_analyzer_update.bat")
        with open(bat, "w") as f:
            f.write(
                "@echo off\r\n"
                ":wait\r\n"
                f'tasklist /FI "PID eq {os.getpid()}" 2>nul | find "{os.getpid()}" >nul && '
                "(timeout /t 1 /nobreak >nul & goto wait)\r\n"
                f'move /Y "{new_exe}" "{exe}" >nul\r\n'
                f'start "" "{exe}"\r\n'
                'del "%~f0"\r\n')

        def finish():
            flags = 0x08000000 | 0x00000008  # CREATE_NO_WINDOW | DETACHED_PROCESS
            subprocess.Popen(["cmd", "/c", bat], creationflags=flags, close_fds=True)
        return finish

    # running from source: replace this .py file (and the page next to it, if there is one)
    script = os.path.abspath(__file__)
    tmp = script + ".new"
    download_file(info["source_url"], tmp, progress)
    with open(tmp, encoding="utf-8") as f:
        compile(f.read(), tmp, "exec")  # make sure it is valid Python before swapping
    page = os.path.join(here(), HTML_ASSET_NAME)
    if info.get("html_url") and not os.path.exists(os.path.join(here(), "web", "app.html")):
        download_file(info["html_url"], page)
    os.replace(script, script + ".bak")
    os.replace(tmp, script)

    def finish():
        subprocess.Popen([sys.executable, script])
    return finish


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------
def expand_paths(paths):
    """Files as given; folders scanned (each folder's files before its subfolders) for supported types."""
    out = []
    for p in paths:
        p = os.path.abspath(p.strip('"'))
        if os.path.isdir(p):
            for d, subdirs, files in os.walk(p):
                subdirs.sort()
                for name in sorted(files):
                    if os.path.splitext(name)[1].lower() in FILE_EXTS and not name.upper().startswith("README"):
                        out.append(os.path.join(d, name))
        elif os.path.isfile(p):
            out.append(p)
    return out


def file_payload(paths):
    items = []
    for p in expand_paths(paths):
        try:
            if os.path.getsize(p) > MAX_FILE:
                continue
            with open(p, "rb") as f:
                items.append({"name": os.path.basename(p), "path": p, "b64": base64.b64encode(f.read()).decode()})
        except OSError:
            continue
    return items


# --------------------------------------------------------------------------
# Native dialogs
# --------------------------------------------------------------------------
def save_dialog(name, initial_dir):
    """Windows Save As dialog. Returns a path or None. Elsewhere: saves to Downloads."""
    ext = os.path.splitext(name)[1].lower()
    if not WIN:
        d = os.path.join(os.path.expanduser("~"), "Downloads")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, name)
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [("lStructSize", wintypes.DWORD), ("hwndOwner", wintypes.HWND), ("hInstance", wintypes.HINSTANCE),
                    ("lpstrFilter", wintypes.LPCWSTR), ("lpstrCustomFilter", wintypes.LPWSTR), ("nMaxCustFilter", wintypes.DWORD),
                    ("nFilterIndex", wintypes.DWORD), ("lpstrFile", wintypes.LPWSTR), ("nMaxFile", wintypes.DWORD),
                    ("lpstrFileTitle", wintypes.LPWSTR), ("nMaxFileTitle", wintypes.DWORD), ("lpstrInitialDir", wintypes.LPCWSTR),
                    ("lpstrTitle", wintypes.LPCWSTR), ("Flags", wintypes.DWORD), ("nFileOffset", wintypes.WORD),
                    ("nFileExtension", wintypes.WORD), ("lpstrDefExt", wintypes.LPCWSTR), ("lCustData", wintypes.LPARAM),
                    ("lpfnHook", ctypes.c_void_p), ("lpTemplateName", wintypes.LPCWSTR), ("pvReserved", ctypes.c_void_p),
                    ("dwReserved", wintypes.DWORD), ("FlagsEx", wintypes.DWORD)]

    kinds = {".docx": "Word document", ".pdf": "PDF", ".csv": "CSV spreadsheet", ".txt": "Text file", ".png": "PNG picture"}
    label = kinds.get(ext, "File")
    filt = f"{label} (*{ext})\0*{ext}\0All files (*.*)\0*.*\0\0"
    buf = ctypes.create_unicode_buffer(re.sub(r'[\\/:*?"<>|]', "-", name), 1024)
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.hwndOwner = ctypes.windll.user32.GetForegroundWindow()
    ofn.lpstrFilter = filt
    ofn.lpstrFile = ctypes.cast(buf, wintypes.LPWSTR)
    ofn.nMaxFile = 1024
    ofn.lpstrInitialDir = initial_dir or os.path.join(os.path.expanduser("~"), "Documents")
    ofn.lpstrDefExt = ext.lstrip(".") or None
    ofn.Flags = 0x00000002 | 0x00080000 | 0x00000008 | 0x00000800  # OVERWRITEPROMPT | EXPLORER | NOCHANGEDIR | PATHMUSTEXIST
    if ctypes.windll.comdlg32.GetSaveFileNameW(ctypes.byref(ofn)):
        return buf.value
    return None


def open_in_explorer(path):
    try:
        if WIN:
            subprocess.Popen(["explorer", "/select,", path])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(path)])
    except OSError:
        pass


# --------------------------------------------------------------------------
# Local server
# --------------------------------------------------------------------------
class App:
    def __init__(self, page_path):
        with open(page_path, encoding="utf-8") as f:
            page = f.read()
        self.token = secrets.token_urlsafe(24)
        boot = ("<script>window.SEL_DESKTOP=" + json.dumps({"token": self.token, "version": VERSION, "platform": sys.platform}) + ";</script>")
        self.page = page.replace("<head>", "<head>\n" + boot, 1).encode("utf-8")
        self.pending = []
        self.lock = threading.Lock()
        self.last_ping = time.time()
        self.update_info = None
        self.finish_update = None
        self.prefs = load_prefs()
        self.server = None

    def queue(self, paths):
        items = file_payload(paths)
        with self.lock:
            self.pending.extend(items)
        return len(items)


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "SELTripAnalyzer"

        def log_message(self, *a):  # quiet
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self):
            # only the page we served (which knows the token) may call the API; also rejects other sites
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost") and secrets.compare_digest(self.headers.get("X-Token", ""), app.token)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4 * MAX_FILE:
                raise ValueError("too large")
            return json.loads(self.rfile.read(n) or b"{}")

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/index.html"):
                host = (self.headers.get("Host") or "").split(":")[0]
                if host not in ("127.0.0.1", "localhost"):
                    return self._send(403, {"error": "forbidden"})
                return self._send(200, app.page, "text/html; charset=utf-8")
            if path == "/favicon.ico":
                return self._send(204, b"", "image/x-icon")
            if not self._authorized():
                return self._send(403, {"error": "forbidden"})
            if path == "/api/info":
                return self._send(200, {"version": VERSION, "frozen": bool(getattr(sys, "frozen", False)), "platform": sys.platform})
            if path == "/api/pending":
                app.last_ping = time.time()
                with app.lock:
                    items, app.pending = app.pending, []
                return self._send(200, {"files": items})
            if path == "/api/update":
                try:
                    info = check_for_update()
                except Exception as e:  # noqa: BLE001
                    return self._send(200, {"error": str(e)})
                app.update_info = info
                return self._send(200, {"update": info})
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            if path == "/api/handoff":  # a second launch passing its files on (token from the instance file)
                if not self._authorized():
                    return self._send(403, {"error": "forbidden"})
                n = app.queue(self._body().get("paths", []))
                return self._send(200, {"queued": n})
            if not self._authorized():
                return self._send(403, {"error": "forbidden"})
            try:
                body = self._body()
            except ValueError:
                return self._send(400, {"error": "bad request"})
            if path == "/api/save":
                name = os.path.basename(body.get("name") or "export.txt")
                data = base64.b64decode(body.get("b64") or "")
                try:
                    dest = save_dialog(name, app.prefs.get("save_dir"))
                except Exception as e:  # noqa: BLE001
                    return self._send(200, {"error": str(e)})
                if not dest:
                    return self._send(200, {"cancelled": True})
                try:
                    with open(dest, "wb") as f:
                        f.write(data)
                except OSError as e:
                    return self._send(200, {"error": str(e)})
                app.prefs["save_dir"] = os.path.dirname(dest)
                save_prefs(app.prefs)
                return self._send(200, {"saved": dest})
            if path == "/api/reveal":
                p = body.get("path") or ""
                if os.path.exists(p):
                    open_in_explorer(p)
                return self._send(200, {"ok": True})
            if path == "/api/open-url":
                url = body.get("url") or ""
                if re.match(r"^https://", url):
                    webbrowser.open(url)
                return self._send(200, {"ok": True})
            if path == "/api/open-files":
                return self._send(200, {"queued": app.queue(body.get("paths", []))})
            if path == "/api/update-install":
                info = app.update_info
                if not info:
                    return self._send(200, {"error": "Check for updates first"})
                try:
                    app.finish_update = install_update(info)
                except Exception as e:  # noqa: BLE001
                    return self._send(200, {"error": str(e)})
                threading.Thread(target=lambda: (time.sleep(0.8), app.server.shutdown()), daemon=True).start()
                return self._send(200, {"ok": True, "restarting": True})
            if path == "/api/quit":
                threading.Thread(target=lambda: (time.sleep(0.3), app.server.shutdown()), daemon=True).start()
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})

    return Handler


def instance_file():
    return os.path.join(data_dir(), "instance.json")


def hand_off(paths):
    """If the app is already running, give it our files and return True."""
    import urllib.request
    try:
        with open(instance_file(), encoding="utf-8") as f:
            inst = json.load(f)
        req = urllib.request.Request(f"http://127.0.0.1:{inst['port']}/api/handoff", method="POST",
                                     data=json.dumps({"paths": [os.path.abspath(p) for p in paths]}).encode(),
                                     headers={"X-Token": inst["token"], "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as r:
            json.load(r)
        return True
    except Exception:  # noqa: BLE001
        return False


def start_server(app, port):
    for p in [port] + list(range(port + 1, port + 10)) + [0]:
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p), make_handler(app))
            srv.daemon_threads = True
            app.server = srv
            return srv
        except OSError:
            continue
    raise SystemExit("Couldn't open a local port for the app window.")


def find_browser():
    pf = [os.environ.get(k) for k in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")]
    names = [("Microsoft", "Edge", "Application", "msedge.exe"), ("Google", "Chrome", "Application", "chrome.exe")]
    for parts in names:
        for base in pf:
            if base:
                p = os.path.join(base, *parts)
                if os.path.exists(p):
                    return p
    for exe in ("msedge", "microsoft-edge", "google-chrome", "chromium", "chromium-browser", "chrome"):
        p = shutil.which(exe)
        if p:
            return p
    return None


def open_window(url, use_default):
    browser = None if use_default else find_browser()
    if browser:
        profile = os.path.join(data_dir(), "window")
        args = [browser, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
                "--disable-features=Translate", "--window-size=1320,920"]
        try:
            return subprocess.Popen(args)
        except OSError:
            pass
    webbrowser.open(url)
    return None


def selftest():
    """Start the server, fetch the page and the API, check everything the page needs is there."""
    import urllib.request
    app = App(find_page())
    srv = start_server(app, 0)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    html = urllib.request.urlopen(base + "/", timeout=5).read().decode("utf-8")
    for marker in ("window.SEL_DESKTOP", "SELCore", "SELAnalysis", "SELReference", "SELDocx", "SELWaveUI", "SELWeather", f"v{VERSION}"):
        assert marker in html, f"page is missing {marker}"
    req = urllib.request.Request(base + "/api/info", headers={"X-Token": app.token})
    info = json.load(urllib.request.urlopen(req, timeout=5))
    assert info["version"] == VERSION, info
    try:
        urllib.request.urlopen(base + "/api/info", timeout=5)
        raise AssertionError("API answered without the token")
    except urllib.error.HTTPError as e:
        assert e.code == 403
    samples = os.path.join(getattr(sys, "_MEIPASS", here()), "sample_files")
    if os.path.isdir(samples):
        assert app.queue([samples]) >= 5, "sample files not readable"
    srv.shutdown()
    print(f"selftest ok: v{VERSION}, page {len(html) // 1024} KB")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    use_default = "--browser" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if hand_off(paths):
        return 0
    app = App(find_page())
    srv = start_server(app, int(os.environ.get("SEL_TRIP_PORT", PORT)))
    port = srv.server_address[1]
    with open(instance_file(), "w", encoding="utf-8") as f:
        json.dump({"port": port, "token": app.token, "pid": os.getpid()}, f)
    if paths:
        app.queue(paths)
    proc = open_window(f"http://127.0.0.1:{port}/", use_default)

    def watchdog():
        # quit when the window is closed: the Edge process ends, or (default browser) the page stops checking in
        while True:
            time.sleep(2)
            if proc is not None and proc.poll() is not None and time.time() - app.last_ping > 6:
                break
            if time.time() - app.last_ping > (45 if proc is None else 120):
                break
        srv.shutdown()
    threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever()
    finally:
        try:
            with open(instance_file(), encoding="utf-8") as f:
                if json.load(f).get("pid") == os.getpid():
                    os.remove(instance_file())
        except (OSError, ValueError):
            pass
    if app.finish_update:
        app.finish_update()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
