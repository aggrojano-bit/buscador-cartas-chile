"""Magic4ever Singles (Jumpseller) - https://www.magic4ever.cl

Su robots.txt prohíbe el buscador, así que se usa su sitemap (ver _jumpseller_sitemap.py).
  SKU       "M-SOC-0128"                        -> set SOC, número 128
  categoría "Secrets of Strixhaven Commander (SOC)"
  opciones  Lenguaje / Acabado ("No Foil") / Condición ("NM")
"""
import re

from ._jumpseller_sitemap import AdaptadorJumpsellerSitemap, precio_y_disponibilidad
from .base import Oferta, acabado_desde_texto, condicion, idioma


class Magic4ever(AdaptadorJumpsellerSitemap):
    id = "magic4ever"
    nombre = "Magic4ever"
    url = "https://www.magic4ever.cl"

    def interpretar(self, url, producto, ruta, opciones, pagina):
        precio, disponible, moneda = precio_y_disponibilidad(producto)
        if precio <= 0:
            return None
        set_codigo = numero = None
        sku = re.match(r"^[A-Z]-([A-Z0-9]+)-0*(\d+[A-Za-z]?)$", producto.get("sku") or "")
        if sku:
            set_codigo, numero = sku.group(1), sku.group(2)
        else:
            codigo = re.search(r"\(([A-Z0-9]{2,6})\)\s*$", producto.get("category") or "")
            set_codigo = codigo.group(1) if codigo else None
        stock = re.search(r'"stock":\s*(\d+)', pagina)
        return Oferta(
            tienda=self.id,
            titulo=f"{producto['name']} [{producto.get('category', '')}]",
            url=url,
            precio=precio,
            moneda=moneda,
            disponible=disponible,
            stock=int(stock.group(1)) if stock and disponible else (0 if not disponible else None),
            condicion=condicion(opciones.get("condición", opciones.get("condicion", ""))),
            condicion_original=opciones.get("condición") or opciones.get("condicion"),
            idioma=idioma(opciones.get("lenguaje") or opciones.get("idioma") or ""),
            acabado=acabado_desde_texto(opciones.get("acabado", "") + " " + producto["name"]),
            set_codigo=set_codigo,
            set_nombre=re.sub(r"\s*\([A-Z0-9]{2,6}\)\s*$", "", producto.get("category") or "") or None,
            numero=numero,
        )
