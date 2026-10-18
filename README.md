# 🃏 Buscador de Cartas Chile

Página web para buscar una carta de **Magic: The Gathering**, ver **todas sus ediciones** y
comparar sus precios en **tiendas chilenas e internacionales**, pensando en comprar desde Chile.

### 👉 Pruébala aquí: **https://buscador-cartas-chile.onrender.com**

> La primera visita puede tardar cerca de **1 minuto** en abrir: el servidor gratuito se "duerme"
> cuando nadie lo usa y tiene que despertar. Después funciona normal.

![Resultado de búsqueda](docs/capturas/resultado.png)

---

## ¿Qué hace?

- Busca cualquier carta de Magic **en inglés o en español** (con autocompletado).
- Muestra **todas sus ediciones** con imagen, código, número, rareza y variante (foil, borderless, showcase…).
- Compara precios en **12 tiendas chilenas** y **3 internacionales**, y dice cuál es la más barata.
- Muestra la diferencia con **Card Kingdom** (referencia principal), en verde si es más barato y en rojo si es más caro.
- Para las tiendas internacionales calcula un **costo estimado puesto en Chile** (envío + IVA + arancel).
- Precios en **CLP, USD, EUR o JPY**, con tipo de cambio del día.
- Funciona en **PC y celular**, con modo oscuro y 15 fondos a elección.

## Cómo se usa (paso a paso)

1. Entra a **https://buscador-cartas-chile.onrender.com**.
2. Escribe el nombre de una carta, por ejemplo **Sol Ring** o **relámpago**, y elige una sugerencia.
3. Espera unos segundos: las tiendas van apareciendo a medida que responden (la barra de arriba muestra el avance).
4. Mira el **resumen**: la más barata en Chile, la más barata internacional y la referencia de Card Kingdom.
   Haz clic en cualquiera para ir a esa edición.
5. En la **grilla de ediciones**, las que tienen stock aparecen primero (borde verde). Haz clic en una.
6. A la derecha (o a pantalla completa en el celular) verás la **mejor oferta** y la tabla con todas las tiendas.
   El botón **«Ir a la tienda ↗»** te lleva directo al producto.
7. Usa los **filtros** (Chile / internacional, foil, condición, idioma) y la pestaña **«Todas las ediciones»**
   para ver la oferta más barata de cada una.

| Inicio | En el celular |
|---|---|
| ![Inicio](docs/capturas/inicio.png) | ![Celular](docs/capturas/celular.png) |

## ¿Qué funciona hoy?

- ✅ Catálogo completo de Magic (Scryfall), con búsqueda en inglés y español.
- ✅ Precios de referencia: Card Kingdom (vía MTGJSON), TCGplayer y Cardmarket.
- ✅ Tiendas chilenas: Oasis Games, Pay to Win, La Comarca, Piedra Bruja, CardNexus, Ineko Card Shop,
  ZendiCard, Game of Magic, AFK Store, La Cripta, Magic4ever y Chronomagic.
- ✅ Tiendas internacionales: Card Kingdom (EE.UU.) y Hareruya (Japón).
- ✅ Emparejamiento automático de cada oferta con su edición exacta; lo dudoso se muestra aparte
  como «posible coincidencia» (nunca se asigna a una edición equivocada).

## ¿Qué falta por hacer?

- ⏳ **CardTrader Zero** (Italia): está programado, pero falta activar el token de la API.
- ⏳ **Carrito ficticio**: juntar cartas de varias tiendas y calcular envío, impuestos y pedidos mínimos.
- ⏳ **Pokémon TCG**: catálogo y tiendas.
- ⏳ **Búsqueda por foto** de la carta.
- ⏳ Más tiendas chilenas. Algunas no se pueden incluir porque sus reglas lo prohíben
  (la lista completa, con el motivo, está al final de la página).

## ¿Encontraste un error o tienes una idea?

- 🐞 **[Reportar un error](https://github.com/aggrojano-bit/buscador-cartas-chile/issues/new?template=reportar-error.yml)**
- 💡 **[Sugerir una mejora o una tienda nueva](https://github.com/aggrojano-bit/buscador-cartas-chile/issues/new?template=sugerir-mejora.yml)**

Solo necesitas una cuenta gratis de GitHub. También hay un botón **«🐞 Reportar un error»** en la esquina de la página.
Si sabes programar y quieres proponer cambios, lee [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Instalar en tu PC (opcional)

Necesitas **Python 3.11 o más nuevo** (https://www.python.org, marcando «Add Python to PATH»).

1. Descarga el proyecto (botón verde **Code → Download ZIP**) y descomprímelo.
2. Haz doble clic en **`iniciar.bat`**. La primera vez tarda un par de minutos (instala lo necesario y
   descarga unos 40 MB de precios de Card Kingdom).
3. Abre **http://localhost:8001** en el navegador.
4. Desde el celular (mismo Wi-Fi), usa la dirección `http://192.168.x.x:8001` que aparece en la ventana negra.

**Ajustes:** envíos, impuestos, puerto, horas de caché y moneda inicial están en `ajustes.toml`.
**Datos privados:** copia `.env.example` como `.env` y pon ahí el token de CardTrader (ese archivo nunca se sube).

## Cómo funciona por dentro

```
app/            servidor (Python + FastAPI): catálogo, tipo de cambio, caché y emparejamiento
adaptadores/    una tienda por archivo, todas con la misma estructura
static/         la página (HTML, CSS y JavaScript, sin frameworks)
ajustes.toml    valores configurables
render.yaml     configuración para publicarla en Render.com
```

- **Respeto a las tiendas:** se revisa el `robots.txt` y los términos de cada una; si prohíben la lectura
  automática, no se incluyen. Se usan pausas entre consultas (máximo 2 por segundo por tienda), un
  User-Agent identificable, y los resultados se guardan **6 horas** en caché.
- **Fuentes:** [Scryfall](https://scryfall.com) (catálogo e imágenes), [MTGJSON](https://mtgjson.com)
  (precios Card Kingdom), mindicador.cl y Frankfurter (tipo de cambio).

> Proyecto personal sin fines de lucro, no afiliado a Wizards of the Coast ni a las tiendas.
> Los precios son referenciales: confírmalos siempre en la tienda antes de comprar.
