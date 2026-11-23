"""Lo que abre el ícono del escritorio. Deja todo listo solo, sin ventana negra:
  - si falta el entorno de Python (primera vez, o se dañó), lo crea e instala las librerías,
    mostrando una ventanita de "Preparando...";
  - después abre la app (app/escritorio.py).
Usa el Python del sistema (pyw.exe), así funciona aunque el entorno todavía no exista.
"""
import ctypes
import os
import subprocess
import sys
import threading
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
VENV = Path(os.environ["LOCALAPPDATA"]) / "BuscadorCartasChile" / "venv"
PYTHONW = VENV / "Scripts" / "pythonw.exe"
TITULO = "Buscador de Cartas Chile"
SIN_VENTANA = 0x08000000


def entorno_sano():
    """El entorno existe y el Python con que se creó sigue instalado."""
    try:
        cfg = (VENV / "pyvenv.cfg").read_text(encoding="utf-8")
    except OSError:
        return False
    home = next((l.split("=", 1)[1].strip() for l in cfg.splitlines() if l.startswith("home")), "")
    return PYTHONW.exists() and Path(home, "python.exe").exists()


def preparar():
    """Crea (o rehace) el entorno e instala las librerías. Devuelve el error o None."""
    python = Path(sys.executable).with_name("python.exe")
    pasos = [[str(python), "-m", "venv", "--clear", str(VENV)],
             [str(VENV / "Scripts" / "python.exe"), "-m", "pip", "install", "--quiet",
              "--disable-pip-version-check", "-r", str(RAIZ / "requirements.txt")]]
    for paso in pasos:
        r = subprocess.run(paso, capture_output=True, text=True, creationflags=SIN_VENTANA)
        if r.returncode:
            return (r.stderr or r.stdout)[-600:]
    return None


def preparar_con_ventana():
    import tkinter as tk
    from tkinter import ttk
    ventana = tk.Tk()
    ventana.title(TITULO)
    ventana.resizable(False, False)
    tk.Label(ventana, text="Preparando el Buscador por primera vez…\nTarda 1 a 3 minutos (necesita internet).",
             padx=24, pady=14, font=("Segoe UI", 11)).pack()
    barra = ttk.Progressbar(ventana, mode="indeterminate", length=300)
    barra.pack(padx=24, pady=(0, 18))
    barra.start(12)
    resultado = {}
    hilo = threading.Thread(target=lambda: resultado.update(error=preparar()), daemon=True)
    hilo.start()

    def revisar():
        if hilo.is_alive():
            ventana.after(300, revisar)
        else:
            ventana.destroy()
    revisar()
    ventana.mainloop()
    return resultado.get("error")


def principal():
    if not entorno_sano():
        error = preparar_con_ventana()
        if error:
            ctypes.windll.user32.MessageBoxW(
                0, f"No se pudo preparar la app. Revisa tu conexión a internet y vuelve a intentarlo.\n\n{error}",
                TITULO, 0x10)
            return
    subprocess.Popen([str(PYTHONW), "-m", "app.escritorio"], cwd=RAIZ, creationflags=SIN_VENTANA)


if __name__ == "__main__":
    try:
        principal()
    except Exception as error:
        ctypes.windll.user32.MessageBoxW(0, f"Ocurrió un error al abrir la app:\n\n{type(error).__name__}: {error}",
                                         TITULO, 0x10)
