"""ZendiCard (WooCommerce, sin API pública) - https://zendicard.cl

Su API está cerrada (HTTP 403), así que se usa el buscador normal de la tienda y
luego los datos estructurados (JSON-LD) de cada producto:
  título       "Sol Ring (Borderless) (Foil) (ING)"
  ruta         "... > (2023) Commander Masters > Sol Ring ..."  -> nombre de la edición
  imagen       ".../cmm-703-sol-ring.jpg"                       -> código y número
  atributos    Estado: NM (Near Mint), Idioma: Inglés
"""
import html
import json
import re

from .base import Adaptador, Oferta, acabado_desde_texto, condicion, idioma, nombre_coincide

MAX_PAGINAS = 3
MAX_PRODUCTOS = 30
# La tienda muestra los resultados con dos plantillas distintas (lista de entradas o grilla)
RESULTADO = re.compile(
    r'<h[24][^>]*class="(?:entry|product)-title"[^>]*>\s*<a[^>]*href="(https://zendicard\.cl/tienda/[^"]+)"[^>]*>\s*([^<]+?)\s*</a>')


class ZendiCard(Adaptador):
    id = "zendicard"
    nombre = "ZendiCard"
    url = "https://zendicard.cl"

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        nombre = nombre_carta.split(" // ")[0]
        enlaces = []
        for pagina in range(1, MAX_PAGINAS + 1):
            ruta = self.url + ("/" if pagina == 1 else f"/page/{pagina}/")
            resp = await self.get(ruta, params={"s": nombre, "post_type": "product"})
            if resp.status_code == 404:
                break
            encontrados = dict.fromkeys((u, html.unescape(t)) for u, t in RESULTADO.findall(resp.text))
            nuevos = [(u, t) for u, t in encontrados
                      if "/singles-mtg/" in u and nombre_coincide(t, nombre) and (u, t) not in enlaces]
            if not nuevos:
                break
            enlaces.extend(nuevos)
        ofertas = []
        for url, titulo in enlaces[:MAX_PRODUCTOS]:
            resp = await self.get(url)
            if resp.status_code == 200:
                oferta = self._interpretar(url, titulo, resp.text)
                if oferta:
                    ofertas.append(oferta)
                    if avance is not None:
                        avance.append(oferta)
        return ofertas

    def _interpretar(self, url, titulo, pagina):
        producto, ruta = None, []
        for bloque in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', pagina, re.S):
            try:
                datos = json.loads(bloque)
            except ValueError:
                continue
            for nodo in datos.get("@graph", [datos]):
                if nodo.get("@type") == "Product":
                    producto = nodo
                elif nodo.get("@type") == "BreadcrumbList":
                    ruta = [e["item"]["name"] for e in nodo.get("itemListElement", [])]
        if not producto or not producto.get("offers"):
            return None
        oferta = producto["offers"][0]
        atributos = dict(re.findall(
            r'woocommerce-product-attributes-item__label">\s*([^<:]+):?\s*<.*?'
            r'woocommerce-product-attributes-item__value">(?:<p>)?([^<]*)', pagina, re.S))
        stock = re.search(r'class="stock in-stock">\s*(\d+)', pagina)
        set_codigo = numero = None
        m = re.search(r"/([a-z0-9]{2,6})-(\d{1,4}[a-z]?)-[^/]*\.(?:jpe?g|png|webp)$", producto.get("image") or "", re.I)
        if m:
            set_codigo, numero = m.group(1), m.group(2)
        # El penúltimo elemento de la ruta es la edición: "(2023) Commander Masters"
        set_nombre = re.sub(r"^\(\d{4}\)\s*", "", ruta[-2]) if len(ruta) >= 2 else None
        texto_estado = html.unescape(atributos.get("Estado", "")).strip()
        return Oferta(
            tienda=self.id,
            titulo=titulo,
            url=url,
            precio=float(oferta["price"]),
            moneda=oferta.get("priceCurrency", "CLP"),
            disponible=oferta.get("availability", "").endswith("InStock"),
            stock=int(stock.group(1)) if stock else None,
            condicion=condicion(texto_estado),
            condicion_original=texto_estado or None,
            idioma=idioma(atributos.get("Idioma", "")) or idioma(titulo.replace("(ING)", "(ingles)").replace("(ESP)", "(espanol)")),
            acabado=acabado_desde_texto(titulo),
            set_codigo=set_codigo,
            set_nombre=set_nombre,
            numero=numero,
        )
