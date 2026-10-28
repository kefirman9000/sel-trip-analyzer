"""The browser version (web/core.js) must produce exactly the same report as
sel_trip_analyzer.py. Runs both on the sample files plus edge cases and diffs.

Needs Node.js on PATH (skipped otherwise) and olefile (for .rdb files).
"""
import datetime as dt
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import sel_trip_analyzer as app  # noqa: E402

SAMPLES = os.path.join(ROOT, "sample_files")
NODE = shutil.which("node")


def python_report(paths, comments="", opts=None, fmt="text"):
    paths = app.expand_paths(paths)
    events, rdb, err = app.load_files(paths)
    if fmt == "csv":
        return app.report_csv(events, rdb, opts)
    text = app.build_report(events, rdb, err, paths, comments, opts)
    return "\n".join("Generated: X" if ln.startswith("Generated: ") else ln for ln in text.split("\n"))


def js_report(paths, comments="", opts=None, fmt="text"):
    flags = []
    for k, v in (opts or {}).items():
        flags += ["--hide-duplicates"] if k == "hide_duplicates" and v else ["--" + k, v] if v and k != "hide_duplicates" else []
    out = subprocess.run([NODE, os.path.join(ROOT, "web", "cli.js"), "--now", "X", "--comments", comments,
                          "--format", fmt] + flags + paths,
                         capture_output=True, check=True)
    text = out.stdout.decode("utf-8")
    return text if fmt == "csv" else text.replace("\r\n", "\n").rstrip("\n")


def load_make_samples():
    spec = importlib.util.spec_from_file_location("make_samples", os.path.join(ROOT, "scripts", "make_samples.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@unittest.skipIf(NODE is None, "node not installed")
@unittest.skipIf(app.olefile is None, "olefile not installed")
class WebParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        ms = load_make_samples()
        ms.OUT = cls.tmp
        def S(n):
            return os.path.join(SAMPLES, n)

        # 8 samples/cycle: cycle times like 4.125 hit Python's round-half-even
        ms.cev("Edge_8spc.cev", fid=ms.FID_351, when=dt.datetime(2026, 9, 1, 1, 2, 3, 4000),
               event="CA T", location="6.66", shot=2, targets="TIME ZONE2 C A", freq=50.02, sam=8, trig=33,
               currents={"IA": (ms.LOAD["IA"], ms.LOAD["IA"] + ms.P(1900, 10)), "IB": (ms.LOAD["IB"], ms.LOAD["IB"]),
                         "IC": (ms.LOAD["IC"], ms.LOAD["IC"] - ms.P(1900, 10))},
               vfault=(40.0, 66.0, 41.0), open_row=70,
               names="M2P M2PT Z2G TRIP OUT101 52A 79CY SV1".split(),
               timeline={"M2P": (33, 72), "M2PT": (37, 72), "TRIP": (37, 74), "OUT101": (37, 74),
                         "52A": (0, 70), "SV1": (0, None)},
               settings=["RID     =EDGE RELAY", "TR      =M1P + M2PT + NOT 50P1", "LL      =7.00"])
        # no trigger, no breaker in record, no settings
        ms.cev("Edge_notrig.cev", fid=ms.FID_351, when=dt.datetime(2026, 9, 2, 3, 4, 5, 0),
               event="ER", location="$$$$$", shot=0, targets="", freq=60.0, trig=10**6,
               currents={"IA": (ms.LOAD["IA"], ms.LOAD["IA"]), "IB": (ms.LOAD["IB"], ms.LOAD["IB"]),
                         "IC": (ms.LOAD["IC"], ms.LOAD["IC"])},
               names="51P TRIP".split(), timeline={"51P": (5, 9)}, settings=[])
        with open(os.path.join(cls.tmp, "Edge_notrig.cev"), encoding="latin-1") as f:
            assert '">"' not in f.read()

        # LF line endings instead of CRLF
        for n in ("Feeder3_CG_51G.eve", "Feeder12_history.his"):
            with open(S(n), "rb") as f:
                data = f.read().replace(b"\r\n", b"\n")
            with open(os.path.join(cls.tmp, "LF_" + n), "wb") as f:
                f.write(data)

        # several events in one text capture, header only on the first
        with open(os.path.join(cls.tmp, "Multi.txt"), "w", newline="\r\n") as f:
            f.write("=>SUM\nFEEDER 22                                Date: 08/14/26    Time: 09:00:00.000\nNORTH SUB\n\n"
                    "Event: BCG T      Location: 3.10    Shot:  0  Frequency: 60.00\nTargets: INST 50 B C G\n"
                    "Currents (A Pri), ABCNGQ:   250  3100  3050  9  1900  2100\n\n"
                    "Event: AB      Location: 1.20    Shot:  1  Frequency: 59.20\nTargets: ZONE1 A\n\n"
                    "Event: XYZ T      Location: abc\n")

        # settings files: raw text (scan), zipped, UTF-16, and one matching nothing
        with open(os.path.join(cls.tmp, "Scan.rdb"), "wb") as f:
            f.write(b"\x01\x02junk\x00RID     =FEEDER 22\r\nLL      =4.00\r\nTR      =50P1 + Z1G\r\n\xff\xfe")
        with zipfile.ZipFile(os.path.join(cls.tmp, "Zipped.rdb"), "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("LINE 5/Group 1.txt", "RID     =LINE 5\r\nLL      =10.50\r\nTR      =M1P OR Z1G OR M2PT\r\n")
            z.writestr("LINE 5/Global.txt", "TID     =RIVER SUB\r\nCTR     =400\r\n")
        with open(os.path.join(cls.tmp, "Utf16.rdb"), "wb") as f:
            f.write("RID     =FEEDER 14\r\nTR      =81D1T + 81D2T\r\nLL      =3.00\r\n".encode("utf-16"))
        with open(os.path.join(cls.tmp, "Other.rdb"), "wb") as f:
            f.write(b"RID     =SOMEWHERE ELSE\nTR      =Z1G\n")
        with open(os.path.join(cls.tmp, "junk.txt"), "w") as f:
            f.write("hello, this is not a relay file\n")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def check(self, *names, comments="", opts=None, fmt="text"):
        paths = [n if os.path.isabs(n) else (os.path.join(self.tmp, n) if os.path.exists(os.path.join(self.tmp, n))
                                             else os.path.join(SAMPLES, n)) for n in names]
        py, js = python_report(paths, comments, opts, fmt), js_report(paths, comments, opts, fmt)
        if py != js:
            import difflib
            diff = "\n".join(difflib.unified_diff(py.split("\n"), js.split("\n"), "python", "javascript", lineterm=""))
            self.fail("browser version differs from Python:\n" + diff[:6000])

    def test_full_sample_folder(self):
        self.check(SAMPLES, comments="Crew found a cracked insulator.\nSecond line.")

    def test_each_sample_alone(self):
        for n in sorted(os.listdir(SAMPLES)):
            if not n.startswith("README"):
                with self.subTest(file=n):
                    self.check(n)

    def test_combinations(self):
        self.check("Feeder12_history.his", "Feeder12_AG_Zone1.cev", "Feeder12_settings.rdb")
        self.check("Feeder14_underfrequency.txt", "Feeder12_settings.rdb")    # settings assumed
        self.check("Feeder3_CG_51G.eve", "Other.rdb")                         # settings mismatch

    def test_view_options(self):
        combos = [
            {"show": "trips"}, {"show": "review", "sort": "review"}, {"show": "faults", "sort": "relay"},
            {"show": "notrip"}, {"sort": "newest"}, {"hide_duplicates": True},
            {"relay": "FEEDER 12", "sort": "newest", "hide_duplicates": True, "search": "zone", "detail": "standard"},
            {"relay": "line 5"}, {"search": "check"}, {"search": "no such text"}, {"detail": "summary"},
            {"detail": "standard", "show": "review"},
        ]
        for opts in combos:
            with self.subTest(opts=opts):
                self.check(SAMPLES, opts=opts)
        self.check(self.tmp, opts={"sort": "review", "detail": "standard"})

    def test_csv(self):
        for opts in ({}, {"show": "review", "sort": "newest", "hide_duplicates": True}, {"relay": "FEEDER 12"}):
            with self.subTest(opts=opts):
                self.check(SAMPLES, opts=opts, fmt="csv")
        self.check(self.tmp, fmt="csv")

    def test_edge_cases(self):
        self.check("Edge_8spc.cev")
        self.check("Edge_notrig.cev")
        self.check("LF_Feeder3_CG_51G.eve", "LF_Feeder12_history.his")
        self.check("Multi.txt", "Scan.rdb")
        self.check("Line5_ABC_Zone1.hdr", "Line5_BC_Zone2_POTT.cev", "Zipped.rdb")
        self.check("Feeder14_underfrequency.txt", "Utf16.rdb")
        self.check("junk.txt")
        self.check("Feeder12_settings.rdb")                                   # settings only
        self.check(self.tmp)                                                  # whole edge folder


if __name__ == "__main__":
    unittest.main()
