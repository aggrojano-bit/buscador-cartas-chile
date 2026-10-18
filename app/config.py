"""Lee ajustes.toml y define las carpetas del proyecto."""
import os
import tomllib
from pathlib import Path

# Carpeta raíz del proyecto (donde está ajustes.toml)
RAIZ = Path(__file__).resolve().parent.parent

with open(RAIZ / "ajustes.toml", "rb") as archivo:
    AJUSTES = tomllib.load(archivo)

# Los datos (caché, carrito) van fuera de OneDrive para que no se corrompan.
_carpeta = AJUSTES["general"].get("carpeta_datos", "").strip()
if _carpeta:
    CARPETA_DATOS = Path(_carpeta)
else:
    CARPETA_DATOS = Path(os.environ.get("LOCALAPPDATA", RAIZ)) / "BuscadorCartasChile" / "datos"
CARPETA_DATOS.mkdir(parents=True, exist_ok=True)
