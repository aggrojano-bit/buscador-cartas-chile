"""Catálogo de Magic desde la API de Scryfall (https://scryfall.com/docs/api).

Scryfall pide: User-Agent propio, pausa de 50-100 ms entre peticiones
y guardar en caché lo que se pueda. Todo eso se respeta aquí.
"""
import re
import unicodedata

from . import db, red
from .config import AJUSTES

API = "https://api.scryfall.com"
PAUSA = AJUSTES["peticiones"]["pausa_scryfall"]
HORAS = AJUSTES["cache"]["horas_catalogo"]

RAREZAS = {
    "common": "Común",
    "uncommon": "Infrecuente",
    "rare": "Rara",
    "mythic": "Mítica",
    "special": "Especial",
    "bonus": "Bonus",
}

EFECTOS_MARCO = {
    "showcase": "Showcase",
    "extendedart": "Arte extendido",
    "etched": "Etched",
    "inverted": "Invertida",
    "shatteredglass": "Vidrio roto",
}

TIPOS_PROMO = {
    "serialized": "Numerada",
    "textured": "Texturizada",
    "galaxyfoil": "Galaxy foil",
    "surgefoil": "Surge foil",
    "halofoil": "Halo foil",
    "rainbowfoil": "Rainbow foil",
    "confettifoil": "Confetti foil",
    "raisedfoil": "Raised foil",
    "doublerainbow": "Double rainbow",
    "oilslick": "Oil slick",
    "stepandcompleat": "Step-and-compleat",
    "neonink": "Tinta neón",
    "gilded": "Gilded",
    "fracturefoil": "Fracture foil",
    "manafoil": "Mana foil",
    "firstplacefoil": "First place foil",
}


class ErrorScryfall(Exception):
    pass


async def _get(ruta, params=None):
    resp = await red.obtener(API + ruta, pausa=PAUSA, params=params)
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise ErrorScryfall(f"Scryfall respondió {resp.status_code}")
    return resp.json()


def _limpiar(texto):
    """Quita caracteres que tienen significado especial en la búsqueda de Scryfall."""
    return re.sub(r'[\"():<>=!]', " ", texto).strip()


def _normalizar(texto):
    """Minúsculas y sin tildes: "Relámpago" -> "relampago"."""
    sin_tildes = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in sin_tildes if not unicodedata.combining(c)).lower()


def _calza_comienzos(nombre, texto):
    """True si cada palabra escrita es el comienzo de alguna palabra del nombre."""
    palabras = re.findall(r"\w+", _normalizar(nombre))
    return all(any(p.startswith(t) for p in palabras) for t in re.findall(r"\w+", _normalizar(texto)))


def _es_duplicado_arte(nombre):
    # "Sol Ring // Sol Ring" son tarjetas de arte (Art Series), no la carta jugable
    partes = nombre.split(" // ")
    return len(partes) == 2 and partes[0] == partes[1]


async def autocompletar(texto):
    texto = _limpiar(texto)
    if len(texto) < 2:
        return []
    clave = f"auto:{texto.lower()}"
    guardado = db.cache_leer(clave)
    if guardado is not None:
        return guardado

    sugerencias = []
    vistos = set()

    # 1) Nombres en inglés (endpoint oficial de autocompletado)
    datos = await _get("/cards/autocomplete", {"q": texto})
    for nombre in (datos or {}).get("data", []):
        if not _es_duplicado_arte(nombre) and nombre not in vistos:
            vistos.add(nombre)
            sugerencias.append({"nombre": nombre, "mostrar": nombre, "idioma": "en"})

    # 2) Nombres impresos en español (búsqueda en cartas con lang:es)
    if len(texto) >= 3:
        datos = await _get("/cards/search", {"q": f"lang:es {texto}", "unique": "prints", "order": "name"})
        for carta in (datos or {}).get("data", []):
            nombre = carta["name"]
            impreso = carta.get("printed_name") or (carta.get("card_faces") or [{}])[0].get("printed_name")
            if nombre in vistos or not impreso or not _calza_comienzos(impreso, texto):
                continue
            vistos.add(nombre)
            sugerencias.append({"nombre": nombre, "mostrar": f"{impreso} ({nombre})", "idioma": "es",
                                "impreso": impreso})

    # Orden: coincidencia exacta, luego "empieza con", luego el resto (sort mantiene inglés antes)
    buscado = _normalizar(texto)

    def prioridad(s):
        nombre = _normalizar(s.get("impreso") or s["nombre"])
        return 0 if nombre == buscado else 1 if nombre.startswith(buscado) else 2

    sugerencias.sort(key=prioridad)
    sugerencias = sugerencias[:20]
    for s in sugerencias:
        s.pop("impreso", None)

    db.cache_guardar(clave, sugerencias, HORAS)
    return sugerencias


async def _buscar_carta(nombre):
    """Encuentra la carta por nombre exacto, aproximado o en español."""
    carta = await _get("/cards/named", {"exact": nombre})
    if carta is None:
        carta = await _get("/cards/named", {"fuzzy": nombre})
    if carta is None:
        datos = await _get("/cards/search", {"q": f"lang:es {_limpiar(nombre)}", "unique": "prints"})
        if datos and datos.get("data"):
            carta = datos["data"][0]
    return carta


def _imagenes(carta):
    uris = carta.get("image_uris") or (carta.get("card_faces") or [{}])[0].get("image_uris") or {}
    return uris.get("normal"), uris.get("large") or uris.get("normal")


def _variantes(c):
    etiquetas = []
    if c.get("border_color") == "borderless":
        etiquetas.append("Borderless")
    for efecto in c.get("frame_effects") or []:
        if efecto in EFECTOS_MARCO:
            etiquetas.append(EFECTOS_MARCO[efecto])
    if c.get("full_art"):
        etiquetas.append("Arte completo")
    if c.get("textless"):
        etiquetas.append("Sin texto")
    if c.get("frame") in ("1993", "1997") and c.get("released_at", "") >= "2004":
        etiquetas.append("Marco retro")
    for promo in c.get("promo_types") or []:
        if promo in TIPOS_PROMO:
            etiquetas.append(TIPOS_PROMO[promo])
    if c.get("promo"):
        etiquetas.append("Promo")
    if c.get("variation"):
        etiquetas.append("Variación")
    if c.get("oversized"):
        etiquetas.append("Sobredimensionada")
    if c.get("lang", "en") != "en":
        etiquetas.append(f"Idioma: {c['lang'].upper()}")
    return list(dict.fromkeys(etiquetas))  # sin repetidos, en orden


def _edicion(c):
    imagen, imagen_grande = _imagenes(c)
    precios = c.get("prices") or {}
    compra = c.get("purchase_uris") or {}

    def numero(valor):
        return float(valor) if valor else None

    return {
        "id": c["id"],
        "nombre": c["name"],
        "nombre_impreso": c.get("printed_name"),
        "set": c["set"].upper(),
        "set_nombre": c["set_name"],
        "numero": c["collector_number"],
        "rareza": RAREZAS.get(c.get("rarity"), c.get("rarity", "").capitalize()),
        "rareza_clave": c.get("rarity"),
        "fecha": c.get("released_at"),
        "idioma": c.get("lang"),
        "imagen": imagen,
        "imagen_grande": imagen_grande,
        # nonfoil se renombra a "normal" para usar el mismo nombre que Card Kingdom
        "acabados": ["normal" if f == "nonfoil" else f for f in c.get("finishes", [])],
        "variantes": _variantes(c),
        "precios_scryfall": {
            "tcgplayer": {"normal": numero(precios.get("usd")), "foil": numero(precios.get("usd_foil")),
                          "etched": numero(precios.get("usd_etched"))},
            "cardmarket": {"normal": numero(precios.get("eur")), "foil": numero(precios.get("eur_foil")),
                           "etched": numero(precios.get("eur_etched"))},
        },
        "enlaces": {
            "scryfall": c.get("scryfall_uri"),
            "tcgplayer": compra.get("tcgplayer"),
            "cardmarket": compra.get("cardmarket"),
        },
    }


async def ediciones(nombre):
    """Devuelve la carta y todas sus ediciones en papel, de la más nueva a la más antigua."""
    clave = f"ediciones:{nombre.lower()}"
    guardado = db.cache_leer(clave)
    if guardado is not None:
        return guardado

    carta = await _buscar_carta(nombre)
    if carta is None:
        return None

    lista = []
    datos = await _get("/cards/search", {
        "q": f"oracleid:{carta['oracle_id']} game:paper",
        "unique": "prints",
        "include_extras": "true",
        "include_variations": "true",
        "order": "released",
        "dir": "desc",
    })
    while datos:
        lista.extend(_edicion(c) for c in datos["data"])
        if not datos.get("has_more"):
            break
        resp = await red.obtener(datos["next_page"], pausa=PAUSA)
        datos = resp.json() if resp.status_code == 200 else None

    resultado = {
        "carta": {
            "nombre": carta["name"],
            "tipo": carta.get("type_line") or (carta.get("card_faces") or [{}])[0].get("type_line"),
            "coste": carta.get("mana_cost") or (carta.get("card_faces") or [{}])[0].get("mana_cost"),
        },
        "ediciones": lista,
    }
    db.cache_guardar(clave, resultado, HORAS)
    # También bajo el nombre oficial, por si se buscó en español o con errores
    db.cache_guardar(f"ediciones:{carta['name'].lower()}", resultado, HORAS)
    return resultado


def olvidar(nombre):
    db.cache_borrar(f"ediciones:{nombre.lower()}")
