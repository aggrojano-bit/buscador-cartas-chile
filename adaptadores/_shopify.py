"""Base para tiendas hechas con Shopify.

1. Usa el buscador público de la tienda (/search) para encontrar los productos.
2. Lee cada producto en formato JSON (/products/<handle>.js), que trae
   las variantes con precio y disponibilidad.
Cada tienda solo define cómo interpretar sus títulos y variantes.
"""
import re

from .base import Adaptador, ErrorTienda, nombre_coincide, slug

MAX_PAGINAS = 4
MAX_PRODUCTOS = 60


class AdaptadorShopify(Adaptador):
    pausa = 1.0   # Shopify está hecho para mucho tráfico; 1 s entre peticiones es prudente

    async def buscar(self, nombre_carta):
        nombre = nombre_carta.split(" // ")[0]
        ofertas = []
        for handle in await self._buscar_handles(nombre):
            resp = await self.get(f"{self.url}/products/{handle}.js")
            if resp.status_code != 200:
                continue
            producto = resp.json()
            if nombre_coincide(producto["title"], nombre):
                ofertas.extend(self.interpretar(producto))
        return ofertas

    async def _buscar_handles(self, nombre):
        clave = slug(nombre)
        handles = []
        for pagina in range(1, MAX_PAGINAS + 1):
            resp = await self.get(f"{self.url}/search", params={"q": nombre, "type": "product", "page": pagina})
            if resp.status_code != 200:
                raise ErrorTienda(f"el buscador respondió HTTP {resp.status_code}")
            encontrados = dict.fromkeys(re.findall(r'href="(?:/[a-z]{2}(?:-[a-z]{2})?)?/products/([^"?#/]+)', resp.text))
            nuevos = [h for h in encontrados if clave in h and h not in handles]
            if not nuevos:
                break
            handles.extend(nuevos)
            if len(handles) >= MAX_PRODUCTOS:
                break
        return handles[:MAX_PRODUCTOS]

    def url_producto(self, producto):
        return f"{self.url}/products/{producto['handle']}"

    def interpretar(self, producto):
        """Convierte un producto de Shopify en una lista de Oferta."""
        raise NotImplementedError
