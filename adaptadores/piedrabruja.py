"""Piedra Bruja (Shopify) - https://piedrabruja.cl

Cada producto es una sola carta (sin variantes):
  título   "Negate Regular Foil (ingles) 47"
  etiquetas "setcode-tmt", "foil" / "nonfoil", rareza
La tienda no indica la condición.
"""
import re

from ._shopify import AdaptadorShopify
from .base import Oferta, idioma, solo_disponibles


class PiedraBruja(AdaptadorShopify):
    id = "piedrabruja"
    nombre = "Piedra Bruja"
    url = "https://piedrabruja.cl"

    def interpretar(self, producto):
        if producto.get("type") != "singlemtg":
            return []
        titulo = producto["title"]
        etiquetas = [t.lower() for t in producto.get("tags", [])]
        set_codigo = next((t[len("setcode-"):] for t in etiquetas if t.startswith("setcode-")), None)
        numero = re.search(r"(\d+[a-z]?)\s*$", titulo)
        if "etched" in etiquetas or "etched" in titulo.lower():
            acabado = "etched"
        elif "foil" in etiquetas:
            acabado = "foil"
        else:
            acabado = "normal"
        ofertas = [Oferta(
            tienda=self.id,
            titulo=titulo,
            url=f"{self.url_producto(producto)}?variant={v['id']}",
            precio=v["price"] / 100,
            disponible=bool(v["available"]),
            idioma=idioma(titulo),
            acabado=acabado,
            set_codigo=set_codigo,
            numero=numero.group(1) if numero else None,
        ) for v in producto["variants"]]
        return solo_disponibles(ofertas)
