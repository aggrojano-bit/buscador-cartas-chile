"""Tienda La Comarca (Shopify) - https://www.tiendalacomarca.cl

Títulos:  "Sol Ring (Borderless) [CMM - 703]"  (código de set y número)
Opciones: Condition / Language / Printing  ->  "Near Mint / English / Foil"
"""
import re

from ._shopify import AdaptadorShopify
from .base import Oferta, acabado_desde_texto, condicion, entre_corchetes, idioma, solo_disponibles


class LaComarca(AdaptadorShopify):
    id = "lacomarca"
    nombre = "La Comarca"
    url = "https://www.tiendalacomarca.cl"

    def interpretar(self, producto):
        if "magic" not in (producto.get("type") or "").lower():
            return []
        titulo = producto["title"]
        set_codigo = numero = None
        m = re.match(r"^\s*([A-Z0-9]+)\s*-\s*([A-Za-z0-9★]+)", entre_corchetes(titulo) or "")
        if m:
            set_codigo, numero = m.group(1), m.group(2)
        # "The List": "Lightning Bolt (A25) [LIST - 141/249]" -> en Scryfall es PLST "A25-141"
        origen = re.search(r"\(([A-Z0-9]{3,5})\)", titulo)
        if set_codigo == "LIST" and origen and numero:
            set_codigo, numero = "PLST", f"{origen.group(1)}-{numero.split('/')[0].lstrip('0')}"
        nombres_opciones = [o["name"].lower() for o in producto.get("options", [])]
        ofertas = []
        for v in producto["variants"]:
            opciones = dict(zip(nombres_opciones, v.get("options") or []))
            texto_condicion = opciones.get("condition", "")
            ofertas.append(Oferta(
                tienda=self.id,
                titulo=titulo,
                url=f"{self.url_producto(producto)}?variant={v['id']}",
                precio=v["price"] / 100,
                disponible=bool(v["available"]),
                condicion=condicion(texto_condicion),
                condicion_original=texto_condicion or None,
                idioma=idioma(opciones.get("language", "")),
                acabado=acabado_desde_texto(opciones.get("printing", "") + " " + titulo),
                set_codigo=set_codigo,
                numero=numero,
            ))
        return solo_disponibles(ofertas)
