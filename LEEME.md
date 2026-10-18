# Buscador de Cartas Chile

App web local para buscar cartas de Magic: The Gathering, ver todas sus ediciones
y comparar precios pensando en comprar desde Chile.

## Cómo abrirla

1. Haz doble clic en **`iniciar.bat`**.
   - La primera vez tarda un par de minutos: crea el entorno de Python e instala las librerías.
   - También descarga los precios de Card Kingdom (unos 40 MB, una vez al día).
2. Abre en el navegador: **http://localhost:8001**
3. Para cerrarla, cierra la ventana negra.

### Desde el celular
- El celular debe estar en el **mismo Wi-Fi** que el PC.
- La ventana negra muestra una dirección del tipo `http://192.168.x.x:8001`: escríbela en el navegador del celular.
- La primera vez Windows puede preguntar si permite a Python usar la red: acepta solo en **redes privadas**.
- Si no carga, revisa que la red de tu casa esté marcada como "Privada" en Windows
  (Configuración → Red e Internet → Wi-Fi → tu red → Tipo de perfil de red).

## Qué necesitas instalado
- **Python 3.11 o más nuevo** (https://www.python.org, marcando "Add Python to PATH"). Ya lo tienes.
- **Git** (opcional, para guardar versiones). Ya lo tienes.

## Ajustes
Todo lo configurable está en **`ajustes.toml`** (se abre con el Bloc de notas): el puerto, la moneda inicial,
las horas de caché y las pausas entre peticiones. Después de editarlo, reinicia la app.

## Dónde se guardan los datos
Para que OneDrive no sincronice (y dañe) archivos que cambian todo el tiempo, se guardan fuera de esta carpeta:
- Librerías de Python: `%LOCALAPPDATA%\BuscadorCartasChile\venv`
- Caché y datos: `%LOCALAPPDATA%\BuscadorCartasChile\datos`

Puedes borrar la carpeta `datos` cuando quieras: la app la vuelve a crear.

## De dónde vienen los datos
| Dato | Fuente |
|---|---|
| Cartas, ediciones e imágenes | [Scryfall](https://scryfall.com/docs/api) |
| Precio Card Kingdom (referencia principal) | [MTGJSON](https://mtgjson.com), actualizado a diario. No informa stock |
| Precios TCGplayer y Cardmarket (respaldo) | Scryfall |
| Tipo de cambio | [mindicador.cl](https://mindicador.cl) y [Frankfurter](https://frankfurter.dev); respaldo: open.er-api.com |

## Tiendas
Cada tienda es un archivo en `adaptadores/`. La lista de tiendas activas (y las revisadas que
no se consultan, con el motivo) está en `adaptadores/__init__.py`: para quitar una tienda,
bórrala de `ACTIVAS`.

| Tienda | Cómo se lee |
|---|---|
| Oasis Games, Pay to Win, La Comarca, Piedra Bruja, Game of Magic, AFK Store | Shopify: buscador público + datos JSON de cada producto |
| CardNexus, Ineko, La Cripta | WooCommerce: API pública de la tienda (Store API) |
| ZendiCard | Buscador público + datos estructurados (JSON-LD) de cada producto |
| Magic4ever, Chronomagic | Jumpseller: su robots.txt prohíbe el buscador, así que se usa su sitemap (1 descarga al día) + cada producto |
| Card Kingdom (EE.UU.) | Precios diarios de MTGJSON (su sitio está protegido); no informa stock |
| Hareruya (Japón) | API JSON de su propio buscador, una consulta por carta |
| CardTrader Zero (Italia) | API oficial; necesita tu token (ver abajo) |

### Token de CardTrader
1. Crea una cuenta gratis en https://www.cardtrader.com
2. Entra a tu perfil → **Settings** → sección **API** y copia el token.
3. Pégalo en `ajustes.toml`, en `[cardtrader]`, así: `token = "el-token-copiado"`.
4. Reinicia la app. Sin token, CardTrader aparece como "falta configurar token" y el resto funciona igual.

### Costo "puesto en Chile"
Para las tiendas internacionales la app estima: precio + envío + arancel + IVA 19%, comprando solo esa carta.
Los valores están en `ajustes.toml` (`[importacion]` y `[envio.*]`). Son estimaciones: confirma el valor real al pagar.

Los precios de tiendas se guardan 6 horas (`horas_precios_tiendas` en `ajustes.toml`).
El botón **Actualizar precios** vuelve a consultarlas. Se respeta el robots.txt de cada tienda,
con pausas de 1 a 1,5 segundos entre consultas a la misma tienda.

## Estructura del proyecto
```
iniciar.bat         abre la app con doble clic
ajustes.toml        tus ajustes
app/
  main.py           servidor web (las rutas /api/...)
  scryfall.py       catálogo de cartas
  cardkingdom.py    precios de Card Kingdom vía MTGJSON
  monedas.py        tipo de cambio
  ofertas.py        consulta las tiendas en paralelo, con caché
  emparejar.py      asigna cada oferta a su edición (o la deja como "posible coincidencia")
  red.py            consultas a internet con pausas y User-Agent
  db.py             base de datos SQLite (caché)
  lanzar.py         arranca el servidor
adaptadores/        una tienda por archivo (base.py = estructura común)
static/             la página: index.html, estilos.css, app.js
```

Para desarrolladores: con la app abierta, http://localhost:8001/docs muestra todas las rutas de la API para probarlas.
