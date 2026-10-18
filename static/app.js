// =============================================================
//  Buscador de Cartas Chile: lógica de la página
// =============================================================

const estado = {
  moneda: "CLP",
  tasas: null,          // cuántos CLP vale 1 unidad de cada moneda
  carta: null,          // datos de la carta buscada
  ediciones: [],
  seleccion: null,      // id de la edición elegida
  tiendas: [],          // estado de cada tienda
  ofertas: [],          // todas las ofertas encontradas
  noIncluidas: [],
  tiendasCompletas: false,
  vista: "edicion",
  orden: { campo: "final", dir: 1 },   // tabla de ofertas: "final" (puesto en Chile) o "precio"
  config: null,         // impuestos y envíos de ajustes.toml
  consulta: 0,          // número de búsqueda, para ignorar respuestas viejas
};

const filtros = { origen: "", idioma: "", acabado: "", condicion: "", agotados: false };

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

// Precio comparable entre monedas (en CLP; si no hay tipo de cambio, el monto tal cual)
function enCLP(monto, moneda) {
  return convertir(monto, moneda, "CLP") ?? monto;
}

// "+$1.200 (+15%)" en rojo o "−$300 (−5%)" en verde
function diferenciaHTML(monto, moneda, base) {
  if (!base) return "—";
  const a = convertir(monto, moneda, estado.moneda);
  const b = convertir(base.precio, base.moneda, estado.moneda);
  if (a == null || b == null || b <= 0) return "—";
  const delta = a - b;
  const signo = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const clase = delta < 0 ? "verde" : delta > 0 ? "rojo" : "";
  const porcentaje = Math.abs((delta / b) * 100).toFixed(0);
  const marca = base.fuente !== "cardkingdom" ? `<span class="original">vs ${esc(base.fuente_nombre)}*</span>` : "";
  return `<span class="${clase}">${signo}${esc(formatear(Math.abs(delta), estado.moneda))} (${signo}${porcentaje}%)</span>${marca}`;
}

// Costo estimado "puesto en Chile" de una oferta internacional, comprando solo esa carta.
// Valor CIF = precio + envío. Arancel sobre el CIF. IVA sobre CIF + arancel. Todo en CLP.
function costoPuesto(o) {
  if (o.pais === "CL" || !estado.config || !estado.tasas) return null;
  const imp = estado.config.importacion || {};
  const envio = (estado.config.envios || {})[o.tienda];
  const precio = convertir(o.precio, o.moneda, "CLP");
  const costoEnvio = envio ? convertir(envio.costo, envio.moneda, "CLP") : 0;
  const cif = precio + costoEnvio;
  const tasaArancel = convertir(cif, "CLP", "USD") > (imp.limite_usd ?? 500)
    ? (imp.arancel_sobre_limite ?? 0.06) : (imp.arancel_bajo_limite ?? 0);
  const arancel = cif * tasaArancel;
  const iva = (cif + arancel) * (imp.iva ?? 0.19);
  const cargo = imp.cargo_fijo_clp ?? 0;
  return { total: cif + arancel + iva + cargo, precio, envio: costoEnvio, arancel, tasaArancel, iva, cargo, sinEnvio: !envio };
}

// Costo para comparar ofertas (en CLP): puesto en Chile si es internacional, precio si es chilena
function costoFinal(o) {
  return costoPuesto(o)?.total ?? enCLP(o.precio, o.moneda);
}

function costoPuestoHTML(o) {
  const c = costoPuesto(o);
  if (!c) return o.pais === "CL" ? '<span class="original">mismo precio</span>' : "—";
  const f = (v) => formatear(convertir(v, "CLP", estado.moneda), estado.moneda);
  const detalle = `Precio ${f(c.precio)} + envío ${c.sinEnvio ? "(no configurado)" : f(c.envio)}` +
    ` + arancel ${(c.tasaArancel * 100).toFixed(0)}% ${f(c.arancel)} + IVA ${f(c.iva)}` + (c.cargo ? ` + cargo fijo ${f(c.cargo)}` : "");
  return `<span title="${esc(detalle)}">≈ ${esc(f(c.total))}</span><span class="original">con envío e impuestos</span>`;
}

// La oferta cuenta como "con stock" solo si la fuente lo informa (Card Kingdom no lo hace)
function tieneStock(o) {
  return o.disponible && o.stock_conocido !== false;
}

function mostrarMensaje(texto, esError = false) {
  const el = $("#mensaje");
  el.hidden = !texto;
  el.textContent = texto || "";
  el.classList.toggle("error", esError);
}

const NOMBRE_ACABADO = { normal: "Normal", foil: "Foil", etched: "Etched foil" };
const NOMBRE_IDIOMA = { EN: "Inglés", ES: "Español", JA: "Japonés", PT: "Portugués", FR: "Francés", DE: "Alemán",
  IT: "Italiano", ZH: "Chino", KO: "Coreano", RU: "Ruso" };
const RANGO_CONDICION = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };
const BANDERA = { CL: "Chile", US: "EE.UU.", JP: "Japón", IT: "Italia (Zero)" };

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
    estado.config = { importacion: info.importacion, envios: info.envios };
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

// ---------- Búsqueda de ediciones y ofertas ----------

async function buscar(nombre, { forzar = false, mantenerSeleccion = false } = {}) {
  const consulta = ++estado.consulta;
  mostrarMensaje(forzar ? "Actualizando precios…" : `Buscando todas las ediciones de «${nombre}»…`);
  const boton = $("#actualizar");
  boton.disabled = true;
  try {
    const ruta = `/api/${forzar ? "actualizar" : "ediciones"}?nombre=${encodeURIComponent(nombre)}`;
    const datos = await api(ruta, forzar ? { method: "POST" } : undefined);
    if (consulta !== estado.consulta) return;
    const anterior = estado.seleccion;
    const mismaCarta = estado.carta?.nombre === datos.carta.nombre;
    estado.carta = datos.carta;
    estado.ediciones = datos.ediciones;
    estado.seleccion = mantenerSeleccion && datos.ediciones.some((e) => e.id === anterior)
      ? anterior : (datos.ediciones.find((e) => e.referencias.length) || datos.ediciones[0])?.id;
    if (!mismaCarta) {
      estado.ofertas = [];
      estado.tiendas = [];
      estado.tiendasCompletas = false;
    }
    try { history.replaceState(null, "", `?carta=${encodeURIComponent(datos.carta.nombre)}`); } catch (e) {}
    mostrarMensaje("");
    pintarResultado();
    cargarOfertas(datos.carta.nombre, consulta, forzar);
  } catch (e) {
    mostrarMensaje(e.message, true);
    boton.disabled = false;
  }
}

// Pide las ofertas y vuelve a preguntar cada 2,5 s hasta que todas las tiendas terminen
async function cargarOfertas(nombre, consulta, forzar) {
  let primera = true;
  while (consulta === estado.consulta) {
    try {
      const datos = await api(`/api/ofertas?nombre=${encodeURIComponent(nombre)}${primera && forzar ? "&forzar=true" : ""}`);
      if (consulta !== estado.consulta) return;
      primera = false;
      estado.tiendas = datos.tiendas;
      estado.ofertas = datos.ofertas;
      estado.noIncluidas = datos.no_incluidas;
      estado.tiendasCompletas = datos.completo;
      actualizarOpcionesIdioma();
      pintarTodo();
      if (datos.completo) break;
    } catch (e) {
      mostrarMensaje(`No se pudieron consultar las tiendas: ${e.message}`, true);
      break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (consulta === estado.consulta) $("#actualizar").disabled = false;
}

// ---------- Filtros ----------

function pasaFiltros(o) {
  if (!filtros.agotados && !o.disponible) return false;
  if (filtros.origen && o.pais !== filtros.origen) return false;
  if (filtros.acabado && o.acabado !== filtros.acabado) return false;
  if (filtros.idioma && (o.idioma || "?") !== filtros.idioma) return false;
  // Condición: las ofertas sin condición indicada se muestran siempre
  if (filtros.condicion !== "" && o.condicion && RANGO_CONDICION[o.condicion] > Number(filtros.condicion)) return false;
  return true;
}

function ofertasVisibles() {
  return estado.ofertas.filter(pasaFiltros);
}

function actualizarOpcionesIdioma() {
  const select = $("#f-idioma");
  const presentes = [...new Set(estado.ofertas.map((o) => o.idioma || "?"))].sort();
  const actual = filtros.idioma;
  select.innerHTML = '<option value="">Todos</option>' + presentes.map((c) =>
    `<option value="${esc(c)}">${esc(c === "?" ? "No indicado" : NOMBRE_IDIOMA[c] || c)}</option>`).join("");
  select.value = presentes.includes(actual) ? actual : "";
  filtros.idioma = select.value;
}

function cargarFiltros() {
  try { Object.assign(filtros, JSON.parse(leerPreferencia("filtros") || "{}")); } catch (e) {}
  $("#f-origen").value = filtros.origen;
  $("#f-acabado").value = filtros.acabado;
  $("#f-condicion").value = filtros.condicion;
  $("#f-agotados").checked = filtros.agotados;
}

[["#f-origen", "origen"], ["#f-idioma", "idioma"], ["#f-acabado", "acabado"], ["#f-condicion", "condicion"]].forEach(([sel, clave]) => {
  $(sel).addEventListener("change", (ev) => {
    filtros[clave] = ev.target.value;
    guardarPreferencia("filtros", JSON.stringify(filtros));
    pintarTodo();
  });
});
$("#f-agotados").addEventListener("change", (ev) => {
  filtros.agotados = ev.target.checked;
  guardarPreferencia("filtros", JSON.stringify(filtros));
  pintarTodo();
});

// ---------- Cálculos por edición ----------

// Referencia (Card Kingdom o respaldo) para comparar una oferta, según su acabado
function referenciaPara(edicion, acabado) {
  return edicion?.referencia_principal[acabado] || null;
}

// Precio de referencia de la edición para el carrusel: normal si existe, si no el primer acabado
function referenciaCarrusel(ed) {
  const p = ed.referencia_principal;
  return p.normal || p[ed.acabados[0]] || Object.values(p)[0] || null;
}

// Resumen por edición: ofertas visibles con stock y la más barata (comparando el costo final)
function resumenPorEdicion() {
  const resumen = {};
  for (const o of ofertasVisibles()) {
    if (!o.edicion_id || !tieneStock(o)) continue;
    const r = (resumen[o.edicion_id] ||= { cantidad: 0, mejor: null });
    r.cantidad++;
    if (!r.mejor || costoFinal(o) < costoFinal(r.mejor)) r.mejor = o;
  }
  return resumen;
}

function edicionesOrdenadas(resumen) {
  const lista = [...estado.ediciones];
  const orden = $("#orden").value;
  const precio = (e) => {
    if (resumen[e.id]) return costoFinal(resumen[e.id].mejor);
    const ref = referenciaCarrusel(e);
    return ref ? enCLP(ref.precio, ref.moneda) : null;
  };
  const porPrecio = (signo) => (a, b) => {
    const pa = precio(a), pb = precio(b);
    if (pa == null) return 1;
    if (pb == null) return -1;
    return signo * (pa - pb);
  };
  if (orden === "antiguas") lista.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  else if (orden === "barata") lista.sort(porPrecio(1));
  else if (orden === "cara") lista.sort(porPrecio(-1));
  else lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  // Las ediciones con stock en alguna tienda van primero (sort es estable: mantiene el orden elegido)
  lista.sort((a, b) => (resumen[b.id] ? 1 : 0) - (resumen[a.id] ? 1 : 0));
  return lista;
}

// ---------- Dibujar ----------

function pintarResultado() {
  $("#resultado").hidden = false;
  const c = estado.carta;
  $("#titulo-carta").textContent = c.nombre;
  const total = estado.ediciones.length;
  $("#subtitulo-carta").textContent = `${c.tipo || ""} · ${total} ${total === 1 ? "edición" : "ediciones"} en papel`;
  pintarTodo();
}

function pintarTodo() {
  if (!estado.carta) return;
  const resumen = resumenPorEdicion();
  pintarEstadoTiendas();
  pintarCarrusel(resumen);
  pintarDetalle();
  pintarTodas(resumen);
  pintarPosibles();
  pintarNoIncluidas();
}

function pintarEstadoTiendas() {
  $("#tiendas-estado").innerHTML = estado.tiendas.map((t) => {
    let texto = esc(t.nombre);
    let titulo = "";
    if (t.estado === "ok") texto += ` · ${t.cantidad}`;
    if (t.estado === "error") {
      texto += (t.error || "").includes("token") ? " · falta configurar token" : " · no disponible";
      titulo = t.error;
    }
    if (t.estado === "antiguo") { texto += " · datos antiguos"; titulo = `No respondió (${t.error}); se muestran datos guardados.`; }
    return `<a class="estado-tienda ${esc(t.estado)}" href="${esc(t.url)}" target="_blank" rel="noopener" title="${esc(titulo)}">${texto}</a>`;
  }).join("");
}

function pintarCarrusel(resumen) {
  $("#carrusel").innerHTML = edicionesOrdenadas(resumen).map((ed) => {
    const ref = referenciaCarrusel(ed);
    const r = resumen[ed.id];
    const atenuada = estado.tiendasCompletas && !r;
    const chips = [...ed.acabados.filter((a) => a !== "normal").map((a) => NOMBRE_ACABADO[a]), ...ed.variantes];
    const clases = ["edicion", ed.id === estado.seleccion && "seleccionada", r && "con-stock", atenuada && "sin-stock"].filter(Boolean).join(" ");
    return `
      <button type="button" role="listitem" class="${clases}" data-id="${ed.id}">
        <img src="${esc(ed.imagen)}" alt="${esc(ed.nombre)} de ${esc(ed.set_nombre)}" loading="lazy">
        <span class="set" title="${esc(ed.set_nombre)}">${esc(ed.set_nombre)}</span>
        <span class="linea">${esc(ed.set)} · #${esc(ed.numero)} · <span class="rareza-${esc(ed.rareza_clave)}">${esc(ed.rareza)}</span></span>
        ${chips.length ? `<span class="chips">${chips.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</span>` : ""}
        ${r ? `<span class="badge-stock">🛒 ${r.cantidad} ${r.cantidad === 1 ? "oferta" : "ofertas"} · desde ${r.mejor.pais === "CL" ? "" : "≈"}${esc(estado.tasas ? formatear(convertir(costoFinal(r.mejor), "CLP", estado.moneda), estado.moneda) : formatear(r.mejor.precio, r.mejor.moneda))}</span>` : ""}
        <span class="precio-ref">${ref ? `<span class="linea">Ref. ${esc(ref.fuente_nombre)}</span> ${precioHTML(ref.precio, ref.moneda)}` : '<span class="linea">Sin precio de referencia</span>'}</span>
      </button>`;
  }).join("");
}

function filasOfertas(lista, ed) {
  return lista.map((o) => `
    <tr class="${o.disponible ? "" : "agotada"}">
      <td>${esc(o.tienda_nombre)}<span class="pais">${esc(BANDERA[o.pais] || o.pais)}</span></td>
      <td class="num">${esc(formatear(o.precio, o.moneda))}</td>
      <td class="num"><strong>${esc(formatear(convertir(o.precio, o.moneda, estado.moneda), estado.moneda))}</strong></td>
      <td class="num">${costoPuestoHTML(o)}</td>
      <td class="num">${diferenciaHTML(o.precio, o.moneda, referenciaPara(ed, o.acabado))}</td>
      <td title="${esc(o.condicion_original || "")}">${esc(o.condicion || "No indicada")}</td>
      <td>${esc(o.idioma ? NOMBRE_IDIOMA[o.idioma] || o.idioma : "No indicado")}</td>
      <td>${esc(NOMBRE_ACABADO[o.acabado] || o.acabado)}</td>
      <td class="num">${!o.disponible ? "Agotado" : o.stock_conocido === false ? "Sin dato" : o.stock != null ? esc(o.stock) : "Sí"}</td>
      <td><a href="${esc(o.url)}" target="_blank" rel="noopener" title="${esc(o.titulo)}">Ver ↗</a></td>
    </tr>`).join("");
}

function encabezadoOfertas() {
  const flecha = (campo) => estado.orden.campo === campo ? (estado.orden.dir === 1 ? " ▲" : " ▼") : "";
  return `<thead><tr>
    <th>Tienda</th><th class="num">Precio original</th>
    <th class="num"><button type="button" class="boton-orden" data-orden="precio">Precio (${esc(estado.moneda)})${flecha("precio")}</button></th>
    <th class="num"><button type="button" class="boton-orden" data-orden="final" title="Estimación: precio + envío + arancel + IVA, comprando solo esta carta">Puesto en Chile (est.)${flecha("final")}</button></th>
    <th class="num">Dif. vs Card Kingdom</th><th>Condición</th><th>Idioma</th><th>Acabado</th><th class="num">Stock</th><th>Enlace</th>
  </tr></thead>`;
}

function ordenarPorPrecio(lista) {
  const valor = estado.orden.campo === "precio" ? (o) => enCLP(o.precio, o.moneda) : costoFinal;
  return [...lista].sort((a, b) => estado.orden.dir * (valor(a) - valor(b)));
}

const AVISO_IMPORTACION = "«Puesto en Chile» es una estimación comprando solo esa carta: precio + envío de la tienda + arancel + IVA 19%, " +
  "según ajustes.toml. Pasa el mouse sobre el valor para ver el detalle. Las tiendas chilenas ya incluyen IVA (su envío nacional no está sumado).";

function pintarDetalle() {
  const ed = estado.ediciones.find((e) => e.id === estado.seleccion);
  if (!ed) { $("#detalle").innerHTML = ""; return; }

  // Precio de Card Kingdom por acabado, para calcular diferencias
  const ck = {};
  ed.referencias.filter((r) => r.fuente === "cardkingdom").forEach((r) => { ck[r.acabado] = r; });

  const filasRef = ed.referencias.map((r) => {
    const base = r.es_principal ? null : ed.referencia_principal[r.acabado];
    const etiqueta = r.es_principal
      ? (r.es_respaldo ? '<span class="etiqueta respaldo">referencia (respaldo)</span>' : '<span class="etiqueta ref">referencia</span>')
      : "";
    return `
      <tr class="${r.es_principal ? "principal" : ""}">
        <td>${esc(r.fuente_nombre)}${etiqueta}</td>
        <td>${esc(NOMBRE_ACABADO[r.acabado] || r.acabado)}</td>
        <td class="num">${precioHTML(r.precio, r.moneda)}</td>
        <td class="num">${diferenciaHTML(r.precio, r.moneda, base)}</td>
        <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Ver ↗</a>` : "—"}</td>
      </tr>`;
  }).join("");

  const ofertas = ordenarPorPrecio(ofertasVisibles().filter((o) => o.edicion_id === ed.id));
  const posibles = ofertasVisibles().filter((o) => !o.edicion_id && o.candidatos.includes(ed.id));
  const cargando = !estado.tiendasCompletas;

  const sinCK = ed.acabados.filter((a) => !ck[a]);
  const avisos = [];
  if (sinCK.length && ed.referencias.length) {
    avisos.push(`Card Kingdom no tiene precio para: ${sinCK.map((a) => NOMBRE_ACABADO[a] || a).join(", ")}. En esos casos se compara con TCGplayer o Cardmarket (marcado con *).`);
  }

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

      <div class="ofertas-titulo"><h4>Ofertas en tiendas</h4>${cargando ? '<span class="nota">⏳ consultando tiendas…</span>' : ""}</div>
      ${ofertas.length ? `<div class="tabla-marco"><table>${encabezadoOfertas()}<tbody>${filasOfertas(ofertas, ed)}</tbody></table></div>`
        : `<p class="vacio">${cargando ? "Buscando en las tiendas…" : "Ninguna tienda tiene esta edición con los filtros actuales."}</p>`}
      ${ofertas.some((o) => o.pais !== "CL") ? `<p class="aviso">ℹ ${esc(AVISO_IMPORTACION)}</p>` : ""}
      ${posibles.length ? `<p class="aviso">⚠ ${posibles.length} ${posibles.length === 1 ? "oferta podría" : "ofertas podrían"} ser de esta edición, pero no hay certeza. Míralas en «Posibles coincidencias», más abajo.</p>` : ""}

      <h4 style="margin-top:18px">Precios de referencia mundial</h4>
      ${ed.referencias.length ? `
        <div class="tabla-marco"><table>
          <thead><tr><th>Fuente</th><th>Acabado</th><th class="num">Precio (${esc(estado.moneda)})</th><th class="num">Dif. vs referencia</th><th>Enlace</th></tr></thead>
          <tbody>${filasRef}</tbody>
        </table></div>` : '<p class="nota">No hay precios de referencia para esta edición.</p>'}
      ${avisos.map((a) => `<p class="aviso">ℹ ${esc(a)}</p>`).join("")}
      <p class="nota">Card Kingdom no informa su stock en la lista de precios. <a href="${esc(ed.enlaces.scryfall)}" target="_blank" rel="noopener">Ver en Scryfall ↗</a></p>
    </div>`;
}

function pintarTodas(resumen) {
  const filas = estado.ediciones
    .filter((e) => resumen[e.id])
    .sort((a, b) => costoFinal(resumen[a.id].mejor) - costoFinal(resumen[b.id].mejor))
    .map((ed) => {
      const { mejor: o, cantidad } = resumen[ed.id];
      return `
        <tr class="clicable" data-id="${ed.id}">
          <td><img class="mini" src="${esc(ed.imagen)}" alt="" loading="lazy">${esc(ed.set_nombre)} <span class="pais">${esc(ed.set)} #${esc(ed.numero)}</span>
            ${ed.variantes.length ? `<span class="original">${ed.variantes.map(esc).join(", ")}</span>` : ""}</td>
          <td>${esc(o.tienda_nombre)}<span class="pais">${esc(BANDERA[o.pais] || o.pais)}</span></td>
          <td class="num">${esc(formatear(o.precio, o.moneda))}</td>
          <td class="num"><strong>${esc(formatear(convertir(o.precio, o.moneda, estado.moneda), estado.moneda))}</strong></td>
          <td class="num">${costoPuestoHTML(o)}</td>
          <td class="num">${diferenciaHTML(o.precio, o.moneda, referenciaPara(ed, o.acabado))}</td>
          <td>${esc(o.condicion || "—")} · ${esc(o.idioma || "—")} · ${esc(NOMBRE_ACABADO[o.acabado])}</td>
          <td class="num">${cantidad}</td>
          <td><a href="${esc(o.url)}" target="_blank" rel="noopener">Ver ↗</a></td>
        </tr>`;
    }).join("");
  $("#vista-todas").innerHTML = `
    <h3>La oferta más barata de cada edición</h3>
    <p class="nota">Solo ediciones con stock según los filtros. En las internacionales se compara el costo estimado puesto en Chile.
      Card Kingdom no aparece aquí porque no informa stock. Toca una fila para ver todas sus ofertas.</p>
    ${filas ? `<div class="tabla-marco"><table>
      <thead><tr><th>Edición</th><th>Tienda</th><th class="num">Precio original</th><th class="num">Precio (${esc(estado.moneda)})</th>
      <th class="num">Puesto en Chile (est.)</th>
      <th class="num">Dif. vs Card Kingdom</th><th>Cond. · Idioma · Acabado</th><th class="num">Ofertas</th><th>Enlace</th></tr></thead>
      <tbody>${filas}</tbody></table></div>`
      : `<p class="vacio">${estado.tiendasCompletas ? "Ninguna tienda tiene esta carta con los filtros actuales." : "Buscando en las tiendas…"}</p>`}`;
}

function pintarPosibles() {
  const posibles = ordenarPorPrecio(ofertasVisibles().filter((o) => !o.edicion_id));
  const seccion = $("#posibles");
  seccion.hidden = !posibles.length;
  if (!posibles.length) return;
  const porId = Object.fromEntries(estado.ediciones.map((e) => [e.id, e]));
  seccion.innerHTML = `
    <h3>Posibles coincidencias (${posibles.length})</h3>
    <p class="nota">Ofertas que no se pudieron asignar con seguridad a una edición. Revisa el enlace antes de comprar.</p>
    <div class="tabla-marco"><table>
      <thead><tr><th>Tienda</th><th>Producto</th><th class="num">Precio (${esc(estado.moneda)})</th><th>Cond. · Idioma · Acabado</th><th>Motivo</th><th>Podría ser</th><th>Enlace</th></tr></thead>
      <tbody>${posibles.map((o) => `
        <tr class="${o.disponible ? "" : "agotada"}">
          <td>${esc(o.tienda_nombre)}</td>
          <td>${esc(o.titulo)}</td>
          <td class="num">${precioHTML(o.precio, o.moneda)}</td>
          <td>${esc(o.condicion || "—")} · ${esc(o.idioma || "—")} · ${esc(NOMBRE_ACABADO[o.acabado])}</td>
          <td>${esc(o.emparejado_por)}</td>
          <td>${o.candidatos.filter((id) => porId[id]).map((id) =>
            `<button type="button" class="candidato" data-id="${id}">${esc(porId[id].set)} #${esc(porId[id].numero)}</button>`).join("") || "—"}</td>
          <td><a href="${esc(o.url)}" target="_blank" rel="noopener">Ver ↗</a></td>
        </tr>`).join("")}
      </tbody></table></div>`;
}

function pintarNoIncluidas() {
  const lista = estado.noIncluidas;
  const el = $("#no-incluidas");
  el.hidden = !lista.length;
  const abierto = el.open;
  el.innerHTML = `<summary>Tiendas revisadas que no se consultan (${lista.length})</summary>
    <ul>${lista.map((t) => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.nombre)}</a>: ${esc(t.motivo)}</li>`).join("")}</ul>`;
  el.open = abierto;
}

function seleccionarEdicion(id, desplazar = true) {
  estado.seleccion = id;
  cambiarVista("edicion");
  pintarCarrusel(resumenPorEdicion());
  pintarDetalle();
  const tarjeta = document.querySelector(`.edicion[data-id="${id}"]`);
  tarjeta?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  if (desplazar && window.innerWidth < 900) $("#detalle").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cambiarVista(vista) {
  estado.vista = vista;
  document.querySelectorAll(".pestanas button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.vista === vista)));
  $("#vista-edicion").hidden = vista !== "edicion";
  $("#vista-todas").hidden = vista !== "todas";
}

// ---------- Eventos ----------

$("#carrusel").addEventListener("click", (ev) => {
  const tarjeta = ev.target.closest(".edicion");
  if (tarjeta) seleccionarEdicion(tarjeta.dataset.id);
});

$("#vista-todas").addEventListener("click", (ev) => {
  if (ev.target.closest("a")) return;
  const fila = ev.target.closest("tr[data-id]");
  if (fila) seleccionarEdicion(fila.dataset.id);
});

$("#posibles").addEventListener("click", (ev) => {
  const boton = ev.target.closest(".candidato");
  if (boton) seleccionarEdicion(boton.dataset.id);
});

$("#detalle").addEventListener("click", (ev) => {
  const boton = ev.target.closest("[data-orden]");
  if (boton) {
    const campo = boton.dataset.orden;
    estado.orden = { campo, dir: estado.orden.campo === campo ? -estado.orden.dir : 1 };
    pintarDetalle();
  }
});

document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => cambiarVista(b.dataset.vista)));

document.querySelectorAll(".flecha").forEach((boton) => {
  boton.addEventListener("click", () => {
    const carrusel = $("#carrusel");
    const paso = carrusel.clientWidth * 0.8;
    carrusel.scrollBy({ left: boton.classList.contains("izquierda") ? -paso : paso, behavior: "smooth" });
  });
});

$("#orden").addEventListener("change", () => pintarCarrusel(resumenPorEdicion()));

$("#actualizar").addEventListener("click", () => {
  if (estado.carta) buscar(estado.carta.nombre, { forzar: true, mantenerSeleccion: true });
});

$("#moneda").addEventListener("change", (ev) => {
  estado.moneda = ev.target.value;
  guardarPreferencia("moneda", estado.moneda);
  pintarTodo();
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
  cargarFiltros();
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
