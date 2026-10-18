"""CardTrader (Italia) - https://www.cardtrader.com  —  API oficial

Necesita un token personal en el archivo privado .env (CARDTRADER_TOKEN=...).
Pasos:
  1. Lista de expansiones de Magic (se guarda 7 días).
  2. Para cada edición de la carta, sus "blueprints" (se guardan 7 días). Cada blueprint
     trae el id de Scryfall, así que el emparejamiento es exacto.
  3. Ofertas de cada blueprint (/marketplace/products, máximo 1 consulta por segundo).
Solo se consideran vendedores de CardTrader Zero (un solo envío consolidado a Chile).
"""
from app import db, red
from app.config import CARDTRADER_TOKEN

from .base import Adaptador, ErrorTienda, Oferta, condicion, idioma

API = "https://api.cardtrader.com/api/v2"
HORAS_CATALOGO = 24 * 7


class CardTrader(Adaptador):
    id = "cardtrader"
    nombre = "CardTrader Zero"
    url = "https://www.cardtrader.com"
    pais = "IT"
    moneda = "EUR"

    def __init__(self):
        self.token = CARDTRADER_TOKEN

    async def _api(self, ruta, params=None, pausa=0.1):
        resp = await red.obtener(API + ruta, pausa=pausa, params=params,
                                 headers={"Authorization": f"Bearer {self.token}"})
        if resp.status_code == 401:
            raise ErrorTienda("el token de CardTrader no es válido (revisa el archivo .env)")
        if resp.status_code == 429:
            raise ErrorTienda("CardTrader pidió bajar la velocidad de consultas (HTTP 429)")
        if resp.status_code != 200:
            raise ErrorTienda(f"la API de CardTrader respondió HTTP {resp.status_code}")
        return resp.json()

    async def _expansiones(self):
        """{código en minúsculas: [ids de expansión]} solo de Magic."""
        guardado = db.cache_leer("cardtrader:expansiones")
        if guardado is not None:
            return guardado
        juegos = await self._api("/games")
        juegos = juegos.get("array", juegos) if isinstance(juegos, dict) else juegos
        magic = next((j["id"] for j in juegos if "magic" in j.get("name", "").lower()), 1)
        por_codigo = {}
        for exp in await self._api("/expansions"):
            if exp.get("game_id") == magic and exp.get("code"):
                por_codigo.setdefault(exp["code"].lower(), []).append(exp["id"])
        db.cache_guardar("cardtrader:expansiones", por_codigo, HORAS_CATALOGO)
        return por_codigo

    async def _blueprints(self, expansion_id):
        """{id de Scryfall: id de blueprint} de una expansión."""
        clave = f"cardtrader:blueprints:{expansion_id}"
        guardado = db.cache_leer(clave)
        if guardado is not None:
            return guardado
        datos = await self._api("/blueprints/export", {"expansion_id": expansion_id})
        mapa = {b["scryfall_id"]: b["id"] for b in datos if b.get("scryfall_id")}
        db.cache_guardar(clave, mapa, HORAS_CATALOGO)
        return mapa

    async def buscar(self, nombre_carta, ediciones=None, avance=None):
        ediciones = ediciones or []
        if not self.token:
            raise ErrorTienda("falta configurar el token de CardTrader (CARDTRADER_TOKEN en el archivo .env)")
        expansiones = await self._expansiones()
        buscados = {}   # blueprint -> id de Scryfall
        for codigo in {e["set"].lower() for e in ediciones}:
            for exp_id in expansiones.get(codigo, []):
                mapa = await self._blueprints(exp_id)
                for e in ediciones:
                    if e["id"] in mapa:
                        buscados[mapa[e["id"]]] = e["id"]

        ofertas = []
        for blueprint, scryfall_id in buscados.items():
            datos = await self._api("/marketplace/products", {"blueprint_id": blueprint}, pausa=1.1)
            mejores = {}   # la más barata por condición / idioma / acabado
            for p in datos.get(str(blueprint), []):
                if not p.get("user", {}).get("can_sell_via_hub") or p.get("on_vacation") or p.get("graded"):
                    continue
                props = p.get("properties_hash") or {}
                o = Oferta(
                    tienda=self.id,
                    titulo=f"{p.get('name_en', nombre_carta)} [{p.get('expansion', {}).get('name_en', '')}]",
                    url=f"{self.url}/cards/{blueprint}",
                    precio=p["price"]["cents"] / 100,
                    moneda=p["price"]["currency"],
                    stock=p.get("quantity"),
                    condicion=condicion(props.get("condition", "")),
                    condicion_original=props.get("condition"),
                    idioma=idioma(props.get("mtg_language", ""), codigo_corto=True),
                    acabado="foil" if props.get("mtg_foil") else "normal",
                    scryfall_id=scryfall_id,
                )
                clave = (o.condicion, o.idioma, o.acabado)
                if clave not in mejores or o.precio < mejores[clave].precio:
                    mejores[clave] = o
            ofertas.extend(mejores.values())
            if avance is not None:
                avance.extend(mejores.values())
        return ofertas
