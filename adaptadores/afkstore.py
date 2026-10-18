"""AFK Store (Shopify) - https://www.afkstore.cl

  título     "Sol Ring (Borderless) M0359"   -> número 359 (la letra inicial no es parte del número)
  etiquetas  "edicion_secretlair", "edicion_Universes_Beyond_Fallout"  -> posibles ediciones
  variantes  "Ingles", "Ingles Foil"
La tienda no indica la condición. Como a veces trae más de una etiqueta de edición,
se usa la lista de ediciones de Scryfall para quedarse con la que calza con el número.
"""
import re
from contextvars import ContextVar

from app.emparejar import numero_normalizado

from ._shopify import AdaptadorShopify
from .base import Oferta, acabado_desde_texto, idioma, normalizar, solo_disponibles


def _pegado(texto):
    """'The Lost Caverns of Ixalan' -> 'thelostcavernsofixalan' (las etiquetas de la tienda vienen así)"""
    return re.sub(r"[^a-z0-9]", "", normalizar(texto))

# Ediciones de la búsqueda en curso (separadas por búsqueda, aunque haya varias a la vez)
_ediciones = ContextVar("ediciones_afk", default=[])


class AFKStore(AdaptadorShopify):
    id = "afkstore"
    nombre = "AFK Store"
    url = "https://www.afkstore.cl"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        _ediciones.set(ediciones or [])
        return await super().buscar(nombre_carta, ediciones, avance)

    def _edicion_exacta(self, nombres_set, numero):
        """Id de Scryfall si una sola edición calza con alguna etiqueta y con el número."""
        if not numero:
            return None
        etiquetas = [_pegado(n) for n in nombres_set if len(_pegado(n)) >= 3]
        calzan = [e for e in _ediciones.get()
                  if numero_normalizado(e["numero"]) == numero_normalizado(numero)
                  and any(t in _pegado(e["set_nombre"]) or _pegado(e["set_nombre"]) in t for t in etiquetas)]
        return calzan[0]["id"] if len(calzan) == 1 else None

    def interpretar(self, producto):
        if producto.get("type") != "Singles Magic":
            return []
        titulo = producto["title"]
        numero = re.search(r"\b[A-Z]?0*(\d{1,4}[a-z]?)\s*$", titulo)
        numero = numero.group(1) if numero else None
        nombres_set = [t[len("edicion_"):].replace("_", " ") for t in producto.get("tags", [])
                       if t.lower().startswith("edicion_")]
        scryfall_id = self._edicion_exacta(nombres_set, numero)
        es_etched = "etched" in titulo.lower()
        ofertas = []
        for v in producto["variants"]:
            acabado = acabado_desde_texto(v["title"])
            if acabado == "foil" and es_etched:
                acabado = "etched"
            ofertas.append(Oferta(
                tienda=self.id,
                titulo=titulo,
                url=f"{self.url_producto(producto)}?variant={v['id']}",
                precio=v["price"] / 100,
                disponible=bool(v["available"]),
                idioma=idioma(v["title"]),
                acabado=acabado,
                set_nombre=nombres_set[0] if nombres_set else None,
                numero=numero,
                scryfall_id=scryfall_id,
            ))
        return solo_disponibles(ofertas)
