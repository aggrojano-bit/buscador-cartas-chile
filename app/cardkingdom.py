"""Precios de referencia de Card Kingdom a través de MTGJSON (https://mtgjson.com).

Card Kingdom protege su sitio y su lista de precios con Cloudflare, así que
no lo leemos directamente. MTGJSON publica cada día sus precios de venta
y el id de Scryfall de cada carta, lo que permite un emparejamiento exacto.
Limitación: MTGJSON no informa el stock de Card Kingdom.
"""
import asyncio
import csv
import gzip
import logging
import time

from . import db, red
from .config import CARPETA_DATOS

BASE = "https://mtgjson.com/api/v5/csv/"
HORAS_PRECIOS = 20        # MTGJSON se actualiza una vez al día
HORAS_IDENTIFICADORES = 72

log = logging.getLogger("cardkingdom")
estado = {"cargando": False, "error": None}


def _vencido(clave, horas):
    return time.time() - float(db.meta_leer(clave, 0)) > horas * 3600


def _hay_identificadores():
    with db.conexion() as con:
        return con.execute("SELECT 1 FROM mtgjson_cartas LIMIT 1").fetchone() is not None


def _importar_identificadores(ruta_ids, ruta_enlaces):
    enlaces = {}
    with gzip.open(ruta_enlaces, "rt", encoding="utf-8", newline="") as f:
        for fila in csv.DictReader(f):
            if fila["cardKingdom"] or fila["cardKingdomFoil"] or fila["cardKingdomEtched"]:
                enlaces[fila["uuid"]] = (fila["cardKingdom"] or None, fila["cardKingdomFoil"] or None,
                                         fila["cardKingdomEtched"] or None)
    filas = []
    with gzip.open(ruta_ids, "rt", encoding="utf-8", newline="") as f:
        for fila in csv.DictReader(f):
            if fila["scryfallId"]:
                filas.append((fila["uuid"], fila["scryfallId"], *enlaces.get(fila["uuid"], (None, None, None))))
    with db.conexion() as con:
        con.execute("DELETE FROM mtgjson_cartas")
        con.executemany("INSERT OR REPLACE INTO mtgjson_cartas VALUES (?, ?, ?, ?, ?)", filas)
    return len(filas)


def _importar_precios(ruta):
    filas = []
    fecha = None
    with gzip.open(ruta, "rt", encoding="utf-8", newline="") as f:
        for fila in csv.DictReader(f):
            if (fila["priceProvider"] == "cardkingdom" and fila["providerListing"] == "retail"
                    and fila["gameAvailability"] == "paper"):
                filas.append((fila["uuid"], fila["cardFinish"], float(fila["price"])))
                fecha = fecha or fila["date"]
    with db.conexion() as con:
        con.execute("DELETE FROM ck_precios")
        con.executemany("INSERT OR REPLACE INTO ck_precios VALUES (?, ?, ?)", filas)
    db.meta_guardar("ck_fecha_precios", fecha or "")
    return len(filas)


async def actualizar(forzar=False):
    """Descarga los archivos de MTGJSON si están vencidos. Corre en segundo plano."""
    if estado["cargando"]:
        return
    estado["cargando"] = True
    estado["error"] = None
    try:
        if forzar or _vencido("ck_descarga_ids", HORAS_IDENTIFICADORES) or not _hay_identificadores():
            log.info("Descargando identificadores de MTGJSON (unos 23 MB)...")
            ruta_ids = CARPETA_DATOS / "cardIdentifiers.csv.gz"
            ruta_enlaces = CARPETA_DATOS / "cardPurchaseUrls.csv.gz"
            await red.descargar(BASE + "cardIdentifiers.csv.gz", ruta_ids)
            await red.descargar(BASE + "cardPurchaseUrls.csv.gz", ruta_enlaces)
            total = await asyncio.to_thread(_importar_identificadores, ruta_ids, ruta_enlaces)
            db.meta_guardar("ck_descarga_ids", time.time())
            log.info("Identificadores importados: %s", total)
        if forzar or _vencido("ck_descarga_precios", HORAS_PRECIOS):
            log.info("Descargando precios de MTGJSON (unos 18 MB)...")
            ruta = CARPETA_DATOS / "cardPrices.csv.gz"
            await red.descargar(BASE + "cardPrices.csv.gz", ruta)
            total = await asyncio.to_thread(_importar_precios, ruta)
            db.meta_guardar("ck_descarga_precios", time.time())
            log.info("Precios de Card Kingdom importados: %s", total)
    except Exception as error:  # si falla, la app sigue funcionando con el respaldo de Scryfall
        log.exception("No se pudieron actualizar los precios de Card Kingdom")
        estado["error"] = str(error)
    finally:
        estado["cargando"] = False


def precios(scryfall_ids):
    """{scryfall_id: {acabado: {"precio": 1.23, "url": "..."}}}"""
    resultado = {}
    ids = list(scryfall_ids)
    with db.conexion() as con:
        for i in range(0, len(ids), 500):
            trozo = ids[i:i + 500]
            marcas = ",".join("?" * len(trozo))
            consulta = f"""
                SELECT c.scryfall_id, p.acabado, p.precio, c.url_normal, c.url_foil, c.url_etched
                FROM mtgjson_cartas c JOIN ck_precios p ON p.uuid = c.uuid
                WHERE c.scryfall_id IN ({marcas})"""
            for fila in con.execute(consulta, trozo):
                url = {"normal": fila["url_normal"], "foil": fila["url_foil"],
                       "etched": fila["url_etched"]}.get(fila["acabado"])
                resultado.setdefault(fila["scryfall_id"], {})[fila["acabado"]] = {
                    "precio": fila["precio"], "url": url}
    return resultado


def info():
    return {
        "fecha_precios": db.meta_leer("ck_fecha_precios"),
        "cargando": estado["cargando"],
        "error": estado["error"],
    }
