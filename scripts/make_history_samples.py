"""Generate sample_history/ (and Relay_history_samples.zip): two years of made-up
relay files from five substations, for trying the Trip History page and for
its tests.

    python scripts/make_history_samples.py

Folders are laid out the way people usually keep downloads:
    sample_history/<STATION>/<RELAY>/<date>_<relay>_<event>.sum|.cev, settings .set, history .his

The scenarios (what the history page should find) are listed in
sample_history/README.txt. Uses the CEV writer from make_samples.py. Names and
numbers are invented; the random numbers are seeded so the files never change.
"""
import datetime as dt
import os
import random
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_samples as ms  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sample_history")
rnd = random.Random(20261028)

RELAYS = {
    # relay: (station, line length, CT ratio, trip equation)
    "FEEDER 12": ("APEX SUB", 10.0, 240, "M1P + Z1G + M2PT + Z2GT + 51GT + 50P1"),
    "FEEDER 7": ("APEX SUB", 6.5, 240, "M1P + Z1G + 51GT + 51PT + PTRX"),
    "FEEDER 14": ("APEX SUB", 7.0, 240, "51GT + 51PT + 81D1T"),
    "FEEDER 3": ("OAK HILL SUB", 8.0, 240, "51GT + 51PT + 50P1"),
    "FEEDER 8": ("OAK HILL SUB", 9.0, 240, "51GT + 51PT + 50P1"),
    "LINE 5": ("RIVER SUB", 10.5, 400, "M1P OR Z1G OR M2PT OR Z2GT"),
    "LINE 5 HILL": ("HILL SUB", 10.5, 400, "M1P OR Z1G OR M2PT OR Z2GT"),
    "FEEDER 9": ("MILL ROAD SUB", 10.0, 240, "M1P + Z1G + 51GT + 50P1"),
    "FEEDER 11": ("MILL ROAD SUB", 12.0, 240, "M1P + Z1G + 51GT + 51PT"),
}
START, END = dt.datetime(2024, 11, 1), dt.datetime(2026, 10, 27, 18, 0)
LOAD = {"A": 210, "B": 205, "C": 200}
events = []  # (relay, when, event, location, shot, targets, currents ABCNGQ, freq)


def folder(relay):
    st = RELAYS[relay][0]
    return os.path.join(OUT, st.title().replace(" Sub", " Sub"), relay.title().replace(" ", "_"))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="\r\n") as f:
        f.write(text)


def rand_time(a, b):
    return a + dt.timedelta(seconds=rnd.uniform(0, (b - a).total_seconds()))


def fault_currents(ph, mag):
    """Primary amps A B C N G Q for a fault of type ph (e.g. 'AG', 'BC', 'ABC')."""
    cur = {p: LOAD[p] + rnd.randint(-15, 15) for p in "ABC"}
    for p in "ABC":
        if p in ph:
            cur[p] = int(mag * rnd.uniform(0.92, 1.05))
    g = int(mag * 0.97) if "G" in ph and ph != "ABC" else rnd.randint(4, 40)
    q = int(mag * 0.6) if ph not in ("ABC",) else rnd.randint(20, 70)
    return [cur["A"], cur["B"], cur["C"], rnd.randint(3, 12), g, q]


def add(relay, when, event, loc, targets, mag=1800, shot=0, freq=60.00, reclose=None):
    ph = event.split()[0]
    targets = targets.replace("{ph}", " ".join(ph))
    cur = fault_currents(ph, mag) if ph not in ("TRIP", "ER") else [LOAD["A"], LOAD["B"], LOAD["C"], 9, 8, 4]
    events.append((relay, when, event, loc, shot, targets, cur, freq))
    if reclose:  # the fault was still there after the reclose: lockout a few seconds later
        events.append((relay, when + dt.timedelta(seconds=reclose), event, f"{float(loc) + rnd.uniform(-0.04, 0.04):.2f}",
                       shot + 1, targets + " LO", fault_currents(ph, mag), freq))


def slg():
    return rnd.choice(["AG", "BG", "CG"])


def scenarios():
    # 1) FEEDER 12: a few scattered faults, then from June 2026 repeat A-G faults at ~4.2 miles, getting more frequent
    for _ in range(5):
        add("FEEDER 12", rand_time(START, dt.datetime(2026, 5, 1)), slg() + " T", f"{rnd.uniform(0.5, 9.5):.2f}",
            rnd.choice(["INST ZONE1 {ph}", "TIME 51 {ph}"]), mag=rnd.randint(1500, 3200))
    hot = [dt.datetime(2026, 6, 14), dt.datetime(2026, 7, 22), dt.datetime(2026, 8, 9), dt.datetime(2026, 8, 30),
           dt.datetime(2026, 9, 18), dt.datetime(2026, 10, 3), dt.datetime(2026, 10, 15), dt.datetime(2026, 10, 24)]
    for i, d in enumerate(hot):
        when = d + dt.timedelta(hours=rnd.randint(5, 20), minutes=rnd.randint(0, 59), seconds=rnd.uniform(0, 59))
        add("FEEDER 12", when, "AG T", f"{rnd.uniform(4.08, 4.36):.2f}", "INST ZONE1 A G", mag=rnd.randint(2400, 2900),
            reclose=8.5 if i in (3, 6) else None)

    # 2) FEEDER 8: storm season 2025 was bad (many faults, lockouts); trees trimmed Dec 2025, quieter since
    for _ in range(13):
        d = rand_time(dt.datetime(2025, 5, 1), dt.datetime(2025, 9, 30))
        add("FEEDER 8", d, slg() + " T", f"{rnd.uniform(1.0, 8.6):.2f}", "TIME 51 {ph}",
            mag=rnd.randint(900, 1700), reclose=rnd.choice([None, None, 6.6]))
    for _ in range(4):
        add("FEEDER 8", rand_time(dt.datetime(2024, 11, 5), dt.datetime(2025, 4, 20)), slg() + " T", f"{rnd.uniform(1, 8.6):.2f}", "TIME 51 {ph}", mag=1300)
    for d in [dt.datetime(2026, 2, 11, 7), dt.datetime(2026, 6, 28, 16), dt.datetime(2026, 8, 19, 15)]:
        add("FEEDER 8", d + dt.timedelta(minutes=rnd.randint(0, 50)), slg() + " T", f"{rnd.uniform(1, 8.6):.2f}", "TIME 51 {ph}", mag=1250)

    # 3) FEEDER 7: transfer trips with no fault in spring 2026 (channel noise), stopped after the channel was fixed
    for d in [dt.datetime(2026, 3, 4, 2, 11), dt.datetime(2026, 3, 29, 23, 40), dt.datetime(2026, 4, 17, 4, 5),
              dt.datetime(2026, 5, 9, 1, 52)]:
        add("FEEDER 7", d + dt.timedelta(seconds=rnd.uniform(0, 59)), "TRIP", "$$$$$", "COMM")
    for _ in range(3):
        add("FEEDER 7", rand_time(START, END), slg() + " T", f"{rnd.uniform(0.4, 6.0):.2f}", "INST ZONE1 {ph}", mag=2100)

    # 4) FEEDER 14: two underfrequency load-shedding trips (system events)
    add("FEEDER 14", dt.datetime(2025, 7, 30, 17, 48, 2, 115000), "TRIP", "$$$$$", "81", freq=59.21)
    add("FEEDER 14", dt.datetime(2026, 8, 11, 18, 3, 41, 604000), "TRIP", "$$$$$", "81", freq=59.18)

    # 5) FEEDER 9: trips with no fault and no reason, three close together in 2025 (looks like a misoperation)
    for d in [dt.datetime(2025, 2, 3, 9, 12), dt.datetime(2025, 2, 27, 13, 40), dt.datetime(2025, 3, 21, 10, 5)]:
        add("FEEDER 9", d + dt.timedelta(seconds=rnd.uniform(0, 59)), "TRIP", "$$$$$", "")
    for _ in range(4):
        add("FEEDER 9", rand_time(START, END), slg() + " T", f"{rnd.uniform(0.5, 9.5):.2f}", "TIME 51 {ph}", mag=1700)

    # 6) FEEDER 11: steady background of faults, plus reverse (behind the relay) faults in 2026
    for _ in range(14):
        ph = rnd.choice(["AG", "BG", "CG", "CG", "BC"])
        add("FEEDER 11", rand_time(START, END), ph + " T", f"{rnd.uniform(0.5, 11.5):.2f}",
            "TIME 51 {ph}", mag=rnd.randint(1000, 2600))
    for d in [dt.datetime(2026, 4, 2, 6, 30), dt.datetime(2026, 5, 15, 21, 10), dt.datetime(2026, 6, 20, 11, 44)]:
        add("FEEDER 11", d, "CG T", f"{-rnd.uniform(0.6, 1.4):.2f}", "TIME 51 C G", mag=1900)

    # 7) FEEDER 3: quiet
    for _ in range(3):
        add("FEEDER 3", rand_time(START, END), slg() + " T", f"{rnd.uniform(0.5, 7.5):.2f}", "TIME 51 {ph}", mag=1800)


def sum_text(relay, when, event, loc, shot, targets, cur, freq):
    st = RELAYS[relay][0]
    return (f"{relay:<41}Date: {when:%m/%d/%y}    Time: {when:%H:%M:%S}.{when.microsecond // 1000:03d}\n{st}\n\n"
            f"Event: {event:<9} Location: {loc:<7} Shot: {shot:>2}  Frequency: {freq:.2f}\n"
            f"Targets: {targets}\n"
            f"Currents (A Pri), ABCNGQ: " + "".join(f"{c:>6}" for c in cur) + "\n")


def settings_text(relay):
    st, ll, ctr, tr = RELAYS[relay]
    return (f"RID     ={relay:<30}TID     ={st}\n"
            f"CTR     ={ctr:<10}PTR     =600.00    LL      ={ll:.2f}\n"
            f"Z1MAG   =4.62      Z1ANG   =78.40     Z1P     =3.70      Z1MG    =3.70\n"
            f"51GP    =1.20      51GC    =U3        51GTD   =3.00      51PP    =2.50\n"
            f"TR      ={tr}\n")


def his_text(relay, rows, now):
    st = RELAYS[relay][0]
    out = [f"{relay:<41}Date: {now:%m/%d/%y}    Time: {now:%H:%M:%S}.000", st, "",
           "#    DATE      TIME          EVENT    LOCAT   CURR   FREQ  GRP  SHOT  TARGETS"]
    for i, (_, when, event, loc, shot, targets, cur, freq) in enumerate(sorted(rows, key=lambda r: r[1], reverse=True), 1):
        top = max(cur[:3])
        out.append(f"{i:<3}{when:%m/%d/%y}  {when:%H:%M:%S}.{when.microsecond // 1000:03d}   {event:<8}{loc:>6}  {top:>5}  {freq:.2f}   1    {shot}   {targets}")
    return "\n".join(out) + "\n"


def line5_cevs():
    """LINE 5: faults seen from both ends; the RIVER SUB breaker is getting slower every time."""
    clears = [(dt.datetime(2025, 3, 18, 10, 22, 7, 330000), "BC", 3.0, 7.9, 2.6),
              (dt.datetime(2025, 11, 6, 14, 51, 40, 812000), "AG", 3.5, 3.2, 7.3),
              (dt.datetime(2026, 4, 12, 16, 8, 19, 205000), "BC", 5.5, 6.4, 4.1),
              (dt.datetime(2026, 7, 2, 13, 37, 55, 640000), "CG", 6.25, 5.0, 5.5),
              (dt.datetime(2026, 9, 9, 18, 2, 11, 77000), "BC", 7.0, 8.8, 1.7),
              (dt.datetime(2026, 10, 19, 9, 45, 30, 420000), "AG", 7.75, 2.3, 8.2)]
    P, L2 = ms.P, 2
    for when, ph, clear, loc_r, loc_h in clears:
        for relay, loc, mag in (("LINE 5", loc_r, 2900 if loc_r > 5 else 5200), ("LINE 5 HILL", loc_h, 2900 if loc_h > 5 else 5200)):
            st, ll, ctr, tr = RELAYS[relay]
            pre = {k: L2 * v for k, v in ms.LOAD.items()}
            cur = {k: (pre[k], pre[k]) for k in pre}
            if ph == "BC":
                cur["IB"] = (pre["IB"], pre["IB"] + P(mag, -165)); cur["IC"] = (pre["IC"], pre["IC"] - P(mag, -165))
                vf = (66.5, 30.0, 29.5)
            else:
                k = "I" + ph[0]
                cur[k] = (pre[k], pre[k] + P(mag, -78 + {"IA": 0, "IB": -120, "IC": 120}[k]))
                vf = tuple(25.0 if "ABC"[i] == ph[0] else 66.0 for i in range(3))
            zone1 = loc < 0.8 * ll
            trip_q = 17 if zone1 else 18
            c = clear if relay == "LINE 5" else 2.5
            open_q = int(round(trip_q + 4 * c))
            pick = ("M1P" if ph == "BC" else "Z1G") if zone1 else ("M2P" if ph == "BC" else "Z2G")
            when2 = when + dt.timedelta(milliseconds=4 if relay == "LINE 5 HILL" else 0)
            event = f"{ph} T"
            targets = ("INST ZONE1 " if zone1 else "COMM ZONE2 ") + " ".join(ph)
            tl = {pick: (16, open_q + 1), "KEY": (16, open_q + 1), "TRIP": (trip_q, open_q + 3), "OUT101": (trip_q, open_q + 3), "52AA1": (0, open_q)}
            if not zone1:
                tl["PTRX"] = (trip_q, open_q + 2)
            name = os.path.join(folder(relay), f"{when2:%Y-%m-%d}_{relay.replace(' ', '')}_{ph}.cev")
            old = ms.OUT
            ms.OUT = os.path.dirname(name); os.makedirs(ms.OUT, exist_ok=True)
            ms.cev(os.path.basename(name), fid=ms.FID_421, when=when2, event=event, location=f"{loc:.2f}", shot=0, targets=targets,
                   freq=60.0, sam=8, ncyc=15, currents=cur, vfault=vf, open_row=open_q,
                   names="M1P M2P Z1G Z2G KEY PTRX TRIP OUT101 52AA1".split(), timeline=tl,
                   settings=[f"RID      := {relay}", f"TID      := {st}", f"LL       := {ll:.2f}", f"CTR      := {ctr}",
                             "PTR      := 1200", f"TR       := {tr}", "TRCOMM   := M2P OR Z2G", "ECOMM    := POTT"])
            ms.OUT = old


README = """RELAY TRIP HISTORY - SAMPLE FILES
================================

Two years (Nov 2024 to Oct 2026) of made-up relay files from five substations,
kept in folders by station and relay. Drag the whole sample_history folder (or
Relay_history_samples.zip) onto the Trip History page, or click "Try samples".

WHERE            WHAT HAPPENED                                     WHAT THE HISTORY PAGE SHOULD SHOW
FEEDER 12        A-G faults at ~4.1-4.4 miles since June 2026,     Top problem location: recurring ground faults, a fault
(APEX SUB)       more often each month, two locked out             hot spot near 42% of the line, trend increasing
FEEDER 8         Many storm faults in summer 2025, trees trimmed   Recurring faults and lockouts in 2025, trend decreasing
(OAK HILL SUB)   in Dec 2025, quieter since                        (the sample work log marks the trimming)
LINE 5           Faults seen from both ends; the RIVER SUB         Recurring slow breaker clearing, 5.5 -> 7.75 cycles
(RIVER/HILL)     breaker takes longer to open every time           (CEV files, with settings)
FEEDER 7         Four transfer trips with no fault in spring 2026  Recurring transfer trips, stopped since May
FEEDER 9         Three trips with no fault and no reason, 2025     Recurring "trip with no fault found"
FEEDER 11        Faults all along, plus three faults behind the    Recurring negative-location faults (behind the relay)
(MILL ROAD SUB)  relay in spring 2026
FEEDER 14        Two underfrequency load-shedding trips            Frequency trips, nothing recurring
FEEDER 3         Three faults in two years                         Low in the ranking

Each relay folder also has its settings (.set). FEEDER 12 and FEEDER 8 have an
event history (.his) that repeats events already in the .sum files: each event
should be counted once.
"""


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    scenarios()
    for relay in RELAYS:
        write(os.path.join(folder(relay), f"{relay.replace(' ', '')}_settings.set"), settings_text(relay))
    for ev in events:
        relay, when = ev[0], ev[1]
        if relay.startswith("LINE 5"):
            continue
        base = f"{when:%Y-%m-%d}_{relay.replace(' ', '')}_{ev[2].split()[0]}"
        path = os.path.join(folder(relay), base + ".sum")
        if os.path.exists(path):  # a reclose sequence on the same day goes in the same file, like the relay does
            with open(path) as f:
                prev = f.read()
            write(path, prev.replace("\r\n", "\n") + "\n" + sum_text(*ev))
        else:
            write(path, sum_text(*ev))
    line5_cevs()
    for relay, upto in (("FEEDER 12", dt.datetime(2026, 10, 27, 7, 30)), ("FEEDER 8", dt.datetime(2026, 9, 1, 8, 0))):
        rows = [e for e in events if e[0] == relay and e[1] <= upto][-20:]
        write(os.path.join(folder(relay), f"{relay.replace(' ', '')}_history_{upto:%Y-%m-%d}.his"), his_text(relay, rows, upto))
    write(os.path.join(OUT, "README.txt"), README)
    zpath = os.path.join(ROOT, "Relay_history_samples.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _, names in os.walk(OUT):
            for n in sorted(names):
                full = os.path.join(dirpath, n)
                z.write(full, os.path.relpath(full, ROOT))
    n = sum(len(f) for _, _, f in os.walk(OUT))
    print(f"wrote {n} files to {OUT} and {zpath}")


if __name__ == "__main__":
    main()
