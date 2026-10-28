#!/usr/bin/env python3
"""
SEL Trip Event Analyzer
-----------------------
Drag-and-drop Windows tool that reads SEL relay event files and AcSELerator
QuickSet .RDB settings databases, then writes an editable, copy-and-paste
summary of what caused each trip.

Supported inputs
  .CEV            Compressed event reports (CEV / CEV R)
  .EVE .TXT .SUM  Text event reports / event summaries (EVE, SUM, CHI, etc.)
  .HIS            Event history (HIS command output)
  .SER            Sequential Events Recorder output
  .HDR            COMTRADE header (SEL writes the event summary here)
  .RDB            QuickSet relay database (settings context: TR, LL, CTR, ...)
  Folders         Dropped folders are scanned for the types above
"""

import csv
import datetime
import math
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field

try:
    import olefile  # reads the OLE container used by QuickSet .rdb files
except ImportError:  # pragma: no cover
    olefile = None

APP_NAME = "SEL Trip Event Analyzer"
VERSION = "1.0.0"
# GitHub "owner/repo" that publishes releases. Each release must attach
# SEL_Trip_Analyzer.exe (the GitHub Actions workflow in this repo does that).
GITHUB_REPO = "kefirman9000/sel-trip-analyzer"
EXE_ASSET_NAME = "SEL_Trip_Analyzer.exe"


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
    """Return None if up to date, else dict(version, notes, url, sha256, page, source_url)."""
    import json
    with _http_get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest") as r:
        rel = json.load(r)
    tag = rel.get("tag_name", "")
    if version_tuple(tag) <= version_tuple(VERSION):
        return None
    asset = next((a for a in rel.get("assets", []) if a.get("name") == EXE_ASSET_NAME), None)
    digest = (asset or {}).get("digest") or ""
    return {
        "version": tag.lstrip("vV"),
        "tag": tag,
        "notes": (rel.get("body") or "").strip(),
        "url": asset["browser_download_url"] if asset else None,
        "sha256": digest.split(":", 1)[1].lower() if digest.startswith("sha256:") else None,
        "page": rel.get("html_url", ""),
        "source_url": f"https://raw.githubusercontent.com/{GITHUB_REPO}/{tag}/sel_trip_analyzer.py",
    }


def download_file(url, dest, progress=None):
    import hashlib
    h = hashlib.sha256()
    with _http_get(url, accept="application/octet-stream", timeout=60) as r, open(dest, "wb") as f:
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
    return h.hexdigest()


def install_update(info, progress=None):
    """Download and stage the update. Returns a callable that finishes the
    install and restarts the app (call it after closing the window)."""
    import subprocess
    import tempfile

    if getattr(sys, "frozen", False):  # running as the built .exe
        if not info["url"]:
            raise RuntimeError("This release has no .exe attached yet - try again in a few minutes.")
        exe = sys.executable
        folder = os.path.dirname(exe)
        if not os.access(folder, os.W_OK):
            raise RuntimeError(f"No permission to write to {folder}.\n"
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

    # running from source: replace this .py file
    script = os.path.abspath(__file__)
    tmp = script + ".new"
    download_file(info["source_url"], tmp, progress)
    with open(tmp, encoding="utf-8") as f:
        compile(f.read(), tmp, "exec")  # make sure it is valid Python before swapping
    os.replace(script, script + ".bak")
    os.replace(tmp, script)

    def finish():
        subprocess.Popen([sys.executable, script])
    return finish

EVENT_EXTS = {".cev", ".eve", ".txt", ".sum", ".his", ".ser", ".hdr", ".log", ".chi"}
SETTINGS_EXTS = {".rdb"}
ALL_EXTS = EVENT_EXTS | SETTINGS_EXTS


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------
@dataclass
class EventRecord:
    source: str
    kind: str = "event"           # event | history | ser
    relay_id: str = ""
    terminal_id: str = ""
    fid: str = ""
    date: str = ""
    time: str = ""
    event_type: str = ""
    location: str = ""
    shot: str = ""
    freq: str = ""
    targets: str = ""
    currents: dict = field(default_factory=dict)        # name -> (prefault, fault max)
    voltages: dict = field(default_factory=dict)        # name -> (prefault, fault min)
    sequence: list = field(default_factory=list)        # (cycle, element, 'asserted'/'pre')
    trip_cycle: float = None
    open_cycle: float = None
    settings: dict = field(default_factory=dict)
    ser_lines: list = field(default_factory=list)
    extra: list = field(default_factory=list)


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def read_text(path):
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def is_num(s):
    try:
        float(str(s).strip())
        return True
    except ValueError:
        return False


def fnum(s, default=None):
    try:
        return float(str(s).strip())
    except (ValueError, TypeError):
        return default


SETTING_RE = re.compile(
    r"\b([A-Z][A-Z0-9_]{0,11})\s*:?=\s*(.*?)(?=\s{2,}[A-Z][A-Z0-9_]{0,11}\s*:?=|\"|$)"
)
USEFUL_SETTINGS = {
    "RID", "TID", "SID", "LL", "CTR", "CTRN", "PTR", "PTRS", "Z1MAG", "Z1ANG", "Z0MAG",
    "TR", "TRCOMM", "TRSOTF", "DTT", "ULTR", "ER", "79RI", "52A", "52AA1", "BFI",
    "Z1P", "Z2P", "Z3P", "Z1MG", "Z2MG", "Z1G", "Z2D", "Z2PD", "Z2GD", "Z3D",
    "50P1P", "50G1P", "50Q1P", "51PP", "51PC", "51PTD", "51GP", "51GC", "51GTD",
    "51QP", "E21P", "E21MG", "E21XG", "E50P", "E50G", "E51S", "E32", "ECOMM", "E81",
    "TOP", "TPA", "TPB", "TPC",
}


def extract_settings(text):
    out = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        for m in SETTING_RE.finditer(line):
            key, val = m.group(1), m.group(2).strip().strip(",").strip()
            if not val or len(val) > 400:
                continue
            if key in USEFUL_SETTINGS or key.startswith(("TR", "E", "Z", "50", "51", "67", "87")):
                out.setdefault(key, val)
    return out


# --------------------------------------------------------------------------
# Interpretation tables
# --------------------------------------------------------------------------
FAULT_TYPES = {
    "AG": "Phase A-to-ground fault", "BG": "Phase B-to-ground fault", "CG": "Phase C-to-ground fault",
    "AB": "Phase A-B (phase-to-phase) fault", "BC": "Phase B-C (phase-to-phase) fault",
    "CA": "Phase C-A (phase-to-phase) fault",
    "ABG": "Phase A-B-to-ground fault", "BCG": "Phase B-C-to-ground fault", "CAG": "Phase C-A-to-ground fault",
    "ABC": "Three-phase fault", "ABCG": "Three-phase-to-ground fault",
}
NON_FAULT_TYPES = {
    "TRIP": "Trip with no fault type identified (non-fault trip: transfer/remote/manual trip, "
            "external input, or fault type undetermined)",
    "ER": "Event triggered by the ER (event report trigger) equation - no trip",
    "TRIG": "Manually triggered event (TRI command) - no trip",
    "PULSE": "Output pulsed by command (PUL)",
    "OPEN": "Breaker open command", "CLOSE": "Breaker close command",
    "BCW": "Breaker contact wear alarm", "LOP": "Loss of potential",
    "OST": "Out-of-step trip", "OSB": "Out-of-step blocking",
    "SOTF": "Switch-onto-fault",
}

TARGET_WORDS = [
    (r"\bINST\b", "instantaneous element"),
    (r"\bCOMM\b", "communications-assisted scheme (POTT/DCB/DCUB/DTT)"),
    (r"\bSOTF\b", "switch-onto-fault logic"),
    (r"\bTIME\b", "time-delayed element"),
    (r"\bZ(?:ONE)?\s*1\b|\bZONE1\b|\bZ1\b", "Zone 1 distance"),
    (r"\bZ(?:ONE)?\s*2\b|\bZONE2\b|\bZ2\b", "Zone 2 distance"),
    (r"\bZ(?:ONE)?\s*3\b|\bZONE3\b|\bZ3\b", "Zone 3 distance"),
    (r"\bZ(?:ONE)?\s*4\b|\bZONE4\b|\bZ4\b", "Zone 4 distance"),
    (r"\b87\w*\b", "differential (87)"),
    (r"\b51\w*\b", "time-overcurrent (51)"),
    (r"\b50\w*\b", "instantaneous overcurrent (50)"),
    (r"\b67\w*\b", "directional overcurrent (67)"),
    (r"\b81\w*\b|\bFREQ\b", "frequency (81)"),
    (r"\b27\w*\b", "undervoltage (27)"),
    (r"\b59\w*\b", "overvoltage (59)"),
    (r"\bBF\w*\b|\b50BF\b", "breaker failure"),
    (r"\b79\w*\b|\bRCLS\b|\bRS\b", "reclosing activity"),
    (r"\bLO\b", "reclose lockout"),
]

ELEMENT_RULES = [
    (r"^(Z|M)\d+(P|G|MG|XG|AB|BC|CA|AG|BG|CG)?T?$|^MAB\d|^MBC\d|^MCA\d|^MAG\d|^MBG\d|^MCG\d|^XAG\d|^XBG\d|^XCG\d", "distance"),
    (r"^(Z|M)\d+(P|G)?T$|^Z\d+(P|G)?D$", "distance (time-delayed)"),
    (r"^87", "differential"),
    (r"^51\w*T$", "time-overcurrent trip"),
    (r"^51", "time-overcurrent pickup"),
    (r"^67", "directional overcurrent"),
    (r"^50BF|^BFT|^FBF", "breaker failure"),
    (r"^50", "instantaneous overcurrent"),
    (r"^32|^F32|^R32", "directional"),
    (r"^81", "frequency"),
    (r"^27", "undervoltage"),
    (r"^59", "overvoltage"),
    (r"^24", "volts/hertz"),
    (r"^46", "negative-sequence"),
    (r"^49", "thermal"),
    (r"^OST|^OSB", "out-of-step"),
    (r"^SOTF|^SOTFT", "switch-onto-fault"),
    (r"^(DTT|DTA|DTB|DTC|PTRX|PT\d?|RX|KEY|TRCOMM|ECTT|DCB|POTT|Z2PGS|RB\d|ROK|RBADA?)", "communications / transfer trip"),
    (r"^IN\d+$", "contact input"),
    (r"^(TRIP|TR|TRIP\d|3PT|TPA\d?|TPB\d?|TPC\d?|TRP\w*)$", "TRIP"),
    (r"^OUT\d+$", "output contact"),
    (r"^(52A\w*|52B\w*)$", "breaker status"),
    (r"^79", "reclosing"),
    (r"^LOP|^ILOP", "loss of potential"),
    (r"^(SV|PSV|PLT|PCT|LT|LV|PCV)\d+", "SELogic variable"),
]

TRIP_NAMES = {"TRIP", "TR", "TRIP1", "3PT", "TPA", "TPB", "TPC", "TRIP3", "TRP", "TPA1", "TRIPA"}
BREAKER_NAMES = ("52A", "52AA1", "52AB1", "52AC1", "52A1", "IN101")


def element_class(name):
    n = name.upper()
    for pat, cls in ELEMENT_RULES:
        if re.match(pat, n):
            return cls
    return ""


def interpret_event_type(et):
    et = (et or "").strip().upper()
    if not et:
        return "", False
    tripped = bool(re.search(r"\bT$|\bTRIP\b", et)) or et.endswith(" T")
    core = re.sub(r"\s+T$", "", et).strip(" *")
    core = re.sub(r"\s+", "", core)
    if core in FAULT_TYPES:
        desc = FAULT_TYPES[core]
    elif core in NON_FAULT_TYPES:
        desc = NON_FAULT_TYPES[core]
        if core == "TRIP":
            tripped = True
    else:
        desc = f"Event type '{et}'"
    return desc, tripped


def interpret_targets(t):
    if not t:
        return []
    found = []
    for pat, desc in TARGET_WORDS:
        if re.search(pat, t.upper()) and desc not in found:
            found.append(desc)
    return found


def fmt_loc(loc, settings):
    if not loc:
        return ""
    if "$" in loc:
        return f"{loc} (not calculated - relay could not determine distance)"
    v = fnum(loc)
    ll = fnum(settings.get("LL", "")) if settings else None
    if v is not None and ll:
        return f"{loc} line-length units (~{100 * v / ll:.0f}% of LL={settings['LL']})"
    return f"{loc} (in the relay's line-length units)"


# --------------------------------------------------------------------------
# CEV (compressed event report) parser
# --------------------------------------------------------------------------
CHECKSUM_RE = re.compile(r',\s*"[0-9A-Fa-f]{4}"\s*$')


def parse_cev(text, source):
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        has_ck = bool(CHECKSUM_RE.search(line))
        try:
            fields = next(csv.reader([line]))
        except Exception:
            continue
        fields = [f.strip() for f in fields]
        if has_ck and len(fields) > 1:
            fields = fields[:-1]
        rows.append(fields)

    rec = EventRecord(source=source)
    kv = {}
    table_hdr, table = None, []
    i = 0
    while i < len(rows):
        r = rows[i]
        if r and r[0].upper() == "FID":
            rec.fid = r[1].replace("FID=", "") if len(r) > 1 else ""
            i += 1
            continue
        if len(r) >= 2 and not any(is_num(x) for x in r):
            block = []
            j = i + 1
            while j < len(rows) and len(rows[j]) == len(r) and any(is_num(x) for x in rows[j]):
                block.append(rows[j])
                j += 1
            if len(block) == 1:
                for k, v in zip(r, block[0]):
                    kv[k.upper()] = v
            elif len(block) > len(table):
                table_hdr, table = r, block
            i = j if block else i + 1
            continue
        i += 1

    rec.event_type = kv.get("EVENT", "")
    rec.location = kv.get("LOCATION", kv.get("LOC", ""))
    rec.shot = kv.get("SHOT", kv.get("SHOT_1P", ""))
    rec.freq = kv.get("FREQ", "")
    rec.targets = kv.get("TARGETS", "")
    try:
        y, mo, d = int(kv["YEAR"]), int(kv["MONTH"]), int(kv["DAY"])
        rec.date = f"{mo:02d}/{d:02d}/{y}"
        rec.time = f"{int(kv['HOUR']):02d}:{int(kv['MIN']):02d}:{int(kv['SEC']):02d}.{int(kv.get('MSEC', 0)):03d}"
    except (KeyError, ValueError):
        pass

    rec.settings = extract_settings(text)
    rec.relay_id = rec.settings.get("RID", "")
    rec.terminal_id = rec.settings.get("TID", "")

    if table_hdr and table:
        analyze_table(rec, table_hdr, table, fnum(kv.get("SAM/CYC_A"), 4) or 4)
    return [rec]


def analyze_table(rec, hdr, table, sam):
    sam = int(sam) if sam and sam > 0 else 4
    lag = max(1, round(sam / 4))
    trig = next((k for k, row in enumerate(table) if ">" in row), None)
    start_fault = trig if trig is not None else 0

    # Analog channels
    for c, name in enumerate(hdr):
        n = name.upper().split("(")[0].strip()
        if " " in name or not n:
            continue
        vals = [fnum(row[c]) for row in table]
        if any(v is None for v in vals):
            continue
        mags = [math.hypot(vals[k], vals[k - lag]) / math.sqrt(2) for k in range(lag, len(vals))]
        if not mags:
            continue
        pre = sum(mags[: max(1, sam)]) / max(1, min(sam, len(mags)))
        post = mags[max(0, start_fault - lag):] or mags
        if re.match(r"^(I[ABCNGRSPQ]|IA|IB|IC|IN|IG|3I0|3I2|I1|I2|IP)\w*$", n):
            rec.currents[name] = (pre, max(post))
        elif re.match(r"^V(A|B|C|AB|BC|CA|S|P|1|2)\w*$", n):
            rec.voltages[name] = (pre, min(post))

    # Digital channels (hex-packed relay word bits)
    first_on, pre_on = {}, set()
    for c, name in enumerate(hdr):
        if " " not in name.strip():
            continue
        names = name.split()
        for k, row in enumerate(table):
            h = row[c].strip() if c < len(row) else ""
            if not h or not re.fullmatch(r"[0-9A-Fa-f]+", h):
                continue
            bits = "".join(f"{int(ch, 16):04b}" for ch in h)
            for b, el in zip(bits, names):
                if el == "*" or b != "1":
                    continue
                if k == 0:
                    pre_on.add(el)
                elif el not in first_on and el not in pre_on:
                    first_on[el] = k
        # breaker opening: 52A deasserting
        for k, row in enumerate(table):
            h = row[c].strip() if c < len(row) else ""
            if not re.fullmatch(r"[0-9A-Fa-f]+", h or "-"):
                continue
            bits = "".join(f"{int(ch, 16):04b}" for ch in h)
            state = dict(zip(names, bits))
            for bn in BREAKER_NAMES[:5]:
                if bn in pre_on and state.get(bn) == "0" and rec.open_cycle is None:
                    rec.open_cycle = k / sam

    for el, k in sorted(first_on.items(), key=lambda x: x[1]):
        rec.sequence.append((k / sam, el, "asserted"))
    for el in sorted(pre_on):
        if element_class(el) and element_class(el) not in ("breaker status", "SELogic variable"):
            rec.sequence.append((0.0, el, "pre"))
    trips = [k for el, k in first_on.items() if el.upper() in TRIP_NAMES]
    if trips:
        rec.trip_cycle = min(trips) / sam


# --------------------------------------------------------------------------
# Text report parsers (EVE / SUM / HIS / SER / HDR)
# --------------------------------------------------------------------------
EVENT_LINE_RE = re.compile(r"^\s*Event\s*(?:Type)?\s*:\s*(.+?)(?:\s{2,}|$)", re.I | re.M)


def grab(pattern, text, flags=re.I | re.M):
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else ""


def parse_text(text, source):
    if '"FID"' in text or re.search(r'^"MONTH","DAY"', text, re.M):
        return parse_cev(text, source)

    recs = []
    settings = extract_settings(text)

    # Event history (HIS)
    if re.search(r"\bEVENT\b.*\bLOCAT", text, re.I):
        recs.extend(parse_his(text, source, settings))

    # SER
    ser = re.findall(
        r"^\s*\d*\s*(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\s+(\S+)\s+(Asserted|Deasserted)\b",
        text, re.I | re.M)
    if ser:
        r = EventRecord(source=source, kind="ser")
        r.ser_lines = [f"{d} {t}  {el:<12} {st}" for d, t, el, st in ser]
        recs.append(r)

    # Event reports / summaries
    matches = list(EVENT_LINE_RE.finditer(text))
    for idx, m in enumerate(matches):
        start = text.rfind("\n", 0, max(0, m.start() - 600)) + 1
        prev_end = matches[idx - 1].end() if idx else 0
        start = max(start, prev_end)
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        chunk = text[start:end]
        r = EventRecord(source=source)
        r.event_type = re.split(r"\s{2,}|Location|Shot|Freq", m.group(1), flags=re.I)[0].strip()
        r.location = grab(r"(?:Fault\s+)?Location\s*:\s*([-$\d.]+)", chunk)
        r.shot = grab(r"Shot\s*:\s*(\S+)", chunk)
        r.freq = grab(r"Freq(?:uency)?\s*:\s*([\d.]+)", chunk)
        r.targets = grab(r"Targets?\s*:\s*(.+)$", chunk)
        r.date = grab(r"Date\s*:\s*(\S+)", chunk)
        r.time = grab(r"Time\s*:\s*(\S+)", chunk)
        r.relay_id = settings.get("RID", "")
        r.terminal_id = settings.get("TID", "")
        r.fid = grab(r"FID\s*=\s*(\S+)", chunk)
        if not r.relay_id:
            first = [ln.strip() for ln in chunk.splitlines() if ln.strip()][:2]
            if first and "Date" in first[0]:
                r.relay_id = re.split(r"\s{2,}Date", first[0])[0].strip()
                if len(first) > 1 and not first[1].lower().startswith("event"):
                    r.terminal_id = re.split(r"\s{2,}Time", first[1])[0].strip()
        for lbl in ("Trip Time", "Event Time", r"Breaker\s*\d*\s*\w*", "Fault Type", "Group", "Recloser"):
            v = grab(rf"^\s*({lbl}\s*:.+)$", chunk)
            if v:
                r.extra.append(re.sub(r"\s+", " ", v))
        cur = re.search(r"Currents?\s*\(([^)]*)\)\s*,?\s*([A-Z]+)\s*:\s*([-\d.\s]+)", chunk, re.I)
        if cur:
            labels, nums = cur.group(2), cur.group(3).split()
            for ch, v in zip(labels, nums):
                fv = fnum(v)
                if fv is not None:
                    rec_name = "I" + ch
                    r.currents[rec_name] = (None, fv)
        r.settings = settings
        recs.append(r)
    return recs


def parse_his(text, source, settings):
    recs = []
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)$", line)
        if not m:
            continue
        toks = m.group(4).split()
        et = []
        while toks and not (is_num(toks[0]) or "$" in toks[0]):
            et.append(toks.pop(0))
        r = EventRecord(source=source, kind="history")
        r.date, r.time, r.event_type = m.group(2), m.group(3), " ".join(et)
        nums = []
        while toks and (is_num(toks[0]) or "$" in toks[0]):
            nums.append(toks.pop(0))
        if nums:
            r.location = nums[0]
        if len(nums) > 1:
            r.currents["Fault current"] = (None, fnum(nums[1], 0))
        if len(nums) > 2:
            r.freq = nums[2]
        if len(nums) > 4:
            r.shot = nums[4]
        r.targets = " ".join(toks)
        r.settings = settings
        r.relay_id = settings.get("RID", "")
        recs.append(r)
    return recs


# --------------------------------------------------------------------------
# RDB (QuickSet relay database) parser
# --------------------------------------------------------------------------
def parse_rdb(path):
    """Return {relay_label: settings_dict}. Best effort across RDB variants."""
    texts = []
    with open(path, "rb") as f:
        raw = f.read()
    if olefile is not None and olefile.isOleFile(path):
        try:
            ole = olefile.OleFileIO(path)
            for entry in ole.listdir(streams=True, storages=False):
                try:
                    data = ole.openstream(entry).read()
                except Exception:
                    continue
                texts.append(("/".join(entry), decode_blob(data)))
            ole.close()
        except Exception:
            pass
    if not texts and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                try:
                    texts.append((n, decode_blob(z.read(n))))
                except Exception:
                    continue
    if not texts:
        texts.append(("raw", decode_blob(raw)))

    combined = {}
    per_relay = {}
    for name, t in texts:
        s = extract_settings(t)
        if not s:
            continue
        top = name.split("/")[0]
        per_relay.setdefault(top, {}).update({k: v for k, v in s.items() if k not in per_relay.get(top, {})})
        for k, v in s.items():
            combined.setdefault(k, v)
    if len(per_relay) <= 1:
        return {combined.get("RID") or os.path.basename(path): combined} if combined else {}
    out = {}
    for top, s in per_relay.items():
        out[s.get("RID") or top] = s
    return out


def decode_blob(data):
    if data[:2] in (b"\xff\xfe", b"\xfe\xff") or (len(data) > 4 and data[1:2] == b"\x00" and data[3:4] == b"\x00"):
        try:
            return data.decode("utf-16", errors="ignore")
        except Exception:
            pass
    t = data.decode("latin-1", errors="ignore")
    return re.sub(r"[^\x09\x0a\x0d\x20-\x7e]+", "\n", t)


# --------------------------------------------------------------------------
# Loading and report building
# --------------------------------------------------------------------------
def expand_paths(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for fn in sorted(files):
                    if os.path.splitext(fn)[1].lower() in ALL_EXTS:
                        out.append(os.path.join(root, fn))
        elif os.path.isfile(p):
            out.append(p)
    seen, uniq = set(), []
    for p in out:
        k = os.path.normcase(os.path.abspath(p))
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return uniq


def load_files(paths):
    events, rdb, errors = [], {}, []
    for p in paths:
        ext = os.path.splitext(p)[1].lower()
        name = os.path.basename(p)
        try:
            if ext in SETTINGS_EXTS:
                rdb.update(parse_rdb(p))
            elif ext == ".cev":
                events.extend(parse_cev(read_text(p), name))
            else:
                events.extend(parse_text(read_text(p), name))
        except Exception as e:  # keep going on bad files
            errors.append(f"{name}: {e}")
    return events, rdb, errors


def match_settings(rec, rdb):
    if not rdb:
        return {}, ""
    rid = (rec.relay_id or "").strip().upper()
    for label, s in rdb.items():
        if rid and (rid == str(label).upper() or rid == s.get("RID", "").upper()):
            return s, label
    if len(rdb) == 1:
        label = next(iter(rdb))
        return rdb[label], label
    return {}, ""


def determine_cause(rec, settings):
    desc, tripped = interpret_event_type(rec.event_type)
    tdesc = interpret_targets(rec.targets)
    lines = []

    if rec.trip_cycle is not None:
        tripped = True

    initiators, pickups = [], []
    if rec.sequence:
        tc = rec.trip_cycle
        for cyc, el, st in rec.sequence:
            cls = element_class(el)
            if st != "asserted" or not cls or cls in ("TRIP", "output contact", "breaker status",
                                                       "SELogic variable", "reclosing"):
                continue
            if tc is None or cyc <= tc + 0.01:
                if tc is not None and tc - cyc <= 0.5:
                    initiators.append((el, cls, cyc))
                else:
                    pickups.append((el, cls, cyc))

    tr_eq = settings.get("TR", "")
    tr_hits = []
    if tr_eq:
        tokens = set(re.findall(r"[A-Z0-9_]+", tr_eq.upper()))
        tr_hits = [el for _, el, st in rec.sequence if st == "asserted" and el.upper() in tokens]

    if tripped:
        what = desc if desc else "Event"
        lines.append(f"Relay TRIPPED. {what}.")
    else:
        lines.append(f"No trip recorded. {desc}." if desc else "No trip recorded for this event.")

    if tdesc:
        lines.append("Front-panel targets indicate: " + ", ".join(tdesc) + f"  [{rec.targets.strip()}]")

    if tr_hits:
        lines.append("Trip equation terms that asserted (TR): " + ", ".join(dict.fromkeys(tr_hits)) +
                     " -> these elements caused the trip.")
    elif initiators:
        lines.append("Element(s) that asserted with the trip: " +
                     ", ".join(f"{el} ({cls}, {cyc:.2f} cyc)" for el, cls, cyc in initiators) +
                     " -> most likely tripping element(s).")
    if pickups:
        lines.append("Earlier pickups before the trip: " +
                     ", ".join(f"{el} ({cls}, {cyc:.2f} cyc)" for el, cls, cyc in pickups[:10]))

    classes = {c for _, c, _ in initiators}
    if tripped and not FAULT_TYPES.get(re.sub(r"\s+T$", "", rec.event_type.upper()).replace(" ", "")):
        if classes & {"communications / transfer trip", "contact input"}:
            lines.append("No fault type was identified and a communications/input bit asserted with the trip: "
                         "likely a direct/remote transfer trip or external trip input, not a local fault.")
        elif "frequency" in classes:
            lines.append("Frequency element tripped: likely underfrequency load shed / system disturbance.")
        elif "undervoltage" in classes or "overvoltage" in classes:
            lines.append("Voltage element tripped: check system voltage conditions / loss of source.")
        elif "breaker failure" in classes:
            lines.append("Breaker-failure logic operated: a breaker failed to clear a fault.")

    if rec.trip_cycle is not None and rec.open_cycle is not None and rec.open_cycle > rec.trip_cycle:
        lines.append(f"Breaker opened ~{rec.open_cycle - rec.trip_cycle:.2f} cycles after trip "
                     f"(trip at {rec.trip_cycle:.2f} cyc, 52A dropped at {rec.open_cycle:.2f} cyc).")
    elif tripped and rec.trip_cycle is not None and rec.open_cycle is None and rec.sequence:
        lines.append("No breaker-open indication seen in the record window - verify breaker operation.")

    if rec.shot and rec.shot not in ("0", ""):
        lines.append(f"Reclose shot counter = {rec.shot} (event occurred during a reclose sequence).")
    return lines, tripped


def short_cause(rec, settings):
    desc, tripped = interpret_event_type(rec.event_type)
    tripped = tripped or rec.trip_cycle is not None
    parts = []
    if desc:
        parts.append(desc.split(" (")[0])
    td = interpret_targets(rec.targets)
    if td:
        parts.append("via " + "/".join(td[:3]))
    elif rec.sequence:
        cand = [el for c, el, st in rec.sequence if st == "asserted" and element_class(el)
                and element_class(el) not in ("TRIP", "output contact", "breaker status", "SELogic variable")]
        if cand:
            parts.append("via " + ", ".join(cand[:3]))
    loc = rec.location if rec.location and "$" not in rec.location else ""
    if loc:
        parts.append(f"@ {loc}")
    return ("TRIP - " if tripped else "No trip - ") + " ".join(parts)


def build_report(events, rdb, errors, files, comments="", opts=None):
    opts = opts or {}
    show_seq = opts.get("sequence", True)
    show_settings = opts.get("settings", True)
    show_ser = opts.get("ser", True)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    ev = [e for e in events if e.kind in ("event", "history")]
    ser = [e for e in events if e.kind == "ser"]

    out = []
    out.append("SEL TRIP EVENT SUMMARY")
    out.append("=" * 60)
    out.append(f"Generated: {now}")
    out.append(f"Files analyzed: {len(files)}   Events found: {len(ev)}   "
               f"Settings databases: {len(rdb)}")
    out.append("")

    if comments.strip():
        out.append("ANALYST COMMENTS / NOTES")
        out.append("-" * 60)
        out.extend(comments.strip().splitlines())
        out.append("")

    if not ev and not ser:
        out.append("No event data recognized in the loaded files.")
    else:
        out.append("QUICK SUMMARY")
        out.append("-" * 60)
        for n, e in enumerate(ev, 1):
            s, _ = match_settings(e, rdb)
            s = {**e.settings, **s}
            when = f"{e.date} {e.time}".strip() or "date n/a"
            who = e.relay_id or e.terminal_id or e.source
            out.append(f"{n:>2}. {when} | {who} | {e.event_type or '?'} | {short_cause(e, s)}")
        out.append("")

        out.append("EVENT DETAILS")
        out.append("-" * 60)
        for n, e in enumerate(ev, 1):
            s_rdb, label = match_settings(e, rdb)
            s = {**e.settings, **s_rdb}
            out.append(f"Event {n} of {len(ev)}  ({'history row' if e.kind == 'history' else 'event report'})")
            out.append(f"  Source file : {e.source}")
            relay = " / ".join(x for x in (e.relay_id, e.terminal_id) if x)
            if relay:
                out.append(f"  Relay       : {relay}")
            if e.fid:
                out.append(f"  Firmware    : {e.fid}")
            if e.date or e.time:
                out.append(f"  Date / Time : {e.date} {e.time}")
            if e.event_type:
                d, _ = interpret_event_type(e.event_type)
                out.append(f"  Event type  : {e.event_type}  ({d})")
            if e.location:
                out.append(f"  Fault loc.  : {fmt_loc(e.location, s)}")
            if e.targets:
                out.append(f"  Targets     : {e.targets}")
            if e.freq:
                out.append(f"  Frequency   : {e.freq} Hz")
            if e.shot:
                out.append(f"  Shot        : {e.shot}")
            for x in e.extra:
                out.append(f"  {x}")
            if e.currents:
                parts = []
                for k, (pre, post) in e.currents.items():
                    parts.append(f"{k} {post:,.0f}" + (f" (pre {pre:,.0f})" if pre is not None else ""))
                out.append("  Currents    : " + "; ".join(parts) + "  [A, max during event]")
            if e.voltages:
                parts = [f"{k} {pre:,.2f} -> {post:,.2f}" for k, (pre, post) in e.voltages.items()]
                out.append("  Voltages    : " + "; ".join(parts) + "  [prefault -> min during event]")

            cause, _ = determine_cause(e, s)
            out.append("  Probable cause of trip:")
            for c in cause:
                out.append(f"    - {c}")

            if show_seq and e.sequence:
                out.append("  Element sequence (cycles from start of record):")
                rel = [x for x in e.sequence if element_class(x[1])]
                rest = len(e.sequence) - len(rel)
                for cyc, el, st in rel[:40]:
                    tag = "already asserted at start" if st == "pre" else "asserted"
                    out.append(f"    {cyc:6.2f}  {el:<10} {tag}  ({element_class(el)})")
                if len(rel) > 40:
                    out.append(f"    ... {len(rel) - 40} more")
                if rest:
                    out.append(f"    ({rest} other relay word bits changed - not listed)")

            if show_settings and s:
                keys = [k for k in ("TR", "TRCOMM", "TRSOTF", "DTT", "LL", "CTR", "PTR", "Z1MAG", "Z1P",
                                    "Z1MG", "50P1P", "50G1P", "51PP", "51GP", "ER") if k in s]
                if keys:
                    src = f"RDB: {label}" if label else "event file"
                    out.append(f"  Settings context ({src}):")
                    for k in keys:
                        out.append(f"    {k} := {s[k]}")
            out.append("")

    if show_ser and ser:
        out.append("SEQUENTIAL EVENTS RECORDER (trip-related lines)")
        out.append("-" * 60)
        for r in ser:
            out.append(f"  From {r.source}:")
            lines = [ln for ln in r.ser_lines if element_class(ln.split()[2])] or r.ser_lines
            for ln in lines[:80]:
                out.append(f"    {ln}")
        out.append("")

    if rdb and not ev:
        out.append("SETTINGS LOADED")
        out.append("-" * 60)
        for label, s in rdb.items():
            out.append(f"  {label}: TR := {s.get('TR', 'n/a')}")
        out.append("")

    if errors:
        out.append("FILES THAT COULD NOT BE READ")
        out.append("-" * 60)
        out.extend("  " + e for e in errors)
        out.append("")

    out.append("Note: automated interpretation - verify against the relay oscillography and settings.")
    return "\n".join(out)


# --------------------------------------------------------------------------
# GUI
# --------------------------------------------------------------------------
PALETTES = {
    "light": dict(bg="#fafafa", surface="#ffffff", text="#1b1b1b", muted="#616161",
                  border="#d9d9d9", accent="#005fb8", drop="#f4f8fd", drop_hover="#e3eefb",
                  drop_line="#9fb9d9", sel="#cce4f7", trip="#c42b1c", ok="#0f7b0f"),
    "dark": dict(bg="#1c1c1c", surface="#252525", text="#e9e9e9", muted="#9e9e9e",
                 border="#3a3a3a", accent="#4cc2ff", drop="#20262d", drop_hover="#22344a",
                 drop_line="#4d6a8b", sel="#264f78", trip="#ff8f85", ok="#6ccb5f"),
}

PLACEHOLDER = ("Notes to include at the top of the summary, e.g.\n"
               "Crew found a cracked insulator at pole 47. Recommend checking Z1 reach.")
EMPTY_HINT = ("Drop SEL event files or a folder above and the trip summary will appear here.\n\n"
              "Everything in this box is editable before you copy or save it.")


def settings_path():
    base = (os.environ.get("APPDATA") or os.environ.get("XDG_CONFIG_HOME")
            or os.path.join(os.path.expanduser("~"), ".config"))
    return os.path.join(base, "SEL Trip Analyzer", "settings.json")


def load_settings():
    import json
    try:
        with open(settings_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(data):
    import json
    try:
        os.makedirs(os.path.dirname(settings_path()), exist_ok=True)
        with open(settings_path(), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass


def system_prefers_dark():
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as k:
            return winreg.QueryValueEx(k, "AppsUseLightTheme")[0] == 0
    except Exception:
        return False


def set_windows_titlebar(root, dark):
    if sys.platform != "win32":
        return
    try:
        import ctypes
        root.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
        val = ctypes.c_int(1 if dark else 0)
        for attr in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE (new, old builds)
            if ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, attr, ctypes.byref(val), ctypes.sizeof(val)) == 0:
                break
    except Exception:
        pass


def run_gui():
    import threading
    import tkinter as tk
    import tkinter.font as tkfont
    from tkinter import ttk, filedialog, messagebox
    from types import SimpleNamespace

    if sys.platform == "win32":  # crisp text on high-DPI screens
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass

    try:
        from tkinterdnd2 import TkinterDnD, DND_FILES
        root = TkinterDnD.Tk()
        dnd_ok = True
    except Exception:
        root = tk.Tk()
        dnd_ok = False
    try:
        import sv_ttk
    except Exception:
        sv_ttk = None

    cfg = load_settings()
    st = {"dark": cfg.get("dark", system_prefers_dark()), "update": None, "hover": False,
          "placeholder": True, "empty": True, "pal": None}

    root.title(APP_NAME)
    root.geometry(cfg.get("geometry", "1180x920"))
    root.minsize(920, 720)

    # ---- fonts: Segoe UI Variable on Windows 11, sensible fallbacks elsewhere
    fams = set(tkfont.families(root))

    def pick(*names):
        return next((n for n in names if n in fams), tkfont.nametofont("TkDefaultFont").actual("family"))

    UI = pick("Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", "DejaVu Sans", "Inter")
    UI_SEMI = pick("Segoe UI Variable Display Semibold", "Segoe UI Semibold", "Inter Display SemiBold", UI)
    MONO = pick("Cascadia Mono", "Cascadia Code", "Consolas", "JetBrains Mono", "DejaVu Sans Mono")
    F = {
        "body": (UI, 10), "small": (UI, 9), "cap": (UI, 9, "bold"),
        "title": (UI_SEMI, 17, "bold" if UI_SEMI == UI else "normal"),
        "drop": (UI_SEMI, 13, "bold" if UI_SEMI == UI else "normal"),
        "mono": (MONO, 10), "mono_b": (MONO, 10, "bold"), "mono_h": (MONO, 12, "bold"),
    }

    style = ttk.Style(root)

    # ================= layout =================
    root.columnconfigure(0, weight=1)
    root.rowconfigure(4, weight=1)

    # ---- header
    hdr = ttk.Frame(root, padding=(22, 16, 22, 10))
    hdr.grid(row=0, column=0, sticky="ew")
    hdr.columnconfigure(0, weight=1)
    ttk.Label(hdr, text=APP_NAME, style="Title.TLabel").grid(row=0, column=0, sticky="w")
    ttk.Label(hdr, text="Trip-cause summaries from SEL relay event reports and QuickSet settings",
              style="Sub.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 0))
    v_dark = tk.BooleanVar(value=st["dark"])
    dark_sw = ttk.Checkbutton(hdr, text="Dark mode", variable=v_dark,
                              style="Switch.TCheckbutton" if sv_ttk else "TCheckbutton")
    dark_sw.grid(row=0, column=1, rowspan=2, padx=(0, 18))
    upd_btn = ttk.Button(hdr, text="Check for updates")
    upd_btn.grid(row=0, column=2, rowspan=2)

    # ---- drop zone
    drop = tk.Canvas(root, height=122, highlightthickness=0, bd=0, cursor="hand2")
    drop.grid(row=1, column=0, sticky="ew", padx=22, pady=(4, 0))

    # ---- files + comments
    mid = ttk.Frame(root, padding=(22, 16, 22, 0))
    mid.grid(row=2, column=0, sticky="ew")
    mid.columnconfigure(0, weight=1, uniform="mid")
    mid.columnconfigure(1, weight=1, uniform="mid")

    left = ttk.Frame(mid)
    left.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
    left.columnconfigure(0, weight=1)
    ttk.Label(left, text="FILES", style="Cap.TLabel").grid(row=0, column=0, sticky="w")
    count_lbl = ttk.Label(left, text="none loaded", style="Hint.TLabel")
    count_lbl.grid(row=0, column=1, sticky="e")
    lb = tk.Listbox(left, height=6, selectmode="extended", activestyle="none", relief="flat",
                    bd=0, highlightthickness=1, font=F["body"])
    lb.grid(row=1, column=0, columnspan=2, sticky="nsew", pady=(6, 8))
    fb = ttk.Frame(left)
    fb.grid(row=2, column=0, columnspan=2, sticky="w")

    right = ttk.Frame(mid)
    right.grid(row=0, column=1, sticky="nsew", padx=(10, 0))
    right.columnconfigure(0, weight=1)
    right.rowconfigure(1, weight=1)
    ttk.Label(right, text="COMMENTS & SUGGESTIONS", style="Cap.TLabel").grid(row=0, column=0, sticky="w")
    ttk.Label(right, text="added to the top of the summary", style="Hint.TLabel").grid(row=0, column=1, sticky="e")
    comments = tk.Text(right, height=6, wrap="word", relief="flat", bd=0, highlightthickness=1,
                       padx=10, pady=8, font=F["body"], undo=True)
    comments.grid(row=1, column=0, columnspan=2, sticky="nsew", pady=(6, 0))

    # ---- action row
    act = ttk.Frame(root, padding=(22, 14, 22, 8))
    act.grid(row=3, column=0, sticky="ew")
    v_seq, v_set, v_ser = (tk.BooleanVar(value=cfg.get(k, True)) for k in ("seq", "set", "ser"))
    ttk.Label(act, text="Include:", style="Hint.TLabel").pack(side="left", padx=(0, 8))
    for txt, var in (("Element timeline", v_seq), ("Settings context", v_set), ("SER lines", v_ser)):
        ttk.Checkbutton(act, text=txt, variable=var).pack(side="left", padx=(0, 14))
    gen_btn = ttk.Button(act, text="Generate summary", style="Accent.TButton")
    gen_btn.pack(side="right")

    # ---- output
    outf = ttk.Frame(root, padding=(22, 4, 22, 0))
    outf.grid(row=4, column=0, sticky="nsew")
    outf.columnconfigure(0, weight=1)
    outf.rowconfigure(1, weight=1)
    oh = ttk.Frame(outf)
    oh.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 6))
    ttk.Label(oh, text="TRIP SUMMARY", style="Cap.TLabel").pack(side="left")
    ttk.Label(oh, text="  editable", style="Hint.TLabel").pack(side="left")
    save_btn = ttk.Button(oh, text="Save .txt")
    save_btn.pack(side="right")
    copy_btn = ttk.Button(oh, text="Copy all")
    copy_btn.pack(side="right", padx=(0, 8))
    out = tk.Text(outf, wrap="word", undo=True, relief="flat", bd=0, highlightthickness=1,
                  padx=18, pady=14, font=F["mono"], spacing1=1, spacing3=1)
    out.grid(row=1, column=0, sticky="nsew")
    osb = ttk.Scrollbar(outf, orient="vertical", command=out.yview)
    osb.grid(row=1, column=1, sticky="ns", padx=(4, 0))
    out.configure(yscrollcommand=osb.set)

    # ---- feedback on the output
    fbk = ttk.Frame(root, padding=(22, 14, 22, 0))
    fbk.grid(row=5, column=0, sticky="ew")
    fbk.columnconfigure(0, weight=1)
    fh = ttk.Frame(fbk)
    fh.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 6))
    ttk.Label(fh, text="FEEDBACK ON THIS OUTPUT", style="Cap.TLabel").pack(side="left")
    ttk.Label(fh, text="  what was wrong, missing, or should be added?", style="Hint.TLabel").pack(side="left")
    feedback = tk.Text(fbk, height=3, wrap="word", relief="flat", bd=0, highlightthickness=1,
                       padx=10, pady=8, font=F["body"], undo=True)
    feedback.grid(row=1, column=0, sticky="ew")
    fside = ttk.Frame(fbk)
    fside.grid(row=1, column=1, sticky="ns", padx=(12, 0))
    v_attach = tk.BooleanVar(value=False)
    ttk.Checkbutton(fside, text="Attach summary", variable=v_attach).pack(anchor="w")
    send_btn = ttk.Button(fside, text="Send feedback")
    send_btn.pack(fill="x", pady=(8, 0))

    # ---- status bar
    sbar = ttk.Frame(root, padding=(22, 8, 22, 12))
    sbar.grid(row=6, column=0, sticky="ew")
    status = ttk.Label(sbar, text="Ready" + ("" if dnd_ok else "  -  drag-and-drop unavailable, use Add files"),
                       style="Hint.TLabel")
    status.pack(side="left")
    ttk.Label(sbar, text=f"v{VERSION}", style="Hint.TLabel").pack(side="right")

    # ================= theme =================
    def round_rect(c, x1, y1, x2, y2, r, **kw):
        pts = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
               x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
        return c.create_polygon(pts, smooth=True, **kw)

    def draw_drop(_=None):
        pal = st["pal"]
        drop.delete("all")
        drop.configure(bg=pal["bg"])
        w, h = max(drop.winfo_width(), 200), int(drop["height"])
        hov = st["hover"]
        round_rect(drop, 2, 2, w - 2, h - 2, 16, fill=pal["drop_hover"] if hov else pal["drop"],
                   outline=pal["accent"] if hov else pal["drop_line"], dash=(7, 5), width=1.6)
        cx, ic = w // 2, pal["accent"]
        drop.create_line(cx, 18, cx, 42, fill=ic, width=2.4, arrow="last", arrowshape=(9, 10, 5))
        drop.create_line(cx - 15, 36, cx - 15, 47, cx + 15, 47, cx + 15, 36, fill=ic, width=2.4,
                         capstyle="round", joinstyle="round")
        drop.create_text(cx, 72, text="Drop SEL event files or folders here", font=F["drop"], fill=pal["text"])
        drop.create_text(cx, 98, font=F["small"], fill=pal["muted"],
                         text="CEV  ·  EVE  ·  TXT  ·  SUM  ·  HIS  ·  SER  ·  HDR  ·  RDB        or click to browse")

    def style_text(w, pal):
        w.configure(highlightthickness=1, relief="flat", bd=0, bg=pal["surface"], fg=pal["text"], insertbackground=pal["text"],
                    selectbackground=pal["sel"], selectforeground=pal["text"],
                    highlightbackground=pal["border"], highlightcolor=pal["accent"])

    def apply_theme():
        dark = st["dark"]
        pal = st["pal"] = PALETTES["dark" if dark else "light"]
        if sv_ttk:
            sv_ttk.set_theme("dark" if dark else "light")
            if "Segoe UI Variable Text" not in fams:  # off Windows 11: map theme fonts
                for name in ("SunValleyCaptionFont", "SunValleyBodyFont", "SunValleyBodyStrongFont",
                             "SunValleyBodyLargeFont", "SunValleySubtitleFont", "SunValleyTitleFont"):
                    try:
                        tkfont.nametofont(name).configure(family=UI)
                    except Exception:
                        pass
        else:
            style.theme_use("clam")
            style.configure(".", background=pal["bg"], foreground=pal["text"], font=F["body"],
                            bordercolor=pal["border"], focuscolor=pal["accent"])
            style.configure("TButton", background=pal["surface"], padding=(12, 5), relief="flat")
            style.map("TButton", background=[("active", pal["drop_hover"])])
            style.configure("Accent.TButton", background=pal["accent"],
                            foreground="#000000" if dark else "#ffffff")
            style.map("Accent.TButton", background=[("active", pal["accent"])])
            style.configure("TCheckbutton", background=pal["bg"], foreground=pal["text"],
                            indicatorbackground=pal["surface"], indicatorforeground=pal["accent"])
            style.map("TCheckbutton", background=[("active", pal["bg"])])
            style.configure("TScrollbar", background=pal["surface"], troughcolor=pal["bg"],
                            arrowcolor=pal["muted"])
        style.configure("Title.TLabel", font=F["title"], foreground=pal["text"])
        style.configure("Sub.TLabel", font=F["body"], foreground=pal["muted"])
        style.configure("Cap.TLabel", font=F["cap"], foreground=pal["muted"])
        style.configure("Hint.TLabel", font=F["small"], foreground=pal["muted"])
        root.configure(bg=pal["bg"])
        restyle_widgets()
        root.after(60, restyle_widgets)  # the theme re-colours plain Tk widgets on <<ThemeChanged>>
        draw_drop()
        set_windows_titlebar(root, dark)

    def restyle_widgets():
        pal = st["pal"]
        comments.configure(font=F["body"])
        out.configure(font=F["mono"])
        lb.configure(font=F["body"], highlightthickness=1, relief="flat", bd=0)
        style_text(comments, pal)
        style_text(out, pal)
        style_text(feedback, pal)
        feedback.configure(font=F["body"])
        feedback.tag_configure("ph", foreground=pal["muted"])
        lb.configure(bg=pal["surface"], fg=pal["text"], selectbackground=pal["sel"],
                     selectforeground=pal["text"], highlightbackground=pal["border"],
                     highlightcolor=pal["accent"])
        comments.tag_configure("ph", foreground=pal["muted"])
        out.tag_configure("h1", font=F["mono_h"], foreground=pal["text"])
        out.tag_configure("h2", font=F["mono_b"], foreground=pal["accent"])
        out.tag_configure("rule", foreground=pal["border"])
        out.tag_configure("label", foreground=pal["muted"])
        out.tag_configure("trip", font=F["mono_b"], foreground=pal["trip"])
        out.tag_configure("notrip", font=F["mono_b"], foreground=pal["ok"])
        out.tag_configure("bold", font=F["mono_b"])
        out.tag_configure("hint", font=F["body"], foreground=pal["muted"])

    # ================= behaviour =================
    files = []

    def set_status(text):
        status.config(text=text)

    def refresh_list():
        lb.delete(0, "end")
        for p in files:
            lb.insert("end", f"  {os.path.basename(p)}")
        count_lbl.config(text=f"{len(files)} loaded" if files else "none loaded")

    def add_paths(paths):
        known = {os.path.normcase(os.path.abspath(f)) for f in files}
        new = [p for p in expand_paths(paths) if os.path.normcase(os.path.abspath(p)) not in known]
        files.extend(new)
        refresh_list()
        if new:
            generate()
        elif paths:
            set_status("No new SEL files found in what was dropped.")

    def browse(_=None):
        sel = filedialog.askopenfilenames(
            title="Select SEL event / RDB files",
            filetypes=[("SEL event & settings", " ".join("*" + e for e in sorted(ALL_EXTS))),
                       ("All files", "*.*")])
        if sel:
            add_paths(list(sel))

    def browse_folder():
        d = filedialog.askdirectory(title="Select a folder of SEL files")
        if d:
            add_paths([d])

    def remove_sel():
        for i in reversed(lb.curselection()):
            files.pop(i)
        refresh_list()
        if files:
            generate()

    def clear_all():
        files.clear()
        refresh_list()
        show_empty()
        set_status("Cleared")

    def get_comments():
        return "" if st["placeholder"] else comments.get("1.0", "end-1c")

    def show_placeholder():
        if not comments.get("1.0", "end-1c").strip():
            comments.delete("1.0", "end")
            comments.insert("1.0", PLACEHOLDER, "ph")
            st["placeholder"] = True

    def hide_placeholder(_=None):
        if st["placeholder"]:
            comments.delete("1.0", "end")
            st["placeholder"] = False

    def show_empty():
        out.delete("1.0", "end")
        out.insert("1.0", EMPTY_HINT, "hint")
        st["empty"] = True

    def highlight():
        for tag in ("h1", "h2", "rule", "label", "trip", "notrip", "bold"):
            out.tag_remove(tag, "1.0", "end")
        for i, ln in enumerate(out.get("1.0", "end-1c").split("\n"), 1):
            s = ln.strip()
            if not s:
                continue
            if i == 1 and s.startswith("SEL TRIP"):
                out.tag_add("h1", f"{i}.0", f"{i}.end")
            elif re.fullmatch(r"[=\-]{10,}", s):
                out.tag_add("rule", f"{i}.0", f"{i}.end")
            elif ln == s and re.fullmatch(r"[A-Z][A-Z /&()\-]{3,}", s):
                out.tag_add("h2", f"{i}.0", f"{i}.end")
            elif re.match(r"Event \d+ of \d+", ln):
                out.tag_add("bold", f"{i}.0", f"{i}.end")
            elif s.startswith("Probable cause"):
                out.tag_add("bold", f"{i}.0", f"{i}.end")
            else:
                m = re.match(r"^(\s{2}[A-Za-z][A-Za-z ./]{2,12}:)", ln)
                if m:
                    out.tag_add("label", f"{i}.0", f"{i}.{len(m.group(1))}")
            for word, tag in (("TRIP - ", "trip"), ("Relay TRIPPED", "trip"),
                              ("No trip - ", "notrip"), ("No trip recorded", "notrip")):
                k = ln.find(word)
                if k >= 0:
                    out.tag_add(tag, f"{i}.{k}", f"{i}.{k + len(word.rstrip(' -'))}")

    def generate(_=None):
        if not files:
            set_status("Add some files first")
            return
        root.config(cursor="watch")
        root.update_idletasks()
        try:
            events, rdb, errors = load_files(files)
            txt = build_report(events, rdb, errors, files, get_comments(),
                               {"sequence": v_seq.get(), "settings": v_set.get(), "ser": v_ser.get()})
            out.delete("1.0", "end")
            out.insert("1.0", txt)
            st["empty"] = False
            highlight()
            n = len([e for e in events if e.kind != "ser"])
            set_status(f"{n} event{'s' if n != 1 else ''} from {len(files)} file{'s' if len(files) != 1 else ''}"
                       + (f"  -  {len(errors)} could not be read" if errors else ""))
        finally:
            root.config(cursor="")

    def flash(btn, text, original):
        btn.config(text=text)
        root.after(1600, lambda: btn.config(text=original))

    def copy_all(_=None):
        if st["empty"]:
            return
        root.clipboard_clear()
        root.clipboard_append(out.get("1.0", "end-1c"))
        flash(copy_btn, "Copied ✓", "Copy all")
        set_status("Summary copied to clipboard")

    def save_txt():
        if st["empty"]:
            return
        p = filedialog.asksaveasfilename(defaultextension=".txt", initialfile="trip_summary.txt",
                                         filetypes=[("Text", "*.txt"), ("All files", "*.*")])
        if p:
            with open(p, "w", encoding="utf-8") as f:
                f.write(out.get("1.0", "end-1c"))
            flash(save_btn, "Saved ✓", "Save .txt")
            set_status(f"Saved {p}")

    def toggle_dark(_=None):
        if _ is not None:  # keyboard shortcut
            v_dark.set(not v_dark.get())
        st["dark"] = v_dark.get()
        apply_theme()

    # ---- updater
    def run_bg(work, done):
        def worker():
            try:
                res, err = work(), None
            except Exception as e:
                res, err = None, e
            root.after(0, lambda: done(res, err))
        threading.Thread(target=worker, daemon=True).start()

    def show_update_available(info):
        st["update"] = info
        upd_btn.config(text=f"Update to v{info['version']}", style="Accent.TButton")
        set_status(f"Version {info['version']} is available")

    def check_updates(silent=False):
        if "OWNER/" in GITHUB_REPO:
            if not silent:
                messagebox.showinfo("Updates", "No GitHub repository is configured in this build.")
            return
        upd_btn.config(state="disabled")
        if not silent:
            set_status("Checking GitHub for updates...")

        def done(info, err):
            upd_btn.config(state="normal")
            if err:
                if not silent:
                    set_status("Update check failed")
                    messagebox.showerror("Updates", f"Could not reach GitHub:\n{err}")
                return
            if not info:
                if not silent:
                    set_status(f"You're on the latest version (v{VERSION})")
                    messagebox.showinfo("Updates", f"You're up to date (v{VERSION}).")
                return
            show_update_available(info)
            if not silent:
                prompt_update(info)

        run_bg(check_for_update, done)

    def prompt_update(info):
        notes = info["notes"][:1200] or "(no release notes)"
        if messagebox.askyesno(
                "Update available",
                f"Version {info['version']} is available (you have {VERSION}).\n\n"
                f"What's new:\n{notes}\n\nDownload and install it now?\n"
                "The program will restart when finished."):
            do_install(info)

    def do_install(info):
        upd_btn.config(state="disabled")

        def progress(done_b, total):
            msg = (f"Downloading update... {100 * done_b // total}%" if total
                   else f"Downloading update... {done_b // 1024} KB")
            root.after(0, lambda: set_status(msg))

        def done(finish, err):
            upd_btn.config(state="normal")
            if err:
                set_status("Update failed")
                messagebox.showerror("Update failed", str(err))
                return
            set_status("Update installed - restarting...")
            on_close(save_only=True)
            finish()
            root.destroy()

        run_bg(lambda: install_update(info, progress), done)

    def on_update_click():
        if st["update"]:
            prompt_update(st["update"])
        else:
            check_updates(silent=False)

    FEEDBACK_PH = ("e.g. Event 3 was a DTT from the remote end, not a local fault. "
                   "Would be nice to show the breaker number in the quick summary.")
    st["fb_ph"] = False

    def fb_placeholder(show):
        if show and not feedback.get("1.0", "end-1c").strip():
            feedback.delete("1.0", "end")
            feedback.insert("1.0", FEEDBACK_PH, "ph")
            st["fb_ph"] = True
        elif not show and st["fb_ph"]:
            feedback.delete("1.0", "end")
            st["fb_ph"] = False

    def send_feedback():
        import urllib.parse
        import webbrowser
        text = "" if st["fb_ph"] else feedback.get("1.0", "end-1c").strip()
        if not text:
            set_status("Type your feedback first")
            feedback.focus_set()
            return
        summary = "" if st["empty"] else out.get("1.0", "end-1c")
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        # always keep a local copy
        log = os.path.join(os.path.dirname(settings_path()), "feedback.log")
        try:
            os.makedirs(os.path.dirname(log), exist_ok=True)
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"===== {stamp}  v{VERSION}\n{text}\n\n")
        except Exception:
            pass
        exts = sorted({os.path.splitext(p)[1].lower() for p in files})
        body = (f"{text}\n\n---\nApp version: v{VERSION}  \n"
                f"Files loaded: {len(files)} ({', '.join(exts) or 'none'})\n")
        if v_attach.get() and summary:
            room = 6000 - len(urllib.parse.quote(body))
            clip = summary
            while clip and len(urllib.parse.quote(clip)) > room:
                clip = clip[: int(len(clip) * 0.8)]
            body += ("\n<details><summary>Summary output</summary>\n\n```\n" + clip
                     + ("\n... (truncated)" if len(clip) < len(summary) else "") + "\n```\n</details>\n")
        title = "Feedback: " + re.sub(r"\s+", " ", text)[:70]
        if "OWNER/" in GITHUB_REPO:
            messagebox.showinfo("Feedback", f"Saved to {log}")
            return
        if v_attach.get() and summary and not messagebox.askyesno(
                "Attach summary?",
                "Feedback is posted as a public GitHub issue, so anyone can read the attached "
                "summary (relay names, dates, locations).\n\nAttach it anyway?"):
            return
        url = (f"https://github.com/{GITHUB_REPO}/issues/new?"
               + urllib.parse.urlencode({"title": title, "body": body}))
        webbrowser.open(url)
        feedback.delete("1.0", "end")
        st["fb_ph"] = False
        fb_placeholder(True)
        flash(send_btn, "Opened ✓", "Send feedback")
        set_status("Feedback opened on GitHub - click 'Create' there to submit (a copy was saved locally)")

    def on_close(save_only=False):
        save_settings({"dark": st["dark"], "geometry": root.geometry(),
                       "seq": v_seq.get(), "set": v_set.get(), "ser": v_ser.get()})
        if not save_only:
            root.destroy()

    # ---- wiring
    upd_btn.config(command=on_update_click)
    dark_sw.config(command=toggle_dark)
    gen_btn.config(command=generate)
    copy_btn.config(command=copy_all)
    save_btn.config(command=save_txt)
    send_btn.config(command=send_feedback)
    feedback.bind("<FocusIn>", lambda e: fb_placeholder(False))
    feedback.bind("<FocusOut>", lambda e: fb_placeholder(True))
    feedback.bind("<Control-a>", lambda e: (e.widget.tag_add("sel", "1.0", "end"), "break")[1])
    for txt, cmd in (("Add files", browse), ("Add folder", browse_folder),
                     ("Remove", remove_sel), ("Clear", clear_all)):
        ttk.Button(fb, text=txt, command=cmd).pack(side="left", padx=(0, 6))

    drop.bind("<Configure>", draw_drop)
    drop.bind("<Button-1>", browse)
    drop.bind("<Enter>", lambda e: (st.update(hover=True), draw_drop()))
    drop.bind("<Leave>", lambda e: (st.update(hover=False), draw_drop()))
    comments.bind("<FocusIn>", hide_placeholder)
    comments.bind("<FocusOut>", lambda e: show_placeholder())
    lb.bind("<Delete>", lambda e: remove_sel())

    if dnd_ok:
        def on_drop(event):
            st["hover"] = False
            draw_drop()
            add_paths(list(root.tk.splitlist(event.data)))
            return event.action

        def on_enter(event):
            st["hover"] = True
            draw_drop()
            return event.action

        def on_leave(event):
            st["hover"] = False
            draw_drop()
            return event.action

        for w in (drop, lb, out, root):
            w.drop_target_register(DND_FILES)
            w.dnd_bind("<<Drop>>", on_drop)
        drop.dnd_bind("<<DropEnter>>", on_enter)
        drop.dnd_bind("<<DropLeave>>", on_leave)

    def select_all(e):
        e.widget.tag_add("sel", "1.0", "end")
        return "break"

    out.bind("<Control-a>", select_all)
    comments.bind("<Control-a>", select_all)
    root.bind("<Control-o>", browse)
    root.bind("<Control-Return>", generate)
    root.bind("<F5>", generate)
    root.bind("<Control-d>", toggle_dark)
    root.bind("<Control-Shift-C>", copy_all)
    root.protocol("WM_DELETE_WINDOW", on_close)

    apply_theme()
    fb_placeholder(True)
    show_placeholder()
    show_empty()
    refresh_list()

    # hooks used by scripts/screenshots.py
    root.app = SimpleNamespace(add_paths=add_paths, comments=comments, hide_placeholder=hide_placeholder,
                               feedback=feedback, fb_placeholder=fb_placeholder,
                               generate=generate, toggle_dark=toggle_dark, v_dark=v_dark,
                               show_update_available=show_update_available)

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:  # files dropped onto the .exe icon
        root.after(150, lambda: add_paths(args))
    if os.environ.get("SEL_TRIP_NO_UPDATE_CHECK") != "1":
        root.after(1500, lambda: check_updates(silent=True))
    root.mainloop()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--cli":
        paths = expand_paths(sys.argv[2:])
        ev, rdb, err = load_files(paths)
        print(build_report(ev, rdb, err, paths))
    else:
        run_gui()
