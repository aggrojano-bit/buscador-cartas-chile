"""Empareja cada oferta de una tienda con la edición correcta de Scryfall.

Orden de confianza:
  0. id de Scryfall entregado por la propia fuente  (exacto)
  1. código de set + número de coleccionista  (exacto)
  2. nombre de la edición + número
  3. nombre de la edición, si en esa edición hay una sola versión compatible
     (mismo acabado y mismas palabras de variante: borderless, showcase...)
Si quedan dudas, la oferta NO se asigna: va a "posibles coincidencias".
"""
import re

from adaptadores.base import normalizar

# Palabras que no ayudan a distinguir ediciones
_IGNORAR = {"the", "of", "and", "series", "edition", "set", "magic", "mtg", "legal", "universes", "beyond", "decks"}

# Palabras de los títulos de tienda -> etiqueta de variante de Scryfall (ver scryfall.py)
_VARIANTES = [
    (r"\bborderless\b|sin borde", "Borderless"),
    (r"\bshowcase\b", "Showcase"),
    (r"\bextended\b|arte extendido", "Arte extendido"),
    (r"\bretro\b|old frame|marco retro", "Marco retro"),
    (r"\bfull art\b", "Arte completo"),
    (r"\btextless\b", "Sin texto"),
    (r"\bserialized\b|numerada", "Numerada"),
    (r"\bsurge foil\b", "Surge foil"),
    (r"\bgalaxy foil\b", "Galaxy foil"),
    (r"\bhalo foil\b", "Halo foil"),
    (r"\btextured\b", "Texturizada"),
    (r"japanese art|arte japones", "Idioma: JA"),
]
_ETIQUETAS_VARIANTE = {etiqueta for _, etiqueta in _VARIANTES}


# Nombres que algunas tiendas usan distinto a Scryfall
_ALIAS = {
    "alpha edition": "limited edition alpha",
    "beta edition": "limited edition beta",
    "unlimited": "unlimited edition",
    "revised": "revised edition",
    "3rd edition": "revised edition",
    "4th edition": "fourth edition",
    "5th edition": "fifth edition",
    "6th edition": "classic sixth edition",
    "7th edition": "seventh edition",
    "8th edition": "eighth edition",
    "9th edition": "ninth edition",
    "10th edition": "tenth edition",
}


def _palabras_set(nombre):
    n = normalizar(nombre)
    n = _ALIAS.get(n, n)
    n = re.sub(r"\bftv\b", "from the vault", n)
    n = re.sub(r"^(20(?:09|1[0-5])) core set$", r"magic \1", n)   # "2011 Core Set" -> "Magic 2011"
    n = re.sub(r"^\(\d{4}\)\s*", "", n).replace("&", " and ").replace("40,000", "40000").replace("40.000", "40000")
    return {p for p in re.findall(r"[a-z0-9]+", n) if p not in _IGNORAR}


def _similitud(a, b):
    pa, pb = _palabras_set(a), _palabras_set(b)
    if not pa or not pb:
        return 0.0
    return len(pa & pb) / len(pa | pb)


def _numero(n):
    n = normalizar(str(n)).split("/")[0].strip()
    return n.lstrip("0") or "0"


# Para los adaptadores que necesitan comparar ediciones por su cuenta
numero_normalizado = _numero


def _variantes_titulo(titulo):
    t = normalizar(titulo)
    return {etiqueta for patron, etiqueta in _VARIANTES if re.search(patron, t)}


def _variantes_edicion(e):
    return set(e["variantes"]) & _ETIQUETAS_VARIANTE


def emparejar(oferta, ediciones):
    """Devuelve (id_edicion | None, explicación, [ids candidatos])."""
    # 0) La fuente ya trae el id de Scryfall (Card Kingdom vía MTGJSON, CardTrader)
    if oferta.get("scryfall_id"):
        if any(e["id"] == oferta["scryfall_id"] for e in ediciones):
            return oferta["scryfall_id"], "id de Scryfall", []
        return None, "la edición no está en el catálogo", []

    numero = _numero(oferta["numero"]) if oferta.get("numero") else None
    codigo = (oferta.get("set_codigo") or "").lower()

    # 1) Código de set + número
    if codigo and numero:
        exactas = [e for e in ediciones if e["set"].lower() == codigo and _numero(e["numero"]) == numero]
        if len(exactas) == 1:
            return exactas[0]["id"], "código de edición y número", []

    # 2) Candidatas por nombre de edición (o por código si no hay nombre)
    candidatas = []
    if oferta.get("set_nombre"):
        puntajes = [(_similitud(oferta["set_nombre"], e["set_nombre"]), e) for e in ediciones]
        mejor = max((p for p, _ in puntajes), default=0)
        if mejor >= 0.75:
            candidatas = [e for p, e in puntajes if p == mejor]
    if not candidatas and codigo:
        candidatas = [e for e in ediciones if e["set"].lower() == codigo]
    if not candidatas:
        return None, "no se reconoce la edición", []

    if numero:
        con_numero = [e for e in candidatas if _numero(e["numero"]) == numero]
        if len(con_numero) == 1:
            return con_numero[0]["id"], "nombre de edición y número", []
        if con_numero:
            candidatas = con_numero

    # 3) Mismo acabado y mismas variantes
    compatibles = [e for e in candidatas if oferta["acabado"] in e["acabados"]]
    if not compatibles:
        return None, f"la edición no existe en versión {oferta['acabado']}", [e["id"] for e in candidatas[:8]]
    palabras = _variantes_titulo(oferta["titulo"])
    iguales = [e for e in compatibles if _variantes_edicion(e) == palabras]
    if len(iguales) == 1:
        motivo = "nombre de edición" + (" y variante" if palabras else "")
        return iguales[0]["id"], motivo, []
    if not iguales:
        # Si el título no dice "arte japonés", se descartan las versiones japonesas
        if "Idioma: JA" not in palabras:
            compatibles = [e for e in compatibles if "Idioma: JA" not in e["variantes"]] or compatibles
        # Una sola versión que tenga todas las variantes del título
        contienen = [e for e in compatibles if palabras <= _variantes_edicion(e)]
        if len(contienen) == 1:
            return contienen[0]["id"], "nombre de edición y variante", []
    return None, "hay varias versiones posibles en esa edición", [e["id"] for e in (iguales or compatibles)[:8]]
