"""Regenerate docs/screenshots/*.png.

    python scripts/screenshots.py <shot> <out.png>      shots: empty | light | dark

Windows (used by .github/workflows/screenshots.yml): needs Pillow; captures the
whole window including the title bar.
Linux: run under xvfb-run with ImageMagick's `import` on PATH.
"""
import os
import subprocess
import sys
import tempfile
import tkinter as tk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["SEL_TRIP_NO_UPDATE_CHECK"] = "1"
cfg_dir = tempfile.mkdtemp()  # keep real settings untouched
os.environ["XDG_CONFIG_HOME"] = cfg_dir
os.environ["APPDATA"] = cfg_dir

import sel_trip_analyzer as app  # noqa: E402

shot, out_png = sys.argv[1], os.path.abspath(sys.argv[2])
sys.argv = sys.argv[:1]
_mainloop = tk.Misc.mainloop
WIN = sys.platform == "win32"


def window_rect(root):
    """Visible window bounds (with title bar, without the drop shadow)."""
    import ctypes
    from ctypes import wintypes
    hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
    r = wintypes.RECT()
    if ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(r), ctypes.sizeof(r)) != 0:
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def mainloop(self, n=0):
    a = self.app
    sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
    scale = self.winfo_fpixels("1i") / 96.0
    w, h = int(1180 * scale), int(860 * scale)
    if WIN:
        w, h = min(w, sw - 40), min(h, sh - 80)
        self.geometry(f"{w}x{h}+16+16")
    else:
        self.geometry(f"{w}x{h}+0+0")

    def stage():
        if shot != "empty":
            a.hide_placeholder()
            a.comments.insert("1.0", "Crew patrol found a cracked insulator at pole 47 on Feeder 12.\n"
                                     "Suggest confirming Zone 1 reach against the 42% fault location.")
            a.add_paths([os.path.join(ROOT, "sample_files")])
        if shot == "dark":
            a.v_dark.set(True)
            a.toggle_dark()
            a.show_update_available({"version": "1.1.0", "notes": "", "url": None, "sha256": None,
                                     "page": "", "source_url": "", "tag": "v1.1.0"})
        self.lift()
        self.attributes("-topmost", True)
        self.after(1500, capture)

    def capture():
        self.update()
        if WIN:
            from PIL import ImageGrab
            ImageGrab.grab(bbox=window_rect(self), all_screens=True).save(out_png)
        else:
            subprocess.run(["import", "-window", "root", out_png], check=True)
        print("saved", out_png)
        self.destroy()

    self.after(1000, stage)
    _mainloop(self, n)


tk.Misc.mainloop = mainloop
app.run_gui()
