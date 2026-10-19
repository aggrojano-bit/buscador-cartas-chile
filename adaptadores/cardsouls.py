"""Card Souls (Shopify) - https://www.cardsouls.cl

Títulos:   "Sol Ring [C14-270]", "Sol Ring (2539) [SLD-2539]"  -> set C14, número 270
Variantes: "Near Mint / Inglés / Foil"  (estado / idioma / versión)
La edición viene en el campo "vendor" ("Commander 2014"). La tienda no informa
cuántas unidades quedan, solo si la variante está disponible.
"""
import re

from ._shopify import AdaptadorShopify
from .base import Oferta, acabado_desde_texto, condicion, entre_corchetes, idioma, numero_entre_parentesis, solo_disponibles

CODIGO = re.compile(r"^([A-Z0-9]{2,6})-0*(\d+[a-z]?)", re.I)


class CardSouls(AdaptadorShopify):
    id = "cardsouls"
    nombre = "Card Souls"
    url = "https://www.cardsouls.cl"

    def interpretar(self, producto):
        if "singles" not in (producto.get("type") or "").lower():
            return []
        titulo = producto["title"]
        codigo = CODIGO.match(entre_corchetes(titulo) or "")
        ofertas = []
        for v in producto["variants"]:
            partes = [p.strip() for p in v["title"].split("/")]
            estado = partes[0] if partes else ""
            texto_idioma = partes[1] if len(partes) > 1 else ""
            version = partes[2] if len(partes) > 2 else ""
            ofertas.append(Oferta(
                tienda=self.id,
                titulo=titulo,
                url=f"{self.url_producto(producto)}?variant={v['id']}",
                precio=v["price"] / 100,
                disponible=bool(v["available"]),
                condicion=condicion(estado),
                condicion_original=v["title"],
                idioma=idioma(texto_idioma),
                acabado=acabado_desde_texto(version + " " + titulo),
                set_codigo=codigo.group(1) if codigo else None,
                set_nombre=producto.get("vendor") or None,
                numero=codigo.group(2) if codigo else numero_entre_parentesis(titulo),
            ))
        return solo_disponibles(ofertas)
