"""Servidor web del Buscador de Cartas Chile.

Rutas:
  /                      la página (carpeta static/)
  /api/autocompletar     sugerencias mientras escribes
  /api/ediciones         todas las ediciones de una carta, con precios de referencia
  /api/tipo-cambio       tasas CLP/USD/EUR/JPY
  /api/estado            fechas de los datos
  /api/actualizar        borra la caché de una carta y la vuelve a pedir
  /docs                  página de pruebas automática de FastAPI
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import cardkingdom, db, monedas, red, scryfall
from .config import AJUSTES, RAIZ

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")


async def _tarea_diaria():
    """Revisa cada hora si hay que descargar precios nuevos de Card Kingdom."""
    while True:
        await cardkingdom.actualizar()
        await asyncio.sleep(3600)


@asynccontextmanager
async def ciclo_de_vida(app):
    db.inicializar()
    tarea = asyncio.create_task(_tarea_diaria())
    yield
    tarea.cancel()
    await red.cerrar()


app = FastAPI(title="Buscador de Cartas Chile", lifespan=ciclo_de_vida)

FUENTES = {
    "cardkingdom": {"nombre": "Card Kingdom", "moneda": "USD"},
    "tcgplayer": {"nombre": "TCGplayer", "moneda": "USD"},
    "cardmarket": {"nombre": "Cardmarket", "moneda": "EUR"},
}


def _referencias(edicion, precios_ck):
    """Para cada acabado (normal/foil/etched) junta los precios de las 3 fuentes
    y elige la referencia principal: Card Kingdom, o el respaldo de Scryfall."""
    filas = []
    principal = {}
    for acabado in edicion["acabados"]:
        candidatos = []
        ck = precios_ck.get(acabado)
        if ck:
            candidatos.append(("cardkingdom", ck["precio"], ck["url"]))
        for fuente in ("tcgplayer", "cardmarket"):
            precio = edicion["precios_scryfall"][fuente].get(acabado)
            if precio is not None:
                candidatos.append((fuente, precio, edicion["enlaces"].get(fuente)))
        for i, (fuente, precio, url) in enumerate(candidatos):
            fila = {
                "acabado": acabado,
                "fuente": fuente,
                "fuente_nombre": FUENTES[fuente]["nombre"],
                "precio": precio,
                "moneda": FUENTES[fuente]["moneda"],
                "url": url,
                "es_principal": i == 0,
                "es_respaldo": i == 0 and fuente != "cardkingdom",
            }
            filas.append(fila)
            if i == 0:
                principal[acabado] = fila
    return filas, principal


@app.get("/api/autocompletar")
async def autocompletar(q: str = Query("", max_length=80)):
    try:
        return await scryfall.autocompletar(q)
    except scryfall.ErrorScryfall:
        return []


@app.get("/api/ediciones")
async def ediciones(nombre: str = Query(..., min_length=2, max_length=150)):
    try:
        datos = await scryfall.ediciones(nombre)
    except Exception as error:
        raise HTTPException(502, f"No se pudo consultar Scryfall: {error}")
    if datos is None:
        raise HTTPException(404, f"No encontré ninguna carta llamada «{nombre}».")

    precios_ck = cardkingdom.precios(e["id"] for e in datos["ediciones"])
    for edicion in datos["ediciones"]:
        edicion["referencias"], edicion["referencia_principal"] = _referencias(
            edicion, precios_ck.get(edicion["id"], {}))
    return datos


@app.post("/api/actualizar")
async def actualizar(nombre: str = Query(..., min_length=2, max_length=150)):
    scryfall.olvidar(nombre)
    return await ediciones(nombre)


@app.get("/api/tipo-cambio")
async def tipo_cambio():
    datos = await monedas.tipo_cambio()
    if datos is None:
        raise HTTPException(503, "No se pudo obtener el tipo de cambio.")
    return datos


@app.get("/api/estado")
async def estado():
    return {
        "card_kingdom": cardkingdom.info(),
        "moneda_por_defecto": AJUSTES["general"].get("moneda_por_defecto", "CLP"),
    }


# La página web. Va al final para que no tape las rutas /api.
app.mount("/", StaticFiles(directory=RAIZ / "static", html=True), name="static")
