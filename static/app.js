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
  ofertasTiendas: [],   // ofertas que entregó el servidor
  ofertas: [],          // las anteriores + los precios ingresados a mano (cada una con su número _k)
  noIncluidas: [],
  tiendasCompletas: false,
  cargandoEdiciones: false,
  vista: "edicion",
  orden: { campo: "precio", dir: 1 },  // tabla de ofertas: por precio, de menor a mayor (dir 1) o al revés
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

// "−5%" en verde (más barata que Card Kingdom) o "+15%" en rojo, y debajo la diferencia en dinero
function diferenciaHTML(monto, moneda, base) {
  if (!base) return "—";
  const a = convertir(monto, moneda, estado.moneda);
  const b = convertir(base.precio, base.moneda, estado.moneda);
  if (a == null || b == null || b <= 0) return "—";
  const delta = a - b;
  const signo = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const clase = delta < 0 ? "verde" : delta > 0 ? "rojo" : "";
  const porcentaje = Math.abs((delta / b) * 100).toFixed(0);
  const marca = base.fuente !== "cardkingdom" ? ` vs ${esc(base.fuente_nombre)}*` : "";
  return `<strong class="${clase}">${signo}${porcentaje}%</strong><span class="original">${signo}${esc(formatear(Math.abs(delta), estado.moneda))}${marca}</span>`;
}

// Para comparar tiendas se usa solo el precio de la carta (sin envío ni impuestos), llevado a CLP.
// El envío, el IVA y el arancel se calculan en el carrito, por tienda.
function precioComparable(o) {
  return enCLP(o.precio, o.moneda);
}

function precioTexto(o) {
  return enElegida(o.precio, o.moneda);
}

// Tres celdas: precio en la moneda de la tienda, en dólares y en pesos chilenos
function celdasPrecio(o) {
  const usd = convertir(o.precio, o.moneda, "USD");
  const clp = convertir(o.precio, o.moneda, "CLP");
  return `<td class="num">${esc(formatear(o.precio, o.moneda))}</td>
    <td class="num">${esc(formatear(usd, "USD"))}</td>
    <td class="num"><strong>${esc(formatear(clp, "CLP"))}</strong></td>`;
}

// Grupos para comparar: tiendas chilenas, Card Kingdom (referencia) y el resto de las extranjeras
const GRUPOS = [["CL", "📍 Chile"], ["CK", "⭐ Card Kingdom (referencia)"], ["INT", "🌎 Tiendas extranjeras"]];
function grupoDe(tiendaId, pais) {
  return pais === "CL" ? "CL" : tiendaId === "cardkingdom" ? "CK" : "INT";
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
  // Con una ventana abierta (carrito, precio a mano) el aviso va dentro de ella para que se vea encima
  const contenedor = $("#toasts");
  (document.querySelector("dialog[open]") || document.body).appendChild(contenedor);
  contenedor.appendChild(el);
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
const MONEDAS = ["CLP", "USD", "EUR", "JPY"];

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
    configurarEnlacesRepositorio(info.repositorio);
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

// Botón "Reportar un error" y enlaces del pie, si hay un repositorio configurado
function configurarEnlacesRepositorio(repositorio) {
  if (!repositorio) return;
  const base = repositorio.replace(/\/+$/, "");
  $("#reportar").href = `${base}/issues/new?template=reportar-error.yml`;
  $("#reportar").hidden = false;
  $("#enlace-repo").href = base;
  $("#enlace-sugerencia").href = `${base}/issues/new?template=sugerir-mejora.yml`;
  $("#enlaces-repo").hidden = false;
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
    estado.ofertasTiendas = [];
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
    combinarOfertas();
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
      estado.ofertasTiendas = datos.ofertas;
      combinarOfertas();
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

// Etiqueta chica con el precio de Card Kingdom de la misma edición y acabado
function refMercadoHTML(edicion, acabado) {
  const r = edicion?.referencias.find((x) => x.fuente === "cardkingdom" && x.acabado === acabado);
  return `<span class="ref-mercado" title="Precio de Card Kingdom para esta misma edición (${esc(NOMBRE_ACABADO[acabado] || acabado)})">
    Valor referencia mercado <strong>${r ? esc(enElegida(r.precio, r.moneda)) : "sin dato"}</strong></span>`;
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
    if (!r.mejor || precioComparable(o) < precioComparable(r.mejor)) r.mejor = o;
  }
  return resumen;
}

function edicionesOrdenadas(resumen) {
  let lista = [...estado.ediciones];
  if ($("#solo-stock").checked && Object.keys(resumen).length) lista = lista.filter((e) => resumen[e.id]);
  const orden = $("#orden").value;
  const precio = (e) => {
    if (resumen[e.id]) return precioComparable(resumen[e.id].mejor);
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
  return lista.reduce((m, o) => (!m || precioComparable(o) < precioComparable(m) ? o : m), null);
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
  const aMano = estado.tiendas.filter((t) => t.estado === "manual").length;
  const progreso = $("#progreso");
  progreso.classList.toggle("completo", estado.tiendasCompletas);
  $("#progreso-barra").style.width = total ? `${Math.max(8, (listas / total) * 100)}%` : "8%";
  $("#progreso-texto").textContent = estado.tiendasCompletas
    ? `✓ ${total - aMano} tiendas consultadas${aMano ? ` · ${aMano} a mano` : ""} · ${estado.ofertas.length} ofertas`
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
    if (t.estado === "manual") { texto += " · a mano"; titulo = `${t.motivo} Toca para abrir su buscador.`; }
    const enlace = t.estado === "manual" || t.estado === "error" ? t.busqueda || t.url : t.url;
    return `<a class="estado-tienda ${esc(t.estado)}" href="${esc(enlace)}" target="_blank" rel="noopener" title="${esc(titulo || "Abrir la tienda")}">${texto}</a>`;
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
      <span class="valor">${esc(precioTexto(oferta))}</span>
      <span class="detalle-resumen">${esc(oferta.tienda_nombre)} · ${esc(ed.set)} #${esc(ed.numero)} · ${esc(oferta.condicion || "—")} ${esc(NOMBRE_ACABADO[oferta.acabado])}</span>
      ${refMercadoHTML(ed, oferta.acabado)}
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
  const masBarata = mejores.length ? mejores.reduce((m, x) => (precioComparable(x[1].mejor) < precioComparable(m[1].mejor) ? x : m))[0] : null;
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
        ${r ? `<span class="badge-stock">🛒 ${r.cantidad} · desde ${esc(precioTexto(r.mejor))}</span>` : ""}
        <span class="precio-ref">${ref ? `<span class="linea">Ref. ${esc(ref.fuente_nombre)}</span> <strong>${esc(enElegida(ref.precio, ref.moneda))}</strong>` : '<span class="linea">Sin precio de referencia</span>'}</span>
      </button>`;
  }).join("") || `<p class="vacio">No hay ediciones con stock con estos filtros. Desactiva «Solo con stock» para verlas todas.</p>`;
}

const COLUMNAS_OFERTAS = 10;

function textoStock(o) {
  if (!o.disponible) return '<span class="agotado">Agotado</span>';
  if (o.stock_conocido === false) return "Sin dato";
  return o.stock != null ? esc(o.stock) : "Sí";
}

// Botones de cada oferta: ir a la tienda, agregar al carrito y (si se ingresó a mano) borrarla
function accionesOferta(o) {
  return `<span class="acciones-oferta">
    <a class="ir" href="${esc(o.url)}" target="_blank" rel="noopener" title="${esc(o.titulo)}">Ir ↗</a>
    <button type="button" class="agregar" data-carrito="${o._k}" ${o.disponible ? "" : "disabled"}
      title="${o.disponible ? "Agregar al carrito" : "Está agotada"}" aria-label="Agregar al carrito">🛒+</button>
    ${o.manual ? `<button type="button" class="quitar-manual" data-borrar-manual="${esc(o.id)}" title="Borrar este precio ingresado a mano" aria-label="Borrar">✕</button>` : ""}
  </span>`;
}

function filasOfertas(lista, ed, mejor) {
  return lista.map((o) => `
    <tr class="${o.disponible ? "" : "agotada"} ${o === mejor ? "mejor" : ""}">
      <td>${avatarTienda(o)}${o === mejor ? '<span class="pildora">Mejor</span>' : ""}${o.manual ? '<span class="pildora manual">a mano</span>' : ""}</td>
      ${celdasPrecio(o)}
      <td class="num">${diferenciaHTML(o.precio, o.moneda, referenciaPara(ed, o.acabado))}</td>
      <td title="${esc(o.condicion_original || "")}">${esc(o.condicion || "No indicada")}</td>
      <td>${esc(o.idioma ? NOMBRE_IDIOMA[o.idioma] || o.idioma : "No indicado")}</td>
      <td>${esc(NOMBRE_ACABADO[o.acabado] || o.acabado)}</td>
      <td class="num">${textoStock(o)}</td>
      <td>${accionesOferta(o)}</td>
    </tr>`).join("");
}

// Tiendas de un grupo que no se pudieron leer: enlace a su buscador y botón para ingresar el precio a mano
function filasRevisarAMano(grupo) {
  return estado.tiendas
    .filter((t) => (t.estado === "manual" || t.estado === "error") && grupoDe(t.id, t.pais) === grupo)
    .map((t) => `
      <tr class="a-mano">
        <td>${avatarTienda({ tienda: t.id, tienda_nombre: t.nombre, pais: t.pais })}</td>
        <td colspan="${COLUMNAS_OFERTAS - 2}" class="nota-fila">${t.estado === "manual" ? esc(t.motivo) : `No respondió (${esc(t.error)}). Puedes revisarla a mano.`}</td>
        <td><span class="acciones-oferta">
          <a class="ir" href="${esc(t.busqueda || t.url)}" target="_blank" rel="noopener">Buscar ↗</a>
          <button type="button" class="agregar" data-manual="${esc(t.id)}" title="Anotar el precio que viste en la tienda">✎ Precio</button>
        </span></td>
      </tr>`).join("");
}

// Cuerpo de la tabla separado en grupos: Chile, Card Kingdom y extranjeras
function cuerpoOfertas(ofertas, ed, mejor) {
  return GRUPOS.map(([grupo, titulo]) => {
    const lista = ofertas.filter((o) => grupoDe(o.tienda, o.pais) === grupo);
    const aMano = filasRevisarAMano(grupo);
    if (!lista.length && !aMano) return "";
    const cuenta = `${lista.length} ${lista.length === 1 ? "oferta" : "ofertas"}`;
    return `<tbody class="grupo-ofertas">
      <tr class="titulo-grupo"><th colspan="${COLUMNAS_OFERTAS}">${titulo} <span class="nota">${cuenta}</span></th></tr>
      ${filasOfertas(lista, ed, mejor)}${aMano}
    </tbody>`;
  }).join("");
}

function encabezadoOfertas() {
  const flecha = estado.orden.dir === 1 ? " ▲" : " ▼";
  return `<thead><tr>
    <th>Tienda</th><th class="num">Precio tienda</th><th class="num">USD</th>
    <th class="num"><button type="button" class="boton-orden" data-orden="precio" title="Ordenar por precio">CLP${flecha}</button></th>
    <th class="num" title="Solo el precio de la carta, comparado con Card Kingdom">vs Card Kingdom</th>
    <th>Condición</th><th>Idioma</th><th>Acabado</th><th class="num">Stock</th><th></th>
  </tr></thead>`;
}

function ordenarOfertas(lista) {
  return [...lista].sort((a, b) => estado.orden.dir * (precioComparable(a) - precioComparable(b)));
}

const AVISO_PRECIOS = "Los precios son solo de la carta, sin envío ni impuestos. El envío, el IVA y el arancel se calculan en el carrito 🛒, por tienda.";

function filasEsqueleto(n) {
  return Array.from({ length: n }, () => `<tr class="fila-esqueleto">${'<td><div class="esqueleto"></div></td>'.repeat(COLUMNAS_OFERTAS)}</tr>`).join("");
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
        <div class="precio-y-ref"><span class="grande">${esc(precioTexto(mejor))}</span>${refMercadoHTML(ed, mejor.acabado)}</div>
        <p class="nota">${esc(mejor.tienda_nombre)} (${esc(BANDERA[mejor.pais] || mejor.pais)}) · ${esc(mejor.condicion || "condición no indicada")} ·
          ${esc(mejor.idioma ? NOMBRE_IDIOMA[mejor.idioma] || mejor.idioma : "idioma no indicado")} · ${esc(NOMBRE_ACABADO[mejor.acabado])}
          ${ref ? ` · vs Card Kingdom: ${diferenciaHTML(mejor.precio, mejor.moneda, ref).replace(/<span class="original">.*<\/span>/, "")}` : ""}</p>
      </div>
      <div class="acciones">
        <button type="button" class="boton" data-carrito="${mejor._k}">🛒 Agregar al carrito</button>
        <a class="boton primario" href="${esc(mejor.url)}" target="_blank" rel="noopener">Ir a la tienda ↗</a>
      </div>
    </div>`;
  } else {
    cajaMejor = `<div class="mejor-oferta vacia"><div class="info">
      <div class="rotulo" style="color:var(--texto-suave)">${cargando ? "Buscando ofertas…" : "Sin stock con los filtros actuales"}</div>
      <p class="nota">${cargando ? "Las tiendas van apareciendo a medida que responden." : "Prueba otra edición o cambia los filtros."}</p></div></div>`;
  }

  const sinCK = ed.acabados.filter((a) => !ck[a]);
  const avisos = [];
  if (ofertas.length) avisos.push(AVISO_PRECIOS);
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
        ${cargando ? '<span class="nota">⏳ consultando tiendas…</span>' : '<span class="nota">Toca «CLP» para ordenar por precio</span>'}
        <button type="button" class="boton chico" data-manual="">✎ Anotar un precio a mano</button></div>
      ${ofertas.length || !cargando
        ? `<div class="tabla-marco"><table class="tabla-ofertas">${encabezadoOfertas()}${cuerpoOfertas(ofertas, ed, mejor)}</table></div>
           ${ofertas.length ? "" : '<p class="vacio">Ninguna tienda tiene esta edición con los filtros actuales.</p>'}`
        : `<div class="tabla-marco"><table>${encabezadoOfertas()}<tbody>${filasEsqueleto(3)}</tbody></table></div>`}
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
    .sort((a, b) => precioComparable(resumen[a.id].mejor) - precioComparable(resumen[b.id].mejor))
    .map((ed, i) => {
      const { mejor: o, cantidad } = resumen[ed.id];
      return `
        <tr class="clicable ${i === 0 ? "mejor" : ""}" data-id="${ed.id}" title="Ver todas las ofertas de esta edición">
          <td><img class="mini" src="${esc(ed.imagen)}" alt="" loading="lazy">${esc(ed.set_nombre)} ${i === 0 ? '<span class="pildora">Más barata</span>' : ""}
            <span class="pais">${esc(ed.set)} #${esc(ed.numero)}${ed.variantes.length ? " · " + ed.variantes.map(esc).join(", ") : ""}</span></td>
          <td>${avatarTienda(o)}</td>
          ${celdasPrecio(o)}
          <td class="num">${diferenciaHTML(o.precio, o.moneda, referenciaPara(ed, o.acabado))}</td>
          <td>${esc(o.condicion || "—")} · ${esc(o.idioma || "—")} · ${esc(NOMBRE_ACABADO[o.acabado])}</td>
          <td class="num">${cantidad}</td>
          <td>${accionesOferta(o)}</td>
        </tr>`;
    }).join("");
  $("#vista-todas").innerHTML = `
    <h3>La oferta más barata de cada edición</h3>
    <p class="nota">Solo ediciones con stock según los filtros, ordenadas por precio de la carta (sin envío ni impuestos). Card Kingdom no aparece aquí porque no informa stock.
      Toca una fila para ver todas sus ofertas.</p>
    ${filas ? `<div class="tabla-marco" style="margin-top:10px"><table>
      <thead><tr><th>Edición</th><th>Tienda</th><th class="num">Precio tienda</th><th class="num">USD</th><th class="num">CLP</th>
      <th class="num">vs Card Kingdom</th><th>Cond. · Idioma · Acabado</th><th class="num">Ofertas</th><th></th></tr></thead>
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
      <thead><tr><th>Tienda</th><th>Producto</th><th class="num">Precio tienda</th><th class="num">USD</th><th class="num">CLP</th><th>Cond. · Idioma · Acabado</th><th>Motivo</th><th>Podría ser</th><th></th></tr></thead>
      <tbody>${posibles.map((o) => `
        <tr class="${o.disponible ? "" : "agotada"}">
          <td>${avatarTienda(o)}</td>
          <td>${esc(o.titulo)}</td>
          ${celdasPrecio(o)}
          <td>${esc(o.condicion || "—")} · ${esc(o.idioma || "—")} · ${esc(NOMBRE_ACABADO[o.acabado])}</td>
          <td>${esc(o.emparejado_por)}</td>
          <td>${o.candidatos.filter((id) => porId[id]).map((id) =>
            `<button type="button" class="candidato" data-id="${id}">${esc(porId[id].set)} #${esc(porId[id].numero)}</button>`).join("") || "—"}</td>
          <td>${accionesOferta(o)}</td>
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

// ---------- Precios anotados a mano ----------
// Para tiendas que no se pueden leer automáticamente (o que no respondieron).
// Se guardan solo en este navegador y se suman a las ofertas de la carta.

function leerJSON(clave, vacio) {
  try { return JSON.parse(leerPreferencia(clave) || "null") ?? vacio; } catch (e) { return vacio; }
}

function leerManuales() {
  return leerJSON("preciosManuales", []);
}

function combinarOfertas() {
  const carta = (estado.carta?.nombre || "").toLowerCase();
  const manuales = leerManuales().filter((m) => m.carta === carta && estado.ediciones.some((e) => e.id === m.edicion_id));
  estado.ofertas = [...estado.ofertasTiendas, ...manuales];
  estado.ofertas.forEach((o, i) => { o._k = i; });
}

function tiendasOrdenadas() {
  const orden = { CL: 0, CK: 1, INT: 2 };
  return [...estado.tiendas].sort((a, b) =>
    orden[grupoDe(a.id, a.pais)] - orden[grupoDe(b.id, b.pais)] || a.nombre.localeCompare(b.nombre));
}

function abrirIngresoManual(tiendaId) {
  const form = $("#form-manual");
  const tiendas = tiendasOrdenadas();
  const sugerida = tiendaId || tiendas.find((t) => t.estado === "manual" || t.estado === "error")?.id || tiendas[0]?.id;
  form.tienda.innerHTML = tiendas.map((t) =>
    `<option value="${esc(t.id)}">${esc(t.nombre)} (${esc(BANDERA[t.pais] || t.pais)})${t.estado === "manual" ? " · a mano" : ""}</option>`).join("");
  form.edicion.innerHTML = estado.ediciones.map((e) =>
    `<option value="${esc(e.id)}">${esc(e.set_nombre)} (${esc(e.set)} #${esc(e.numero)})${e.variantes.length ? " · " + esc(e.variantes.join(", ")) : ""}</option>`).join("");
  form.moneda.innerHTML = MONEDAS.map((m) => `<option>${m}</option>`).join("");
  form.reset();
  form.tienda.value = sugerida;
  form.edicion.value = estado.seleccion;
  cambiarTiendaManual();
  $("#manual-carta").textContent = estado.carta.nombre;
  $("#dialogo-manual").showModal();
  form.precio.focus();
}

// Al elegir otra tienda se ajustan la moneda y el enlace a su buscador
function cambiarTiendaManual() {
  const form = $("#form-manual");
  const t = estado.tiendas.find((x) => x.id === form.tienda.value);
  if (!t) return;
  form.moneda.value = t.moneda || "CLP";
  form.enlace.value = t.busqueda || t.url;
  $("#manual-buscar").href = t.busqueda || t.url;
}

function guardarManual(ev) {
  ev.preventDefault();
  const form = $("#form-manual");
  const t = estado.tiendas.find((x) => x.id === form.tienda.value);
  const ed = estado.ediciones.find((e) => e.id === form.edicion.value);
  const precio = Number(String(form.precio.value).replace(",", "."));
  if (!t || !ed || !(precio > 0)) {
    toast("Escribe un precio mayor que cero", "error");
    return;
  }
  const enlace = /^https?:\/\//i.test(form.enlace.value.trim()) ? form.enlace.value.trim() : t.busqueda || t.url;
  const stock = form.stock.value === "" ? null : Math.max(0, Math.floor(Number(form.stock.value)));
  const nueva = {
    id: `m${Date.now()}`, manual: true, carta: estado.carta.nombre.toLowerCase(), fecha: new Date().toISOString(),
    tienda: t.id, tienda_nombre: t.nombre, pais: t.pais, edicion_id: ed.id,
    emparejado_por: "ingresado a mano", candidatos: [],
    titulo: `${estado.carta.nombre} [${ed.set_nombre}] (precio anotado a mano)`, url: enlace,
    precio, moneda: form.moneda.value, condicion: form.condicion.value || null, condicion_original: null,
    idioma: form.idioma.value || null, acabado: form.acabado.value,
    disponible: stock !== 0, stock, stock_conocido: true,
  };
  guardarPreferencia("preciosManuales", JSON.stringify([...leerManuales(), nueva]));
  $("#dialogo-manual").close();
  combinarOfertas();
  seleccionarEdicion(ed.id, { desplazar: false });
  pintarTodo();
  toast(`Precio de ${t.nombre} guardado`);
}

function borrarManual(id) {
  guardarPreferencia("preciosManuales", JSON.stringify(leerManuales().filter((m) => m.id !== id)));
  combinarOfertas();
  pintarTodo();
  toast("Precio anotado borrado");
}

$("#form-manual").addEventListener("submit", guardarManual);
$("#form-manual").tienda.addEventListener("change", cambiarTiendaManual);
$("#cancelar-manual").addEventListener("click", () => $("#dialogo-manual").close());

// ---------- Carrito ----------
// Se guarda en este navegador. Agrupa las cartas por tienda y calcula envío e impuestos:
//  - Tiendas chilenas: sus precios ya incluyen IVA; solo se suma el envío (o retiro en tienda).
//  - Extranjeras: valor = cartas + envío. Arancel si supera el límite (6% sobre US$500).
//    IVA 19% sobre cartas + envío (+ arancel, si corresponde).

function leerCarrito() {
  return leerJSON("carrito", []);
}

function guardarCarrito(lista) {
  guardarPreferencia("carrito", JSON.stringify(lista));
  pintarCuentaCarrito();
  if ($("#dialogo-carrito").open) pintarCarrito();
}

function pintarCuentaCarrito() {
  const cantidad = leerCarrito().reduce((s, it) => s + it.cantidad, 0);
  $("#cuenta-carrito").textContent = cantidad;
  $("#cuenta-carrito").hidden = !cantidad;
}

function agregarAlCarrito(o) {
  if (!o || !o.disponible) return;
  const ed = estado.ediciones.find((e) => e.id === o.edicion_id);
  const clave = [o.tienda, o.url, o.condicion, o.idioma, o.acabado, o.precio].join("|");
  const lista = leerCarrito();
  const existente = lista.find((x) => x.clave === clave);
  if (existente) {
    if (o.stock != null && existente.cantidad >= o.stock) {
      toast(`${o.tienda_nombre} solo tiene ${o.stock} en stock`, "error");
      return;
    }
    existente.cantidad++;
  } else {
    lista.push({
      clave, carta: estado.carta.nombre, imagen: ed?.imagen || "",
      edicion: ed ? `${ed.set_nombre} (${ed.set} #${ed.numero})` : o.titulo,
      tienda: o.tienda, tienda_nombre: o.tienda_nombre, pais: o.pais, url: o.url,
      precio: o.precio, moneda: o.moneda, condicion: o.condicion, idioma: o.idioma, acabado: o.acabado,
      stock: o.stock, manual: !!o.manual, cantidad: 1,
    });
  }
  guardarCarrito(lista);
  toast(`🛒 ${estado.carta.nombre} (${o.tienda_nombre}) agregada al carrito`);
  const boton = $("#abrir-carrito");
  boton.classList.remove("latido");
  void boton.offsetWidth;
  boton.classList.add("latido");
}

function leerEnvios() {
  return leerJSON("enviosCarrito", {});
}

// Envío de una tienda: lo que guardaste en el carrito, o el valor de ajustes.toml (las chilenas parten en 0)
function envioDe(tienda, pais) {
  const base = estado.config?.envios?.[tienda];
  const inicial = { costo: base?.costo ?? 0, moneda: base?.moneda ?? (pais === "CL" ? "CLP" : "USD"), retiro: false };
  return { ...inicial, ...leerEnvios()[tienda] };
}

function guardarEnvio(tienda, pais, cambios) {
  const todos = leerEnvios();
  todos[tienda] = { ...envioDe(tienda, pais), ...cambios };
  guardarPreferencia("enviosCarrito", JSON.stringify(todos));
}

// Cuentas de una tienda, todo en dólares
function cuentaTienda(items) {
  const { tienda, pais } = items[0];
  const extranjera = pais !== "CL";
  const imp = estado.config?.importacion || {};
  const usd = (monto, moneda) => convertir(monto, moneda, "USD") ?? 0;
  const env = envioDe(tienda, pais);
  const subtotal = items.reduce((s, it) => s + usd(it.precio * it.cantidad, it.moneda), 0);
  const envio = env.retiro ? 0 : usd(Number(env.costo) || 0, env.moneda);
  let tasaArancel = 0, arancel = 0, iva = 0, cargo = 0;
  if (extranjera) {
    const valor = subtotal + envio;
    tasaArancel = valor > (imp.limite_usd ?? 500) ? (imp.arancel_sobre_limite ?? 0.06) : (imp.arancel_bajo_limite ?? 0);
    arancel = valor * tasaArancel;
    iva = (valor + arancel) * (imp.iva ?? 0.19);
    cargo = usd(imp.cargo_fijo_clp ?? 0, "CLP");
  }
  return { extranjera, env, subtotal, envio, tasaArancel, arancel, iva, cargo, total: subtotal + envio + arancel + iva + cargo };
}

function dosMonedas(usd) {
  return `<td class="num">${esc(formatear(usd, "USD"))}</td><td class="num">${esc(formatear(convertir(usd, "USD", "CLP"), "CLP"))}</td>`;
}

function pintarCarrito() {
  const lista = leerCarrito();
  const contenido = $("#carrito-contenido");
  if (!lista.length) {
    contenido.innerHTML = `<p class="vacio">El carrito está vacío. Agrega cartas con el botón <b>🛒+</b> de cada oferta.</p>`;
    return;
  }
  if (!estado.tasas) {
    contenido.innerHTML = `<p class="vacio">No hay tipo de cambio disponible, así que no se pueden sumar precios en distintas monedas. Intenta recargar la página.</p>`;
    return;
  }
  const imp = estado.config?.importacion || {};
  const porTienda = {};
  for (const it of lista) (porTienda[it.tienda] ||= []).push(it);
  const orden = { CL: 0, CK: 1, INT: 2 };
  const grupos = Object.values(porTienda).sort((a, b) =>
    orden[grupoDe(a[0].tienda, a[0].pais)] - orden[grupoDe(b[0].tienda, b[0].pais)] || a[0].tienda_nombre.localeCompare(b[0].tienda_nombre));

  let totalUSD = 0;
  const secciones = grupos.map((items) => {
    const c = cuentaTienda(items);
    const { tienda, tienda_nombre, pais } = items[0];
    totalUSD += c.total;
    const filas = items.map((it) => `
      <tr>
        <td class="carta-carrito">${it.imagen ? `<img class="mini" src="${esc(it.imagen)}" alt="" loading="lazy">` : ""}
          <span>${esc(it.carta)}${it.manual ? ' <span class="pildora manual">a mano</span>' : ""}
          <span class="pais">${esc(it.edicion)} · ${esc(it.condicion || "—")} · ${esc(it.idioma ? NOMBRE_IDIOMA[it.idioma] || it.idioma : "—")} · ${esc(NOMBRE_ACABADO[it.acabado] || it.acabado)}</span></span></td>
        <td class="num">${esc(formatear(it.precio, it.moneda))}</td>
        <td class="num"><span class="cantidad">
          <button type="button" data-cantidad="-1" data-clave="${esc(it.clave)}" aria-label="Quitar una">−</button>
          <b>${it.cantidad}</b>
          <button type="button" data-cantidad="1" data-clave="${esc(it.clave)}" aria-label="Agregar una">+</button></span></td>
        <td class="num">${esc(formatear(it.precio * it.cantidad, it.moneda))}</td>
        <td><span class="acciones-oferta"><a class="ir" href="${esc(it.url)}" target="_blank" rel="noopener">Ir ↗</a>
          <button type="button" class="quitar-manual" data-quitar="${esc(it.clave)}" title="Quitar del carrito" aria-label="Quitar">✕</button></span></td>
      </tr>`).join("");
    const lineas = [
      ["Subtotal cartas", c.subtotal],
      [c.env.retiro ? "Envío (retiro en tienda)" : "Envío", c.envio],
      c.arancel > 0 && [`Arancel ${(c.tasaArancel * 100).toFixed(0)}% (la compra supera US$${imp.limite_usd ?? 500})`, c.arancel],
      c.extranjera && [`IVA ${((imp.iva ?? 0.19) * 100).toFixed(0)}% (sobre cartas + envío${c.arancel > 0 ? " + arancel" : ""})`, c.iva],
      c.cargo > 0 && ["Cargo fijo de aduana", c.cargo],
    ].filter(Boolean);
    return `
      <section class="tienda-carrito">
        <header>${avatarTienda({ tienda, tienda_nombre, pais })}
          <span class="nota">${c.extranjera ? "Compra extranjera: se suma IVA" : "Tienda chilena: el precio ya incluye IVA"}</span></header>
        <div class="tabla-marco"><table>
          <thead><tr><th>Carta</th><th class="num">Precio</th><th class="num">Cantidad</th><th class="num">Subtotal</th><th></th></tr></thead>
          <tbody>${filas}</tbody></table></div>
        <div class="envio-tienda">
          <label>Envío <input type="number" min="0" step="any" inputmode="decimal" value="${esc(c.env.costo)}"
            data-envio-costo="${esc(tienda)}" data-pais="${esc(pais)}" ${c.env.retiro ? "disabled" : ""}></label>
          <select data-envio-moneda="${esc(tienda)}" data-pais="${esc(pais)}" aria-label="Moneda del envío" ${c.env.retiro ? "disabled" : ""}>
            ${MONEDAS.map((m) => `<option ${m === c.env.moneda ? "selected" : ""}>${m}</option>`).join("")}</select>
          ${pais === "CL" ? `<label class="interruptor"><input type="checkbox" data-envio-retiro="${esc(tienda)}" data-pais="${esc(pais)}"
            ${c.env.retiro ? "checked" : ""}><span></span>Retiro en tienda</label>` : ""}
        </div>
        <table class="cuentas">
          <thead><tr><th></th><th class="num">USD</th><th class="num">CLP</th></tr></thead>
          <tbody>${lineas.map(([texto, valor]) => `<tr><td>${esc(texto)}</td>${dosMonedas(valor)}</tr>`).join("")}
            <tr class="total"><th>Total ${esc(tienda_nombre)}</th>${dosMonedas(c.total)}</tr></tbody>
        </table>
      </section>`;
  });

  contenido.innerHTML = secciones.join("") + `
    <section class="total-general">
      <div><span class="rotulo">Total general (${grupos.length} ${grupos.length === 1 ? "tienda" : "tiendas"})</span>
        <span class="grande">${esc(formatear(convertir(totalUSD, "USD", "CLP"), "CLP"))}</span>
        <span class="nota">${esc(formatear(totalUSD, "USD"))}</span></div>
      <button type="button" class="boton" data-accion="vaciar">Vaciar carrito</button>
    </section>
    <p class="nota">Estimación referencial con el tipo de cambio del día. El arancel se calcula por tienda: ${((imp.arancel_sobre_limite ?? 0.06) * 100).toFixed(0)}%
      si esa compra (cartas + envío) supera US$${imp.limite_usd ?? 500}. Revisa el envío real en el checkout de cada tienda.</p>`;
}

function abrirCarrito() {
  pintarCarrito();
  $("#dialogo-carrito").showModal();
}

$("#abrir-carrito").addEventListener("click", abrirCarrito);
$("#cerrar-carrito").addEventListener("click", () => $("#dialogo-carrito").close());

$("#carrito-contenido").addEventListener("click", (ev) => {
  const lista = leerCarrito();
  const mas = ev.target.closest("[data-cantidad]");
  if (mas) {
    const it = lista.find((x) => x.clave === mas.dataset.clave);
    if (!it) return;
    const nueva = it.cantidad + Number(mas.dataset.cantidad);
    if (it.stock != null && nueva > it.stock) return toast(`${it.tienda_nombre} solo tiene ${it.stock} en stock`, "error");
    it.cantidad = nueva;
    return guardarCarrito(lista.filter((x) => x.cantidad > 0));
  }
  const quitar = ev.target.closest("[data-quitar]");
  if (quitar) return guardarCarrito(lista.filter((x) => x.clave !== quitar.dataset.quitar));
  if (ev.target.closest('[data-accion="vaciar"]') && confirm("¿Vaciar el carrito?")) guardarCarrito([]);
});

$("#carrito-contenido").addEventListener("change", (ev) => {
  const el = ev.target;
  const pais = el.dataset.pais;
  if (el.dataset.envioCosto) guardarEnvio(el.dataset.envioCosto, pais, { costo: Math.max(0, Number(el.value) || 0) });
  else if (el.dataset.envioMoneda) guardarEnvio(el.dataset.envioMoneda, pais, { moneda: el.value });
  else if (el.dataset.envioRetiro) guardarEnvio(el.dataset.envioRetiro, pais, { retiro: el.checked });
  else return;
  pintarCarrito();
});

// Botones de las tablas de ofertas (en cualquier vista): carrito, precio a mano y borrar precio a mano
document.addEventListener("click", (ev) => {
  const carrito = ev.target.closest("[data-carrito]");
  if (carrito) return agregarAlCarrito(estado.ofertas[Number(carrito.dataset.carrito)]);
  const manual = ev.target.closest("[data-manual]");
  if (manual && estado.carta) return abrirIngresoManual(manual.dataset.manual);
  const borrar = ev.target.closest("[data-borrar-manual]");
  if (borrar && confirm("¿Borrar este precio anotado a mano?")) borrarManual(borrar.dataset.borrarManual);
});

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
  if (ev.target.closest("a, button")) return;
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
  if (document.querySelector("dialog[open]")) return;   // el carrito y el precio a mano se cierran solos con Esc
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

// ---------- Revisión automática de las tiendas (solo en tu PC) ----------

let revision = null;

function haceCuanto(segundos) {
  const minutos = Math.round((Date.now() / 1000 - segundos) / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas < 48 ? `hace ${horas} h` : `hace ${Math.round(horas / 24)} días`;
}

async function cargarRevision() {
  try { revision = await api("/api/revision"); } catch (e) { return; }
  $("#abrir-revision").hidden = !revision.disponible;
  const problemas = revision.revision?.problemas.length || 0;
  $("#cuenta-revision").textContent = problemas;
  $("#cuenta-revision").hidden = !problemas;
  $("#abrir-revision").title = problemas
    ? `Revisión de tiendas: ${problemas} ${problemas === 1 ? "problema" : "problemas"}`
    : "Revisión automática de las tiendas";
  if ($("#dialogo-revision").open) pintarRevision();
  if (revision.en_curso) setTimeout(cargarRevision, 10000);
}

function pintarRevision() {
  const r = revision?.revision;
  const boton = `<button type="button" class="boton chico" id="revisar-ahora" ${revision?.en_curso ? "disabled" : ""}>
    ${revision?.en_curso ? "Revisando… (tarda unos minutos)" : "↻ Revisar ahora"}</button>`;
  if (!r) {
    $("#revision-contenido").innerHTML = `<p class="nota">Todavía no hay una revisión. Se hace sola una vez al día, unos minutos después de abrir la app.</p>${boton}`;
    return;
  }
  const filas = Object.values(r.tiendas).map((t) => `<tr>
      <td>${esc(t.nombre)}</td><td class="num">${t.ofertas}</td><td class="num">${t.emparejadas}</td>
      <td>${t.error ? `⚠️ ${esc(t.error)}` : "✅"}</td></tr>`).join("");
  $("#revision-contenido").innerHTML = `
    <p class="nota">Última revisión ${esc(haceCuanto(r.fecha))}, con ${r.cartas.map(esc).join(" y ")}.
      Se repite sola una vez al día; si una tienda cambia su robots.txt para prohibir la lectura, pasa sola a modo «a mano».</p>
    ${r.problemas.length
      ? `<h3>⚠️ ${r.problemas.length} ${r.problemas.length === 1 ? "problema" : "problemas"}</h3>
         <ul class="problemas-revision">${r.problemas.map((p) => `<li><strong>${esc(p.nombre)}:</strong> ${esc(p.detalle)}</li>`).join("")}</ul>
         <p class="nota">Si una tienda cambió su página, pásale este informe a Claude para ajustarla.</p>`
      : "<h3>✅ Todas las tiendas revisadas funcionan bien</h3>"}
    ${boton}
    <div class="tabla-marco" style="margin-top:12px"><table>
      <thead><tr><th>Tienda</th><th class="num">Ofertas</th><th class="num">Calzan con una edición</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    ${r.omitidas.length ? `<p class="nota">No revisadas: ${r.omitidas.map((o) => `${esc(o.nombre)} (${esc(o.motivo)})`).join("; ")}.</p>` : ""}`;
}

$("#abrir-revision").addEventListener("click", () => { pintarRevision(); $("#dialogo-revision").showModal(); });
$("#cerrar-revision").addEventListener("click", () => $("#dialogo-revision").close());
$("#revision-contenido").addEventListener("click", async (ev) => {
  if (!ev.target.closest("#revisar-ahora")) return;
  try {
    await api("/api/revision", { method: "POST" });
  } catch (e) {
    toast("No se pudo iniciar la revisión", "error");
    return;
  }
  cargarRevision();
});

// ---------- Inicio ----------

(async function iniciar() {
  cargarFiltros();
  pintarRecientes();
  pintarCuentaCarrito();
  cargarRevision();
  setInterval(cargarRevision, 30 * 60 * 1000);   // la revisión diaria puede terminar con la página abierta
  $("#ranura-inicio").appendChild($("#buscador"));
  const info = await cargarInfoDatos();
  const monedaGuardada = leerPreferencia("moneda") || info?.moneda_por_defecto || "CLP";
  estado.moneda = MONEDAS.includes(monedaGuardada) ? monedaGuardada : "CLP";
  pintarMoneda();

  const cartaEnURL = new URLSearchParams(location.search).get("carta");
  if (cartaEnURL) {
    $("#busqueda").value = cartaEnURL;
    buscar(cartaEnURL);
  } else {
    $("#busqueda").focus();
  }
})();
