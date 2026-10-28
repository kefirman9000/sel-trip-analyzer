"""Generate the sample files in sample_files/ (and SEL_sample_files.zip).

    python scripts/make_samples.py

These are synthetic events written in SEL's file formats so people can try
the program and so the tests have known answers. Relay names, stations and
numbers are made up. Each scenario is described in sample_files/README.txt.
"""
import datetime as dt
import math
import os
import struct
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sample_files")
FID_351 = "SEL-351-5-R514-V0-Z105104-D20111020"
FID_421 = "SEL-421-5-R325-V0-Z024016-D20220318"


# --------------------------------------------------------------------------
# CEV (compressed event report)
# --------------------------------------------------------------------------
def checksum_line(fields):
    """SEL CEV lines end with a 4-hex-digit checksum of the bytes before it."""
    body = ",".join(fields) + ","
    return body + '"%04X"' % (sum(body.encode("ascii")) & 0xFFFF)


def P(mag, ang):
    """Phasor from magnitude (A rms) and angle (degrees)."""
    return complex(mag * math.cos(math.radians(ang)), mag * math.sin(math.radians(ang)))


LOAD = {"IA": P(200, 0), "IB": P(200, -120), "IC": P(200, 120)}


def q(x):
    return f'"{x}"'


def wave(z, th, t_fault, faulted, dc=True, tau=2.5, h5=0.0):
    """Instantaneous value of phasor z at angle th; adds a decaying DC offset from fault inception."""
    v = abs(z) * math.sqrt(2) * math.cos(th + math.atan2(z.imag, z.real))
    if h5:
        v += h5 * abs(z) * math.sqrt(2) * math.cos(5 * th)
    if faulted and dc and t_fault is not None:
        v -= abs(z) * math.sqrt(2) * math.cos(math.atan2(z.imag, z.real) + t_fault[1]) * math.exp(-t_fault[0] / tau) * 0.6
    return v


def cev(name, *, fid, when, event, location, shot, targets, freq, sam=16, ncyc=15, trig=16,
        currents, open_row=None, vfault=(67.0, 67.0, 67.0), vpre=67.0, names, timeline, settings):
    """currents: {"IA": (prefault_phasor, fault_phasor), ...} in primary amps rms.
    trig / open_row / timeline rows are given in quarter cycles (4 per cycle) and scaled to `sam`.
    timeline: {element: (on_row, off_row_or_None)}; on_row 0 = already asserted."""
    sc = sam // 4
    trig *= sc
    open_row = open_row * sc if open_row is not None else None
    timeline = {k: (a * sc, b * sc if b is not None else None) for k, (a, b) in timeline.items()}
    lines = [checksum_line([q("FID"), q("FID=" + fid)]),
             checksum_line([q(x) for x in ("MONTH", "DAY", "YEAR", "HOUR", "MIN", "SEC", "MSEC")]),
             checksum_line([str(v) for v in (when.month, when.day, when.year, when.hour, when.minute,
                                             when.second, when.microsecond // 1000)]),
             checksum_line([q(x) for x in ("FREQ", "SAM/CYC_A", "SAM/CYC_D", "NUM_OF_CYC", "EVENT",
                                           "LOCATION", "SHOT", "TARGETS")]),
             checksum_line([f"{freq:.2f}", str(sam), str(sam), str(ncyc), q(event),
                            location if not location.startswith("$") else q(location), str(shot), q(targets)])]
    pad = (-len(names)) % 4
    allnames = names + ["*"] * pad
    lines.append(checksum_line([q(x) for x in ("IA", "IB", "IC", "IG", "VA(kV)", "VB(kV)", "VC(kV)", "TRIG")]
                               + [q(" ".join(allnames))]))
    rows = ncyc * sam
    for k in range(rows):
        th = 2 * math.pi * k / sam
        faulted = k >= trig and (open_row is None or k < open_row)
        opened = open_row is not None and k >= open_row
        tf = ((k - trig) / sam, 2 * math.pi * trig / sam) if faulted else None
        inst = {}
        for ph, (pre, flt) in currents.items():
            z = flt if faulted else 0j if opened else pre
            inst[ph] = wave(z, th, tf, faulted and abs(flt - pre) > 1, h5=0.03 if not faulted else 0.0)
        ig = inst["IA"] + inst["IB"] + inst["IC"]
        volts = []
        for i, base in enumerate((0, -120, 120)):
            mag = vfault[i] if faulted else vpre
            volts.append(mag * math.sqrt(2) * math.cos(th + math.radians(base)))
        bits = "".join("1" if (el in timeline and timeline[el][0] <= k and
                               (timeline[el][1] is None or k < timeline[el][1])) else "0" for el in allnames)
        hexs = "".join("%X" % int(bits[i:i + 4], 2) for i in range(0, len(bits), 4))
        lines.append(checksum_line([f"{inst['IA']:.1f}", f"{inst['IB']:.1f}", f"{inst['IC']:.1f}", f"{ig:.1f}"]
                                   + [f"{v:.2f}" for v in volts]
                                   + [q(">") if k == trig else q(""), q(hexs)]))
    lines.append(checksum_line([q("SETTINGS")]))
    lines += [checksum_line([q(s)]) for s in settings]
    write(name, "\n".join(lines) + "\n")


# --------------------------------------------------------------------------
# RDB (QuickSet relay database): a real OLE compound file holding settings text
# --------------------------------------------------------------------------
def ole_file(path, storage, streams):
    """Minimal OLE/CFB v3 writer: one storage containing a few streams (each
    padded to >= 4096 bytes so no mini-stream is needed)."""
    SEC = 512
    FREE, END, FATSECT = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
    datas = []
    for name, text in streams:
        b = text.encode("latin-1")
        b += b"\x00" * max(0, 4096 - len(b))
        datas.append((name, b))
    # layout: sector 0 = FAT, sector 1 = directory, then stream data
    fat = [FATSECT, END]
    starts, nxt = [], 2
    for _, b in datas:
        n = math.ceil(len(b) / SEC)
        starts.append(nxt)
        fat += [nxt + i + 1 for i in range(n - 1)] + [END]
        nxt += n
    assert len(fat) <= SEC // 4
    fat += [FREE] * (SEC // 4 - len(fat))

    def entry(name, typ, child=FREE, left=FREE, right=FREE, start=END, size=0):
        nm = name.encode("utf-16-le") + b"\x00\x00"
        return (nm.ljust(64, b"\x00") + struct.pack("<HBB", len(nm), typ, 1)
                + struct.pack("<III", left, right, child) + b"\x00" * 16 + struct.pack("<I", 0)
                + b"\x00" * 16 + struct.pack("<IIi", start, size, 0))

    # 0 root -> 1 storage -> streams 2.. chained as right siblings
    ents = [entry("Root Entry", 5, child=1), entry(storage, 1, child=2)]
    for i, ((name, b), st) in enumerate(zip(datas, starts)):
        right = 3 + i if i + 1 < len(datas) else FREE
        ents.append(entry(name, 2, right=right, start=st, size=len(b)))
    assert len(ents) <= 4
    while len(ents) < 4:
        ents.append(b"\x00" * 64 + struct.pack("<HBB", 0, 0, 0) + struct.pack("<III", FREE, FREE, FREE)
                    + b"\x00" * 36 + struct.pack("<IIi", 0, 0, 0))
    header = (bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 16
              + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\x00" * 6
              + struct.pack("<IIIIIIIII", 0, 1, 1, 0, 4096, END, 0, END, 0)
              + struct.pack("<I", 0) + struct.pack("<I", FREE) * 108)
    assert len(header) == SEC
    body = header + struct.pack("<128I", *fat) + b"".join(ents)
    for _, b in datas:
        body += b + b"\x00" * ((-len(b)) % SEC)
    with open(path, "wb") as f:
        f.write(body)


def comtrade(base, *, station, device, start, trigger_offset_cyc, sam, ncyc, freq, analogs, digitals):
    """IEEE C37.111-1999 ASCII COMTRADE (.cfg + .dat).
    analogs: [(name, phase, unit, a_scale, primary, secondary, fn(k) -> value)] ; digitals: [(name, fn(k) -> 0/1)]."""
    n = ncyc * sam
    rate = freq * sam
    trig_time = start + dt.timedelta(seconds=trigger_offset_cyc / freq)
    fmt = lambda t: t.strftime("%d/%m/%Y,%H:%M:%S.%f")  # noqa: E731
    cfg = [f"{station},{device},1999", f"{len(analogs) + len(digitals)},{len(analogs)}A,{len(digitals)}D"]
    for i, (name, ph, unit, a, pri, sec, _) in enumerate(analogs, 1):
        cfg.append(f"{i},{name},{ph},,{unit},{a:g},0,0,-32767,32767,{pri:g},{sec:g},P")
    for i, (name, fn) in enumerate(digitals, 1):
        cfg.append(f"{i},{name},,,{fn(0)}")
    cfg += [f"{freq:g}", "1", f"{rate:g},{n}", fmt(start), fmt(trig_time), "ASCII", "1"]
    dat = []
    for k in range(n):
        vals = [str(int(round(fn(k) / a))) for (_, _, _, a, _, _, fn) in analogs]
        dat.append(",".join([str(k + 1), str(int(round(k * 1e6 / rate)))] + vals + [str(fn(k)) for _, fn in digitals]))
    write(base + ".cfg", "\n".join(cfg) + "\n")
    write(base + ".dat", "\n".join(dat) + "\n")


def write(name, text):
    with open(os.path.join(OUT, name), "w", newline="\r\n") as f:
        f.write(text)


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------
F12_SETTINGS = ["RID     =FEEDER 12                      TID     =APEX SUB",
                "CTR     =240       PTR     =600.00    LL      =10.00",
                "Z1MAG   =4.62      Z1ANG   =78.40     Z1P     =3.70      Z1MG    =3.70",
                "50P1P   =12.00     50G1P   =6.00      51GP    =1.20      51GC    =U3",
                "51GTD   =3.00      51PP    =2.50      51PC    =U3        51PTD   =2.00",
                "TR      =M1P + Z1G + M2PT + Z2GT + 51GT + 50P1",
                "ER      =/51G + /51P + /M2P + /Z2G"]


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))

    # 1) Clean single-line-to-ground fault, Zone 1, everything consistent
    cev("Feeder12_AG_Zone1.cev", fid=FID_351, when=dt.datetime(2026, 10, 27, 14, 3, 22, 417000),
        event="AG T", location="4.21", shot=0, targets="INST ZONE1 A G", freq=60.00,
        currents={"IA": (LOAD["IA"], LOAD["IA"] + P(2400, -78)), "IB": (LOAD["IB"], LOAD["IB"]),
                  "IC": (LOAD["IC"], LOAD["IC"])},
        vfault=(18.4, 66.1, 65.8), open_row=30,
        names="Z1G Z2G M1P M2P 50P1 51G 51GT TRIP OUT101 52A IN101 79RS".split(),
        timeline={"51G": (16, 31), "Z1G": (17, 31), "Z2G": (16, 31), "TRIP": (17, 33), "OUT101": (17, 33),
                  "52A": (0, 30), "IN101": (0, 30), "79RS": (0, 17)},
        settings=F12_SETTINGS)

    # 2) Line, B-C fault near the far end, Zone 2 sped up by POTT (comm-assisted)
    cev("Line5_BC_Zone2_POTT.cev", fid=FID_421, when=dt.datetime(2026, 10, 22, 9, 41, 17, 502000),
        event="BC T", location="9.80", shot=0, targets="COMM ZONE2 B C", freq=59.98,
        currents={"IA": (2 * LOAD["IA"], 2 * LOAD["IA"]), "IB": (2 * LOAD["IB"], 2 * LOAD["IB"] + P(2850, -165)),
                  "IC": (2 * LOAD["IC"], 2 * LOAD["IC"] - P(2850, -165))},
        vfault=(66.5, 41.0, 40.2), open_row=29,
        names="M1P M2P Z1G Z2G M2PT KEY PTRX TRIP OUT102 52AA1 IN201".split(),
        timeline={"M2P": (16, 30), "KEY": (16, 30), "PTRX": (18, 31), "TRIP": (18, 32), "OUT102": (18, 32),
                  "52AA1": (0, 29), "IN201": (0, 29)},
        settings=["RID      := LINE 5", "TID      := RIVER SUB", "LL       := 10.50",
                  "CTR      := 400", "PTR      := 1200", "TR       := M1P OR Z1G OR M2PT OR Z2GT",
                  "TRCOMM   := M2P OR Z2G", "ECOMM    := POTT"])

    # 3) Deliberately inconsistent record - the review flags should catch it
    cev("Feeder9_AG_needs_review.cev", fid=FID_351, when=dt.datetime(2026, 10, 18, 22, 7, 51, 90000),
        event="AG T", location="11.60", shot=0, targets="INST 50 B", freq=60.01,
        currents={"IA": (1.5 * LOAD["IA"], 1.5 * LOAD["IA"]), "IB": (1.5 * LOAD["IB"], 1.5 * LOAD["IB"] + P(3600, -195)),
                  "IC": (1.5 * LOAD["IC"], 1.5 * LOAD["IC"])},
        vfault=(64.0, 22.0, 63.0), open_row=49,
        names="Z1G M1P 50P1 51G 51GT TRIP OUT101 52A".split(),
        timeline={"50P1": (16, 50), "51G": (16, 50), "TRIP": (17, 52), "OUT101": (17, 52), "52A": (0, 49)},
        settings=["RID     =FEEDER 9                       TID     =MILL ROAD SUB",
                  "CTR     =240       PTR     =600.00    LL      =10.00",
                  "TR      =M1P + Z1G + 51GT + 50P1"])

    # 2b) The other end of LINE 5 (HILL SUB) for the same fault: close-in, Zone 1
    cev("Line5_Hill_BC_Zone1.cev", fid=FID_421, when=dt.datetime(2026, 10, 22, 9, 41, 17, 506000),
        event="BC T", location="0.70", shot=0, targets="INST ZONE1 B C", freq=59.98,
        currents={"IA": (2 * LOAD["IA"], 2 * LOAD["IA"]), "IB": (2 * LOAD["IB"], 2 * LOAD["IB"] + P(6200, -168)),
                  "IC": (2 * LOAD["IC"], 2 * LOAD["IC"] - P(6200, -168))},
        vfault=(66.8, 14.0, 13.6), open_row=27,
        names="M1P M2P Z1G Z2G M2PT KEY PTRX TRIP OUT101 52AA1 IN201".split(),
        timeline={"M1P": (16, 28), "M2P": (16, 28), "KEY": (16, 29), "TRIP": (17, 30), "OUT101": (17, 30),
                  "52AA1": (0, 27), "IN201": (0, 27)},
        settings=["RID      := LINE 5 HILL", "TID      := HILL SUB", "LL       := 10.50",
                  "CTR      := 400", "PTR      := 1200", "TR       := M1P OR Z1G OR M2PT OR Z2GT",
                  "TRCOMM   := M2P OR Z2G", "ECOMM    := POTT"])

    # 4) Text event report (EVE) - time-overcurrent ground fault
    write("Feeder3_CG_51G.eve", """\
FEEDER 3                                 Date: 10/21/26    Time: 14:22:05.118
OAK HILL SUB

FID=SEL-351-5-R514-V0-Z105104-D20111020                       CID=0xA61F

                Currents (Amps Pri)                     Voltages (kV Pri)
      IA      IB      IC      IN      IG     3I2     VA      VB      VC
[1]
     212    -105    -108       4      -1       2    93.9   -46.8   -47.1
     -16    -182     198       4       0       3    -4.7   -81.6    86.3
    -210     104     110       4       4       2   -94.0    46.6    47.4
      15     184    -196       4       3       3     4.5    81.8   -86.1
[2]>
     208    -101    1488       5    1595    1022    92.8   -46.0    21.4
     -19    -187    -2391      6   -2597    1601    -4.3   -80.9   -38.0
    -205     100    -1490      5   -1595    1020   -92.9    45.8   -21.5
      18     186    2390       5    2594    1599     4.2    81.0    38.1

Event: CG T    Location: 2.85    Shot:  0   Frequency: 60.01
Targets: TIME 51 C G
Currents (A Pri), ABCNGQ:   214   219  1872     6  1859   1246
""")

    # 5) COMTRADE header written by a SEL-421 for a three-phase fault
    write("Line5_ABC_Zone1.hdr", """\
LINE 5                                   Date: 10/25/2026  Time: 18:16:40.233
RIVER SUB                                Serial Number: 1182730042

FID=SEL-421-5-R325-V0-Z024016-D20220318

Event: ABC T        Location: 1.90      Time Source: IRIG
Event Number: 10045    Shot 1P: 0    Shot 3P: 0    Freq: 59.96    Group: 1
Targets: TRIP Z1 INST A B C
Breaker 1: CLOSED to OPEN    Trip Time: 18:16:40.249
Currents (A Pri), ABCNGQ:  6120  6085  6142    40    52    61
""")

    # 6) Event summary (SUM) - transfer trip received, no local fault
    write("Feeder7_transfer_trip.sum", """\
FEEDER 7                                 Date: 10/26/26    Time: 08:14:02.113
APEX SUB

Event: TRIP      Location: $$$$$    Shot:  1  Frequency: 59.98
Targets: COMM
Currents (A Pri), ABCNGQ:   210  205  198  12  10  4
""")

    # 7) Plain .txt capture - underfrequency load shed
    write("Feeder14_underfrequency.txt", """\
=>SUM
FEEDER 14                                Date: 10/23/26    Time: 17:52:31.604
WEST SUB

Event: TRIP      Location: $$$$$    Shot:  0  Frequency: 58.85
Targets: 81
Currents (A Pri), ABCNGQ:   182  176  185   9   8   3
""")

    # 8) Event history (HIS) for Feeder 12 - includes the CEV event above
    write("Feeder12_history.his", """\
FEEDER 12                                Date: 10/28/26    Time: 07:30:02.551
APEX SUB

#    DATE      TIME          EVENT    LOCAT   CURR   FREQ  GRP  SHOT  TARGETS
1  10/27/26  14:03:22.417   AG T      4.21   2541  60.00   1    0   INST ZONE1 A G
2  10/19/26  03:12:47.090   ABC T    12.80   4120  59.99   1    0   INST ZONE2 A B C
3  10/11/26  16:45:09.334   CG T     -1.30   1890  60.01   1    1   TIME 51 C G
4  09/30/26  11:02:15.870   ER      $$$$$      95  60.00   1    0
""")

    # 9) Sequential events recorder (SER) for the Feeder 12 fault
    write("Feeder12.ser", """\
FEEDER 12                                Date: 10/28/26    Time: 07:31:10.002
APEX SUB

FID=SEL-351-5-R514-V0-Z105104-D20111020

#     DATE       TIME             ELEMENT          STATE
9   10/27/26   14:03:22.417     51G              Asserted
8   10/27/26   14:03:22.417     Z2G              Asserted
7   10/27/26   14:03:22.421     Z1G              Asserted
6   10/27/26   14:03:22.421     TRIP             Asserted
5   10/27/26   14:03:22.421     OUT101           Asserted
4   10/27/26   14:03:22.475     52A              Deasserted
3   10/27/26   14:03:22.479     Z1G              Deasserted
2   10/27/26   14:03:22.488     TRIP             Deasserted
1   10/27/26   14:03:22.900     79CY             Asserted
""")

    # 9b) Storm: Feeder 8 trips twice a minute after Feeder 3 (reclose, then lockout)
    write("Feeder8_storm.sum", """\
FEEDER 8                                 Date: 10/21/26    Time: 14:23:10.240
OAK HILL SUB

Event: BG T      Location: 3.40    Shot:  0  Frequency: 60.00
Targets: TIME 51 B G
Currents (A Pri), ABCNGQ:   230  1410  225  4  1180  790

FEEDER 8                                 Date: 10/21/26    Time: 14:23:16.880
OAK HILL SUB

Event: BG T      Location: 3.38    Shot:  1  Frequency: 60.00
Targets: TIME 51 B G LO
Currents (A Pri), ABCNGQ:   228  1395  221  4  1172  781
""")

    # 9c) COMTRADE record of the Feeder 3 fault (32 samples/cycle), cleared by 51G after its U3 delay
    sam, f0, inception, n_cyc = 32, 60.0, 6.5, 32
    trip_cyc = inception + 19.45            # 51G U3, TD 2.00, M = 7.75 -> 0.324 s
    open_cyc = trip_cyc + 3.0
    pre = {"A": P(212, -25), "B": P(219, -145), "C": P(214, 95)}
    flt = {"A": pre["A"], "B": pre["B"], "C": P(1872, 22)}
    def cyc(k): return k / sam
    def state(k):
        c = cyc(k)
        return "pre" if c < inception else "fault" if c < open_cyc else "open"
    tf0 = 2 * math.pi * inception
    def cur(ph):
        def fn(k):
            st, th = state(k), 2 * math.pi * cyc(k)
            if st == "open":
                return 0.0
            z = flt[ph] if st == "fault" else pre[ph]
            return wave(z, th, (cyc(k) - inception, tf0) if st == "fault" else None,
                        st == "fault" and ph == "C", h5=0.03 if st == "pre" else 0.0)
        return fn
    def ig(k): return cur("A")(k) + cur("B")(k) + cur("C")(k)
    def volt(ph, base, sag):
        def fn(k):
            st, th = state(k), 2 * math.pi * cyc(k)
            mag = sag if st == "fault" else 0.0 if st == "open" else 67.0
            return mag * math.sqrt(2) * math.cos(th + math.radians(base))
        return fn
    on = lambda a, b=None: (lambda k: 1 if a <= cyc(k) and (b is None or cyc(k) < b) else 0)  # noqa: E731
    comtrade("Feeder3_CG_51G", station="OAK HILL SUB", device="FEEDER 3",
             start=dt.datetime(2026, 10, 21, 14, 22, 5, 118000) - dt.timedelta(seconds=inception / f0),
             trigger_offset_cyc=inception, sam=sam, ncyc=n_cyc, freq=f0,
             analogs=[("IA", "A", "A", 0.2, 240, 1, cur("A")), ("IB", "B", "A", 0.2, 240, 1, cur("B")),
                      ("IC", "C", "A", 0.2, 240, 1, cur("C")), ("IG", "N", "A", 0.2, 240, 1, ig),
                      ("VA", "A", "kV", 0.005, 600, 1, volt("A", 0, 66.4)), ("VB", "B", "kV", 0.005, 600, 1, volt("B", -120, 66.1)),
                      ("VC", "C", "kV", 0.005, 600, 1, volt("C", 120, 25.0))],
             digitals=[("51G", on(inception, open_cyc + 0.5)), ("51GT", on(trip_cyc, open_cyc + 0.5)),
                       ("TRIP", on(trip_cyc, open_cyc + 1.5)), ("OUT101", on(trip_cyc, open_cyc + 1.5)),
                       ("52A", on(0, open_cyc)), ("IN101", on(0, open_cyc))])
    # 9d) COMTRADE from a different maker's relay (generic channel names): B-to-ground fault,
    #     ground instantaneous overcurrent trips after 1.5 cycles, breaker clears 3 cycles later
    sam, f0, inception, n_cyc = 32, 60.0, 3.0, 14
    trip_cyc = inception + 1.5
    open_cyc = trip_cyc + 3.0
    pre = {"A": P(305, -28), "B": P(298, -148), "C": P(301, 92)}
    flt = {"A": pre["A"], "B": P(3420, -205), "C": pre["C"]}
    def state22(k):
        c = k / sam
        return "pre" if c < inception else "fault" if c < open_cyc else "open"
    tf0 = 2 * math.pi * inception
    def cur22(ph):
        def fn(k):
            st, th = state22(k), 2 * math.pi * k / sam
            if st == "open":
                return 0.0
            z = flt[ph] if st == "fault" else pre[ph]
            return wave(z, th, (k / sam - inception, tf0) if st == "fault" else None, st == "fault" and ph == "B")
        return fn
    def volt22(ph, base, sag):
        def fn(k):
            st = state22(k)
            mag = sag if st == "fault" else 0.0 if st == "open" else 66.4
            return mag * math.sqrt(2) * math.cos(2 * math.pi * k / sam + math.radians(base))
        return fn
    on22 = lambda a, b=None: (lambda k: 1 if a <= k / sam and (b is None or k / sam < b) else 0)  # noqa: E731
    comtrade("Line22_other_maker", station="NORTH STN", device="LINE 22",
             start=dt.datetime(2026, 10, 24, 6, 12, 40, 250000) - dt.timedelta(seconds=inception / f0),
             trigger_offset_cyc=inception, sam=sam, ncyc=n_cyc, freq=f0,
             analogs=[("Line Ia", "A", "A", 0.2, 600, 5, cur22("A")), ("Line Ib", "B", "A", 0.2, 600, 5, cur22("B")),
                      ("Line Ic", "C", "A", 0.2, 600, 5, cur22("C")),
                      ("Bus Va", "A", "kV", 0.005, 1, 1, volt22("A", 0, 64.0)), ("Bus Vb", "B", "kV", 0.005, 1, 1, volt22("B", -120, 21.5)),
                      ("Bus Vc", "C", "kV", 0.005, 1, 1, volt22("C", 120, 65.2))],
             digitals=[("GND IOC1 OP", on22(trip_cyc, open_cyc + 0.25)), ("PH TOC1 PKP", on22(inception + 0.25, open_cyc + 0.25)),
                       ("TRIP BUS 1 OP", on22(trip_cyc, open_cyc + 1.0)), ("BKR 1 CLOSED", on22(0, open_cyc))])
    ole_file(os.path.join(OUT, "Feeder3_settings.rdb"), "FEEDER 3", [
        ("Global", "SID     =OAK HILL SUB\r\nRID     =FEEDER 3\r\nTID     =OAK HILL SUB\r\n"),
        ("Group 1", "RID     =FEEDER 3                       TID     =OAK HILL SUB\r\n"
                    "CTR     =240       PTR     =600.00    LL      =8.00\r\n"
                    "50P1P   =20.00     50G1P   =15.00     51GP    =1.00      51GC    =U3\r\n"
                    "51GTD   =2.00      51PP    =3.00      51PC    =U3        51PTD   =2.00\r\n"
                    "TR      =51GT + 51PT + 50P1\r\n"),
    ])

    # 10) QuickSet settings database for Feeder 12
    ole_file(os.path.join(OUT, "Feeder12_settings.rdb"), "FEEDER 12", [
        ("Global", "SID     =APEX SUB\r\nRID     =FEEDER 12\r\nTID     =APEX SUB\r\n"),
        ("Group 1", "\r\n".join(F12_SETTINGS) + "\r\n"),
    ])

    write("README.txt", SAMPLES_README)
    zpath = os.path.join(ROOT, "SEL_sample_files.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(OUT)):
            z.write(os.path.join(OUT, f), f"SEL sample files/{f}")
    print("wrote", len(os.listdir(OUT)), "files to", OUT, "and", zpath)


SAMPLES_README = """\
SEL TRIP EVENT ANALYZER - SAMPLE FILES
======================================

Made-up events written in SEL's file formats so you can see how the program
works. Drag this whole folder onto the program (or click "Try sample files").

FILE                           FORMAT   WHAT HAPPENED                      WHAT TO LOOK FOR
Feeder12_AG_Zone1.cev          CEV      A-to-ground fault, Zone 1 trip     Clean result, High confidence, element timeline
Feeder12_settings.rdb          RDB      Feeder 12 relay settings           Trip equation and line length used for Feeder 12
Feeder12_history.his           HIS      Feeder 12 event history (4 rows)   Row 1 is linked to the CEV; beyond-line and reverse
                                                                           fault rows are flagged
Feeder12.ser                   SER      Feeder 12 element on/off log       Shown in the SER section
Line5_BC_Zone2_POTT.cev        CEV      B-C fault, Zone 2 + POTT trip      Trip explained by TRCOMM (communications-assisted)
Line5_ABC_Zone1.hdr            HDR      Three-phase fault, Zone 1          COMTRADE header summary is read
Feeder3_CG_51G.eve             EVE      C-to-ground, time-overcurrent      Text event report; flags missing settings
Feeder7_transfer_trip.sum      SUM      Trip with no fault, COMM target    Recognized as a likely transfer trip
Feeder14_underfrequency.txt    TXT      Underfrequency (81) trip           Off-nominal frequency flagged
Line5_Hill_BC_Zone1.cev        CEV      Other end of LINE 5, same fault    Paired with Line5_BC as a two-ended event
Feeder8_storm.sum              SUM      Two trips a minute after Feeder 3  Grouped with Feeder 3 as one incident (storm)
Feeder3_CG_51G.cfg / .dat      COMTRADE Feeder 3 fault, 32 samples/cycle   Waveform analysis: 51G U3 timing vs settings
Feeder3_settings.rdb           RDB      Feeder 3 relay settings            Used for the 51G evaluation (TD 2.00, U3)
Line22_other_maker.cfg / .dat  COMTRADE Another maker's relay, B-to-ground Summarized from the waveforms and its own
                                         fault, ground IOC trip             channel names (no SEL file needed)
Feeder9_AG_needs_review.cev    CEV      Deliberately inconsistent record   Several CHECK flags: wrong phase, beyond line,
                                                                           slow breaker

Notes
- Names, stations and numbers are invented.
- The .rdb is a simplified QuickSet-style database containing settings text.
"""

if __name__ == "__main__":
    main()
