"""Chronomagic (Jumpseller) - https://www.chronomagic.cl

Su robots.txt prohíbe el buscador, así que se usa su sitemap (ver _jumpseller_sitemap.py).
  enlace  ".../sol-ring-lcc-313-en-nm"   -> set LCC, número 313, inglés, NM
  nombre  "Sol Ring | EN | NM | LCC"
  SKU     "LCC313NENNM"                  -> la letra después del número: N = normal, F = foil
"""
import re

from ._jumpseller_sitemap import AdaptadorJumpsellerSitemap, precio_y_disponibilidad
from .base import Oferta, acabado_desde_texto, condicion, idioma


class Chronomagic(AdaptadorJumpsellerSitemap):
    id = "chronomagic"
    nombre = "Chronomagic"
    url = "https://www.chronomagic.cl"
    # Sus términos permiten ver la tienda solo para uso personal (no volver a publicar su contenido)
    solo_uso_personal = True

    def interpretar(self, url, producto, ruta, opciones, pagina):
        precio, disponible, moneda = precio_y_disponibilidad(producto)
        if precio <= 0:
            return None
        partes = [p.strip() for p in producto["name"].split("|")]
        set_codigo = partes[3] if len(partes) >= 4 else None
        texto_idioma = partes[1] if len(partes) >= 2 else ""
        texto_condicion = partes[2] if len(partes) >= 3 else ""
        # Número desde el enlace: "<carta>-lcc-313-en-nm" o "<carta>-retro-frame-brc-160-en-nm"
        tokens = url.rsplit("/", 1)[-1].split("-")
        codigo = (set_codigo or "").lower()
        numero = None
        if codigo in tokens:
            i = len(tokens) - 1 - tokens[::-1].index(codigo)
            if i + 1 < len(tokens) and re.fullmatch(r"\d{1,4}[a-z]?", tokens[i + 1]):
                numero = tokens[i + 1]
        acabado = acabado_desde_texto(producto["name"] + " " + url.replace("-", " "))
        sku = re.match(rf"^{re.escape(set_codigo or '')}0*{re.escape(numero or '')}([NFE])", producto.get("sku") or "")
        if sku:
            acabado = {"F": "foil", "E": "etched"}.get(sku.group(1), acabado)
        stock = re.search(r'"stock":\s*(\d+)', pagina)
        return Oferta(
            tienda=self.id,
            titulo=producto["name"],
            url=url,
            precio=precio,
            moneda=moneda,
            disponible=disponible,
            stock=int(stock.group(1)) if stock and disponible else (0 if not disponible else None),
            condicion=condicion(texto_condicion),
            condicion_original=texto_condicion or None,
            idioma=idioma(texto_idioma, codigo_corto=True),
            acabado=acabado,
            set_codigo=set_codigo,
            numero=numero,
        )
