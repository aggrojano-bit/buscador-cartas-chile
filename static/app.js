// =============================================================
//  Buscador de Cartas Chile: lógica de la página
// =============================================================

const estado = {
  moneda: "CLP",
  tasas: null,          // cuántos CLP vale 1 unidad de cada moneda
  config: null,         // impuestos y envíos de ajustes.toml
  carta: null,          // datos de la carta buscada
  ediciones: [],
  seleccion: null,      // id de la edición elegida
  tiendas: [],          // estado de cada tienda
  ofertas: [],          // todas las ofertas encontradas
  noIncluidas: [],
  tiendasCompletas: false,
  cargandoEdiciones: false,
  vista: "edicion",
  orden: { campo: "final", dir: 1 },   // tabla de ofertas: "final" (puesto en Chile) o "precio"
  consulta: 0,          // número de búsqueda, para ignorar respuestas viejas
};

const FILTROS_VACIOS = { origen: "", acabado: "", condicion: "", idioma: "", agotados: false };
const filtros = { ...FILTROS_VACIOS };

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

// Monto en la moneda elegida (si no hay tipo de cambio, en su moneda original)
function enElegida(monto, moneda) {
  const c = convertir(monto, moneda, estado.moneda);
  return c == null ? formatear(monto, moneda) : formatear(c, estado.moneda);
}

// Precio en la moneda elegida, y debajo el original si es distinta
function precioHTML(monto, monedaOriginal) {
  if (monto == null) return "—";
  if (monedaOriginal === estado.moneda || !estado.tasas) return esc(formatear(monto, monedaOriginal));
  return `${esc(enElegida(monto, monedaOriginal))}<span class="original">${esc(formatear(monto, monedaOriginal))}</span>`;
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

function costoFinalTexto(o) {
  const valor = estado.tasas ? formatear(convertir(costoFinal(o), "CLP", estado.moneda), estado.moneda) : formatear(o.precio, o.moneda);
  return (o.pais === "CL" ? "" : "≈ ") + valor;
}

function costoPuestoHTML(o) {
  const c = costoPuesto(o);
  if (!c) return o.pais === "CL" ? '<span class="original">igual al precio</span>' : "—";
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

function toast(texto, tipo = "") {
  const el = document.createElement("div");
  el.className = `toast ${tipo}`;
  el.textContent = texto;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("saliendo"); setTimeout(() => el.remove(), 350); }, 3200);
}

// Color estable por tienda, para su avatar
function tono(texto) {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function avatarTienda(o) {
  const iniciales = o.tienda_nombre.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return `<span class="tienda-celda"><span class="avatar" style="--tono:${tono(o.tienda)}">${esc(iniciales)}</span>
    <span>${esc(o.tienda_nombre)}<span class="pais">${esc(BANDERA[o.pais] || o.pais)}</span></span></span>`;
}

const NOMBRE_ACABADO = { normal: "Normal", foil: "Foil", etched: "Etched foil" };
const NOMBRE_IDIOMA = { EN: "Inglés", ES: "Español", JA: "Japonés", PT: "Portugués", FR: "Francés", DE: "Alemán",
  IT: "Italiano", ZH: "Chino", KO: "Coreano", RU: "Ruso" };
const RANGO_CONDICION = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };
// (Windows no muestra emojis de banderas, por eso va solo el nombre)
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

// ---------- Inicio, búsquedas recientes y ubicación del buscador ----------

function leerRecientes() {
  try { return JSON.parse(leerPreferencia("recientes") || "[]"); } catch (e) { return []; }
}

function agregarReciente(nombre) {
  const lista = [nombre, ...leerRecientes().filter((n) => n !== nombre)].slice(0, 8);
  guardarPreferencia("recientes", JSON.stringify(lista));
  pintarRecientes();
}

function pintarRecientes() {
  const lista = leerRecientes();
  const el = $("#recientes");
  el.hidden = !lista.length;
  el.innerHTML = '<span class="nota">Recientes:</span>' +
    lista.map((n) => `<button type="button" class="chip-boton" data-carta="${esc(n)}">${esc(n)}</button>`).join("");
}

function mostrarInicio() {
  estado.consulta++;
  estado.carta = null;
  $("#inicio").hidden = false;
  $("#resultado").hidden = true;
  mostrarMensaje("");
  $("#ranura-inicio").appendChild($("#buscador"));
  $("#busqueda").value = "";
  try { history.replaceState(null, "", "/"); } catch (e) {}
  document.title = "Buscador de Cartas Chile";
  $("#busqueda").focus();
}

function mostrarResultado() {
  $("#inicio").hidden = true;
  $("#resultado").hidden = false;
  $("#ranura-barra").appendChild($("#buscador"));
}

// ---------- Autocompletado ----------

let temporizador = null;
let controlador = null;
let sugerencias = [];
let indiceActivo = -1;
let tituloSugerencias = "";

function pintarSugerencias() {
  const lista = $("#sugerencias");
  const input = $("#busqueda");
  if (!sugerencias.length) {
    lista.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  lista.innerHTML = (tituloSugerencias ? `<li class="titulo-sug" aria-hidden="true">${esc(tituloSugerencias)}</li>` : "") +
    sugerencias.map((s, i) => `
    <li role="option" id="sug-${i}" data-i="${i}" aria-selected="${i === indiceActivo}">
      <span>${esc(s.mostrar)}</span>${s.etiqueta ? `<span class="etiqueta-sug">${esc(s.etiqueta)}</span>` : ""}
    </li>`).join("");
  lista.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", indiceActivo >= 0 ? `sug-${indiceActivo}` : "");
  lista.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function cerrarSugerencias() {
  sugerencias = [];
  indiceActivo = -1;
  pintarSugerencias();
}

function mostrarRecientesEnSugerencias() {
  const recientes = leerRecientes();
  if (!recientes.length) return;
  tituloSugerencias = "Búsquedas recientes";
  sugerencias = recientes.map((n) => ({ nombre: n, mostrar: n, etiqueta: "reciente" }));
  indiceActivo = -1;
  pintarSugerencias();
}

$("#busqueda").addEventListener("focus", (ev) => {
  if (!ev.target.value.trim()) mostrarRecientesEnSugerencias();
});

$("#busqueda").addEventListener("input", (ev) => {
  const texto = ev.target.value.trim();
  clearTimeout(temporizador);
  if (!texto) return mostrarRecientesEnSugerencias();
  if (texto.length < 2) return cerrarSugerencias();
  // Espera a que dejes de escribir 250 ms antes de preguntar (no saturar Scryfall)
  temporizador = setTimeout(async () => {
    controlador?.abort();
    controlador = new AbortController();
    try {
      const datos = await api(`/api/autocompletar?q=${encodeURIComponent(texto)}`, { signal: controlador.signal });
      sugerencias = datos.map((s) => ({ ...s, etiqueta: s.idioma === "es" ? "español" : "" }));
      tituloSugerencias = sugerencias.length ? "" : "Sin sugerencias: presiona Enter para buscar igual";
      indiceActivo = sugerencias.length ? 0 : -1;
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
    const elegida = sugerencias[indiceActivo];
    const nombre = elegida ? elegida.nombre : ev.target.value.trim();
    if (nombre) elegirSugerencia(nombre);
  } else if (ev.key === "Escape") {
    cerrarSugerencias();
    ev.target.blur();
  }
});

$("#sugerencias").addEventListener("mousedown", (ev) => {
  const li = ev.target.closest("li[data-i]");
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
  const mismaCarta = estado.carta && estado.carta.nombre.toLowerCase() === nombre.toLowerCase();
  mostrarResultado();
  mostrarMensaje("");
  const boton = $("#actualizar");
  boton.disabled = true;
  boton.classList.add("cargando");
  if (!mismaCarta) {
    // Esqueletos mientras llegan los datos
    estado.cargandoEdiciones = true;
    estado.ofertas = [];
    estado.tiendas = [];
    estado.tiendasCompletas = false;
    $("#titulo-carta").textContent = nombre;
    $("#subtitulo-carta").textContent = "Buscando todas las ediciones…";
    $("#miniatura-carta").removeAttribute("src");
    pintarEsqueletos();
  }
  try {
    const ruta = `/api/${forzar ? "actualizar" : "ediciones"}?nombre=${encodeURIComponent(nombre)}`;
    const datos = await api(ruta, forzar ? { method: "POST" } : undefined);
    if (consulta !== estado.consulta) return;
    const anterior = estado.seleccion;
    estado.cargandoEdiciones = false;
    estado.carta = datos.carta;
    estado.ediciones = datos.ediciones;
    estado.seleccion = mantenerSeleccion && datos.ediciones.some((e) => e.id === anterior)
      ? anterior : (datos.ediciones.find((e) => e.referencias.length) || datos.ediciones[0])?.id;
    try { history.replaceState(null, "", `?carta=${encodeURIComponent(datos.carta.nombre)}`); } catch (e) {}
    document.title = `${datos.carta.nombre} · Buscador de Cartas Chile`;
    $("#busqueda").value = datos.carta.nombre;
    agregarReciente(datos.carta.nombre);
    pintarTodo(!mismaCarta);
    cargarOfertas(datos.carta.nombre, consulta, forzar);
  } catch (e) {
    if (consulta !== estado.consulta) return;
    estado.cargandoEdiciones = false;
    if (!mismaCarta) {
      $("#resultado").hidden = true;
      $("#inicio").hidden = false;
      $("#ranura-inicio").appendChild($("#buscador"));
    }
    mostrarMensaje(e.message, true);
    boton.disabled = false;
    boton.classList.remove("cargando");
  }
}

// Pide las ofertas y vuelve a preguntar cada 1,5 s hasta que todas las tiendas terminen.
// Las tiendas que siguen buscando ya entregan lo que llevan, así que la pantalla se va llenando.
async function cargarOfertas(nombre, consulta, forzar) {
  let primera = true;
  let firmaAnterior = "";
  while (consulta === estado.consulta) {
    try {
      const datos = await api(`/api/ofertas?nombre=${encodeURIComponent(nombre)}${primera && forzar ? "&forzar=true" : ""}`);
      if (consulta !== estado.consulta) return;
      primera = false;
      // Solo se vuelve a dibujar si algo cambió (evita parpadeos)
      const firma = datos.tiendas.map((t) => t.estado + t.cantidad).join() + "|" + datos.ofertas.length;
      estado.tiendas = datos.tiendas;
      estado.ofertas = datos.ofertas;
      estado.noIncluidas = datos.no_incluidas;
      estado.tiendasCompletas = datos.completo;
      if (firma !== firmaAnterior) pintarTodo();
      firmaAnterior = firma;
      if (datos.completo) {
        const conOfertas = datos.tiendas.filter((t) => t.cantidad).length;
        toast(forzar ? `Precios actualizados: ${datos.ofertas.length} ofertas en ${conOfertas} tiendas`
          : `Listo: ${datos.ofertas.length} ofertas en ${conOfertas} tiendas`);
        break;
      }
    } catch (e) {
      toast(`No se pudieron consultar las tiendas: ${e.message}`, "error");
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (consulta === estado.consulta) {
    $("#actualizar").disabled = false;
    $("#actualizar").classList.remove("cargando");
  }
}

// ---------- Filtros ----------

function pasaFiltros(o) {
  if (!filtros.agotados && !o.disponible) return false;
  if (filtros.origen === "CL" && o.pais !== "CL") return false;
  if (filtros.origen === "INT" && o.pais === "CL") return false;
  if (filtros.acabado && o.acabado !== filtros.acabado) return false;
  if (filtros.idioma && (o.idioma || "?") !== filtros.idioma) return false;
  // Condición: las ofertas sin condición indicada se muestran siempre
  if (filtros.condicion !== "" && o.condicion && RANGO_CONDICION[o.condicion] > Number(filtros.condicion)) return false;
  return true;
}

function ofertasVisibles() {
  return estado.ofertas.filter(pasaFiltros);
}

function hayFiltros() {
  return Object.keys(FILTROS_VACIOS).some((k) => filtros[k] !== FILTROS_VACIOS[k]);
}

function segmentado(clave, opciones) {
  return `<div class="segmentado">${opciones.map(([valor, texto]) =>
    `<button type="button" data-filtro="${clave}" data-valor="${esc(valor)}" aria-pressed="${filtros[clave] === valor}">${esc(texto)}</button>`).join("")}</div>`;
}

function pintarFiltros() {
  const idiomas = [...new Set(estado.ofertas.map((o) => o.idioma || "?"))].sort();
  if (filtros.idioma && !idiomas.includes(filtros.idioma)) filtros.idioma = "";
  $("#filtros").innerHTML = `
    <div class="grupo-filtro"><span class="rotulo">Origen</span>${segmentado("origen", [["", "Todas"], ["CL", "📍 Chile"], ["INT", "🌎 Internacional"]])}</div>
    <div class="grupo-filtro"><span class="rotulo">Acabado</span>${segmentado("acabado", [["", "Todos"], ["normal", "Normal"], ["foil", "Foil"], ["etched", "Etched"]])}</div>
    <div class="grupo-filtro"><span class="rotulo">Condición</span>${segmentado("condicion", [["", "Todas"], ["0", "NM"], ["1", "LP+"], ["2", "MP+"]])}</div>
    ${idiomas.length > 1 ? `<div class="grupo-filtro"><span class="rotulo">Idioma</span>${segmentado("idioma",
      [["", "Todos"], ...idiomas.map((c) => [c, c === "?" ? "¿?" : c])])}</div>` : ""}
    <label class="interruptor"><input type="checkbox" data-filtro="agotados" ${filtros.agotados ? "checked" : ""}><span></span>Agotados</label>
    <button type="button" class="limpiar" id="limpiar-filtros" ${hayFiltros() ? "" : "hidden"}>✕ Limpiar filtros</button>`;
}

function cambiarFiltro(clave, valor) {
  filtros[clave] = valor;
  guardarPreferencia("filtros", JSON.stringify(filtros));
  pintarTodo();
}

$("#filtros").addEventListener("click", (ev) => {
  const boton = ev.target.closest("button[data-filtro]");
  if (boton) return cambiarFiltro(boton.dataset.filtro, boton.dataset.valor);
  if (ev.target.closest("#limpiar-filtros")) {
    Object.assign(filtros, FILTROS_VACIOS);
    guardarPreferencia("filtros", JSON.stringify(filtros));
    pintarTodo();
    toast("Filtros limpiados");
  }
});
$("#filtros").addEventListener("change", (ev) => {
  if (ev.target.dataset.filtro === "agotados") cambiarFiltro("agotados", ev.target.checked);
});

function cargarFiltros() {
  try { Object.assign(filtros, JSON.parse(leerPreferencia("filtros") || "{}")); } catch (e) {}
  $("#solo-stock").checked = leerPreferencia("soloStock") === "1";
}

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
  let lista = [...estado.ediciones];
  if ($("#solo-stock").checked && Object.keys(resumen).length) lista = lista.filter((e) => resumen[e.id]);
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

function mejorDe(lista) {
  return lista.reduce((m, o) => (!m || costoFinal(o) < costoFinal(m) ? o : m), null);
}

// ---------- Dibujar ----------

function animar(selector) {
  const el = $(selector);
  el.classList.remove("animar");
  void el.offsetWidth;   // reinicia la animación
  el.classList.add("animar");
  setTimeout(() => el.classList.remove("animar"), 800);
}

function pintarEsqueletos() {
  const carta = `<div class="edicion esqueleto-carta"><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto" style="width:60%"></div></div>`;
  $("#carrusel").innerHTML = carta.repeat(8);
  $("#detalle").innerHTML = "";
  $("#resumen").innerHTML = ["Más barata en Chile", "Más barata internacional", "Card Kingdom (referencia)", "Ediciones con stock"]
    .map((r) => `<div class="tarjeta-resumen"><span class="rotulo">${r}</span><div class="esqueleto"></div></div>`).join("");
  $("#tiendas-estado").innerHTML = "";
  $("#progreso-texto").textContent = "Buscando ediciones…";
  $("#progreso-barra").style.width = "5%";
  $("#progreso").classList.remove("completo");
  $("#filtros").innerHTML = "";
  $("#cuenta-carrusel").textContent = "";
}

function pintarTodo(conAnimacion = false) {
  if (!estado.carta) return;
  const resumen = resumenPorEdicion();
  const c = estado.carta;
  $("#titulo-carta").textContent = c.nombre;
  const total = estado.ediciones.length;
  $("#subtitulo-carta").textContent = `${c.tipo || ""} · ${total} ${total === 1 ? "edición" : "ediciones"} en papel`;
  const primera = estado.ediciones.find((e) => e.imagen);
  if (primera && $("#miniatura-carta").getAttribute("src") !== primera.imagen) $("#miniatura-carta").src = primera.imagen;
  pintarProgreso();
  pintarResumen(resumen);
  pintarFiltros();
  pintarCarrusel(resumen);
  pintarDetalle();
  pintarTodas(resumen);
  pintarPosibles();
  pintarContadores(resumen);
  pintarNoIncluidas();
  if (conAnimacion) { animar("#resumen"); animar("#carrusel"); }
}

function pintarProgreso() {
  const total = estado.tiendas.length;
  const listas = estado.tiendas.filter((t) => t.estado !== "cargando").length;
  const progreso = $("#progreso");
  progreso.classList.toggle("completo", estado.tiendasCompletas);
  $("#progreso-barra").style.width = total ? `${Math.max(8, (listas / total) * 100)}%` : "8%";
  $("#progreso-texto").textContent = estado.tiendasCompletas
    ? `✓ ${total} tiendas consultadas · ${estado.ofertas.length} ofertas`
    : `Consultando tiendas… ${listas} de ${total || "?"} listas · ${estado.ofertas.length} ofertas hasta ahora`;
  $("#tiendas-estado").innerHTML = estado.tiendas.map((t) => {
    let texto = esc(t.nombre);
    let titulo = "";
    if (t.estado === "ok") texto += ` · ${t.cantidad}`;
    if (t.estado === "cargando" && t.cantidad) texto += ` · ${t.cantidad}…`;
    if (t.estado === "error") {
      texto += (t.error || "").includes("token") ? " · falta token" : " · no disponible";
      titulo = t.error;
    }
    if (t.estado === "antiguo") { texto += " · datos antiguos"; titulo = `No respondió (${t.error}); se muestran datos guardados.`; }
    return `<a class="estado-tienda ${esc(t.estado)}" href="${esc(t.url)}" target="_blank" rel="noopener" title="${esc(titulo || "Abrir la tienda")}">${texto}</a>`;
  }).join("");
}

function pintarResumen(resumen) {
  const visibles = ofertasVisibles().filter((o) => o.edicion_id && tieneStock(o));
  const porId = Object.fromEntries(estado.ediciones.map((e) => [e.id, e]));
  const cargando = !estado.tiendasCompletas;
  const tarjeta = (rotulo, oferta, vacio, destacada = false) => {
    if (!oferta) {
      return `<button type="button" class="tarjeta-resumen" disabled><span class="rotulo">${rotulo}</span>
        ${cargando ? '<div class="esqueleto"></div>' : `<span class="valor">—</span><span class="detalle-resumen">${vacio}</span>`}</button>`;
    }
    const ed = porId[oferta.edicion_id];
    return `<button type="button" class="tarjeta-resumen ${destacada ? "destacada" : ""}" data-id="${oferta.edicion_id}" title="Ver esta edición">
      <span class="rotulo">${rotulo}</span>
      <span class="valor">${esc(costoFinalTexto(oferta))}</span>
      <span class="detalle-resumen">${esc(oferta.tienda_nombre)} · ${esc(ed.set)} #${esc(ed.numero)} · ${esc(oferta.condicion || "—")} ${esc(NOMBRE_ACABADO[oferta.acabado])}</span>
    </button>`;
  };
  // Card Kingdom: la edición más barata según su lista de precios
  let ck = null;
  for (const e of estado.ediciones) {
    for (const r of e.referencias) {
      if (r.fuente === "cardkingdom" && (!ck || enCLP(r.precio, r.moneda) < enCLP(ck.r.precio, ck.r.moneda))) ck = { r, e };
    }
  }
  const conStock = Object.keys(resumen).length;
  const tiendasConStock = new Set(visibles.map((o) => o.tienda)).size;
  $("#resumen").innerHTML =
    tarjeta("📍 Más barata en Chile", mejorDe(visibles.filter((o) => o.pais === "CL")), "Ninguna tienda chilena la tiene", true) +
    tarjeta("🌎 Más barata internacional", mejorDe(visibles.filter((o) => o.pais !== "CL")), "Sin ofertas internacionales") +
    (ck ? `<button type="button" class="tarjeta-resumen" data-id="${ck.e.id}" title="Ver esta edición">
        <span class="rotulo">⭐ Card Kingdom (referencia)</span>
        <span class="valor">${esc(enElegida(ck.r.precio, ck.r.moneda))}</span>
        <span class="detalle-resumen">Edición más barata: ${esc(ck.e.set)} #${esc(ck.e.numero)} · ${esc(NOMBRE_ACABADO[ck.r.acabado])}</span></button>`
      : `<button type="button" class="tarjeta-resumen" disabled><span class="rotulo">⭐ Card Kingdom (referencia)</span><span class="valor">—</span><span class="detalle-resumen">Sin precio</span></button>`) +
    `<button type="button" class="tarjeta-resumen" ${conStock ? "" : "disabled"} data-accion="solo-stock" title="Mostrar solo las ediciones con stock">
      <span class="rotulo">📦 Ediciones con stock</span>
      ${cargando && !conStock ? '<div class="esqueleto"></div>' : `<span class="valor">${conStock} <small class="nota">de ${estado.ediciones.length}</small></span>
      <span class="detalle-resumen">en ${tiendasConStock} ${tiendasConStock === 1 ? "tienda" : "tiendas"}</span>`}
    </button>`;
}

function pintarContadores(resumen) {
  $("#cuenta-edicion").textContent = estado.ediciones.length;
  $("#cuenta-todas").textContent = Object.keys(resumen).length;
  const posibles = ofertasVisibles().filter((o) => !o.edicion_id).length;
  $("#cuenta-posibles").textContent = posibles;
}

function pintarCarrusel(resumen) {
  const lista = edicionesOrdenadas(resumen);
  const conStock = Object.keys(resumen).length;
  $("#cuenta-carrusel").textContent = `${lista.length} ${lista.length === 1 ? "edición" : "ediciones"}` +
    (conStock ? ` · ${conStock} con stock` : estado.tiendasCompletas ? " · ninguna con stock" : "");
  // La edición más barata de todas (para la cinta "Más barata")
  const mejores = Object.entries(resumen);
  const masBarata = mejores.length ? mejores.reduce((m, x) => (costoFinal(x[1].mejor) < costoFinal(m[1].mejor) ? x : m))[0] : null;
  $("#carrusel").innerHTML = lista.map((ed) => {
    const ref = referenciaCarrusel(ed);
    const r = resumen[ed.id];
    const atenuada = estado.tiendasCompletas && !r;
    const chips = [...ed.acabados.filter((a) => a !== "normal").map((a) => NOMBRE_ACABADO[a]), ...ed.variantes];
    const clases = ["edicion", ed.id === estado.seleccion && "seleccionada", r && "con-stock", atenuada && "sin-stock"].filter(Boolean).join(" ");
    return `
      <button type="button" role="option" aria-selected="${ed.id === estado.seleccion}" class="${clases}" data-id="${ed.id}" title="${esc(ed.set_nombre)} #${esc(ed.numero)}">
        ${ed.id === masBarata ? '<span class="cinta">★ Más barata</span>' : ""}
        <div class="marco-img"><img src="${esc(ed.imagen)}" alt="${esc(ed.nombre)} de ${esc(ed.set_nombre)}" loading="lazy"></div>
        <span class="set">${esc(ed.set_nombre)}</span>
        <span class="linea">${esc(ed.set)} · #${esc(ed.numero)} · <span class="rareza-${esc(ed.rareza_clave)}">${esc(ed.rareza)}</span></span>
        ${chips.length ? `<span class="chips">${chips.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</span>` : ""}
        ${r ? `<span class="badge-stock">🛒 ${r.cantidad} · desde ${esc(costoFinalTexto(r.mejor))}</span>` : ""}
        <span class="precio-ref">${ref ? `<span class="linea">Ref. ${esc(ref.fuente_nombre)}</span> <strong>${esc(enElegida(ref.precio, ref.moneda))}</strong>` : '<span class="linea">Sin precio de referencia</span>'}</span>
      </button>`;
  }).join("") || `<p class="vacio">No hay ediciones con stock con estos filtros. Desactiva «Solo con stock» para verlas todas.</p>`;
}

function filasOfertas(lista, ed, mejor) {
  return lista.map((o) => `
    <tr class="${o.disponible ? "" : "agotada"} ${o === mejor ? "mejor" : ""}">
      <td>${avatarTienda(o)}${o === mejor ? '<span class="pildora">Mejor</span>' : ""}</td>
      <td class="num">${esc(formatear(o.precio, o.moneda))}</td>
      <td class="num"><strong>${esc(enElegida(o.precio, o.moneda))}</strong></td>
      <td class="num">${costoPuestoHTML(o)}</td>
      <td class="num">${diferenciaHTML(o.precio, o.moneda, referenciaPara(ed, o.acabado))}</td>
      <td title="${esc(o.condicion_original || "")}">${esc(o.condicion || "No indicada")}</td>
      <td>${esc(o.idioma ? NOMBRE_IDIOMA[o.idioma] || o.idioma : "No indicado")}</td>
      <td>${esc(NOMBRE_ACABADO[o.acabado] || o.acabado)}</td>
      <td class="num">${!o.disponible ? "Agotado" : o.stock_conocido === false ? "Sin dato" : o.stock != null ? esc(o.stock) : "Sí"}</td>
      <td><a class="ir" href="${esc(o.url)}" target="_blank" rel="noopener" title="${esc(o.titulo)}">Ir ↗</a></td>
    </tr>`).join("");
}

function encabezadoOfertas() {
  const flecha = (campo) => estado.orden.campo === campo ? (estado.orden.dir === 1 ? " ▲" : " ▼") : "";
  return `<thead><tr>
    <th>Tienda</th><th class="num">Precio original</th>
    <th class="num"><button type="button" class="boton-orden" data-orden="precio">Precio (${esc(estado.moneda)})${flecha("precio")}</button></th>
    <th class="num"><button type="button" class="boton-orden" data-orden="final" title="Estimación: precio + envío + arancel + IVA, comprando solo esta carta">Puesto en Chile${flecha("final")}</button></th>
    <th class="num">Dif. vs Card Kingdom</th><th>Condición</th><th>Idioma</th><th>Acabado</th><th class="num">Stock</th><th></th>
  </tr></thead>`;
}

function ordenarOfertas(lista) {
  const valor = estado.orden.campo === "precio" ? (o) => enCLP(o.precio, o.moneda) : costoFinal;
  return [...lista].sort((a, b) => estado.orden.dir * (valor(a) - valor(b)));
}

const AVISO_IMPORTACION = "«Puesto en Chile» es una estimación comprando solo esa carta: precio + envío de la tienda + arancel + IVA 19%, " +
  "según ajustes.toml. Pasa el mouse sobre el valor para ver el detalle. Las tiendas chilenas ya incluyen IVA (su envío nacional no está sumado).";

function filasEsqueleto(n) {
  return Array.from({ length: n }, () => `<tr class="fila-esqueleto">${'<td><div class="esqueleto"></div></td>'.repeat(10)}</tr>`).join("");
}

function pintarDetalle() {
  const ed = estado.ediciones.find((e) => e.id === estado.seleccion);
  if (!ed) { $("#detalle").innerHTML = ""; return; }

  const ck = {};
  ed.referencias.filter((r) => r.fuente === "cardkingdom").forEach((r) => { ck[r.acabado] = r; });

  const ofertas = ordenarOfertas(ofertasVisibles().filter((o) => o.edicion_id === ed.id));
  const mejor = mejorDe(ofertas.filter(tieneStock));
  const posibles = ofertasVisibles().filter((o) => !o.edicion_id && o.candidatos.includes(ed.id));
  const cargando = !estado.tiendasCompletas;

  // Caja "Mejor oferta"
  let cajaMejor;
  if (mejor) {
    const ref = referenciaPara(ed, mejor.acabado);
    cajaMejor = `<div class="mejor-oferta">
      <div class="info">
        <div class="rotulo">Mejor oferta para esta edición</div>
        <div class="grande">${esc(costoFinalTexto(mejor))}</div>
        <p class="nota">${esc(mejor.tienda_nombre)} (${esc(BANDERA[mejor.pais] || mejor.pais)}) · ${esc(mejor.condicion || "condición no indicada")} ·
          ${esc(mejor.idioma ? NOMBRE_IDIOMA[mejor.idioma] || mejor.idioma : "idioma no indicado")} · ${esc(NOMBRE_ACABADO[mejor.acabado])}
          ${ref ? ` · vs Card Kingdom: ${diferenciaHTML(mejor.precio, mejor.moneda, ref).replace(/<span class="original">.*<\/span>/, "")}` : ""}</p>
      </div>
      <a class="boton primario" href="${esc(mejor.url)}" target="_blank" rel="noopener">Ir a la tienda ↗</a>
    </div>`;
  } else {
    cajaMejor = `<div class="mejor-oferta vacia"><div class="info">
      <div class="rotulo" style="color:var(--texto-suave)">${cargando ? "Buscando ofertas…" : "Sin stock con los filtros actuales"}</div>
      <p class="nota">${cargando ? "Las tiendas van apareciendo a medida que responden." : "Prueba otra edición o cambia los filtros."}</p></div></div>`;
  }

  const sinCK = ed.acabados.filter((a) => !ck[a]);
  const avisos = [];
  if (ofertas.some((o) => o.pais !== "CL")) avisos.push(AVISO_IMPORTACION);
  if (sinCK.length && ed.referencias.length) {
    avisos.push(`Card Kingdom no tiene precio para: ${sinCK.map((a) => NOMBRE_ACABADO[a] || a).join(", ")}. En esos casos se compara con TCGplayer o Cardmarket (marcado con *).`);
  }

  const filasRef = ed.referencias.map((r) => {
    const base = r.es_principal ? null : ed.referencia_principal[r.acabado];
    const etiqueta = r.es_principal
      ? (r.es_respaldo ? '<span class="etiqueta respaldo">referencia (respaldo)</span>' : '<span class="etiqueta ref">referencia</span>')
      : "";
    return `
      <tr>
        <td>${esc(r.fuente_nombre)}${etiqueta}</td>
        <td>${esc(NOMBRE_ACABADO[r.acabado] || r.acabado)}</td>
        <td class="num">${precioHTML(r.precio, r.moneda)}</td>
        <td class="num">${diferenciaHTML(r.precio, r.moneda, base)}</td>
        <td>${r.url ? `<a class="ir" href="${esc(r.url)}" target="_blank" rel="noopener">Ver ↗</a>` : "—"}</td>
      </tr>`;
  }).join("");
  const refPrincipal = referenciaCarrusel(ed);

  $("#detalle").innerHTML = `
    <div class="imagen-detalle">
      <img src="${esc(ed.imagen_grande)}" alt="${esc(ed.nombre)} de ${esc(ed.set_nombre)}" data-accion="ampliar">
      <p class="nota">Toca la imagen para ampliarla</p>
    </div>
    <div>
      <h3>${esc(ed.nombre_impreso || ed.nombre)}</h3>
      <div class="datos-edicion">
        <span class="dato"><b>${esc(ed.set_nombre)}</b> (${esc(ed.set)})</span>
        <span class="dato">#${esc(ed.numero)}</span>
        <span class="dato rareza-${esc(ed.rareza_clave)}">${esc(ed.rareza)}</span>
        <span class="dato">${ed.acabados.map((a) => esc(NOMBRE_ACABADO[a] || a)).join(" · ")}</span>
        ${ed.variantes.map((v) => `<span class="dato">${esc(v)}</span>`).join("")}
        <span class="dato">📅 ${esc(ed.fecha || "—")}</span>
      </div>

      ${cajaMejor}

      <div class="seccion-titulo"><h4>Ofertas en tiendas (${ofertas.length})</h4>
        ${cargando ? '<span class="nota">⏳ consultando tiendas…</span>' : '<span class="nota">Toca los encabezados para ordenar</span>'}</div>
      ${ofertas.length
        ? `<div class="tabla-marco"><table>${encabezadoOfertas()}<tbody>${filasOfertas(ofertas, ed, mejor)}</tbody></table></div>`
        : cargando ? `<div class="tabla-marco"><table>${encabezadoOfertas()}<tbody>${filasEsqueleto(3)}</tbody></table></div>`
        : `<p class="vacio">Ninguna tienda tiene esta edición con los filtros actuales.</p>`}
      ${posibles.length ? `<p class="aviso">⚠ ${posibles.length} ${posibles.length === 1 ? "oferta podría" : "ofertas podrían"} ser de esta edición, pero no hay certeza.
        <a href="#" data-accion="ver-posibles">Ver posibles coincidencias</a>.</p>` : ""}
      ${avisos.map((a) => `<p class="aviso">ℹ ${esc(a)}</p>`).join("")}

      <details class="referencias">
        <summary>Precios de referencia mundial ${refPrincipal ? `· ${esc(refPrincipal.fuente_nombre)} ${esc(enElegida(refPrincipal.precio, refPrincipal.moneda))}` : ""}</summary>
        ${ed.referencias.length ? `
          <div class="tabla-marco"><table>
            <thead><tr><th>Fuente</th><th>Acabado</th><th class="num">Precio (${esc(estado.moneda)})</th><th class="num">Dif. vs referencia</th><th></th></tr></thead>
            <tbody>${filasRef}</tbody>
          </table></div>` : '<p class="nota">No hay precios de referencia para esta edición.</p>'}
        <p class="nota">Card Kingdom no informa su stock en la lista de precios. <a href="${esc(ed.enlaces.scryfall)}" target="_blank" rel="noopener">Ver en Scryfall ↗</a></p>
      </details>
    </div>`;
}

function pintarTodas(resumen) {
  const filas = estado.ediciones
    .filter((e) => resumen[e.id])
    .sort((a, b) => costoFinal(resumen[a.id].mejor) - costoFinal(resumen[b.id].mejor))
    .map((ed, i) => {
      const { mejor: o, cantidad } = resumen[ed.id];
      return `
        <tr class="clicable ${i === 0 ? "mejor" : ""}" data-id="${ed.id}" title="Ver todas las ofertas de esta edición">
          <td><img class="mini" src="${esc(ed.imagen)}" alt="" loading="lazy">${esc(ed.set_nombre)} ${i === 0 ? '<span class="pildora">Más barata</span>' : ""}
            <span class="pais">${esc(ed.set)} #${esc(ed.numero)}${ed.variantes.length ? " · " + ed.variantes.map(esc).join(", ") : ""}</span></td>
          <td>${avatarTienda(o)}</td>
          <td class="num"><strong>${esc(enElegida(o.precio, o.moneda))}</strong><span class="original">${esc(formatear(o.precio, o.moneda))}</span></td>
          <td class="num">${costoPuestoHTML(o)}</td>
          <td class="num">${diferenciaHTML(o.precio, o.moneda, referenciaPara(ed, o.acabado))}</td>
          <td>${esc(o.condicion || "—")} · ${esc(o.idioma || "—")} · ${esc(NOMBRE_ACABADO[o.acabado])}</td>
          <td class="num">${cantidad}</td>
          <td><a class="ir" href="${esc(o.url)}" target="_blank" rel="noopener">Ir ↗</a></td>
        </tr>`;
    }).join("");
  $("#vista-todas").innerHTML = `
    <h3>La oferta más barata de cada edición</h3>
    <p class="nota">Solo ediciones con stock según los filtros, ordenadas por costo final. Card Kingdom no aparece aquí porque no informa stock.
      Toca una fila para ver todas sus ofertas.</p>
    ${filas ? `<div class="tabla-marco" style="margin-top:10px"><table>
      <thead><tr><th>Edición</th><th>Tienda</th><th class="num">Precio (${esc(estado.moneda)})</th><th class="num">Puesto en Chile</th>
      <th class="num">Dif. vs Card Kingdom</th><th>Cond. · Idioma · Acabado</th><th class="num">Ofertas</th><th></th></tr></thead>
      <tbody>${filas}</tbody></table></div>`
      : `<p class="vacio" style="margin-top:10px">${estado.tiendasCompletas ? "Ninguna tienda tiene esta carta con los filtros actuales." : "Buscando en las tiendas…"}</p>`}`;
}

function pintarPosibles() {
  const posibles = ordenarOfertas(ofertasVisibles().filter((o) => !o.edicion_id));
  const porId = Object.fromEntries(estado.ediciones.map((e) => [e.id, e]));
  $("#vista-posibles").innerHTML = `
    <h3>Posibles coincidencias</h3>
    <p class="nota">Ofertas que no se pudieron asignar con seguridad a una edición (por ejemplo, la tienda no indica el número).
      Revisa el enlace antes de comprar. Toca una edición sugerida para verla.</p>
    ${posibles.length ? `<div class="tabla-marco" style="margin-top:10px"><table>
      <thead><tr><th>Tienda</th><th>Producto</th><th class="num">Precio (${esc(estado.moneda)})</th><th>Cond. · Idioma · Acabado</th><th>Motivo</th><th>Podría ser</th><th></th></tr></thead>
      <tbody>${posibles.map((o) => `
        <tr class="${o.disponible ? "" : "agotada"}">
          <td>${avatarTienda(o)}</td>
          <td>${esc(o.titulo)}</td>
          <td class="num">${precioHTML(o.precio, o.moneda)}</td>
          <td>${esc(o.condicion || "—")} · ${esc(o.idioma || "—")} · ${esc(NOMBRE_ACABADO[o.acabado])}</td>
          <td>${esc(o.emparejado_por)}</td>
          <td>${o.candidatos.filter((id) => porId[id]).map((id) =>
            `<button type="button" class="candidato" data-id="${id}">${esc(porId[id].set)} #${esc(porId[id].numero)}</button>`).join("") || "—"}</td>
          <td><a class="ir" href="${esc(o.url)}" target="_blank" rel="noopener">Ir ↗</a></td>
        </tr>`).join("")}
      </tbody></table></div>`
      : `<p class="vacio" style="margin-top:10px">${estado.tiendasCompletas ? "No hay posibles coincidencias: todas las ofertas quedaron asignadas a su edición. 🎉" : "Buscando en las tiendas…"}</p>`}`;
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

function seleccionarEdicion(id, { desplazar = true } = {}) {
  estado.seleccion = id;
  cambiarVista("edicion");
  // Si la edición está oculta por "Solo con stock", se desactiva el interruptor
  if ($("#solo-stock").checked && !resumenPorEdicion()[id]) {
    $("#solo-stock").checked = false;
    guardarPreferencia("soloStock", "0");
  }
  pintarCarrusel(resumenPorEdicion());
  pintarDetalle();
  $("#panel-detalle").scrollTop = 0;
  const tarjeta = document.querySelector(`.edicion[data-id="${id}"]`);
  if (pantallaAngosta()) {
    if (desplazar) abrirDetalle();
  } else {
    tarjeta?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// En pantallas angostas el detalle se abre encima, a pantalla completa
const consultaAngosta = window.matchMedia("(max-width: 900px)");
function pantallaAngosta() {
  return consultaAngosta.matches;
}
function abrirDetalle() {
  $("#panel-detalle").classList.add("abierto");
  document.body.classList.add("detalle-abierto");
}
function cerrarDetalle() {
  $("#panel-detalle").classList.remove("abierto");
  document.body.classList.remove("detalle-abierto");
  document.querySelector(`.edicion[data-id="${estado.seleccion}"]`)?.scrollIntoView({ block: "center" });
}

function cambiarVista(vista) {
  estado.vista = vista;
  document.querySelectorAll(".pestanas button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.vista === vista)));
  $("#vista-edicion").hidden = vista !== "edicion";
  $("#vista-todas").hidden = vista !== "todas";
  $("#vista-posibles").hidden = vista !== "posibles";
}

function abrirImagen(src) {
  const caja = $("#lightbox");
  caja.querySelector("img").src = src;
  caja.hidden = false;
}

// ---------- Eventos ----------

$("#carrusel").addEventListener("click", (ev) => {
  const tarjeta = ev.target.closest(".edicion[data-id]");
  if (tarjeta) seleccionarEdicion(tarjeta.dataset.id);
});

// Flechas del teclado para recorrer la grilla de ediciones (← → de a una, ↑ ↓ de a una fila)
$("#carrusel").addEventListener("keydown", (ev) => {
  const columnas = getComputedStyle($("#carrusel")).gridTemplateColumns.split(" ").length;
  const paso = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columnas, ArrowUp: -columnas }[ev.key];
  if (!paso) return;
  ev.preventDefault();
  const ids = [...document.querySelectorAll(".edicion[data-id]")].map((el) => el.dataset.id);
  const i = ids.indexOf(estado.seleccion);
  const siguiente = ids[Math.min(ids.length - 1, Math.max(0, i + paso))];
  if (siguiente) {
    seleccionarEdicion(siguiente, { desplazar: false });
    $("#carrusel").focus({ preventScroll: true });
  }
});

$("#cerrar-detalle").addEventListener("click", cerrarDetalle);

$("#resumen").addEventListener("click", (ev) => {
  const tarjeta = ev.target.closest(".tarjeta-resumen");
  if (!tarjeta || tarjeta.disabled) return;
  if (tarjeta.dataset.accion === "solo-stock") {
    $("#solo-stock").checked = true;
    guardarPreferencia("soloStock", "1");
    cambiarVista("edicion");
    pintarCarrusel(resumenPorEdicion());
    $("#carrusel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (tarjeta.dataset.id) seleccionarEdicion(tarjeta.dataset.id);
});

$("#vista-todas").addEventListener("click", (ev) => {
  if (ev.target.closest("a")) return;
  const fila = ev.target.closest("tr[data-id]");
  if (fila) seleccionarEdicion(fila.dataset.id);
});

$("#vista-posibles").addEventListener("click", (ev) => {
  const boton = ev.target.closest(".candidato");
  if (boton) seleccionarEdicion(boton.dataset.id);
});

$("#detalle").addEventListener("click", (ev) => {
  const orden = ev.target.closest("[data-orden]");
  if (orden) {
    const campo = orden.dataset.orden;
    estado.orden = { campo, dir: estado.orden.campo === campo ? -estado.orden.dir : 1 };
    pintarDetalle();
    return;
  }
  const accion = ev.target.closest("[data-accion]")?.dataset.accion;
  if (accion === "ampliar") abrirImagen(ev.target.src);
  if (accion === "ver-posibles") {
    ev.preventDefault();
    cerrarDetalle();
    cambiarVista("posibles");
    $(".pestanas").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

$("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });

document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => cambiarVista(b.dataset.vista)));

$("#orden").addEventListener("change", () => pintarCarrusel(resumenPorEdicion()));
$("#solo-stock").addEventListener("change", (ev) => {
  guardarPreferencia("soloStock", ev.target.checked ? "1" : "0");
  pintarCarrusel(resumenPorEdicion());
});

$("#actualizar").addEventListener("click", () => {
  if (estado.carta) buscar(estado.carta.nombre, { forzar: true, mantenerSeleccion: true });
});

$("#copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Enlace copiado: puedes abrirlo en el celular o compartirlo");
  } catch (e) {
    toast("No se pudo copiar el enlace", "error");
  }
});

$("#ir-inicio").addEventListener("click", (ev) => {
  ev.preventDefault();
  mostrarInicio();
});

document.querySelector(".inicio").addEventListener("click", (ev) => {
  const chip = ev.target.closest("[data-carta]");
  if (chip) {
    $("#busqueda").value = chip.dataset.carta;
    buscar(chip.dataset.carta);
  }
});

function pintarMoneda() {
  document.querySelectorAll("#monedas button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.moneda === estado.moneda)));
}

$("#monedas").addEventListener("click", (ev) => {
  const boton = ev.target.closest("button[data-moneda]");
  if (!boton) return;
  estado.moneda = boton.dataset.moneda;
  guardarPreferencia("moneda", estado.moneda);
  pintarMoneda();
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

// ---------- Fondos (texturas de fondos.css) ----------

const FONDOS = [
  ["", "Liso"], ["arcano", "Arcano"], ["cosmos", "Cosmos"], ["tormenta", "Tormenta"],
  ["lava", "Lava"], ["oceano", "Océano"], ["bosque", "Bosque"], ["sombras", "Sombras"],
  ["escamas", "Escamas"], ["ruinas", "Ruinas"], ["metal", "Metal"], ["aurora", "Aurora"],
  ["pergamino", "Pergamino"], ["mesa", "Mesa de juego"], ["taller", "Taller"], ["fantasia", "Fantasía"],
];

function pintarMuestras() {
  const actual = document.documentElement.dataset.fondo || "";
  $("#muestras").innerHTML = FONDOS.map(([id, nombre]) =>
    `<button type="button" class="muestra" ${id ? `data-fondo="${id}"` : ""} data-elegir="${id}"
       aria-pressed="${id === actual}" title="${esc(nombre)}"><span>${esc(nombre)}</span></button>`).join("");
}

function menuFondo(abrir) {
  $("#menu-fondo").hidden = !abrir;
  $("#boton-fondo").setAttribute("aria-expanded", String(abrir));
  if (abrir) pintarMuestras();
}

$("#boton-fondo").addEventListener("click", (ev) => {
  ev.stopPropagation();
  menuFondo($("#menu-fondo").hidden);
});

$("#muestras").addEventListener("click", (ev) => {
  const muestra = ev.target.closest("[data-elegir]");
  if (!muestra) return;
  const id = muestra.dataset.elegir;
  if (id) document.documentElement.dataset.fondo = id;
  else delete document.documentElement.dataset.fondo;
  guardarPreferencia("fondo", id);
  pintarMuestras();
});

document.addEventListener("click", (ev) => {
  if (!$("#menu-fondo").hidden && !ev.target.closest(".selector-fondo")) menuFondo(false);
});

// Atajos: "/" para buscar, Esc para cerrar la imagen ampliada, el detalle o el menú de fondos
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("#lightbox").hidden) { $("#lightbox").hidden = true; return; }
  if (ev.key === "Escape" && !$("#menu-fondo").hidden) { menuFondo(false); return; }
  if (ev.key === "Escape" && $("#panel-detalle").classList.contains("abierto")) { cerrarDetalle(); return; }
  const escribiendo = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (ev.key === "/" && !escribiendo) {
    ev.preventDefault();
    $("#busqueda").focus();
    $("#busqueda").select();
  }
});

// ---------- Inicio ----------

(async function iniciar() {
  cargarFiltros();
  pintarRecientes();
  $("#ranura-inicio").appendChild($("#buscador"));
  const info = await cargarInfoDatos();
  const monedaGuardada = leerPreferencia("moneda") || info?.moneda_por_defecto || "CLP";
  estado.moneda = ["CLP", "USD", "EUR", "JPY"].includes(monedaGuardada) ? monedaGuardada : "CLP";
  pintarMoneda();

  const cartaEnURL = new URLSearchParams(location.search).get("carta");
  if (cartaEnURL) {
    $("#busqueda").value = cartaEnURL;
    buscar(cartaEnURL);
  } else {
    $("#busqueda").focus();
  }
})();
