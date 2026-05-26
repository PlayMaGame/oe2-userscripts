"""
Outer Empires – PiP overlay  (v8)
=================================
Features:
- Drag to move
- Double-click to jump to game
- 10 FPS
- Rounded corners
- PrintWindow(PW_RENDERFULLCONTENT) capture
- Smart pseudo-minimize handling
- Sends game behind windows instead of offscreen
- Maintains live rendering after minimize
- System tray icon (Show/Hide, Quit)

Requirements:
    pip install pillow pywin32 psutil pystray

Run:
    pythonw oe_pip.pyw
"""

import tkinter as tk
from PIL import Image, ImageTk, ImageDraw

import win32gui
import win32con
import win32process
import win32ui

import ctypes
import psutil

import pystray
import threading


TARGET_EXE   = "min.exe"
TARGET_TITLE = "Outer Empires"

PIP_W        = 320
PIP_H        = 180

# 10 FPS
REFRESH_MS   = 100

OPACITY      = 0.93
CORNER_R     = 14

# offset from screen bottom (taskbar area)
PIP_Y_OFFSET = 70

PW_RENDERFULLCONTENT = 0x00000002


def find_window() -> int | None:
    found: list = []

    target_title_lower = TARGET_TITLE.lower()
    target_exe_lower = TARGET_EXE.lower()

    def cb(hwnd, _):
        title = win32gui.GetWindowText(hwnd)

        if target_title_lower not in title.lower():
            return

        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)

            proc = psutil.Process(pid)

            if target_exe_lower in proc.name().lower():
                found.append(hwnd)

        except Exception:
            pass

    win32gui.EnumWindows(cb, None)

    return found[0] if found else None


def capture_window(hwnd) -> Image.Image | None:
    hdc = None
    mdc = None
    sdc = None
    bmp = None

    try:
        l, t, r, b = win32gui.GetWindowRect(hwnd)

        w = r - l
        h = b - t

        if w <= 0 or h <= 0:
            return None

        hdc = win32gui.GetWindowDC(hwnd)

        mdc = win32ui.CreateDCFromHandle(hdc)
        sdc = mdc.CreateCompatibleDC()

        bmp = win32ui.CreateBitmap()
        bmp.CreateCompatibleBitmap(mdc, w, h)

        sdc.SelectObject(bmp)

        ok = ctypes.windll.user32.PrintWindow(
            hwnd,
            sdc.GetSafeHdc(),
            PW_RENDERFULLCONTENT
        )

        if not ok:
            return None

        info = bmp.GetInfo()
        raw = bmp.GetBitmapBits(True)

        return Image.frombuffer(
            "RGB",
            (info["bmWidth"], info["bmHeight"]),
            raw,
            "raw",
            "BGRX",
            0,
            1
        )

    except Exception:
        return None

    finally:
        if bmp:
            win32gui.DeleteObject(bmp.GetHandle())
        if sdc:
            sdc.DeleteDC()
        if mdc:
            mdc.DeleteDC()
        if hdc:
            win32gui.ReleaseDC(hwnd, hdc)


def apply_round_mask(img: Image.Image, radius: int) -> Image.Image:
    img = img.convert("RGBA")

    mask = Image.new("L", img.size, 0)

    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), img.size],
        radius=radius,
        fill=255
    )

    img.putalpha(mask)

    return img


def is_minimized(hwnd: int) -> bool:
    return win32gui.IsIconic(hwnd)


def is_foreground(hwnd: int) -> bool:
    return win32gui.GetForegroundWindow() == hwnd


def send_to_back(hwnd: int) -> None:
    """
    Convert a real minimize into a pseudo-minimize:
    - restore window internally
    - keep rendering alive
    - push behind all windows
    """

    # Only restore if actually minimized (preserves maximized/fullscreen)
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

    # push behind everything
    win32gui.SetWindowPos(
        hwnd,
        win32con.HWND_BOTTOM,
        0,
        0,
        0,
        0,
        win32con.SWP_NOMOVE
        | win32con.SWP_NOSIZE
        | win32con.SWP_NOACTIVATE
    )


def bring_to_front(hwnd: int) -> None:
    """
    Restore game window normally (preserving maximized/fullscreen state).
    """

    # Only restore if minimized — SW_RESTORE on a maximized window
    # would un-maximize it and break fullscreen.
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

    win32gui.SetWindowPos(
        hwnd,
        win32con.HWND_TOP,
        0,
        0,
        0,
        0,
        win32con.SWP_NOMOVE
        | win32con.SWP_NOSIZE
    )

    try:
        win32gui.SetForegroundWindow(hwnd)

    except Exception:
        pass


class PiP:

    def __init__(self, root):

        self.root = root

        self.root.overrideredirect(True)

        self.root.attributes("-topmost", True)

        self.root.attributes("-alpha", OPACITY)

        self.root.attributes("-transparentcolor", "magenta")

        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()

        x = screen_w - PIP_W - 20
        y = screen_h - PIP_H - PIP_Y_OFFSET

        self.root.geometry(f"{PIP_W}x{PIP_H}+{x}+{y}")

        self.root.configure(bg="magenta")

        self.canvas = tk.Canvas(
            self.root,
            width=PIP_W,
            height=PIP_H,
            bg="magenta",
            highlightthickness=0
        )

        self.canvas.pack(fill="both", expand=True)

        self.canvas.bind("<ButtonPress-1>", self._drag_start)

        self.canvas.bind("<B1-Motion>", self._drag_move)

        self.canvas.bind(
            "<Double-Button-1>",
            lambda e: self.jump()
        )

        self.hwnd = None

        self.parked = False

        # tracks true minimize events
        self.was_minimized = False

        self.img_ref = None

        self.running = True

        self._dx = 0
        self._dy = 0

        self._round_mask: Image.Image | None = None
        self._mask_size: tuple[int, int] | None = None

        self.root.protocol("WM_DELETE_WINDOW", self._hide_to_tray)

        self._setup_tray()

        self.root.after(300, self.loop)

    def jump(self) -> None:

        if not self.hwnd or not win32gui.IsWindow(self.hwnd):
            return

        if self.parked:

            bring_to_front(self.hwnd)

            self.parked = False
            self.was_minimized = False

        else:

            try:
                win32gui.SetForegroundWindow(self.hwnd)

            except Exception:
                pass

    def _drag_start(self, e: tk.Event) -> None:

        self._dx = e.x_root
        self._dy = e.y_root

    def _drag_move(self, e: tk.Event) -> None:

        x = self.root.winfo_x() + (e.x_root - self._dx)
        y = self.root.winfo_y() + (e.y_root - self._dy)

        self.root.geometry(f"+{x}+{y}")

        self._dx = e.x_root
        self._dy = e.y_root

    def loop(self) -> None:

        if not self.running:
            return

        try:

            # Find game window
            if self.hwnd is None or not win32gui.IsWindow(self.hwnd):

                self.hwnd = find_window()

                self.parked = False
                self.was_minimized = False

            # Waiting state
            if self.hwnd is None:

                self._placeholder("Waiting for game window…")

                self.root.after(2000, self.loop)

                return

            # ============================================
            # SMART MINIMIZE DETECTION
            # ============================================

            currently_minimized = is_minimized(self.hwnd)

            # New minimize event
            if currently_minimized and not self.was_minimized:

                send_to_back(self.hwnd)

                self.parked = True
                self.was_minimized = True

            # User restored manually
            elif not currently_minimized and self.was_minimized:

                self.was_minimized = False
                self.parked = False

            # ============================================

            # Hide PiP when game is foreground
            if is_foreground(self.hwnd) and not self.parked:

                self.root.withdraw()

                self.root.after(REFRESH_MS, self.loop)

                return

            else:

                self.root.deiconify()

            # Capture frame
            img = capture_window(self.hwnd)

            if img is None:

                self._placeholder("Capture failed…")

                self.root.after(REFRESH_MS, self.loop)

                return

            cw = self.canvas.winfo_width() or PIP_W
            ch = self.canvas.winfo_height() or PIP_H

            img = img.resize((cw, ch), Image.LANCZOS)

            img.putalpha(self._get_round_mask(cw, ch))

            photo = ImageTk.PhotoImage(img)

            self.canvas.delete("frame")

            self.canvas.create_image(
                0,
                0,
                anchor="nw",
                image=photo,
                tags="frame"
            )

            self.img_ref = photo

        except Exception as ex:

            self._placeholder(f"Error:\n{ex}")

        self.root.after(REFRESH_MS, self.loop)

    def _make_tray_image(self) -> Image.Image:
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle((2, 2, 61, 61), radius=10, fill=(20, 30, 60, 255))
        draw.text((32, 24), "OE", fill=(200, 180, 80, 255), anchor="mm", font=None)
        draw.text((32, 40), "2", fill=(255, 255, 255, 180), anchor="mm", font=None)
        draw.rounded_rectangle((2, 2, 61, 61), radius=10, outline=(100, 140, 200, 200), width=2)
        return img

    def _setup_tray(self):
        menu = pystray.Menu(
            pystray.MenuItem("Show/Hide PiP", self._tray_toggle, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._tray_quit),
        )
        self.tray_icon = pystray.Icon(
            "oe_pip",
            self._make_tray_image(),
            "Outer Empires 2 — PiP",
            menu
        )
        self._tray_thread = threading.Thread(target=self.tray_icon.run, daemon=True)
        self._tray_thread.start()

    def _tray_toggle(self, icon=None, item=None):
        if self.root.state() == "withdrawn" or self.root.state() == "iconic":
            self.root.deiconify()
            self.root.lift()
        else:
            self.root.withdraw()

    def _tray_quit(self, icon=None, item=None):
        self.running = False
        self.tray_icon.stop()
        self.root.destroy()

    def _hide_to_tray(self):
        self.root.withdraw()

    def _on_close(self) -> None:
        self.running = False
        self.tray_icon.stop()
        self.root.destroy()

    def _get_round_mask(self, w: int, h: int) -> Image.Image:
        if (w, h) != self._mask_size:
            mask = Image.new("L", (w, h), 0)
            ImageDraw.Draw(mask).rounded_rectangle(
                [(0, 0), (w, h)], radius=CORNER_R, fill=255
            )
            self._round_mask = mask
            self._mask_size = (w, h)
        return self._round_mask

    def _placeholder(self, msg: str) -> None:

        cw = self.canvas.winfo_width() or PIP_W
        ch = self.canvas.winfo_height() or PIP_H

        self.canvas.delete("all")

        self.canvas.create_rectangle(
            0,
            0,
            cw,
            ch,
            fill="#0d0d1a",
            outline="#2a2a3e"
        )

        self.canvas.create_text(
            cw // 2,
            ch // 2,
            text=msg,
            fill="#777",
            font=("Consolas", 9),
            justify="center"
        )


if __name__ == "__main__":

    root = tk.Tk()

    app = PiP(root)

    root.mainloop()