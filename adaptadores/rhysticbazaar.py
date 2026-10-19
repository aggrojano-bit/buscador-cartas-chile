"""Rhystic Bazaar (WooCommerce) - https://rhysticbazaar.cl

Cada producto es una sola copia (condición e idioma fijos):
  nombre      "Sol Ring — Near Mint · Spanish"
  SKU         "MIC-162-NF-NM-SPAN"   -> set MIC, número 162
  atributos   Condicion / Foil / Idioma / Edicion
La tienda informa cuántas unidades quedan ("1 disponibles").
"""
import re

from ._woocommerce import AdaptadorWooCommerce, atributos, precio, stock_variante
from .base import Oferta, acabado_desde_texto, condicion, idioma, solo_disponibles

SKU = re.compile(r"^([A-Z0-9]{2,6})-0*(\d+[A-Za-z]?)-", re.I)


class RhysticBazaar(AdaptadorWooCommerce):
    id = "rhysticbazaar"
    nombre = "Rhystic Bazaar"
    url = "https://rhysticbazaar.cl"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        grupos = {}
        for p in await self.productos(nombre_carta):
            a = atributos(p)
            texto_condicion = (a.get("condicion") or [""])[0]
            texto_idioma = (a.get("idioma") or [""])[0]
            edicion = (a.get("edicion") or [""])[0]
            sku = SKU.match(p.get("sku") or "")
            oferta = Oferta(
                tienda=self.id,
                titulo=p["name"],
                url=p["permalink"],
                precio=precio(p["prices"]),
                disponible=bool(p.get("is_in_stock")),
                stock=stock_variante(p),
                condicion=condicion(texto_condicion),
                condicion_original=texto_condicion or None,
                idioma=idioma(texto_idioma) or idioma(p["name"]),
                acabado=acabado_desde_texto(" ".join(a.get("foil") or [])),
                set_codigo=sku.group(1) if sku else None,
                set_nombre=edicion or None,
                numero=sku.group(2) if sku else None,
            )
            # Copias de la misma edición y acabado: se dejan las que tienen stock (o una agotada de referencia)
            grupos.setdefault((oferta.set_codigo, oferta.numero, oferta.set_nombre, oferta.acabado), []).append(oferta)
        ofertas = [o for lista in grupos.values() for o in solo_disponibles(lista)]
        if avance is not None:
            avance.extend(ofertas)
        return ofertas
