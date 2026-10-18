"""Base de datos SQLite: caché genérica y valores sueltos ("meta")."""
import json
import sqlite3
import time
from contextlib import contextmanager

from .config import CARPETA_DATOS

RUTA_DB = CARPETA_DATOS / "buscador.sqlite3"

ESQUEMA = """
CREATE TABLE IF NOT EXISTS cache (
    clave  TEXT PRIMARY KEY,
    valor  TEXT NOT NULL,
    expira REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
-- Relación entre el id de MTGJSON y el id de Scryfall, con enlaces a Card Kingdom
CREATE TABLE IF NOT EXISTS mtgjson_cartas (
    uuid         TEXT PRIMARY KEY,
    scryfall_id  TEXT NOT NULL,
    url_normal   TEXT,
    url_foil     TEXT,
    url_etched   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mtgjson_scryfall ON mtgjson_cartas(scryfall_id);
-- Precios de venta de Card Kingdom (USD) de hoy
CREATE TABLE IF NOT EXISTS ck_precios (
    uuid    TEXT NOT NULL,
    acabado TEXT NOT NULL,   -- normal, foil o etched
    precio  REAL NOT NULL,
    PRIMARY KEY (uuid, acabado)
);
"""


@contextmanager
def conexion():
    """Abre la base, confirma los cambios al terminar y la cierra."""
    con = sqlite3.connect(RUTA_DB, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def inicializar():
    with conexion() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(ESQUEMA)


def cache_leer(clave, permitir_vencido=False):
    """Devuelve el valor guardado, o None si no existe o ya venció."""
    with conexion() as con:
        fila = con.execute("SELECT valor, expira FROM cache WHERE clave = ?", (clave,)).fetchone()
    if fila is None:
        return None
    if fila["expira"] < time.time() and not permitir_vencido:
        return None
    return json.loads(fila["valor"])


def cache_guardar(clave, valor, horas):
    with conexion() as con:
        con.execute(
            "INSERT OR REPLACE INTO cache (clave, valor, expira) VALUES (?, ?, ?)",
            (clave, json.dumps(valor, ensure_ascii=False), time.time() + horas * 3600),
        )


def cache_borrar(prefijo):
    with conexion() as con:
        con.execute("DELETE FROM cache WHERE clave LIKE ?", (prefijo + "%",))


def meta_leer(clave, por_defecto=None):
    with conexion() as con:
        fila = con.execute("SELECT valor FROM meta WHERE clave = ?", (clave,)).fetchone()
    return fila["valor"] if fila else por_defecto


def meta_guardar(clave, valor):
    with conexion() as con:
        con.execute("INSERT OR REPLACE INTO meta (clave, valor) VALUES (?, ?)", (clave, str(valor)))
