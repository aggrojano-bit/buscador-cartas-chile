"""Lee ajustes.toml, el archivo privado .env y define las carpetas del proyecto."""
import os
import tomllib
from pathlib import Path

# Carpeta raíz del proyecto (donde está ajustes.toml)
RAIZ = Path(__file__).resolve().parent.parent

with open(RAIZ / "ajustes.toml", "rb") as archivo:
    AJUSTES = tomllib.load(archivo)


def _cargar_env(ruta):
    """Lee líneas CLAVE=valor del archivo .env (datos privados que NO se suben a GitHub).
    Las variables que ya existen en el sistema (por ejemplo en Render) tienen prioridad."""
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))


_cargar_env(RAIZ / ".env")

# Datos privados (ver .env.example)
CARDTRADER_TOKEN = os.environ.get("CARDTRADER_TOKEN", "").strip()
CONTACTO = os.environ.get("CONTACTO", "").strip()

# True cuando la app corre publicada en Render (ahí se consulta a las tiendas más despacio)
EN_SERVIDOR = bool(os.environ.get("RENDER"))

# Puerto: Render (u otro servicio) lo indica con la variable PORT
PUERTO = int(os.environ.get("PORT") or AJUSTES["general"].get("puerto", 8001))

# Los datos (caché, carrito) van fuera de OneDrive para que no se corrompan.
_carpeta = os.environ.get("CARPETA_DATOS") or AJUSTES["general"].get("carpeta_datos", "").strip()
if _carpeta:
    CARPETA_DATOS = Path(_carpeta)
elif os.environ.get("LOCALAPPDATA"):
    CARPETA_DATOS = Path(os.environ["LOCALAPPDATA"]) / "BuscadorCartasChile" / "datos"
else:
    CARPETA_DATOS = RAIZ / "datos"   # Linux / servidores
CARPETA_DATOS.mkdir(parents=True, exist_ok=True)
