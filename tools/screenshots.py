"""Régénère les captures d'écran du README (docs/*.png).

Usage : python tools/screenshots.py
Prérequis : ffmpeg et Google Chrome (ou Chromium) installés.
Les sons de démonstration sont synthétisés par ffmpeg dans test-audio/demo/ (non versionné).
"""
import functools
import http.server
import os
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, "test-audio", "demo")
PORT = 8643

# Sons synthétiques : seule leur forme compte pour les captures.
SOUNDS = {
    "applause": "anoisesrc=d=6:c=pink:a=0.5,volume='0.6+0.4*sin(2*PI*7*t)':eval=frame",
    "bell": "sine=f=880:d=3,volume='exp(-1.5*t)':eval=frame",
    "door": "anullsrc=r=44100:cl=mono:d=0.8[s];sine=f=180:d=2.2,vibrato=f=9:d=0.8[t];[s][t]concat=n=2:v=0:a=1",
    "storm": "anoisesrc=d=14:c=brown:a=0.7,volume='0.4+0.6*abs(sin(2*PI*0.15*t))':eval=frame",
    "phone": "sine=f=1200:d=4,volume='lt(mod(t,1),0.5)':eval=frame",
    "steps": "anoisesrc=d=5:c=white:a=0.6,volume='lt(mod(t,0.5),0.06)':eval=frame",
    "clock": "sine=f=2000:d=10,volume='lt(mod(t,1),0.03)':eval=frame",
    "laugh": "anoisesrc=d=4:c=pink:a=0.5,volume='0.3+0.7*abs(sin(2*PI*3*t))*exp(-0.3*t)':eval=frame",
    "waltz": "aevalsrc='0.3*sin(2*PI*262*t)*(0.6+0.4*sin(2*PI*1.5*t))+0.2*sin(2*PI*330*t)+0.2*sin(2*PI*392*t)':d=20",
    "rain": "anoisesrc=d=12:c=pink:a=0.35",
}


def make_sounds():
    os.makedirs(DEMO, exist_ok=True)
    for name, graph in SOUNDS.items():
        out = os.path.join(DEMO, name + ".mp3")
        if os.path.exists(out):
            continue
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-filter_complex", graph,
                        "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", out], check=True)


def find_chrome():
    for p in [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]:
        if os.path.exists(p):
            return p
    return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chrome")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        # Chrome prend la capture à l'événement « load » : cette image lente le retarde
        # le temps que la page de démo prépare son projet et lance les sons.
        if self.path.startswith("/__delay"):
            time.sleep(10)
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()


def serve():
    handler = functools.partial(QuietHandler, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def capture(chrome, shot, out, size):
    profile = tempfile.mkdtemp(prefix="jinglee-shot-")
    try:
        subprocess.run([
            chrome, "--headless=new", "--hide-scrollbars", "--mute-audio",
            "--autoplay-policy=no-user-gesture-required",
            "--force-device-scale-factor=2",
            "--window-size=" + size,
            "--user-data-dir=" + profile,
            "--screenshot=" + out,
            "http://127.0.0.1:%d/tools/screenshots.html?shot=%s" % (PORT, shot),
        ], check=True, timeout=120)
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def main():
    make_sounds()
    chrome = find_chrome()
    if not chrome:
        raise SystemExit("Chrome introuvable")
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    srv = serve()
    try:
        capture(chrome, "main", os.path.join(ROOT, "docs", "ecran-principal.png"), "1180,820")
        capture(chrome, "pad", os.path.join(ROOT, "docs", "reglages-pad.png"), "1180,820")
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
