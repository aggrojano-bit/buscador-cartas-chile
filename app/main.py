"""Servidor web del Buscador de Cartas Chile.

Rutas:
  /                      la página (carpeta static/)
  /api/autocompletar     sugerencias mientras escribes
  /api/ediciones         todas las ediciones de una carta, con precios de referencia
  /api/ofertas           ofertas de las tiendas, emparejadas con cada edición
  /api/tipo-cambio       tasas CLP/USD/EUR/JPY
  /api/estado            fechas de los datos
  /api/actualizar        borra la caché de una carta y la vuelve a pedir
  /api/revision          última revisión automática de las tiendas (POST = revisar ahora, solo en tu PC)
  /docs                  página de pruebas automática de FastAPI
"""
import asyncio
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from adaptadores import ACTIVAS

from . import cardkingdom, db, monedas, ofertas, red, revision, robots, scryfall
from .config import AJUSTES, EN_SERVIDOR, RAIZ

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")


async def _tarea_diaria():
    """Cada hora: precios nuevos de Card Kingdom si toca, y el robots.txt de las tiendas
    (se vuelve a descargar una vez al día; si una tienda prohíbe la lectura, pasa a modo «a mano»)."""
    while True:
        await cardkingdom.actualizar()
        try:
            await robots.revisar_todas(ACTIVAS)
        except Exception:
            logging.getLogger("robots").warning("Falló la revisión de robots.txt", exc_info=True)
        await asyncio.sleep(3600)


@asynccontextmanager
async def ciclo_de_vida(app):
    db.inicializar()
    tareas = [asyncio.create_task(_tarea_diaria())]
    if not EN_SERVIDOR:
        # En tu PC: revisión diaria de las tiendas (en la nube la hace GitHub)
        tareas.append(asyncio.create_task(revision.tarea_diaria()))
    yield
    for tarea in tareas:
        tarea.cancel()
    await red.cerrar()


app = FastAPI(title="Buscador de Cartas Chile", lifespan=ciclo_de_vida)

# Límite por visitante: cuando la app es pública, nadie puede lanzar búsquedas sin parar
# (cada carta nueva consulta 15 tiendas). Las búsquedas guardadas en caché no cuentan para las tiendas.
BUSQUEDAS_MAXIMAS = 30
VENTANA_SEGUNDOS = 600
_busquedas = defaultdict(deque)


@app.middleware("http")
async def limitar_busquedas(request: Request, siguiente):
    if request.url.path in ("/api/ediciones", "/api/actualizar"):
        ip = (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()
        ahora = time.time()
        historial = _busquedas[ip]
        while historial and ahora - historial[0] > VENTANA_SEGUNDOS:
            historial.popleft()
        if len(historial) >= BUSQUEDAS_MAXIMAS:
            return JSONResponse({"detail": "Hiciste muchas búsquedas seguidas. Espera unos minutos para no saturar a las tiendas."},
                                status_code=429)
        historial.append(ahora)
    return await siguiente(request)

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


@app.get("/api/ofertas")
async def ofertas_tiendas(nombre: str = Query(..., min_length=2, max_length=150), forzar: bool = False):
    """Ofertas de las tiendas. Si alguna sigue consultando, "completo" viene en false
    y la página vuelve a preguntar en unos segundos."""
    datos = await ediciones(nombre)
    return ofertas.consultar(datos["carta"]["nombre"], datos["ediciones"], forzar=forzar)


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
        "repositorio": AJUSTES["general"].get("repositorio", ""),
        # Para calcular el costo estimado "puesto en Chile" en la página
        "importacion": AJUSTES.get("importacion", {}),
        "envios": AJUSTES.get("envio", {}),
    }


@app.get("/api/revision")
async def ver_revision():
    guardada = revision.leer_guardada() if not EN_SERVIDOR else None
    return {"revision": guardada, "en_curso": revision.en_curso, "disponible": not EN_SERVIDOR}


@app.post("/api/revision")
async def revisar_ahora():
    if EN_SERVIDOR:
        raise HTTPException(403, "La revisión de tiendas solo se puede lanzar desde tu PC.")
    global _revision_manual
    if not revision.en_curso:
        revision.en_curso = True   # evita lanzar dos revisiones si se presiona dos veces
        _revision_manual = asyncio.create_task(revision.revisar_y_guardar())
    return {"en_curso": True}


_revision_manual = None


# La página web. Va al final para que no tape las rutas /api.
app.mount("/", StaticFiles(directory=RAIZ / "static", html=True), name="static")
