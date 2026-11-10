# -*- coding: utf-8 -*-
"""MassiDeck - il telefono diventa una pulsantiera (stile Stream Deck) per il PC.

Programma per il PC: riceve i comandi dal telefono sul Wi-Fi di casa e li esegue
(apre programmi e siti, musica e volume, testi pronti, blocca/spegne, screenshot).
Serve anche la pagina dei tasti: dal telefono http://IP-DEL-PC:8765,
dal PC http://localhost:8765 (configurazione, PIN, QR).

Solo libreria standard di Python. Su Windows usa ctypes; su altri sistemi
le azioni vengono solo scritte nel registro (utile per le prove).
"""
import json
import os
import random
import secrets
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

VERSIONE = "1.1"
PORTA = int(os.environ.get("MASSIDECK_PORTA", "8765"))
WINDOWS = sys.platform.startswith("win")

# ---------------------------------------------------------------- percorsi
if getattr(sys, "frozen", False):
    BASE = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
else:
    BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
if not os.path.isdir(WEB):
    WEB = os.path.join(os.path.dirname(BASE), "web")

if os.environ.get("MASSIDECK_DATI"):
    DATI = os.environ["MASSIDECK_DATI"]
elif WINDOWS:
    DATI = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "MassiDeck")
else:
    DATI = os.path.join(os.path.expanduser("~"), ".massideck")
os.makedirs(DATI, exist_ok=True)
FILE_CONFIG = os.path.join(DATI, "tasti.json")
FILE_SEGRETI = os.path.join(DATI, "accesso.json")

REGISTRO = []  # ultime azioni, per la pagina del PC


def log(msg):
    riga = time.strftime("%H:%M:%S") + "  " + msg
    REGISTRO.append(riga)
    del REGISTRO[:-40]
    try:
        print(riga, flush=True)
    except Exception:
        pass


# ---------------------------------------------------------------- tasti di partenza
def tasto(etichetta, icona, colore, azione):
    return {"id": secrets.token_hex(4), "etichetta": etichetta, "icona": icona,
            "colore": colore, "azione": azione}


def config_iniziale():
    VERDE, BLU, ROSSO, GIALLO, VIOLA, GRIGIO, ARANCIO, AZZURRO = (
        "#1db954", "#2b6cde", "#d93838", "#e6a817", "#8a4fd8", "#4a5160", "#e8702a", "#1a9bd7")
    apri = lambda t: {"tipo": "apri", "valore": t}
    media = lambda t: {"tipo": "media", "valore": t}
    sist = lambda t: {"tipo": "sistema", "valore": t}
    pagine = [
        {"id": "home", "nome": "Principale", "tasti": [
            tasto("Spotify", "🎵", VERDE, apri("spotify:")),
            tasto("Play / Pausa", "⏯️", GRIGIO, media("play")),
            tasto("Volume −", "🔉", GRIGIO, media("vol-")),
            tasto("Volume +", "🔊", GRIGIO, media("vol+")),
            tasto("Chrome", "🌐", AZZURRO, apri("chrome")),
            tasto("Gmail", "✉️", ROSSO, apri("https://mail.google.com")),
            tasto("Word", "📝", BLU, apri("winword")),
            tasto("Excel", "📊", "#1f8a4c", apri("excel")),
            tasto("Esplora file", "📁", GIALLO, apri("explorer")),
            tasto("Screenshot", "📸", VIOLA, sist("screenshot")),
            tasto("Muto", "🔇", GRIGIO, media("muto")),
            tasto("Blocca PC", "🔒", ARANCIO, sist("blocca")),
        ]},
        {"id": "musica", "nome": "Musica", "tasti": [
            tasto("Spotify", "🎵", VERDE, apri("spotify:")),
            tasto("Precedente", "⏮️", GRIGIO, media("prec")),
            tasto("Play / Pausa", "⏯️", VERDE, media("play")),
            tasto("Successiva", "⏭️", GRIGIO, media("succ")),
            tasto("Stop", "⏹️", GRIGIO, media("stop")),
            tasto("Volume −", "🔉", GRIGIO, media("vol-")),
            tasto("Volume +", "🔊", GRIGIO, media("vol+")),
            tasto("Muto", "🔇", ROSSO, media("muto")),
            tasto("Volume −10", "🔈", GRIGIO, media("vol-10")),
            tasto("Volume +10", "📢", GRIGIO, media("vol+10")),
            tasto("YouTube Music", "🎧", ROSSO, apri("https://music.youtube.com")),
            tasto("Cerca su Spotify", "🔎", VERDE, apri("spotify:search")),
        ]},
        {"id": "office", "nome": "Office e browser", "tasti": [
            tasto("Word", "📝", BLU, apri("winword")),
            tasto("Excel", "📊", "#1f8a4c", apri("excel")),
            tasto("PowerPoint", "📽️", ARANCIO, apri("powerpnt")),
            tasto("Outlook", "📧", AZZURRO, apri("outlook")),
            tasto("Chrome", "🌐", AZZURRO, apri("chrome")),
            tasto("Edge", "🌊", BLU, apri("msedge")),
            tasto("Blocco note", "🗒️", GRIGIO, apri("notepad")),
            tasto("Calcolatrice", "🧮", GRIGIO, apri("calc")),
            tasto("Documenti", "📂", GIALLO, apri("%USERPROFILE%\\Documents")),
            tasto("Download", "📥", GIALLO, apri("%USERPROFILE%\\Downloads")),
            tasto("Office online", "🏢", ROSSO, apri("https://www.office.com")),
            tasto("Esplora file", "📁", GIALLO, apri("explorer")),
        ]},
        {"id": "google", "nome": "Google", "tasti": [
            tasto("Google", "🔍", AZZURRO, apri("https://www.google.com")),
            tasto("Gmail", "✉️", ROSSO, apri("https://mail.google.com")),
            tasto("Drive", "🗂️", GIALLO, apri("https://drive.google.com")),
            tasto("Documenti", "📄", BLU, apri("https://docs.google.com/document")),
            tasto("Fogli", "📗", "#1f8a4c", apri("https://docs.google.com/spreadsheets")),
            tasto("Presentazioni", "📙", GIALLO, apri("https://docs.google.com/presentation")),
            tasto("Calendar", "📅", BLU, apri("https://calendar.google.com")),
            tasto("Maps", "🗺️", VERDE, apri("https://maps.google.com")),
            tasto("YouTube", "▶️", ROSSO, apri("https://www.youtube.com")),
            tasto("Classroom", "🎓", "#1f8a4c", apri("https://classroom.google.com")),
            tasto("Meet", "📹", "#00897b", apri("https://meet.google.com")),
            tasto("Traduttore", "🈯", AZZURRO, apri("https://translate.google.com")),
        ]},
        {"id": "sistema", "nome": "Sistema", "tasti": [
            tasto("Blocca PC", "🔒", ARANCIO, sist("blocca")),
            tasto("Screenshot", "📸", VIOLA, sist("screenshot")),
            tasto("Ritaglio schermo", "✂️", VIOLA, sist("ritaglio")),
            tasto("Mostra desktop", "🖥️", GRIGIO, sist("desktop")),
            tasto("Gestione attività", "📈", GRIGIO, sist("taskmgr")),
            tasto("Impostazioni", "⚙️", GRIGIO, apri("ms-settings:")),
            tasto("La mia email", "✍️", BLU, {"tipo": "testo", "valore": "scrivi.qui@la-tua-email.it"}),
            tasto("Saluti", "👋", BLU, {"tipo": "testo", "valore": "Cordiali saluti,\nMassimiliano"}),
            tasto("Sospendi", "🌙", AZZURRO, sist("sospendi")),
            tasto("Riavvia", "🔄", ROSSO, sist("riavvia")),
            tasto("Spegni", "⏻", ROSSO, sist("spegni")),
            tasto("Annulla spegnimento", "↩️", GRIGIO, sist("annulla")),
        ]},
    ]
    return {"versione": 1, "rev": 1, "colonne": 4, "conferma_pericolosi": True,
            "vibrazione": True, "pagine": pagine}


def carica_json(percorso, predefinito):
    try:
        with open(percorso, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return predefinito


def salva_json(percorso, dati):
    tmp = percorso + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dati, f, ensure_ascii=False, indent=1)
    os.replace(tmp, percorso)


LOCK = threading.Lock()
CONFIG = carica_json(FILE_CONFIG, None)
if not isinstance(CONFIG, dict) or not CONFIG.get("pagine"):
    CONFIG = config_iniziale()
    salva_json(FILE_CONFIG, CONFIG)

SEGRETI = carica_json(FILE_SEGRETI, {})
if not SEGRETI.get("pin"):
    SEGRETI = {"pin": "%04d" % random.SystemRandom().randint(0, 9999), "token": []}
    salva_json(FILE_SEGRETI, SEGRETI)


def nuovo_pin():
    with LOCK:
        SEGRETI["pin"] = "%04d" % random.SystemRandom().randint(0, 9999)
        SEGRETI["token"] = []  # scollega tutti i telefoni
        salva_json(FILE_SEGRETI, SEGRETI)


# ---------------------------------------------------------------- rete
def ps(comando, attesa=8):
    """Esegue PowerShell senza finestra e restituisce il testo (solo Windows)."""
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", comando],
                           capture_output=True, text=True, timeout=attesa, creationflags=0x08000000)
        return r.stdout.strip()
    except Exception:
        return ""


_CACHE = {}


def in_cache(chiave, durata, funzione):
    v = _CACHE.get(chiave)
    if v and time.time() - v[0] < durata:
        return v[1]
    r = funzione()
    _CACHE[chiave] = (time.time(), r)
    return r


def _ip_windows():
    out = ps("Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | "
             "ForEach-Object { $_.IPv4Address.IPAddress + '|' + $_.InterfaceAlias + '|' + $_.NetProfile.NetworkCategory }")
    righe = []
    for r in out.splitlines():
        parti = r.strip().split("|")
        if len(parti) == 3 and parti[0] and not parti[0].startswith("169.254"):
            righe.append({"ip": parti[0], "scheda": parti[1], "tipo": parti[2]})
    return righe


def reti_windows():
    return in_cache("reti", 20, _ip_windows) if WINDOWS else []


def _firewall():
    out = ps("$r = Get-NetFirewallRule -DisplayName 'MassiDeck' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }; "
             "$b = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like '*MassiDeck*' } | "
             "Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' }).Count; "
             "if ($r) { 'ok|' + $b } else { 'manca|' + $b }", 15)
    parti = out.split("|")
    return {"regola": parti[0] == "ok", "blocchi": int(parti[1]) if len(parti) > 1 and parti[1].isdigit() else 0,
            "letto": bool(out)}


def stato_firewall():
    return in_cache("fw", 15, _firewall) if WINDOWS else {"regola": True, "blocchi": 0, "letto": False}


def sblocca_firewall():
    """Toglie i blocchi di Windows per MassiDeck e apre la porta su tutte le reti (chiede l'amministratore)."""
    exe = sys.executable
    comandi = ('netsh advfirewall firewall delete rule name=all program="%s" & '
               'netsh advfirewall firewall delete rule name="MassiDeck" & '
               'netsh advfirewall firewall add rule name="MassiDeck" dir=in action=allow protocol=TCP localport=%d profile=any'
               % (exe, PORTA))
    if not WINDOWS:
        log("   (prova) firewall: " + comandi)
        return True
    r = ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", "/c " + comandi, None, 0)
    _CACHE.pop("fw", None)
    return r > 32


def ip_locali():
    ips = [r["ip"] for r in reti_windows()]
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    # prima gli indirizzi di casa
    ips.sort(key=lambda i: 0 if i.startswith(("192.168.", "10.", "172.")) else 1)
    return ips or ["127.0.0.1"]


# ---------------------------------------------------------------- azioni Windows
if WINDOWS:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    ULONG_PTR = ctypes.c_size_t

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class _UNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]

    class INPUT(ctypes.Structure):
        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _UNION)]

    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.SendInput.restype = wintypes.UINT

    KEYUP, UNICODE, EXTENDED = 0x0002, 0x0004, 0x0001

    def _manda(lista):
        arr = (INPUT * len(lista))(*lista)
        user32.SendInput(len(lista), arr, ctypes.sizeof(INPUT))

    def _vk(vk, su=False, est=False):
        f = (KEYUP if su else 0) | (EXTENDED if est else 0)
        return INPUT(type=1, ki=KEYBDINPUT(wVk=vk, wScan=0, dwFlags=f, time=0, dwExtraInfo=0))

    ESTESI = {0x5B, 0x5C, 0x2C, 0x2D, 0x2E, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28}

    def premi(*vks):
        """Combinazione: preme i tasti in ordine e li rilascia al contrario."""
        giu = [_vk(v, False, v in ESTESI or 0xA6 <= v <= 0xB7) for v in vks]
        su = [_vk(v, True, v in ESTESI or 0xA6 <= v <= 0xB7) for v in reversed(vks)]
        _manda(giu + su)

    def scrivi(testo):
        evs = []
        for ch in testo.replace("\r\n", "\n"):
            if ch == "\n":
                evs += [_vk(0x0D), _vk(0x0D, True)]
                continue
            data = ch.encode("utf-16-le")
            for i in range(0, len(data), 2):
                cu = int.from_bytes(data[i:i + 2], "little")
                evs.append(INPUT(type=1, ki=KEYBDINPUT(wVk=0, wScan=cu, dwFlags=UNICODE, time=0, dwExtraInfo=0)))
                evs.append(INPUT(type=1, ki=KEYBDINPUT(wVk=0, wScan=cu, dwFlags=UNICODE | KEYUP, time=0, dwExtraInfo=0)))
        for i in range(0, len(evs), 200):
            _manda(evs[i:i + 200])
            time.sleep(0.01)

    def apri_cosa(valore):
        os.startfile(valore)  # programmi (App Paths), collegamenti, cartelle, file, siti, spotify:, ms-settings:

    def blocca():
        user32.LockWorkStation()

    def sospendi():
        ctypes.WinDLL("powrprof").SetSuspendState(False, True, False)

    def comando(args):
        subprocess.Popen(args, creationflags=0x08000000)  # senza finestra
else:
    def premi(*vks):
        log("   (prova) tasti " + "+".join(hex(v) for v in vks))

    def scrivi(testo):
        log("   (prova) scrive %r" % testo)

    def apri_cosa(valore):
        log("   (prova) apre %s" % valore)

    def blocca():
        log("   (prova) blocca")

    def sospendi():
        log("   (prova) sospendi")

    def comando(args):
        log("   (prova) comando %s" % " ".join(args))


VK = {"ctrl": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B, "invio": 0x0D, "esc": 0x1B, "tab": 0x09,
      "spazio": 0x20, "canc": 0x2E, "back": 0x08, "stamp": 0x2C, "su": 0x26, "giu": 0x28,
      "sinistra": 0x25, "destra": 0x27, "home": 0x24, "fine": 0x23, "pagsu": 0x21, "paggiu": 0x22}
for _i in range(1, 13):
    VK["f%d" % _i] = 0x6F + _i

MEDIA = {"play": 0xB3, "succ": 0xB0, "prec": 0xB1, "stop": 0xB2,
         "vol+": 0xAF, "vol-": 0xAE, "muto": 0xAD}


def combinazione(testo):
    """'ctrl+shift+esc' -> lista di codici virtuali."""
    vks = []
    for parte in testo.lower().replace(" ", "").split("+"):
        if not parte:
            continue
        if parte in VK:
            vks.append(VK[parte])
        elif len(parte) == 1 and (parte.isalnum()):
            vks.append(ord(parte.upper()))
        else:
            raise ValueError("tasto sconosciuto: " + parte)
    if not vks:
        raise ValueError("combinazione vuota")
    return vks


def esegui(azione):
    tipo = (azione or {}).get("tipo")
    val = str((azione or {}).get("valore", ""))
    if tipo == "apri":
        if not val.strip():
            raise ValueError("niente da aprire")
        apri_cosa(os.path.expandvars(val.strip()))
    elif tipo == "media":
        if val in ("vol+10", "vol-10"):
            for _ in range(5):  # ogni scatto di Windows vale 2
                premi(MEDIA[val[:4]])
                time.sleep(0.02)
        elif val in MEDIA:
            premi(MEDIA[val])
        else:
            raise ValueError("comando musica sconosciuto")
    elif tipo == "testo":
        scrivi(val)
    elif tipo == "tasti":
        premi(*combinazione(val))
    elif tipo == "sistema":
        if val == "blocca":
            blocca()
        elif val == "screenshot":
            premi(VK["win"], VK["stamp"])  # salva in Immagini\Screenshot
        elif val == "ritaglio":
            premi(VK["win"], VK["shift"], ord("S"))
        elif val == "desktop":
            premi(VK["win"], ord("D"))
        elif val == "taskmgr":
            premi(VK["ctrl"], VK["shift"], VK["esc"])
        elif val == "spegni":
            comando(["shutdown", "/s", "/t", "15"])
        elif val == "riavvia":
            comando(["shutdown", "/r", "/t", "15"])
        elif val == "annulla":
            comando(["shutdown", "/a"])
        elif val == "sospendi":
            sospendi()
        else:
            raise ValueError("comando di sistema sconosciuto")
    else:
        raise ValueError("azione sconosciuta")


# ---------------------------------------------------------------- programmi installati
def programmi_installati():
    cartelle = []
    if WINDOWS:
        for base in (os.environ.get("PROGRAMDATA", ""), os.environ.get("APPDATA", "")):
            if base:
                cartelle.append(os.path.join(base, "Microsoft", "Windows", "Start Menu", "Programs"))
    trovati = {}
    for c in cartelle:
        for radice, _dirs, files in os.walk(c):
            for f in files:
                if f.lower().endswith((".lnk", ".url")):
                    nome = f.rsplit(".", 1)[0]
                    basso = nome.lower()
                    if any(x in basso for x in ("uninstall", "disinstall", "readme", "leggimi", "help", "guida")):
                        continue
                    trovati.setdefault(basso, {"nome": nome, "percorso": os.path.join(radice, f)})
    lista = sorted(trovati.values(), key=lambda p: p["nome"].lower())
    if not lista and not WINDOWS:  # dati finti per le prove fuori da Windows
        lista = [{"nome": n, "percorso": "C:\\Prova\\" + n + ".lnk"} for n in
                 ("Audacity", "Arduino IDE", "Blender", "Discord", "GIMP", "Google Chrome", "KiCad",
                  "Spotify", "Steam", "Visual Studio Code", "VLC media player", "Word")]
    return lista


# ---------------------------------------------------------------- avvio automatico
def cartella_esecuzione_automatica():
    return os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")


def file_avvio():
    return os.path.join(cartella_esecuzione_automatica(), "MassiDeck.cmd")


def avvio_automatico(attivo=None):
    if not WINDOWS:
        return False
    f = file_avvio()
    if attivo is True:
        exe = sys.executable if getattr(sys, "frozen", False) else '%s" "%s' % (sys.executable, os.path.abspath(__file__))
        with open(f, "w", encoding="utf-8") as h:
            h.write('@start "" "%s" --avvio\r\n' % exe)
    elif attivo is False and os.path.exists(f):
        os.remove(f)
    return os.path.exists(f)


# ---------------------------------------------------------------- server
TIPI = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}
TENTATIVI = {}  # ip -> [errori, momento]
VISTI = set()


class Gestore(BaseHTTPRequestHandler):
    server_version = "MassiDeck/" + VERSIONE
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # -- utilità
    def locale(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def autorizzato(self):
        if self.locale():
            return True
        t = self.headers.get("X-Deck-Token", "")
        return bool(t) and t in SEGRETI.get("token", [])

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Deck-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def rispondi(self, codice, dati):
        corpo = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(corpo)

    def leggi(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("troppo grande")
        grezzo = self.rfile.read(n) if n else b"{}"
        return json.loads(grezzo.decode("utf-8") or "{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # -- GET
    def do_GET(self):
        ip = self.client_address[0]
        if not self.locale() and ip not in VISTI:
            VISTI.add(ip)
            log("Il telefono %s raggiunge il PC ✓" % ip)
        u = urlparse(self.path)
        p = u.path
        if p == "/api/ping":
            return self.rispondi(200, {"app": "MassiDeck", "versione": VERSIONE, "nome": socket.gethostname(),
                                       "autorizzato": self.autorizzato()})
        if p.startswith("/api/"):
            if not self.autorizzato():
                return self.rispondi(401, {"errore": "PIN richiesto"})
            if p == "/api/config":
                with LOCK:
                    return self.rispondi(200, CONFIG)
            if p == "/api/rev":
                return self.rispondi(200, {"rev": CONFIG.get("rev", 0)})
            if p == "/api/programmi":
                return self.rispondi(200, {"programmi": programmi_installati()})
            if p == "/api/pc":
                if not self.locale():
                    return self.rispondi(403, {"errore": "solo dal PC"})
                return self.rispondi(200, {"pin": SEGRETI["pin"], "ip": ip_locali(), "porta": PORTA,
                                           "nome": socket.gethostname(), "windows": WINDOWS,
                                           "avvio": avvio_automatico(), "telefoni": len(SEGRETI.get("token", [])),
                                           "registro": REGISTRO[-15:], "versione": VERSIONE, "dati": DATI,
                                           "reti": reti_windows(), "firewall": stato_firewall()})
            return self.rispondi(404, {"errore": "?"})
        # file della pagina
        if p in ("", "/"):
            p = "/index.html"
        nome = os.path.normpath(unquote(p).lstrip("/"))
        if nome.startswith("..") or os.path.isabs(nome):
            return self.rispondi(404, {"errore": "?"})
        f = os.path.join(WEB, nome)
        if not os.path.isfile(f):
            return self.rispondi(404, {"errore": "file non trovato"})
        with open(f, "rb") as h:
            corpo = h.read()
        self.send_response(200)
        self.send_header("Content-Type", TIPI.get(os.path.splitext(f)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(corpo)

    # -- POST / PUT
    def do_PUT(self):
        self.do_POST()

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            dati = self.leggi()
        except Exception:
            return self.rispondi(400, {"errore": "richiesta non valida"})

        if p == "/api/accedi":
            ip = self.client_address[0]
            err, quando = TENTATIVI.get(ip, [0, 0])
            if err >= 5 and time.time() - quando < 60:
                return self.rispondi(429, {"errore": "Troppi tentativi: aspetta un minuto"})
            if str(dati.get("pin", "")).strip() != SEGRETI["pin"]:
                TENTATIVI[ip] = [err + 1, time.time()]
                log("PIN sbagliato da %s" % ip)
                return self.rispondi(403, {"errore": "PIN sbagliato"})
            TENTATIVI.pop(ip, None)
            t = secrets.token_urlsafe(24)
            with LOCK:
                SEGRETI.setdefault("token", []).append(t)
                del SEGRETI["token"][:-20]
                salva_json(FILE_SEGRETI, SEGRETI)
            log("Telefono collegato: %s (%s)" % (ip, str(dati.get("nome", ""))[:40]))
            return self.rispondi(200, {"token": t, "nome": socket.gethostname()})

        if not self.autorizzato():
            return self.rispondi(401, {"errore": "PIN richiesto"})

        if p == "/api/esegui":
            az = dati.get("azione")
            if not az and dati.get("tasto"):
                with LOCK:
                    for pg in CONFIG["pagine"]:
                        for t in pg["tasti"]:
                            if t["id"] == dati["tasto"]:
                                az = t["azione"]
            etichetta = str(dati.get("etichetta") or (az or {}).get("valore", ""))[:40]
            try:
                esegui(az)
                log("▶ %s" % etichetta)
                return self.rispondi(200, {"ok": True})
            except Exception as e:
                log("✖ %s: %s" % (etichetta, e))
                return self.rispondi(200, {"ok": False, "errore": str(e) or e.__class__.__name__})

        if p == "/api/config":
            if not isinstance(dati.get("pagine"), list) or not dati["pagine"]:
                return self.rispondi(400, {"errore": "configurazione non valida"})
            with LOCK:
                dati["rev"] = int(CONFIG.get("rev", 0)) + 1
                CONFIG.clear()
                CONFIG.update(dati)
                salva_json(FILE_CONFIG, CONFIG)
            return self.rispondi(200, {"ok": True, "rev": CONFIG["rev"]})

        if p == "/api/ripristina":
            with LOCK:
                rev = int(CONFIG.get("rev", 0)) + 1
                CONFIG.clear()
                CONFIG.update(config_iniziale())
                CONFIG["rev"] = rev
                salva_json(FILE_CONFIG, CONFIG)
            return self.rispondi(200, {"ok": True, "rev": rev})

        # solo dal PC
        if not self.locale():
            return self.rispondi(403, {"errore": "solo dal PC"})
        if p == "/api/nuovo-pin":
            nuovo_pin()
            log("Nuovo PIN: i telefoni devono ricollegarsi")
            return self.rispondi(200, {"pin": SEGRETI["pin"]})
        if p == "/api/firewall":
            ok = sblocca_firewall()
            log("Firewall: richiesta di sblocco " + ("inviata" if ok else "annullata"))
            return self.rispondi(200, {"ok": ok})
        if p == "/api/avvio":
            return self.rispondi(200, {"avvio": avvio_automatico(bool(dati.get("attivo")))})
        if p == "/api/chiudi":
            self.rispondi(200, {"ok": True})
            threading.Thread(target=lambda: (time.sleep(0.5), os._exit(0)), daemon=True).start()
            return
        return self.rispondi(404, {"errore": "?"})


def gia_acceso():
    try:
        with socket.create_connection(("127.0.0.1", PORTA), timeout=0.5):
            return True
    except Exception:
        return False


def main():
    silenzioso = "--avvio" in sys.argv or "--nascosto" in sys.argv
    if gia_acceso():
        if not silenzioso:
            webbrowser.open("http://localhost:%d/" % PORTA)
        return
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", PORTA), Gestore)
    except OSError as e:
        if WINDOWS:
            ctypes.windll.user32.MessageBoxW(0, "La porta %d è occupata da un altro programma.\n%s" % (PORTA, e),
                                             "MassiDeck", 0x10)
        raise
    srv.daemon_threads = True
    log("MassiDeck %s acceso — dal telefono apri http://%s:%d  —  PIN %s" % (
        VERSIONE, ip_locali()[0], PORTA, SEGRETI["pin"]))
    if not silenzioso:
        threading.Timer(0.8, lambda: webbrowser.open("http://localhost:%d/" % PORTA)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
