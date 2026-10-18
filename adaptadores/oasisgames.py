"""Oasis Games (Shopify) - https://www.oasisgames.cl

Títulos:   "Sol Ring (1011) [Secret Lair Drop Series]"
Variantes: "Near Mint", "Lightly Played Foil Spanish", ...
SKU:       "CMM-703-EN-FO-1"  (set - número - idioma - NF/FO - condición)
El idioma del SKU no siempre es correcto, así que se toma del nombre de la variante.
"""
import re

from ._shopify import AdaptadorShopify
from .base import Oferta, acabado_desde_texto, condicion, entre_corchetes, idioma, numero_entre_parentesis, solo_disponibles

# A veces trae una parte extra: "SLD-1011-SOL-EN-NF-1"
SKU = re.compile(r"^([A-Z0-9]+)-([A-Z0-9]+)-(?:[A-Z0-9]+-)*([A-Z]{2})-([A-Z]{2})-\d$", re.I)


class OasisGames(AdaptadorShopify):
    id = "oasisgames"
    nombre = "Oasis Games"
    url = "https://www.oasisgames.cl"
    tipo_producto = "MTG Single"

    def interpretar(self, producto):
        if producto.get("type") != self.tipo_producto:
            return []
        titulo = producto["title"]
        es_etched = "etched" in titulo.lower()
        ofertas = []
        for v in producto["variants"]:
            sku = SKU.match(v.get("sku") or "")
            acabado = acabado_desde_texto(v["title"])
            if acabado == "foil" and es_etched:
                acabado = "etched"
            ofertas.append(Oferta(
                tienda=self.id,
                titulo=titulo,
                url=f"{self.url_producto(producto)}?variant={v['id']}",
                precio=v["price"] / 100,
                disponible=bool(v["available"]),
                condicion=condicion(v["title"]),
                condicion_original=v["title"],
                idioma=idioma(v["title"]) or "EN",
                acabado=acabado,
                set_codigo=sku.group(1) if sku else None,
                set_nombre=entre_corchetes(titulo),
                numero=sku.group(2) if sku else numero_entre_parentesis(titulo),
            ))
        return solo_disponibles(ofertas)
