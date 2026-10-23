"""Revisión automática de las tiendas: avisa cuando una tienda cambia y la app deja de leerla bien.

Prueba cada tienda con un par de cartas muy comunes y compara con la revisión anterior.
Marca un problema cuando:
  - la tienda da error, bloquea o está en mantención;
  - antes encontraba ofertas y ahora ninguna (suele ser que la tienda cambió su página);
  - muchas ofertas ya no calzan con ninguna edición (cambió el formato de sus títulos);
  - muchos precios son absurdos comparados con el precio de mercado (cambió el formato del precio);
  - su robots.txt ahora prohíbe lo que la app lee (la tienda pasa sola a modo «a mano»).

Corre sola una vez al día en tu PC (ver app/main.py) y en GitHub (ver
.github/workflows/revision-tiendas.yml). También se puede correr a mano:
    python -m app.revision
"""
import argparse
import asyncio
import datetime
import json
import logging
import os
import time
from pathlib import Path

from adaptadores import ACTIVAS

from . import cardkingdom, db, monedas, red, robots, scryfall
from .config import EN_SERVIDOR
from .emparejar import emparejar
from .ofertas import _mensaje_error

CARTAS_PRUEBA = ["Sol Ring", "Counterspell"]   # casi todas las tiendas las tienen
CADA_HORAS = 24
TIEMPO_MAXIMO = 300          # segundos por tienda y carta
MINIMO_PARA_PORCENTAJES = 5  # con menos ofertas, los porcentajes no dicen mucho
CLAVE = "revision_tiendas"   # dónde se guarda la última revisión en tu PC (tabla meta)

log = logging.getLogger("revision")
en_curso = False


def _a_usd(precio, moneda, tasas):
    if not tasas or moneda not in tasas["tasas"]:
        return None
    return precio * tasas["tasas"][moneda] / tasas["tasas"]["USD"]


async def _revisar_tienda(adaptador, cartas, tasas, anterior):
    inicio = time.time()
    r = {"id": adaptador.id, "nombre": adaptador.nombre, "ofertas": 0, "emparejadas": 0,
         "precios_raros": 0, "por_carta": {}, "error": None}
    for nombre, ediciones in cartas:
        try:
            ofertas = await asyncio.wait_for(adaptador.buscar(nombre, ediciones, []), TIEMPO_MAXIMO)
        except Exception as error:
            r["error"] = _mensaje_error(error)
            break
        por_id = {e["id"]: e for e in ediciones}
        ofertas = [o for o in ofertas if o.precio > 0]
        r["por_carta"][nombre] = len(ofertas)
        r["ofertas"] += len(ofertas)
        for o in ofertas:
            edicion_id, _, _ = emparejar(o.a_dict(), ediciones)
            if not edicion_id:
                continue
            r["emparejadas"] += 1
            # Precio de mercado de esa misma edición y acabado (TCGplayer vía Scryfall)
            mercado = por_id[edicion_id]["precios_scryfall"]["tcgplayer"].get(o.acabado)
            usd = _a_usd(o.precio, o.moneda, tasas)
            if mercado and usd and not (mercado / 20 <= usd <= mercado * 20):
                r["precios_raros"] += 1
    # Cuántas ofertas encontraba la última vez que funcionó (para notar si deja de encontrar)
    if not r["error"] and r["ofertas"]:
        r["ofertas_normales"] = r["ofertas"]
    else:
        r["ofertas_normales"] = (anterior or {}).get("ofertas_normales", 0)
    r["segundos"] = round(time.time() - inicio)
    return r


def _problemas_tienda(r, anterior, nube):
    problema = lambda tipo, detalle: {"tienda": r["id"], "nombre": r["nombre"], "tipo": tipo, "detalle": detalle}
    if r["error"]:
        if nube and "bloqueó" in r["error"]:
            return []   # algunas tiendas bloquean a los servidores en la nube: no es un cambio de la tienda
        return [problema("error", f"No se pudo leer: {r['error']}.")]
    lista = []
    antes = (anterior or {}).get("ofertas_normales", 0)
    if r["ofertas"] == 0 and antes > 0:
        lista.append(problema("sin_ofertas",
            f"Antes encontraba {antes} ofertas de {' y '.join(r['por_carta'])}; ahora ninguna. "
            "Lo más probable es que la tienda cambió su página o su buscador."))
    if r["ofertas"] >= MINIMO_PARA_PORCENTAJES and r["emparejadas"] / r["ofertas"] < 0.5:
        lista.append(problema("sin_emparejar",
            f"Solo {r['emparejadas']} de {r['ofertas']} ofertas calzan con una edición. "
            "Puede que la tienda cambió cómo escribe el nombre de la edición."))
    if r["emparejadas"] >= MINIMO_PARA_PORCENTAJES and r["precios_raros"] / r["emparejadas"] > 0.3:
        lista.append(problema("precios_raros",
            f"{r['precios_raros']} de {r['emparejadas']} precios están a más de 20 veces del precio de mercado. "
            "Puede que la tienda cambió cómo muestra los precios."))
    return lista


def _problema_card_kingdom():
    """Los precios de Card Kingdom (MTGJSON) deberían renovarse a diario."""
    fecha = cardkingdom.info().get("fecha_precios")
    try:
        dias = (datetime.date.today() - datetime.date.fromisoformat((fecha or "")[:10])).days
    except ValueError:
        return []
    if dias <= 3:
        return []
    return [{"tienda": "cardkingdom", "nombre": "Card Kingdom", "tipo": "datos_viejos",
             "detalle": f"Los precios de referencia (MTGJSON) son del {fecha}: no se actualizan hace {dias} días."}]


async def revisar(anterior=None, nube=False):
    """Revisa todas las tiendas. anterior = el resultado de la revisión anterior (o None)."""
    inicio = time.time()
    anteriores = (anterior or {}).get("tiendas", {})

    # 1) robots.txt: si una tienda ahora prohíbe la lectura, queda sola en modo «a mano»
    bloqueos = await robots.revisar_todas(ACTIVAS)
    problemas = [{"tienda": a.id, "nombre": a.nombre, "tipo": "robots",
                  "detalle": f"Su robots.txt ahora prohíbe leer {bloqueos[a.id]}. "
                             "La app la dejó en modo «a mano» automáticamente."}
                 for a in ACTIVAS if bloqueos.get(a.id)]

    # 2) Prueba de cada tienda con cartas conocidas
    cartas = [(n, (await scryfall.ediciones(n))["ediciones"]) for n in CARTAS_PRUEBA]
    tasas = await monedas.tipo_cambio()
    revisar_estas, omitidas = [], []
    for a in ACTIVAS:
        motivo = (a.modo_manual() or ("no lee la página de la tienda" if not a.revisable else None)
                  or ("bloquea a los servidores en la nube" if nube and a.bloquea_servidores else None))
        if motivo:
            omitidas.append({"id": a.id, "nombre": a.nombre, "motivo": motivo})
        else:
            revisar_estas.append(a)
    resultados = await asyncio.gather(*(_revisar_tienda(a, cartas, tasas, anteriores.get(a.id))
                                        for a in revisar_estas))
    for r in resultados:
        problemas += _problemas_tienda(r, anteriores.get(r["id"]), nube)
    if not nube:
        problemas += _problema_card_kingdom()

    return {
        "fecha": time.time(),
        "nube": nube,
        "segundos": round(time.time() - inicio),
        "cartas": CARTAS_PRUEBA,
        "tiendas": {r["id"]: r for r in resultados},
        "omitidas": omitidas,
        "problemas": problemas,
    }


def firma(revision):
    """Qué problemas hay (sin detalles), para saber si cambiaron desde la vez anterior."""
    return sorted({f"{p['tienda']}:{p['tipo']}" for p in (revision or {}).get("problemas", [])})


def informe(revision):
    """Texto del informe (Markdown), para el aviso en GitHub."""
    fecha = datetime.datetime.fromtimestamp(revision["fecha"]).strftime("%Y-%m-%d %H:%M")
    lineas = [f"Revisión automática del {fecha} (cartas de prueba: {', '.join(revision['cartas'])}).", ""]
    if revision["problemas"]:
        lineas += ["## ⚠️ Problemas", ""]
        lineas += [f"- **{p['nombre']}**: {p['detalle']}" for p in revision["problemas"]]
    else:
        lineas += ["## ✅ Todas las tiendas revisadas funcionan bien"]
    lineas += ["", "## Tiendas revisadas", "", "| Tienda | Ofertas | Calzan con una edición | Estado |", "|---|---|---|---|"]
    for r in revision["tiendas"].values():
        estado = f"⚠️ {r['error']}" if r["error"] else "✅"
        lineas.append(f"| {r['nombre']} | {r['ofertas']} | {r['emparejadas']} | {estado} |")
    if revision["omitidas"]:
        lineas += ["", "No revisadas: " + "; ".join(f"{o['nombre']} ({o['motivo']})" for o in revision["omitidas"]) + "."]
    return "\n".join(lineas) + "\n"


# ---------- En tu PC: una vez al día, guardada en la base de datos ----------

def leer_guardada():
    texto = db.meta_leer(CLAVE)
    return json.loads(texto) if texto else None


async def revisar_y_guardar():
    global en_curso
    en_curso = True
    try:
        revision = await revisar(leer_guardada())
        db.meta_guardar(CLAVE, json.dumps(revision, ensure_ascii=False))
        log.info("Revisión de tiendas lista: %d problemas (%d s)", len(revision["problemas"]), revision["segundos"])
        return revision
    finally:
        en_curso = False


async def tarea_diaria():
    """Espera un rato tras abrir la app (para no competir con tu primera búsqueda) y revisa si toca."""
    await asyncio.sleep(120)
    while True:
        guardada = leer_guardada()
        if not en_curso and (not guardada or time.time() - guardada["fecha"] > CADA_HORAS * 3600):
            try:
                await revisar_y_guardar()
            except Exception:
                log.warning("Falló la revisión de tiendas", exc_info=True)
        await asyncio.sleep(3600)


# ---------- Desde la consola o desde GitHub ----------

async def _principal():
    parser = argparse.ArgumentParser(description="Revisa que todas las tiendas se sigan leyendo bien.")
    parser.add_argument("--archivo", help="JSON con la revisión anterior; se reemplaza por la nueva")
    parser.add_argument("--informe", help="dónde escribir el informe en Markdown")
    opciones = parser.parse_args()

    db.inicializar()
    ruta = Path(opciones.archivo) if opciones.archivo else None
    if ruta:
        anterior = json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else None
    else:
        anterior = leer_guardada()
    try:
        revision = await revisar(anterior, nube=EN_SERVIDOR)
    finally:
        await red.cerrar()

    if ruta:
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(json.dumps(revision, ensure_ascii=False, indent=1), encoding="utf-8")
    else:
        db.meta_guardar(CLAVE, json.dumps(revision, ensure_ascii=False))
    texto = informe(revision)
    if opciones.informe:
        Path(opciones.informe).write_text(texto, encoding="utf-8")
    print(texto)

    # Para GitHub Actions: cuántos problemas hay y si cambiaron desde la revisión anterior
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as salida:
            salida.write(f"problemas={len(revision['problemas'])}\n")
            salida.write(f"cambio={'true' if firma(revision) != firma(anterior) else 'false'}\n")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    asyncio.run(_principal())
