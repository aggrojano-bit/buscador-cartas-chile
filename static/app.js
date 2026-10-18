// =============================================================
//  Buscador de Cartas Chile: lógica de la página
// =============================================================

const estado = {
  moneda: "CLP",
  tasas: null,          // cuántos CLP vale 1 unidad de cada moneda
  carta: null,          // datos de la carta buscada
  ediciones: [],
  seleccion: null,      // id de la edición elegida
};

const $ = (sel) => document.querySelector(sel);

// ---------- Utilidades ----------

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function guardarPreferencia(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch (e) {}
}
function leerPreferencia(clave) {
  try { return localStorage.getItem(clave); } catch (e) { return null; }
}

async function api(ruta, opciones) {
  const resp = await fetch(ruta, opciones);
  if (!resp.ok) {
    let detalle = `Error ${resp.status}`;
    try { detalle = (await resp.json()).detail || detalle; } catch (e) {}
    throw new Error(detalle);
  }
  return resp.json();
}

function convertir(monto, de, a) {
  if (monto == null || !estado.tasas) return null;
  return (monto * estado.tasas[de]) / estado.tasas[a];
}

const formateadores = {};
function formatear(monto, moneda) {
  if (monto == null) return "—";
  if (!formateadores[moneda]) {
    const sinDecimales = moneda === "CLP" || moneda === "JPY";
    formateadores[moneda] = new Intl.NumberFormat("es-CL", {
      style: "currency", currency: moneda,
      minimumFractionDigits: sinDecimales ? 0 : 2, maximumFractionDigits: sinDecimales ? 0 : 2,
    });
  }
  return formateadores[moneda].format(monto);
}

// Precio en la moneda elegida, y debajo el original si es distinta
function precioHTML(monto, monedaOriginal) {
  if (monto == null) return "—";
  const elegido = convertir(monto, monedaOriginal, estado.moneda);
  if (monedaOriginal === estado.moneda || elegido == null) return esc(formatear(monto, monedaOriginal));
  return `${esc(formatear(elegido, estado.moneda))}<span class="original">${esc(formatear(monto, monedaOriginal))}</span>`;
}

function mostrarMensaje(texto, esError = false) {
  const el = $("#mensaje");
  el.hidden = !texto;
  el.textContent = texto || "";
  el.classList.toggle("error", esError);
}

const NOMBRE_ACABADO = { normal: "Normal", foil: "Foil", etched: "Etched foil" };

// ---------- Datos generales (tipo de cambio y Card Kingdom) ----------

let consultandoEstado = null;

async function cargarInfoDatos() {
  const partes = [];
  try {
    const cambio = await api("/api/tipo-cambio");
    estado.tasas = cambio.tasas;
    const usd = formatear(cambio.tasas.USD, "CLP");
    const eur = formatear(cambio.tasas.EUR, "CLP");
    const jpy = (cambio.tasas.JPY).toLocaleString("es-CL", { maximumFractionDigits: 2 });
    partes.push(`Tipo de cambio del ${esc(cambio.fecha)}: US$1 = ${usd} · €1 = ${eur} · ¥1 = $${jpy}` +
      (cambio.desactualizado ? " (⚠ sin conexión, valor antiguo)" : ""));
  } catch (e) {
    partes.push("⚠ No se pudo obtener el tipo de cambio: los precios se muestran solo en su moneda original.");
  }
  try {
    const info = await api("/api/estado");
    const ck = info.card_kingdom;
    if (ck.cargando) {
      partes.push("⏳ Descargando precios de Card Kingdom (la primera vez tarda 1 o 2 minutos)…");
      esperarCardKingdom();
    } else if (ck.error) {
      partes.push("⚠ No se pudieron descargar los precios de Card Kingdom; se usa el respaldo de Scryfall.");
    } else if (ck.fecha_precios) {
      partes.push(`Precios Card Kingdom del ${esc(ck.fecha_precios)}.`);
    }
    return info;
  } catch (e) {
    return null;
  } finally {
    $("#info-datos").innerHTML = partes.join("<br>");
  }
}

// Mientras Card Kingdom se descarga, revisa cada 10 s y recarga la carta al terminar
function esperarCardKingdom() {
  if (consultandoEstado) return;
  consultandoEstado = setInterval(async () => {
    const info = await api("/api/estado").catch(() => null);
    if (info && !info.card_kingdom.cargando) {
      clearInterval(consultandoEstado);
      consultandoEstado = null;
      await cargarInfoDatos();
      if (estado.carta) buscar(estado.carta.nombre, { mantenerSeleccion: true });
    }
  }, 10000);
}

// ---------- Autocompletado ----------

let temporizador = null;
let controlador = null;
let sugerencias = [];
let indiceActivo = -1;

function pintarSugerencias() {
  const lista = $("#sugerencias");
  const input = $("#busqueda");
  if (!sugerencias.length) {
    lista.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  lista.innerHTML = sugerencias.map((s, i) => `
    <li role="option" id="sug-${i}" data-i="${i}" aria-selected="${i === indiceActivo}">
      <span>${esc(s.mostrar)}</span>${s.idioma === "es" ? '<span class="idioma">español</span>' : ""}
    </li>`).join("");
  lista.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", indiceActivo >= 0 ? `sug-${indiceActivo}` : "");
}

function cerrarSugerencias() {
  sugerencias = [];
  indiceActivo = -1;
  pintarSugerencias();
}

$("#busqueda").addEventListener("input", (ev) => {
  const texto = ev.target.value.trim();
  clearTimeout(temporizador);
  if (texto.length < 2) return cerrarSugerencias();
  // Espera a que dejes de escribir 250 ms antes de preguntar (no saturar Scryfall)
  temporizador = setTimeout(async () => {
    controlador?.abort();
    controlador = new AbortController();
    try {
      sugerencias = await api(`/api/autocompletar?q=${encodeURIComponent(texto)}`, { signal: controlador.signal });
      indiceActivo = -1;
      pintarSugerencias();
    } catch (e) {
      if (e.name !== "AbortError") cerrarSugerencias();
    }
  }, 250);
});

$("#busqueda").addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" && sugerencias.length) {
    ev.preventDefault();
    indiceActivo = (indiceActivo + 1) % sugerencias.length;
    pintarSugerencias();
  } else if (ev.key === "ArrowUp" && sugerencias.length) {
    ev.preventDefault();
    indiceActivo = (indiceActivo - 1 + sugerencias.length) % sugerencias.length;
    pintarSugerencias();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const elegida = sugerencias[indiceActivo] || sugerencias[0];
    const nombre = elegida ? elegida.nombre : ev.target.value.trim();
    if (nombre) elegirSugerencia(nombre);
  } else if (ev.key === "Escape") {
    cerrarSugerencias();
  }
});

$("#sugerencias").addEventListener("mousedown", (ev) => {
  const li = ev.target.closest("li");
  if (!li) return;
  ev.preventDefault();
  elegirSugerencia(sugerencias[Number(li.dataset.i)].nombre);
});

$("#busqueda").addEventListener("blur", () => setTimeout(cerrarSugerencias, 150));

function elegirSugerencia(nombre) {
  clearTimeout(temporizador);
  controlador?.abort();
  cerrarSugerencias();
  $("#busqueda").value = nombre;
  $("#busqueda").blur();
  buscar(nombre);
}

// ---------- Búsqueda de ediciones ----------

async function buscar(nombre, { forzar = false, mantenerSeleccion = false } = {}) {
  mostrarMensaje(forzar ? "Actualizando precios…" : `Buscando todas las ediciones de «${nombre}»…`);
  const boton = $("#actualizar");
  boton.disabled = true;
  try {
    const ruta = `/api/${forzar ? "actualizar" : "ediciones"}?nombre=${encodeURIComponent(nombre)}`;
    const datos = await api(ruta, forzar ? { method: "POST" } : undefined);
    const anterior = estado.seleccion;
    estado.carta = datos.carta;
    estado.ediciones = datos.ediciones;
    estado.seleccion = mantenerSeleccion && datos.ediciones.some((e) => e.id === anterior)
      ? anterior : (datos.ediciones.find((e) => e.referencias.length) || datos.ediciones[0])?.id;
    try { history.replaceState(null, "", `?carta=${encodeURIComponent(datos.carta.nombre)}`); } catch (e) {}
    mostrarMensaje("");
    pintarResultado();
  } catch (e) {
    mostrarMensaje(e.message, true);
  } finally {
    boton.disabled = false;
  }
}

// Precio de referencia de la edición para el carrusel: normal si existe, si no el primer acabado
function referenciaCarrusel(ed) {
  const p = ed.referencia_principal;
  return p.normal || p[ed.acabados[0]] || Object.values(p)[0] || null;
}

function precioEnCLP(ed) {
  const ref = referenciaCarrusel(ed);
  return ref ? convertir(ref.precio, ref.moneda, "CLP") ?? ref.precio : null;
}

function edicionesOrdenadas() {
  const lista = [...estado.ediciones];
  const orden = $("#orden").value;
  const porPrecio = (signo) => (a, b) => {
    const pa = precioEnCLP(a), pb = precioEnCLP(b);
    if (pa == null) return 1;
    if (pb == null) return -1;
    return signo * (pa - pb);
  };
  if (orden === "antiguas") lista.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  else if (orden === "barata") lista.sort(porPrecio(1));
  else if (orden === "cara") lista.sort(porPrecio(-1));
  else lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  return lista;
}

function pintarResultado() {
  $("#resultado").hidden = false;
  const c = estado.carta;
  $("#titulo-carta").textContent = c.nombre;
  const total = estado.ediciones.length;
  $("#subtitulo-carta").textContent = `${c.tipo || ""} · ${total} ${total === 1 ? "edición" : "ediciones"} en papel`;
  pintarCarrusel();
  pintarDetalle();
}

function pintarCarrusel() {
  $("#carrusel").innerHTML = edicionesOrdenadas().map((ed) => {
    const ref = referenciaCarrusel(ed);
    const chips = [...ed.acabados.filter((a) => a !== "normal").map((a) => NOMBRE_ACABADO[a]), ...ed.variantes];
    return `
      <button type="button" role="listitem" class="edicion ${ed.id === estado.seleccion ? "seleccionada" : ""}" data-id="${ed.id}">
        <img src="${esc(ed.imagen)}" alt="${esc(ed.nombre)} de ${esc(ed.set_nombre)}" loading="lazy">
        <span class="set" title="${esc(ed.set_nombre)}">${esc(ed.set_nombre)}</span>
        <span class="linea">${esc(ed.set)} · #${esc(ed.numero)} · <span class="rareza-${esc(ed.rareza_clave)}">${esc(ed.rareza)}</span></span>
        ${chips.length ? `<span class="chips">${chips.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</span>` : ""}
        <span class="precio-ref">${ref ? precioHTML(ref.precio, ref.moneda) : '<span class="linea">Sin precio</span>'}</span>
      </button>`;
  }).join("");
}

function pintarDetalle() {
  const ed = estado.ediciones.find((e) => e.id === estado.seleccion);
  if (!ed) { $("#detalle").innerHTML = ""; return; }

  // Precio de Card Kingdom por acabado, para calcular diferencias
  const ck = {};
  ed.referencias.filter((r) => r.fuente === "cardkingdom").forEach((r) => { ck[r.acabado] = r; });

  const filas = ed.referencias.map((r) => {
    const base = r.es_principal && !r.es_respaldo ? null : ck[r.acabado] || ed.referencia_principal[r.acabado];
    let diferencia = "—";
    if (base && base !== r) {
      const a = convertir(r.precio, r.moneda, estado.moneda);
      const b = convertir(base.precio, base.moneda, estado.moneda);
      if (a != null && b != null && b > 0) {
        const delta = a - b;
        const clase = delta < 0 ? "var(--verde)" : delta > 0 ? "var(--rojo)" : "inherit";
        const signo = delta > 0 ? "+" : delta < 0 ? "−" : "";
        const porcentaje = Math.abs((delta / b) * 100).toFixed(0);
        diferencia = `<span style="color:${clase}">${signo}${esc(formatear(Math.abs(delta), estado.moneda))} (${signo}${porcentaje}%)</span>`;
      }
    }
    const etiqueta = r.es_principal
      ? (r.es_respaldo ? '<span class="etiqueta respaldo">referencia (respaldo)</span>' : '<span class="etiqueta ref">referencia</span>')
      : "";
    return `
      <tr class="${r.es_principal ? "principal" : ""}">
        <td>${esc(r.fuente_nombre)}${etiqueta}</td>
        <td>${esc(NOMBRE_ACABADO[r.acabado] || r.acabado)}</td>
        <td class="num">${precioHTML(r.precio, r.moneda)}</td>
        <td class="num">${diferencia}</td>
        <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Ver ↗</a>` : "—"}</td>
      </tr>`;
  }).join("");

  const sinCK = ed.acabados.filter((a) => !ck[a]);
  const avisos = [];
  if (sinCK.length && ed.referencias.length) {
    avisos.push(`Card Kingdom no tiene precio para: ${sinCK.map((a) => NOMBRE_ACABADO[a] || a).join(", ")}. En esos casos la referencia es TCGplayer o Cardmarket (vía Scryfall), marcada como «respaldo».`);
  }
  avisos.push("Card Kingdom no informa su stock en la lista de precios. La diferencia se calcula contra la referencia del mismo acabado.");

  $("#detalle").innerHTML = `
    <div><img src="${esc(ed.imagen_grande)}" alt="${esc(ed.nombre)} de ${esc(ed.set_nombre)}"></div>
    <div>
      <h3>${esc(ed.nombre_impreso || ed.nombre)}</h3>
      <dl class="datos-edicion">
        <dt>Edición</dt><dd>${esc(ed.set_nombre)} (${esc(ed.set)})</dd>
        <dt>Número</dt><dd>#${esc(ed.numero)}</dd>
        <dt>Rareza</dt><dd class="rareza-${esc(ed.rareza_clave)}">${esc(ed.rareza)}</dd>
        <dt>Acabados</dt><dd>${ed.acabados.map((a) => esc(NOMBRE_ACABADO[a] || a)).join(", ")}</dd>
        <dt>Variante</dt><dd>${ed.variantes.length ? ed.variantes.map(esc).join(", ") : "Normal"}</dd>
        <dt>Lanzamiento</dt><dd>${esc(ed.fecha || "—")}</dd>
      </dl>
      <h4>Precios de referencia mundial</h4>
      ${ed.referencias.length ? `
        <div class="tabla-marco"><table>
          <thead><tr><th>Fuente</th><th>Acabado</th><th class="num">Precio (${esc(estado.moneda)})</th><th class="num">Dif. vs referencia</th><th>Enlace</th></tr></thead>
          <tbody>${filas}</tbody>
        </table></div>` : '<p class="nota">No hay precios de referencia para esta edición.</p>'}
      ${avisos.map((a) => `<p class="aviso">ℹ ${esc(a)}</p>`).join("")}
      <p class="nota">Las tiendas donde comprar se agregan en las próximas fases. <a href="${esc(ed.enlaces.scryfall)}" target="_blank" rel="noopener">Ver en Scryfall ↗</a></p>
    </div>`;
}

// ---------- Eventos ----------

$("#carrusel").addEventListener("click", (ev) => {
  const tarjeta = ev.target.closest(".edicion");
  if (!tarjeta) return;
  estado.seleccion = tarjeta.dataset.id;
  document.querySelectorAll(".edicion").forEach((el) => el.classList.toggle("seleccionada", el === tarjeta));
  pintarDetalle();
  if (window.innerWidth < 900) $("#detalle").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelectorAll(".flecha").forEach((boton) => {
  boton.addEventListener("click", () => {
    const carrusel = $("#carrusel");
    const paso = carrusel.clientWidth * 0.8;
    carrusel.scrollBy({ left: boton.classList.contains("izquierda") ? -paso : paso, behavior: "smooth" });
  });
});

$("#orden").addEventListener("change", pintarCarrusel);

$("#actualizar").addEventListener("click", () => {
  if (estado.carta) buscar(estado.carta.nombre, { forzar: true, mantenerSeleccion: true });
});

$("#moneda").addEventListener("change", (ev) => {
  estado.moneda = ev.target.value;
  guardarPreferencia("moneda", estado.moneda);
  if (estado.carta) { pintarCarrusel(); pintarDetalle(); }
});

$("#tema").addEventListener("click", () => {
  const raiz = document.documentElement;
  const oscuroAhora = raiz.dataset.theme
    ? raiz.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  raiz.dataset.theme = oscuroAhora ? "light" : "dark";
  guardarPreferencia("tema", raiz.dataset.theme);
});

// ---------- Inicio ----------

(async function iniciar() {
  const info = await cargarInfoDatos();
  const monedaGuardada = leerPreferencia("moneda") || info?.moneda_por_defecto || "CLP";
  estado.moneda = ["CLP", "USD", "EUR", "JPY"].includes(monedaGuardada) ? monedaGuardada : "CLP";
  $("#moneda").value = estado.moneda;

  const cartaEnURL = new URLSearchParams(location.search).get("carta");
  if (cartaEnURL) {
    $("#busqueda").value = cartaEnURL;
    buscar(cartaEnURL);
  } else {
    $("#busqueda").focus();
  }
})();
