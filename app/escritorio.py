"""Lanzador del ícono del escritorio: abre la app con doble clic, sin ventana negra.

Se ejecuta con pythonw.exe (Python sin consola):
  1. Si la app ya está funcionando con el código actual, solo abre la ventana.
  2. Si no está funcionando, la inicia escondida (sin ventana) y abre la ventana
     apenas responde. Mientras tanto se ve una pantalla de "Abriendo...".
  3. Si el código cambió desde que se inició (una actualización), la reinicia sola.
  4. Si algo falla, muestra un mensaje explicando qué hacer.
La app queda funcionando en segundo plano hasta que apagues el PC
(así también la puedes abrir desde el celular). Para cerrarla: python -m app.escritorio --cerrar

El registro del servidor queda en la carpeta de datos (servidor.log).
"""
import ctypes
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

from .config import CARPETA_DATOS, PUERTO, RAIZ

TITULO = "Buscador de Cartas Chile"
URL = f"http://localhost:{PUERTO}"
ESTADO = CARPETA_DATOS / "escritorio.json"     # pid y versión del servidor que inició este lanzador
REGISTRO = CARPETA_DATOS / "servidor.log"
CARGANDO = RAIZ / "escritorio" / "cargando.html"
SEGUNDOS_PARA_INICIAR = 90
SIN_VENTANA = 0x08000000                       # CREATE_NO_WINDOW
SEPARADO = 0x00000008 | 0x00000200             # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
FUERA_DEL_GRUPO = 0x01000000                   # CREATE_BREAKAWAY_FROM_JOB


def mensaje(texto, error=True):
    ctypes.windll.user32.MessageBoxW(0, texto, TITULO, 0x10 if error else 0x40)


def huella():
    """Cambia cada vez que cambia el código del servidor, los ajustes o las librerías."""
    archivos = [*RAIZ.glob("app/*.py"), *RAIZ.glob("adaptadores/*.py"),
                RAIZ / "ajustes.toml", RAIZ / ".env", RAIZ / "requirements.txt"]
    h = hashlib.sha1()
    for ruta in sorted(a for a in archivos if a.exists()):
        dato = ruta.stat()
        h.update(f"{ruta.relative_to(RAIZ)}|{dato.st_mtime_ns}|{dato.st_size}\n".encode())
    return h.hexdigest()


def responde():
    """True si en el puerto está esta app; False si no hay nada; None si hay otro programa."""
    try:
        with urllib.request.urlopen(f"{URL}/api/estado", timeout=3) as resp:
            return "card_kingdom" in json.loads(resp.read())
    except (urllib.error.HTTPError, ValueError):
        return None
    except OSError:
        return False


def leer_estado():
    try:
        return json.loads(ESTADO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def pid_en_puerto():
    """Proceso que escucha en el puerto de la app (por si se inició de otra forma)."""
    salida = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True,
                            creationflags=SIN_VENTANA).stdout
    for linea in salida.splitlines():
        partes = linea.split()
        if len(partes) == 5 and partes[1].endswith(f":{PUERTO}") and partes[3] == "LISTENING":
            return int(partes[4])
    return None


def detener():
    """Cierra la app (solo el proceso que de verdad está escuchando en su puerto)."""
    pid = pid_en_puerto() if responde() else None
    if pid:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=SIN_VENTANA)
    for _ in range(40):            # esperar a que el puerto quede libre
        if responde() is False:
            break
        time.sleep(0.25)
    ESTADO.unlink(missing_ok=True)


def instalar_librerias():
    """Instala lo que falte de requirements.txt (sin ventana). Devuelve el error o None."""
    resultado = subprocess.run(
        [sys.executable.replace("pythonw.exe", "python.exe"), "-m", "pip", "install", "--quiet",
         "--disable-pip-version-check", "-r", str(RAIZ / "requirements.txt")],
        capture_output=True, text=True, creationflags=SIN_VENTANA)
    return None if resultado.returncode == 0 else (resultado.stderr or resultado.stdout)[-600:]


def iniciar(version):
    requisitos = hashlib.sha1((RAIZ / "requirements.txt").read_bytes()).hexdigest()
    if leer_estado().get("requisitos") != requisitos:
        error = instalar_librerias()
        if error:
            mensaje(f"No se pudieron instalar las librerías. Revisa tu conexión a internet.\n\n{error}")
            return False
    registro = open(REGISTRO, "w", encoding="utf-8")
    orden = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(PUERTO),
             "--log-level", "warning"]
    opciones = dict(cwd=RAIZ, stdout=registro, stderr=registro, stdin=subprocess.DEVNULL, close_fds=True)
    try:
        # Independiente del lanzador: sigue funcionando aunque el programa que lo abrió se cierre
        proceso = subprocess.Popen(orden, creationflags=SIN_VENTANA | SEPARADO | FUERA_DEL_GRUPO, **opciones)
    except OSError:
        proceso = subprocess.Popen(orden, creationflags=SIN_VENTANA | SEPARADO, **opciones)
    limite = time.time() + SEGUNDOS_PARA_INICIAR
    while time.time() < limite:
        if proceso.poll() is not None:
            break                   # el servidor se cerró al partir
        if responde():
            # El pythonw del entorno virtual abre otro proceso que es el que atiende: se guarda ese
            ESTADO.write_text(json.dumps({"pid": pid_en_puerto() or proceso.pid, "version": version,
                                          "requisitos": requisitos}),
                              encoding="utf-8")
            return True
        time.sleep(0.5)
    proceso.kill()
    mensaje("La app no pudo iniciarse.\n\nCierra esta ventana y vuelve a intentarlo. Si sigue pasando, "
            f"pásale a Claude el archivo:\n{REGISTRO}")
    return False


def abrir_ventana(pantalla_de_carga=False):
    """Abre la app en una ventana propia de Edge (sin barras del navegador)."""
    destino = CARGANDO.as_uri() + f"?puerto={PUERTO}" if pantalla_de_carga else URL
    for edge in (Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft/Edge/Application/msedge.exe",
                 Path(os.environ.get("ProgramFiles", "")) / "Microsoft/Edge/Application/msedge.exe"):
        if edge.exists():
            subprocess.Popen([str(edge), f"--app={destino}"], creationflags=SIN_VENTANA)
            return
    webbrowser.open(destino)


def principal():
    if "--cerrar" in sys.argv:
        detener()
        return
    # Un solo lanzador a la vez (por si se hace doble clic varias veces)
    ctypes.windll.kernel32.CreateMutexW(None, False, "BuscadorCartasChile-lanzador")
    if ctypes.windll.kernel32.GetLastError() == 183:   # ERROR_ALREADY_EXISTS
        return

    version = huella()
    estado = responde()
    if estado is None:
        mensaje(f"Otro programa está usando el puerto {PUERTO}.\n\n"
                "Ciérralo, o cambia 'puerto' en ajustes.toml.")
        return
    if estado:
        guardado = leer_estado()
        # Si la inició este lanzador con código viejo, se reinicia. Si se abrió con iniciar.bat, se respeta.
        if guardado.get("pid") != pid_en_puerto() or guardado.get("version") == version:
            abrir_ventana()
            return
        detener()
    abrir_ventana(pantalla_de_carga=True)
    iniciar(version)


if __name__ == "__main__":
    try:
        principal()
    except Exception as error:   # sin consola: cualquier error se muestra en un mensaje
        mensaje(f"Ocurrió un error al abrir la app:\n\n{type(error).__name__}: {error}")
