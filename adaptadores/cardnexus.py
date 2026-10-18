"""CardNexus (WooCommerce) - https://cardnexus.cl

Productos simples, uno por edición/idioma/condición:
  SKU         "OTC 267 Español NM"
  atributos   idioma, pa_condicion, Foil, Edición Magic, Numero
Algunas cartas aparecen dos veces (con y sin idioma en el SKU); se deja la más completa.
"""
from ._woocommerce import AdaptadorWooCommerce, atributos, precio
from .base import Oferta, acabado_desde_texto, condicion, idioma


class CardNexus(AdaptadorWooCommerce):
    id = "cardnexus"
    nombre = "CardNexus"
    url = "https://cardnexus.cl"

    async def buscar(self, nombre_carta):
        ofertas = {}
        for p in await self.productos(nombre_carta, stock_status="instock"):
            if precio(p["prices"]) <= 0:
                continue
            attrs = atributos(p)
            partes = (p.get("sku") or "").split()
            texto_idioma = " ".join(attrs.get("idioma", [])) or " ".join(partes[2:3])
            texto_condicion = " ".join(attrs.get("pa_condicion", attrs.get("condicion", []))) or " ".join(partes[3:4])
            oferta = Oferta(
                tienda=self.id,
                titulo=p["name"] + (f" ({p['sku']})" if p.get("sku") else ""),
                url=p["permalink"],
                precio=precio(p["prices"]),
                disponible=bool(p["is_in_stock"]),
                stock=p.get("low_stock_remaining"),
                condicion=condicion(texto_condicion),
                condicion_original=texto_condicion or None,
                idioma=idioma(texto_idioma),
                acabado=acabado_desde_texto(" ".join(attrs.get("foil", []))),
                set_codigo=partes[0] if len(partes) >= 2 else None,
                set_nombre=(attrs.get("edición magic") or attrs.get("edicion magic") or [None])[0],
                numero=partes[1] if len(partes) >= 2 else (attrs.get("numero") or [None])[0],
            )
            # Duplicados: misma edición, número, acabado y precio -> se queda el que trae idioma
            clave = (oferta.set_codigo, oferta.numero, oferta.acabado, oferta.precio, oferta.idioma or "?")
            clave_sin_idioma = clave[:4] + ("?",)
            if oferta.idioma and clave_sin_idioma in ofertas:
                del ofertas[clave_sin_idioma]
            if oferta.idioma is None and any(k[:4] == clave[:4] for k in ofertas):
                continue
            ofertas[clave] = oferta
        return list(ofertas.values())
