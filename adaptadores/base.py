"""Estructura común de todos los adaptadores de tiendas.

Cada tienda es una clase que hereda de Adaptador y define:
  - id, nombre, url, pais, moneda
  - async buscar(nombre_carta, ediciones, avance) -> lista de Oferta
      ediciones: las ediciones de Scryfall (algunas tiendas las usan)
      avance:    lista donde la tienda puede ir agregando ofertas mientras busca,
                 para que la página las muestre antes de que termine
Las pausas entre peticiones y el User-Agent los pone app/red.py.
"""
import asyncio
import re
import unicodedata
from dataclasses import asdict, dataclass

from app import red
from app.config import AJUSTES


class ErrorTienda(Exception):
    """La tienda respondió algo inesperado (caída, bloqueo, cambio de diseño)."""


@dataclass
class Oferta:
    tienda: str                     # id de la tienda
    titulo: str                     # nombre del producto tal como lo publica la tienda
    url: str
    precio: float
    moneda: str = "CLP"
    disponible: bool = True
    stock: int | None = None        # cantidad, si la tienda la informa
    condicion: str | None = None    # NM, LP, MP, HP, DMG (None = la tienda no lo indica)
    condicion_original: str | None = None
    idioma: str | None = None       # EN, ES, JA... (None = no indicado)
    acabado: str = "normal"         # normal, foil o etched
    # Pistas para emparejar con la edición correcta
    set_codigo: str | None = None
    set_nombre: str | None = None
    numero: str | None = None
    scryfall_id: str | None = None  # si la fuente ya trae el id de Scryfall, el emparejamiento es exacto
    stock_conocido: bool = True     # False = la fuente no informa si hay stock (Card Kingdom)

    def a_dict(self):
        return asdict(self)


class Adaptador:
    id = ""
    nombre = ""
    url = ""
    pais = "CL"
    moneda = "CLP"
    pausa = None   # segundos entre peticiones a esta tienda; None = valor de ajustes.toml

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        raise NotImplementedError

    async def get(self, url, params=None):
        pausa = self.pausa if self.pausa is not None else AJUSTES["peticiones"]["pausa_tiendas"]
        for intento in range(REINTENTOS_429 + 1):
            resp = await red.obtener(url, pausa=pausa, params=params)
            if resp.status_code != 429 or intento == REINTENTOS_429:
                break
            # "429: demasiadas consultas": se espera lo que pide la tienda (Retry-After) y se reintenta
            await asyncio.sleep(_segundos_de_espera(resp, intento))
        if resp.status_code in (403, 429, 503):
            raise ErrorTienda(f"la tienda bloqueó o limitó la consulta (HTTP {resp.status_code})")
        if resp.status_code >= 500:
            raise ErrorTienda(f"la tienda respondió con error (HTTP {resp.status_code})")
        return resp

    def info(self):
        return {"id": self.id, "nombre": self.nombre, "url": self.url, "pais": self.pais, "moneda": self.moneda}


REINTENTOS_429 = 2


def _segundos_de_espera(resp, intento):
    """Lo que indica el encabezado Retry-After (máximo 30 s); si no viene, 5 s, 10 s..."""
    try:
        return min(30.0, max(1.0, float(resp.headers.get("retry-after", ""))))
    except ValueError:
        return 5.0 * (intento + 1)


# ---------- Utilidades para leer títulos y atributos ----------

def normalizar(texto):
    """Minúsculas, sin tildes y con espacios simples."""
    texto = unicodedata.normalize("NFKD", texto or "")
    texto = "".join(c for c in texto if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", texto.replace("’", "'")).strip()


def slug(texto):
    """'Ajani's Pridemate' -> 'ajanis-pridemate' (como los enlaces de Shopify)."""
    return re.sub(r"[^a-z0-9]+", "-", normalizar(texto).replace("'", "")).strip("-")


def nombre_coincide(titulo, nombre_carta):
    """True si el título del producto empieza con el nombre de la carta."""
    t = normalizar(titulo)
    t = re.sub(r"^(mtg|magic)\s*[:\-]?\s*", "", t)
    n = normalizar(nombre_carta.split(" // ")[0])
    return t.startswith(n) and (len(t) == len(n) or not t[len(n)].isalnum())


def entre_corchetes(titulo):
    m = re.search(r"\[([^\]]+)\]", titulo or "")
    return m.group(1).strip() if m else None


def numero_entre_parentesis(titulo):
    """'Sol Ring (1011) [Secret Lair]' -> '1011'"""
    m = re.search(r"\((\d{1,4}[a-z]?)\)", titulo or "")
    return m.group(1) if m else None


_CONDICIONES = [
    (("near mint", "nm", "mint", "nuevo", "nueva"), "NM"),
    (("lightly played", "slightly played", "excellent", "lp", "ex", "sp"), "LP"),
    (("moderately played", "very good", "mp", "vg"), "MP"),
    (("heavily played", "good", "hp", "played"), "HP"),
    (("damaged", "poor", "dmg", "dm"), "DMG"),
]


def condicion(texto):
    t = normalizar(texto)
    for claves, codigo in _CONDICIONES:
        if any(re.search(rf"\b{re.escape(c)}\b", t) for c in claves):
            return codigo
    return None


_IDIOMAS = {
    "EN": ("english", "ingles", "ing", "eng"),
    "ES": ("spanish", "espanol", "esp"),
    "JA": ("japanese", "japones", "jap", "jpn"),
    "PT": ("portuguese", "portugues"),
    "FR": ("french", "frances"),
    "DE": ("german", "aleman"),
    "IT": ("italian", "italiano"),
    "ZH": ("chinese", "chino"),
    "KO": ("korean", "coreano"),
    "RU": ("russian", "ruso"),
}
_CODIGOS_IDIOMA = {"en": "EN", "es": "ES", "ja": "JA", "jp": "JA", "pt": "PT", "fr": "FR",
                   "de": "DE", "it": "IT", "zh": "ZH", "ko": "KO", "ru": "RU"}


def idioma(texto, codigo_corto=False):
    """Detecta el idioma en un texto. Con codigo_corto=True acepta también 'EN', 'ES'...
    (solo para campos cortos como un SKU, nunca para títulos)."""
    t = normalizar(texto)
    if codigo_corto and t in _CODIGOS_IDIOMA:
        return _CODIGOS_IDIOMA[t]
    for codigo, palabras in _IDIOMAS.items():
        if any(re.search(rf"\b{p}\b", t) for p in palabras):
            return codigo
    return None


def acabado_desde_texto(texto):
    t = normalizar(texto)
    if "etched" in t:
        return "etched"
    if re.search(r"\bfoil\b", t) and not re.search(r"\b(no|non|sin) ?foil\b", t):
        return "foil"
    return "normal"


def solo_disponibles(ofertas):
    """De las variantes de un producto deja las que tienen stock.
    Si ninguna tiene, deja una (la más barata) marcada como agotada."""
    ofertas = [o for o in ofertas if o.precio > 0]
    con_stock = [o for o in ofertas if o.disponible]
    if con_stock or not ofertas:
        return con_stock
    # Como referencia de "agotado" se prefiere la variante NM más barata
    return [min(ofertas, key=lambda o: (o.condicion != "NM", o.precio))]
