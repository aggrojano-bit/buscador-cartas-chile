"""Base para tiendas hechas con WooCommerce (WordPress).

Usa la "Store API" pública de WooCommerce (/wp-json/wc/store/v1/products),
la misma que usa la propia página de la tienda. Solo se usa en tiendas
cuyo robots.txt no la prohíbe.
"""
import html

from .base import Adaptador, ErrorTienda, nombre_coincide

POR_PAGINA = 100
MAX_PAGINAS = 3


def precio(precios):
    """La Store API entrega el precio como texto sin decimales: '3490' con minor_unit 0."""
    return int(precios["price"]) / (10 ** precios.get("currency_minor_unit", 0))


def atributos(producto):
    """{'idioma': ['Español'], 'pa_condicion': ['NM'], ...} con nombres en minúscula."""
    return {a["name"].lower(): [html.unescape(t["name"]) for t in a.get("terms", [])]
            for a in producto.get("attributes", [])}


class AdaptadorWooCommerce(Adaptador):

    async def productos(self, nombre_carta, **filtros):
        nombre = nombre_carta.split(" // ")[0]
        resultado = []
        for pagina in range(1, MAX_PAGINAS + 1):
            resp = await self.get(f"{self.url}/wp-json/wc/store/v1/products",
                                  params={"search": nombre, "per_page": POR_PAGINA, "page": pagina, **filtros})
            if resp.status_code != 200:
                raise ErrorTienda(f"la API de la tienda respondió HTTP {resp.status_code}")
            datos = resp.json()
            for p in datos:
                p["name"] = html.unescape(p["name"])
                if nombre_coincide(p["name"], nombre):
                    resultado.append(p)
            if len(datos) < POR_PAGINA:
                break
        return resultado
