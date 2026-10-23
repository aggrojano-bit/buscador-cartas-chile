"""Hareruya (Japón) - https://www.hareruyamtg.com/en/

Usa la misma API JSON de búsqueda que usa su página (/en/products/search/unisearch_api),
pidiendo solo la carta exacta y con stock, en una sola consulta.
Su robots.txt permite el buscador (solo prohíbe paginar u ordenar).
  título   "【Foil】(1512)■Borderless■《Sol Ring》[SLD]"
  idioma   "1" = japonés, "2" = inglés
  estado   "1" = NM, "2" = SP, "3" = MP, "4" = HP
"""
import re

from .base import Adaptador, Oferta, normalizar

IDIOMAS = {"1": "JA", "2": "EN"}
# "【BB】" = borde negro: en Scryfall son ediciones aparte
BORDE_NEGRO = {"4ED": "4BB", "3ED": "FBB"}
CONDICIONES = {"1": ("NM", "NM"), "2": ("LP", "SP"), "3": ("MP", "MP"), "4": ("HP", "HP")}


class Hareruya(Adaptador):
    id = "hareruya"
    nombre = "Hareruya"
    url = "https://www.hareruyamtg.com"
    busqueda = "/en/products/search?product={q}"
    pais = "JP"
    moneda = "JPY"
    rutas_robots = ["/en/products/search/unisearch_api?kw=sol+ring"]
    pausa = 2.0

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        nombre = nombre_carta.split(" // ")[0]
        resp = await self.get(f"{self.url}/en/products/search/unisearch_api", params={
            "kw": nombre, "rows": 300, "fq.card_name": nombre, "fq.stock": "1~*"})
        ofertas = []
        for d in resp.json()["response"]["docs"]:
            if normalizar(d.get("card_name", "")) != normalizar(nombre):
                continue
            titulo = d["product_name_en"]
            # El set va entre corchetes después del nombre: 《Sol Ring》[CMM-BF] o 《Sol Ring》[40K](250)
            corchetes = re.search(r"》[^\[]*\[([^\]]+)\]", titulo)
            texto_set = corchetes.group(1).strip() if corchetes else None
            # Sufijos propios de Hareruya: -BF (Booster Fun), -P (promo), -JP (arte japonés)
            sufijo = re.fullmatch(r"([A-Z0-9]{2,6})-(?:BF|P|JP)", texto_set or "")
            if sufijo:
                texto_set = sufijo.group(1)
            es_codigo = bool(texto_set and re.fullmatch(r"[A-Z0-9]{2,6}", texto_set))
            if "【BB】" in titulo and texto_set in BORDE_NEGRO:
                texto_set = BORDE_NEGRO[texto_set]
            # Número: (305), (A25-141) para The List, o (410-Human) -> 410
            numero = re.search(r"\(([A-Z0-9]{2,4}-\d{1,4}|\d{1,4}[a-z]?)(?:-[A-Za-z]+)?\)", titulo)
            acabado = "foil" if d.get("foil_flg") == "1" else "normal"
            if acabado == "foil" and "etched" in titulo.lower():
                acabado = "etched"
            condicion, original = CONDICIONES.get(d.get("card_condition"), (None, None))
            ofertas.append(Oferta(
                tienda=self.id,
                titulo=titulo,
                url=f"{self.url}/en/products/detail/{d['product']}?lang=EN",
                precio=float(d["price"]),
                moneda="JPY",
                stock=int(d["stock"]),
                condicion=condicion,
                condicion_original=original,
                idioma=IDIOMAS.get(d.get("language")),
                acabado=acabado,
                set_codigo=texto_set if es_codigo else None,
                set_nombre=None if es_codigo else texto_set,
                numero=numero.group(1) if numero else None,
            ))
        return ofertas
