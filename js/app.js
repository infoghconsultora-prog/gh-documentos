(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plano = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const mesISO = () => hoyISO().slice(0, 7);
  const fechaDe = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

  const TIPOS = [
    { id: 'ot', nombre: 'Pedido de OT' },
    { id: 'manifiestos', nombre: 'Manifiestos' },
    { id: 'ratificacion', nombre: 'Ratificación' },
    { id: 'designacion', nombre: 'Designación' },
    { id: 'nota', nombre: 'Nota' },
    { id: 'cdf', nombre: 'CDF' }
  ];
  const MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const tarjetaVacia = () => ({ ot: '', mat: '', fec: '', kg: '', mts: '', cont: 'A GRANEL', dest: '', destManual: false });
  let FORMATO_GUARDADO = 'pdf';
  try { FORMATO_GUARDADO = localStorage.getItem('gh-formato') || 'pdf'; } catch (e) { /* sin storage */ }

  const S = {
    datos: null, tipo: 'ot', manual: false, comp: null, anexos: [],
    pdf: null, gen: 0, timer: null, carpetas: null, carpetaElegida: null, logos: {},
    formato: FORMATO_GUARDADO, cards: [tarjetaVacia()], guardadoOk: false, pendienteReg: null, mesManual: false
  };

  /* ------------------------------------------------------------ api (Apps Script) */
  // Las rutas conservan la forma del servidor local; acá se traducen a acciones del backend.
  const API = {
    async get(p) {
      const u = new URL(p, 'http://x'), q = Object.fromEntries(u.searchParams);
      if (u.pathname === '/api/datos') return GH.llamar('getData');
      if (u.pathname === '/api/carpetas') return GH.llamar('getCarpetas', q);
      throw new Error('ruta desconocida');
    },
    async post(p, b) {
      if (p === '/api/guardar') return GH.llamar('guardar', b, true);
      if (p === '/api/cdf/registrar') return GH.llamar('cdfRegistrar', b, true);
      if (p === '/api/cdf/crear-mes') return GH.llamar('cdfCrearMes', b, true);
      throw new Error('ruta desconocida');
    }
  };
  const bytesDeB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  /* ------------------------------------------------------------ utilidades */
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('ver');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('ver'), ms || 4200);
  }
  const val = id => { const e = $(id); if (!e) return ''; return e.type === 'checkbox' ? e.checked : e.value.trim(); };
  const setVal = (id, v) => { const e = $(id); if (e) { if (e.type === 'checkbox') e.checked = !!v; else e.value = v == null ? '' : v; } };
  const empActual = () => (S.datos.empresas.find(e => e.clave === val('emp')) || null);

  function generoEval(nombre) {
    const p = (nombre || '').trim().split(/\s+/)[0] || '';
    return (/a$/i.test(p) || /^(yanet|janet|doris)$/i.test(p)) ? 'Evaluadora:' : 'Evaluador:';
  }

  async function aBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }

  // Cualquier imagen -> JPEG liviano sobre fondo blanco (capturas de celular pesan varios MB).
  async function imagenAJpg(blob, maxLado) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    return { tipo: 'jpg', bytes: await aBytes(out), blob: out };
  }

  async function leerArchivo(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return { tipo: 'pdf', bytes: await aBytes(file), nombre: file.name, kb: Math.round(file.size / 1024) };
    }
    if (!/^image\//.test(file.type)) throw new Error('"' + file.name + '" no es imagen ni PDF');
    const j = await imagenAJpg(file, 1800);
    return { tipo: 'jpg', bytes: j.bytes, nombre: file.name || 'captura.jpg', kb: Math.round(j.bytes.length / 1024), url: URL.createObjectURL(j.blob) };
  }

  async function cargarLogo(clave) {
    if (S.logos[clave] !== undefined) return S.logos[clave];
    let res = null;
    try {
      const r = await GH.llamar('getLogo', { e: clave });
      const bytes = bytesDeB64(r.b64);
      if (r.mime === 'image/png') res = { tipo: 'png', bytes };
      else if (r.mime === 'image/jpeg') res = { tipo: 'jpg', bytes };
      else { const j = await imagenAJpg(new Blob([bytes], { type: r.mime }), 800); res = { tipo: 'jpg', bytes: j.bytes }; }
    } catch (e) { res = null; }
    S.logos[clave] = res; return res;
  }
  async function cargarAsset(nombre, tipo) {
    if (S.logos[nombre] !== undefined) return S.logos[nombre];
    const r = await GH.llamar('getAsset', { nombre: nombre.replace(/\.[a-z]+$/, '') });
    S.logos[nombre] = { tipo, bytes: bytesDeB64(r.b64) };
    return S.logos[nombre];
  }

  /* ------------------------------------------------------------ formularios */
  const F = {
    text(id, label, o) {
      o = o || {};
      return '<label class="fld ' + (o.cls || '') + '"><span>' + label + '</span><input type="text" id="' + id + '" value="' + esc(o.v) + '" placeholder="' + esc(o.ph) + '"' +
        (o.list ? ' list="' + o.list + '"' : '') + (o.gen ? ' data-gen="1"' : '') + ' autocomplete="off" spellcheck="false">' + (o.hint ? '<small>' + o.hint + '</small>' : '') + '</label>';
    },
    num(id, label, o) {
      o = o || {};
      return '<label class="fld ' + (o.cls || '') + '"><span>' + label + '</span><input type="number" id="' + id + '" value="' + esc(o.v) + '" min="' + (o.min == null ? 0 : o.min) + '"' +
        (o.step ? ' step="' + o.step + '"' : '') + (o.gen ? ' data-gen="1"' : '') + ' inputmode="decimal"></label>';
    },
    date(id, label, o) {
      o = o || {};
      return '<label class="fld ' + (o.cls || '') + '"><span>' + label + '</span><input type="date" id="' + id + '" value="' + esc(o.v) + '"' + (o.gen ? ' data-gen="1"' : '') + '></label>';
    },
    month(id, label, o) {
      o = o || {};
      return '<label class="fld ' + (o.cls || '') + '"><span>' + label + '</span><input type="month" id="' + id + '" value="' + esc(o.v) + '" data-gen="1"></label>';
    },
    sel(id, label, opts, o) {
      o = o || {};
      return '<label class="fld ' + (o.cls || '') + '"><span>' + label + '</span><select id="' + id + '"' + (o.gen ? ' data-gen="1"' : '') + '>' +
        opts.map(x => '<option value="' + esc(x[0]) + '"' + (x[0] === o.v ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select></label>';
    },
    chk(id, label, checked, o) {
      o = o || {};
      return '<label class="chk ' + (o.cls || '') + '"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (o.gen ? ' data-gen="1"' : '') + '><div>' + label + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</div></label>';
    },
    area(id, label, o) {
      o = o || {};
      return '<label class="fld ' + (o.cls || '') + '"><span>' + label + '</span><textarea id="' + id + '" rows="' + (o.rows || 4) + '"' + (o.gen ? ' data-gen="1"' : '') + ' placeholder="' + esc(o.ph) + '">' + esc(o.v) + '</textarea>' + (o.hint ? '<small>' + o.hint + '</small>' : '') + '</label>';
    }
  };

  const esCarta = () => S.tipo !== 'cdf';
  const DEST = {
    ot: ['Sr. Subsecretario de RSU', 'Ing. Santiago Ceballos'],
    manifiestos: ['Sr. Sub Secretario de Residuos', 'Ing. Santiago Ceballos'],
    ratificacion: ['Sr. Sub Secretario de Residuos', 'Ing. Santiago Ceballos'],
    designacion: ['Sr. Secretario de Estado de Ambiente y Desarrollo Sustentable', 'Sr. Federico Rios Yañez'],
    nota: ['Sr. Sub Secretario de Residuos', 'Ing. Santiago Ceballos']
  };

  // Textos de notas que se repiten (salen de las notas reales de 2026). Lo que va entre [ ] se completa a mano.
  const MODELOS = [
    { n: 'Presentación de documentación', t: 'Nos dirigimos a Usted con el fin de presentar la siguiente documentación:\n\n• [documento 1]\n• [documento 2]' },
    { n: 'Solicitud de renovación', t: 'Nos dirigimos a Ud. a fin de solicitar la renovación de [DIA / Certificado Ambiental / CAD], otorgado mediante Resolución N.º [número y año].\n\nSe adjunta la siguiente documentación:\n\n• [documento 1]\n• [documento 2]' },
    { n: 'Respuesta a informe técnico', t: 'Nos dirigimos a Ud. con motivo de dar respuesta al informe N.º [número].\n\nSe adjunta la siguiente documentación:\n\n• [documento 1]\n• [documento 2]' },
    { n: 'Trazabilidad de residuos peligrosos', t: 'Nos dirigimos a Usted con motivo de presentar la trazabilidad de los residuos peligrosos generados en la empresa de referencia en el año [año] y el período comprendido hasta la actualidad de [año].\n\nSe adjunta la siguiente información:\n\n• Cuadro de la generación de RRPP en [año]\n• Cuadro de la generación de RRPP en [año]\n• Su respectivo CDF' },
    { n: 'Retiro de RAEE', t: 'En mi carácter de Representante Técnica de la empresa de referencia, me dirijo a Ud. a fin de solicitar el retiro y la disposición final de Residuos de Aparatos Eléctricos y Electrónicos (RAEE) generados en nuestras instalaciones, de acuerdo con los procedimientos establecidos por la Secretaría.\n\nA continuación, se detalla el material a retirar:\n\n• [detalle del material]\n\nQuedamos a disposición para coordinar la fecha y modalidad de retiro del material detallado.' },
    { n: 'Presentación de pago de tasas', t: 'A través del presente escrito nos dirigimos a Ud., con el fin de informar que la empresa realizó un pago en concepto de [concepto] correspondiente a [período] por el monto de $[monto] con fecha [fecha].\n\nSe adjunta comprobante de pago.' },
    { n: 'Cambio de rúbrica de libro de registro', t: 'Nos dirigimos a usted con el fin de presentar libro de registro para nueva rúbrica actualizada, cabe destacar que este libro corresponde a [tipo de libro], en el cual se detectó un error en el título de la rúbrica inicial donde dice [texto erróneo], tener en cuenta esta corrección para la nueva rúbrica.' }
  ];

  function formHTML() {
    const t = S.tipo, d = S.datos;
    const dl = '<datalist id="dlExp"></datalist><datalist id="dlEval">' + [...new Set(d.empresas.flatMap(e => e.expedientes.map(x => x.evaluador)).filter(Boolean))].sort().map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
      '<datalist id="dlMat">' + (d.entidades.materiales || []).map(x => '<option value="' + esc(x.tipo) + '">').join('') + '</datalist>' +
      '<datalist id="dlCont"><option value="A GRANEL"><option value="1"><option value="2"><option value="3"><option value="4"></datalist>' +
      '<datalist id="dlGen">' + d.entidades.generadores.map(x => '<option value="' + esc(x.nombre) + '">').join('') + '</datalist>' +
      '<datalist id="dlTra">' + d.entidades.transportistas.map(x => '<option value="' + esc(x.nombre) + '">').join('') + '</datalist>' +
      '<datalist id="dlCierre"><option value="Sin otro particular, saludamos a usted atentamente."><option value="Sin otro particular, saludo a Ud. atte."><option value="Sin otro particular, saludo a Ud. muy atentamente."><option value="Saludamos a Usted atte."></datalist>' +
      '<datalist id="dlMotivo"><option value="generados en tareas de mantenimiento en la empresa"><option value="generados en el predio"></datalist>';
    let h = dl;
    if (esCarta()) {
      const opEmp = [['', 'Elegir empresa…']].concat(d.empresas.map(e => [e.clave, e.nombre]));
      const nota = t === 'nota', des = t === 'designacion';
      h += '<section class="card"><h2>Empresa y trámite</h2><div class="grid">' +
        F.sel('emp', 'Empresa', opEmp, { cls: 'full', v: S.empSel || '' }) +
        F.text('nombreEmp', 'Nombre en la nota', { gen: 1, cls: 'full' }) +
        (nota ? F.text('ref', 'Referencia (opcional)', { cls: 'full', ph: 'Ej: Solicitud de renovación de CAD' }) : '') +
        (des ? F.text('exp', 'Expediente (opcional)', { list: 'dlExp', cls: 'full' }) :
          F.text('exp', nota ? 'Expediente (opcional)' : 'Expediente', { list: 'dlExp', gen: nota ? 0 : 1, hint: '<span id="expHint"></span>' })) +
        (des ? '' : F.text('eval', nota ? 'Evaluador/a o área' : 'Evaluador/a', { list: 'dlEval' })) +
        (nota ? F.sel('etiqEval', 'Rótulo', [['auto', 'Evaluador/a'], ['Área:', 'Área']], {}) : '') +
        ((nota || des) ? F.text('cuit', 'CUIT (opcional)', {}) : '') +
        (nota ? F.text('ubic', 'Ubicación (opcional)', {}) : '') +
        F.text('rca', 'RCA', { v: des ? '126 GH Consultora/ Bioing. Gabriela J. Hidalgo' : '126 GH Consultora', cls: des ? 'full' : '' }) +
        (des ? F.text('rca2', 'Línea adicional (opcional)', { v: 'Ing. M. Florencia Palumbo', cls: 'full' }) : '') +
        F.date('fecha', 'Fecha de la nota', { v: hoyISO() }) +
        '</div></section>';
      const presets = d.destinatarios || [];
      h += '<section class="card"><h2>Destinatario</h2><div class="grid">' +
        (nota ? F.sel('destPre', 'Elegir de la lista', [['', 'Escribir a mano…']].concat(presets.map((x, i) => [String(i), x.cargo + (x.nombre ? ' · ' + x.nombre : '')])), { cls: 'full' }) : '') +
        F.text('destCargo', 'Cargo', { v: DEST[t][0], cls: 'full' }) +
        ((des || nota) ? F.text('destOrg', 'Organismo (opcional)', { v: des ? 'Gobierno Provincia de San Juan' : '', cls: 'full' }) : '') +
        F.text('destNombre', 'Nombre', { v: DEST[t][1] }) +
        F.sel('saludo', 'Fórmula', [['Presente.', 'Presente'], ['S________________/_________________D', 'S____/____D'], ['S………………/………….......D', 'S……/……D'], ['', 'Ninguna']], { v: des ? 'S________________/_________________D' : 'Presente.' }) +
        (nota ? F.sel('apertura', 'Apertura', [['', 'Ninguna'], ['De mi mayor consideración:', 'De mi mayor consideración'], ['De nuestra consideración:', 'De nuestra consideración'], ['De nuestra mayor consideración:', 'De nuestra mayor consideración']], {}) :
          F.sel('persona', 'Redacción', [['nos', 'Plural: "Nos dirigimos…"'], ['yo', 'Singular: "Tengo el agrado…"']], { v: des ? 'yo' : 'nos', gen: 1 })) +
        '</div></section>';
    } else {
      h += '<section class="card"><h2>Certificado</h2><div class="grid">' +
        F.date('fecha', 'Fecha de emisión', { v: hoyISO() }) +
        F.num('numero', 'N° de certificado', { v: d.cdf.siguiente, min: 1 }) +
        '</div><p class="hint" id="numHint"></p></section>';
    }

    if (t === 'ot') {
      h += '<section class="card"><h2>Pedido</h2><div class="grid">' +
        F.num('cantP', 'Órdenes tipo “P”', { v: 100, gen: 1 }) + F.num('cantR', 'Órdenes tipo “R”', { v: 0, gen: 1 }) +
        F.chk('transp', 'Aclarar que es para transporte de RSU asimilables a domiciliarios', false, { gen: 1, cls: 'full' }) +
        F.text('nreg', 'N° de registro (opcional)', {}) + F.text('nres', 'N° de resolución (opcional)', {}) +
        F.text('fvenc', 'Fecha de vencimiento (opcional)', { cls: 'full' }) +
        '</div></section>';
    } else if (t === 'manifiestos') {
      h += '<section class="card"><h2>Pedido</h2><div class="grid">' +
        F.num('cantM', 'Cantidad de manifiestos', { v: 10, min: 1, gen: 1 }) +
        F.text('motivo', 'Residuos peligrosos…', { v: 'generados en el predio', list: 'dlMotivo', gen: 1 }) +
        '</div></section>';
    } else if (t === 'ratificacion') {
      h += '<section class="card"><h2>Qué se presenta</h2><div class="grid">' +
        F.sel('quien', 'Ratifica', [['legal', 'El representante legal de la empresa'], ['gh', 'GH Consultora (nota nuestra)']], { gen: 1, cls: 'full' }) +
        F.chk('rat', 'Ratificar las presentaciones previas de la representante técnica', true, { gen: 1, cls: 'full' }) +
        F.chk('mat', 'Adjunto certificado de matrícula profesional', false, { gen: 1, cls: 'full' }) +
        F.chk('est', 'Adjunto estatuto y acta societaria', false, { gen: 1, cls: 'full' }) +
        F.area('extras', 'Otros puntos (uno por línea)', { rows: 3, gen: 1, cls: 'full', ph: 'Ej: Se solicita dar de baja la movilidad dominio ABC 123 por error de tipeo.' }) +
        '</div></section>';
    } else if (t === 'designacion') {
      h += '<section class="card"><h2>Designación</h2><div class="grid">' +
        F.text('prof', 'Profesional designado', { v: 'Bioingeniera Gabriela Hidalgo', gen: 1 }) +
        F.text('mp', 'Matrícula', { v: 'MP 3927', gen: 1 }) +
        F.text('prof2', 'Segundo profesional (opcional)', { v: 'Ing. M. Florencia Palumbo Hidalgo', gen: 1 }) +
        F.text('mp2', 'Matrícula', { v: 'MP 5163', gen: 1 }) +
        F.sel('cuando', 'Desde', [['fecha', 'A partir de la fecha'], ['mes', 'A partir del mes de…']], { gen: 1 }) +
        F.month('desde', 'Mes (si corresponde)', { v: mesISO() }) +
        F.text('org', 'Gestiones ante', { v: 'SECRETARIA DE AMBIENTE Y DESARROLLO SUSTENTABLE', gen: 1, cls: 'full' }) +
        F.text('adj', 'Documentación que se adjunta', { v: 'certificados de CPIESJ y DNI', gen: 1, cls: 'full' }) +
        '</div></section>';
    } else if (t === 'cdf') {
      h += '<section class="card"><h2>Generador</h2><div class="grid">' +
        F.text('gNom', 'Nombre', { list: 'dlGen', cls: 'full', ph: 'Elegí uno guardado o escribí uno nuevo' }) +
        F.text('gDom', 'Domicilio', { cls: 'full' }) + F.text('gDep', 'Departamento – Provincia', {}) +
        F.text('gRes', 'Resolución generador RSU', { v: 'S/D' }) + F.text('gObs', 'Observaciones', { cls: 'full' }) +
        '</div><p class="hint" id="gHint"></p></section>' +
        '<section class="card"><h2>Transportista</h2><div class="grid">' +
        F.text('tNom', 'Razón social', { list: 'dlTra', cls: 'full', ph: 'Elegí uno guardado o escribí uno nuevo' }) +
        F.text('tDom', 'Domicilio', { cls: 'full' }) + F.text('tDep', 'Departamento – Provincia', {}) +
        F.text('tRes', 'N° resolución habilitación (SAyDS)', { v: 'S/D', hint: '<span id="tResHint"></span>' }) +
        F.text('tObs', 'Observaciones', { cls: 'full' }) +
        '</div><p class="hint" id="tHint"></p></section>' +
        '<div id="tarjetas"></div>' +
        '<button class="btn" id="btnMasOT" type="button" style="align-self:flex-start">+ Agregar otra orden de transporte</button>' +
        '<section class="card"><h2>Datos generales del material</h2><div class="grid">' +
        F.text('mForma', 'Forma de recepción', { v: 'CAMIÓN' }) + F.text('mObs', 'Observaciones', {}) +
        F.chk('firma', 'Incluir firma y sello de Reciclados Industriales', true, { cls: 'full' }) +
        '</div></section>';
    }

    if (t === 'nota') {
      h += '<section class="card"><h2>Texto de la nota</h2>' +
        '<div class="grid">' + F.sel('modelo', 'Empezar desde un modelo (opcional)', [['', '— elegir —']].concat(MODELOS.map((m, i) => [String(i), m.n])), { cls: 'full' }) + '</div>' +
        '<textarea id="cuerpo" rows="14" style="margin-top:12px" placeholder="Escribí acá el cuerpo de la nota. Una línea en blanco separa párrafos; las líneas que empiezan con “•” salen como viñetas."></textarea>' +
        '<div class="grid" style="margin-top:12px">' + F.text('cierre', 'Cierre', { v: 'Sin otro particular, saludamos a usted atentamente.', list: 'dlCierre', cls: 'full' }) + '</div></section>';
    } else if (esCarta()) {
      h += '<section class="card"><div class="fila"><h2 style="margin:0">Texto de la nota</h2><button class="linkbtn" id="btnAuto" type="button" hidden>↺ Volver al texto automático</button></div>' +
        '<textarea id="cuerpo" rows="9" style="margin-top:12px"></textarea>' +
        '<p class="hint">Se arma solo con los datos de arriba. Si lo escribís a mano, no se pisa. Línea que empieza con “•” = viñeta.</p></section>';
    }

    if (t === 'ot' || t === 'manifiestos' || t === 'nota') {
      h += '<section class="card"><h2>Comprobante de pago' + (t === 'nota' ? ' (si corresponde)' : '') + '</h2><div id="compBox"></div></section>';
    }
    if (t === 'ratificacion' || t === 'designacion' || t === 'nota') {
      h += '<section class="card"><h2>Anexos</h2><div id="anexBox"></div><p class="hint">Se agregan como páginas al final del PDF, en el orden en que los cargues.</p></section>';
    }

    const segFormato = '<div class="fld full"><span>Formato del archivo</span><div class="seg" id="formato">' +
      [['pdf', 'PDF'], ['docx', 'Word'], ['ambos', 'Word y PDF']].map(x => '<button type="button" data-f="' + x[0] + '" aria-pressed="' + (S.formato === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>';
    if (t === 'cdf') {
      h += '<section class="card"><h2>Guardar</h2><div class="grid">' + segFormato +
        '<label class="fld"><span>Año</span><select id="anioSel"></select></label>' +
        '<label class="fld"><span>Mes</span><select id="mesSel"></select></label>' +
        '<p class="hint full" id="carpetaHint" style="margin:0"></p>' +
        F.chk('regExcel', 'Registrar también en MOVIMIENTOS RI (hoja del mes)', true, { cls: 'full', sub: 'Cada OT va en una fila, con kg, mts y contenedores.' }) +
        F.text('nombreArch', 'Nombre del archivo', { cls: 'full' }) + '</div>' +
        '<div id="avisos"></div><div class="acciones">' +
        '<button class="btn primario" id="btnGuardar" type="button"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>Guardar y registrar</button>' +
        '<button class="btn" id="btnBajar" type="button">Descargar</button></div></section>';
    } else {
      h += '<section class="card"><h2>Guardar</h2><div class="grid">' + segFormato +
        '<label class="fld full"><span>Carpeta en Drive</span><select id="carpeta"></select></label>' +
        F.text('nombreArch', 'Nombre del archivo', { cls: 'full' }) + '</div>' +
        '<div id="avisos"></div><div class="acciones">' +
        '<button class="btn primario" id="btnGuardar" type="button"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>Guardar en la carpeta</button>' +
        '<button class="btn" id="btnBajar" type="button">Descargar</button></div></section>';
    }

    h += '<section class="card"><h2>Últimos generados</h2><div class="hist" id="hist"></div></section>';
    return h;
  }

  /* ------------------------------------------------------------ archivos (adjuntos) */
  function cajaArchivos(cont, multiple, lista, onCambio, etiqueta) {
    const arr = multiple ? lista : (lista ? [lista] : []);
    cont.innerHTML = arr.map((a, i) =>
      '<div class="archivo">' + (a.url ? '<img src="' + a.url + '" alt="">' : '<div class="pdfico">PDF</div>') +
      '<div class="n">' + esc(a.nombre) + '<small>' + a.kb + ' KB</small></div><button type="button" data-q="' + i + '" title="Quitar">×</button></div>').join('') +
      ((multiple || !arr.length) ? '<div class="dropzone" tabindex="0"><b>' + etiqueta + '</b><br>arrastrá, pegá (⌘V) o hacé clic para elegir</div>' +
        '<input type="file" hidden ' + (multiple ? 'multiple ' : '') + 'accept="image/*,application/pdf">' : '');
    const dz = cont.querySelector('.dropzone'), inp = cont.querySelector('input[type=file]');
    const agregar = async files => {
      try {
        const nuevos = [];
        for (const f of files) nuevos.push(await leerArchivo(f));
        onCambio(multiple ? arr.concat(nuevos) : nuevos[0]);
      } catch (e) { toast(e.message); }
    };
    if (dz) {
      dz.onclick = () => inp.click();
      dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); };
      inp.onchange = () => agregar([...inp.files]);
      dz.ondragover = e => { e.preventDefault(); dz.classList.add('sobre'); };
      dz.ondragleave = () => dz.classList.remove('sobre');
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove('sobre'); agregar([...e.dataTransfer.files]); };
    }
    cont.querySelectorAll('button[data-q]').forEach(b => b.onclick = () => {
      const i = +b.dataset.q; onCambio(multiple ? arr.filter((_, k) => k !== i) : null);
    });
  }
  function pintarArchivos() {
    if ($('compBox')) cajaArchivos($('compBox'), false, S.comp, a => { S.comp = a; pintarArchivos(); cambioGen(); }, 'Comprobante de pago (imagen o PDF)');
    if ($('anexBox')) cajaArchivos($('anexBox'), true, S.anexos, a => { S.anexos = a; pintarArchivos(); pedirRender(); }, 'Agregar anexos (imagen o PDF)');
  }

  /* ------------------------------------------------------------ texto automático */
  function apertura() { return val('persona') === 'yo' ? 'Tengo el agrado de dirigirme a Ud. con el fin de' : 'Nos dirigimos a Usted, con el fin de'; }
  function cierreCarta() { if (S.tipo === 'nota') return val('cierre'); return val('persona') === 'yo' ? 'Sin otro particular, saludo a Ud. atte.' : 'Sin otro particular saludamos atte.'; }
  const num = id => { const n = parseFloat(String(val(id)).replace(',', '.')); return isFinite(n) ? n : 0; };

  function textoAuto() {
    const t = S.tipo, comp = S.comp ? '\n\nSe adjunta comprobante de pago.' : '';
    if (t === 'ot') {
      const p = num('cantP'), r = num('cantR'), partes = [];
      if (p > 0) partes.push(p + ' órdenes tipo “P”');
      if (r > 0) partes.push(r + ' órdenes tipo “R”');
      return apertura() + ' solicitar un talonario de ' + (partes.join(' y ') || '…') +
        (val('transp') ? ' para realizar el transporte de residuos sólidos urbanos asimilables a domiciliarios' : '') + '.' + comp;
    }
    if (t === 'manifiestos') {
      const n = num('cantM');
      return apertura() + ' solicitar ' + n + ' manifiestos para realizar el retiro de residuos peligrosos ' + (val('motivo') || '…') + '.' + comp;
    }
    if (t === 'ratificacion') {
      const items = [];
      if (val('est')) items.push('Estatuto y acta societaria de la empresa.');
      if (val('mat')) items.push('Certificado de matrícula profesional de la Bioing. Gabriela Hidalgo.');
      String(val('extras')).split('\n').map(x => x.trim()).filter(Boolean).forEach(x => items.push(x));
      const legal = val('quien') === 'legal';
      if (val('rat')) {
        const base = 'las presentaciones previas realizadas en el expediente de referencia por la Bioing. Gabriela Hidalgo, representante técnica de la empresa.';
        if (!items.length) {
          return legal ? 'En carácter de representante legal de la empresa ratifico todas ' + base : 'Nos dirigimos a Usted con el fin de ratificar ' + base;
        }
        items.splice(val('est') ? 1 : 0, 0, legal ? 'En carácter de representante legal de la empresa ratifico todas ' + base : 'Se ratifican ' + base);
      }
      if (!items.length) return '';
      if (items.length === 1) return apertura() + ' presentar en el expediente de referencia la siguiente documentación: ' + items[0].replace(/\.$/, '') + '.';
      return apertura() + ' presentar en el expediente de referencia la siguiente documentación que adjuntamos a esta presentación:\n\n' + items.map(x => '• ' + x).join('\n');
    }
    if (t === 'designacion') {
      const m = /^(\d{4})-(\d{2})/.exec(val('desde') || '');
      const desde = val('cuando') === 'mes' ? 'a partir del mes de ' + (m ? GHPDF.MESES[+m[2] - 1] + ' de ' + m[1] : '…') : 'a partir de la fecha';
      const profes = (val('prof') || '…') + (val('mp') ? ', ' + val('mp') : '') + (val('prof2') ? ' e ' + val('prof2') + (val('mp2') ? ' ' + val('mp2') : '') : '');
      return 'El que suscribe en carácter de representante legal de la empresa ut supra mencionada, tiene el agrado de dirigirse a Ud. a fin de comunicar que ' + desde +
        ' se designa como representante técnica, para realizar cualquier gestión ante la ' + (val('org') || '…') + ' a la ' + profes +
        (val('adj') ? ', se adjuntan ' + val('adj').replace(/^se adjuntan?\s+/i, '').replace(/\.$/, '') : '') + '.';
    }
    return '';
  }

  function cambioGen() {
    if (esCarta() && !S.manual && $('cuerpo')) $('cuerpo').value = textoAuto();
    pedirRender();
  }

  /* ------------------------------------------------------------ empresa / expediente */
  function onEmpresa() {
    const e = empActual();
    S.empSel = val('emp');
    setVal('nombreEmp', e ? e.nombre : '');
    const t = S.tipo;
    const ok = x => t === 'nota' ? true : t === 'ot' ? /tpte.*rsu/i.test(x.tipo) : t === 'manifiestos' ? (/rrpp/i.test(x.tipo) && /gen/i.test(x.tipo)) : true;
    const L = e ? e.expedientes : [];
    const orden = L.filter(ok).concat(L.filter(x => !ok(x)));
    $('dlExp').innerHTML = orden.map(x => '<option value="' + esc(x.exp) + '">' + esc(x.tipo + (x.evaluador ? ' · ' + x.evaluador : '')) + '</option>').join('');
    let pick = t === 'designacion' ? null : (t === 'nota' ? (L.length === 1 ? L[0] : null) : L.filter(ok)[0]);
    setVal('exp', pick ? pick.exp : '');
    if ($('eval')) { setVal('eval', pick ? pick.evaluador : ''); }
    if ($('expHint')) {
      $('expHint').textContent = t === 'nota' ? (pick ? pick.tipo : (L.length ? 'Elegí uno de la lista (' + L.length + ' expedientes); el evaluador se completa solo.' : '')) : e && !pick && (t === 'ot' || t === 'manifiestos')
        ? 'No hay expediente de ' + (t === 'ot' ? 'transporte RSU' : 'generador RRPP') + ' cargado para esta empresa: escribilo.'
        : (pick ? pick.tipo : '');
    }
    cargarCarpetas();
    cambioGen();
  }
  function onExp() {
    const e = empActual(); if (!e) return;
    const x = e.expedientes.find(y => y.exp === val('exp'));
    if (x) { if ($('eval')) setVal('eval', x.evaluador); if ($('expHint')) $('expHint').textContent = x.tipo; }
    cargarCarpetas();
  }

  async function cargarCarpetas() {
    const clave = S.tipo === 'cdf' ? 'RECICLADOS INDUSTRIALES' : val('emp');
    const sel = $('carpeta'); if (!sel) return;
    if (!clave) { sel.innerHTML = '<option value="">Elegí primero la empresa</option>'; return; }
    try {
      const r = await API.get('/api/carpetas?e=' + encodeURIComponent(clave) + '&exp=' + encodeURIComponent(S.tipo === 'cdf' ? '' : val('exp')) + '&tipo=' + S.tipo);
      if (!r.base) { sel.innerHTML = '<option value="">Esta empresa no tiene carpeta en 2 GH GESTIÓN</option>'; return; }
      sel.innerHTML = r.opciones.map(o => {
        const partes = o.split('/'), prof = partes.length - 1;
        return '<option value="' + esc(o) + '"' + (o === r.sugerida ? ' selected' : '') + '>' + '\u00A0\u00A0'.repeat(prof) + esc(partes[partes.length - 1]) + '</option>';
      }).join('');
    } catch (e) { sel.innerHTML = '<option value="">No se pudieron leer las carpetas</option>'; }
  }

  /* ------------------------------------------------------------ tarjetas de material (CDF) */
  const ent = () => S.datos.entidades;
  const catalogoMat = tipo => (ent().materiales || []).find(m => plano(m.tipo) === plano(tipo));
  const kgTxt = n => String(Math.round(n * 100) / 100).replace('.', ',') === 'NaN' ? '' : String(Math.round(n * 100) / 100);

  function pintarTarjetas() {
    const cont = $('tarjetas'); if (!cont) return;
    cont.innerHTML = S.cards.map((c, i) =>
      '<section class="card mcard" data-i="' + i + '"><div class="mhead">' +
      '<h2>Material recibido ' + (S.cards.length > 1 ? '· ' + (i + 1) : '') + '</h2>' +
      '<div class="mbtns">' + (S.cards.length > 1 ? '<button type="button" class="ico" data-del="' + i + '" title="Quitar esta orden">×</button>' : '') +
      '<button type="button" class="ico mas" data-add="' + i + '" title="Agregar otra orden de transporte">+</button></div></div>' +
      '<div class="grid">' +
      '<label class="fld full"><span>N° de orden de transporte</span><input type="text" data-k="ot" value="' + esc(c.ot) + '" inputmode="numeric" autocomplete="off"></label>' +
      '<label class="fld"><span>Material</span><input type="text" data-k="mat" value="' + esc(c.mat) + '" list="dlMat" autocomplete="off" spellcheck="false"></label>' +
      '<label class="fld"><span>Fecha de ingreso</span><input type="date" data-k="fec" value="' + esc(c.fec) + '"></label>' +
      '<label class="fld"><span>Cantidad recibida (kg)</span><input type="number" data-k="kg" value="' + esc(c.kg) + '" min="0" step="any" inputmode="decimal"></label>' +
      '<label class="fld"><span>Mts (m³ del contenedor)</span><input type="number" data-k="mts" value="' + esc(c.mts) + '" min="0" step="any" inputmode="decimal"></label>' +
      '<label class="fld"><span>Cantidad de contenedores</span><input type="text" data-k="cont" value="' + esc(c.cont) + '" list="dlCont" autocomplete="off"></label>' +
      '<label class="fld"><span>Se envió a</span><input type="text" data-k="dest" value="' + esc(c.dest) + '" autocomplete="off"></label>' +
      '</div><p class="hint" style="margin-top:6px">Mts y contenedores van solo al Excel de movimientos, no al certificado.</p></section>').join('');
  }

  function agregarTarjeta(despuesDe) {
    const prev = S.cards[despuesDe == null ? S.cards.length - 1 : despuesDe];
    const nueva = Object.assign(tarjetaVacia(), prev ? { mat: prev.mat, fec: prev.fec, mts: prev.mts, cont: prev.cont, dest: prev.dest, destManual: prev.destManual } : {});
    S.cards.splice((despuesDe == null ? S.cards.length - 1 : despuesDe) + 1, 0, nueva);
    pintarTarjetas(); marcarCambio();
    const nuevas = document.querySelectorAll('.mcard input[data-k="ot"]');
    const i = (despuesDe == null ? S.cards.length - 2 : despuesDe) + 1;
    if (nuevas[i]) nuevas[i].focus();
  }

  function onTarjeta(ev) {
    const el = ev.target, card = el.closest('.mcard'); if (!card || !el.dataset.k) return false;
    const c = S.cards[+card.dataset.i], k = el.dataset.k;
    c[k] = el.value;
    if (k === 'dest') c.destManual = !!el.value.trim();
    if (k === 'mat' && !c.destManual) {
      const m = catalogoMat(el.value);
      if (m) { c.dest = m.destino; const d = card.querySelector('[data-k="dest"]'); if (d) d.value = m.destino; }
    }
    return true;
  }

  // Une las tarjetas en los campos únicos del certificado. Con más de una OT cada dato va en
  // el mismo orden que su N° de OT, separado por guiones (xxxx-xxxx-xxxx). Si un campo es igual
  // en todas las tarjetas (mismo material, mismo destino, misma fecha) se muestra una sola vez.
  function combinar(cards) {
    const lista = f => cards.map(f);
    const uno = arr => (arr.every(x => x === arr[0]) ? [arr[0]] : arr);
    const kg = lista(c => { const n = parseFloat(String(c.kg).replace(',', '.')); return isFinite(n) && n > 0 ? kgTxt(n) : ''; });
    const multi = cards.length > 1;
    return {
      ot: lista(c => String(c.ot).trim() || (multi ? 'S/D' : '')).join('-'),
      tipo: uno(lista(c => String(c.mat).trim().toUpperCase())).join('-'),
      cantidad: kg.some(Boolean) ? kg.map(x => x || '0').join('-') + ' KG' : '',
      ingreso: uno(lista(c => { const f = fechaDe(c.fec); return f ? GHPDF.fechaCorta(f) : ''; })).join('-'),
      reciclado: uno(lista(c => String(c.dest).trim().toUpperCase())).join('-')
    };
  }

  function mesDestino() {
    const fechas = S.cards.map(c => fechaDe(c.fec)).filter(Boolean).sort((a, b) => a - b);
    const base = fechas[0] || fechaDe(val('fecha')) || new Date();
    return { anio: base.getFullYear(), mes: base.getMonth() + 1 };
  }

  function pintarCarpetasCDF(forzar) {
    const sa = $('anioSel'), sm = $('mesSel'); if (!sa) return;
    const info = S.datos.cdf.carpetas;
    const previoA = sa.value, previoM = sm.value;
    const d = mesDestino();
    if (!info.length) { sa.innerHTML = '<option value="">No hay carpetas CDF</option>'; return; }
    const anios = info.map(x => x.anio);
    const anioDef = S.mesManual && previoA ? +previoA : (anios.includes(d.anio) ? d.anio : anios[anios.length - 1]);
    sa.innerHTML = info.map(x => '<option value="' + x.anio + '"' + (x.anio === anioDef ? ' selected' : '') + '>' + esc(x.nombre) + '</option>').join('');
    const reg = info.find(x => x.anio === anioDef);
    const mesDef = S.mesManual && previoM ? +previoM : d.mes;
    sm.innerHTML = MESES_TXT.map((m, i) => {
      const f = reg.meses.find(x => x.num === i + 1);
      return '<option value="' + (i + 1) + '"' + (i + 1 === mesDef ? ' selected' : '') + '>' + esc(cap(m)) + (f ? '' : ' (carpeta nueva)') + '</option>';
    }).join('');
    const exc = $('regExcel');
    if (exc) { exc.disabled = !reg.tiene_excel; if (!reg.tiene_excel) exc.checked = false; }
    const f = reg.meses.find(x => x.num === +sm.value);
    $('carpetaHint').textContent = f ? 'Se guarda en ' + reg.nombre + ' / ' + f.nombre + '.' :
      'La carpeta de ' + MESES_TXT[+sm.value - 1] + ' no existe todavía: al guardar te pregunto si querés crearla.' + (reg.tiene_excel ? '' : ' Tampoco hay Excel de movimientos de ' + reg.anio + '.');
  }

  /* ------------------------------------------------------------ armado del documento */
  function nombreSugerido() {
    const f = fechaDe(val('fecha')) || new Date();
    const mes = cap(GHPDF.MESES[f.getMonth()]), aa = String(f.getFullYear()).slice(2);
    switch (S.tipo) {
      case 'ot': return 'Nota Pedido de OT ' + mes + ' ' + aa;
      case 'manifiestos': return 'Pedido de manifiestos ' + mes + ' ' + aa;
      case 'ratificacion': return 'Ratificación de presentaciones ' + mes + ' ' + aa;
      case 'designacion': return 'Designación representante técnico ' + mes + ' ' + aa;
      case 'nota': return ('Nota ' + (val('ref') ? val('ref') + ' ' : '') + mes + ' ' + aa).replace(/[\\/:*?"<>|]/g, ' ');
      case 'cdf': {
        const c = { tipo: [...new Set(S.cards.map(x => String(x.mat).trim().toUpperCase()).filter(Boolean))].join('-') }, d = mesDestino();
        const g = String(val('gNom')).toUpperCase(), tr = String(val('tNom')).toUpperCase();
        return ('CDF ' + val('numero') + ' ' + c.tipo + ' ' + g + (tr ? ' (' + tr + ')' : '') + ' ' + MESES_TXT[(+($('mesSel') || {}).value || d.mes) - 1] + ' ' + String(+($('anioSel') || {}).value || d.anio).slice(2)).replace(/\s+/g, ' ');
      }
    }
    return 'Documento';
  }

  function parrafosDe(texto) {
    const out = [];
    const esVineta = l => /^\s*[•\-]\s+/.test(l);
    String(texto || '').split(/\n{2,}/).forEach(bloque => {
      let buf = [];
      const volcar = () => { if (buf.length) out.push({ t: 'p', texto: buf.join(' ') }); buf = []; };
      bloque.split('\n').filter(l => l.trim()).forEach(l => {
        if (esVineta(l)) { volcar(); out.push({ t: 'li', texto: l.replace(/^\s*[•\-]\s+/, '') }); }
        else buf.push(l.trim());
      });
      volcar();
    });
    return out;
  }

  // Junta los datos del formulario. No dibuja nada: de ahí salen el PDF y el Word.
  async function armarDatos() {
    const avisos = [], ojos = [];
    const f = fechaDe(val('fecha'));
    if (!f) avisos.push('Falta la fecha.');
    const fecha = f || new Date();

    if (esCarta()) {
      const e = empActual(), t = S.tipo;
      if (!e) avisos.push('Elegí la empresa.');
      if (t !== 'designacion' && t !== 'nota' && !val('exp')) avisos.push('Falta el expediente.');
      if (t === 'nota' && !val('exp')) ojos.push('La nota sale sin número de expediente.');
      if (t !== 'designacion' && t !== 'nota' && !val('eval')) ojos.push('No hay evaluador/a cargado.');
      if (t === 'nota' && /\[[^\]\n]+\]/.test(val('cuerpo'))) ojos.push('Quedan campos entre corchetes [ ] sin completar en el texto.');
      if (t === 'ot' && num('cantP') + num('cantR') <= 0) avisos.push('Indicá cuántas órdenes se piden.');
      if (t === 'manifiestos' && num('cantM') <= 0) avisos.push('Indicá cuántos manifiestos se piden.');
      if ((t === 'designacion' || t === 'nota') && !val('destNombre')) ojos.push('Falta el nombre del destinatario.');
      if ((t === 'ot' || t === 'manifiestos') && !S.comp) ojos.push('No se adjuntó comprobante de pago.');
      if (!String(val('cuerpo')).trim()) avisos.push('El texto de la nota está vacío.');
      const refs = [];
      if (t === 'nota') refs.push(['Ref:', val('ref')]);
      refs.push(['Expte. Nº:', val('exp')]);
      refs.push(['Empresa:', val('nombreEmp')]);
      if (t === 'nota' || t === 'designacion') refs.push(['Cuit:', val('cuit')]);
      if (t === 'nota') refs.push(['Ubicación:', val('ubic')]);
      if (t === 'ot') { refs.push(['N° Registro:', val('nreg')]); refs.push(['N° Res:', val('nres')]); refs.push(['Fecha Venc:', val('fvenc')]); }
      refs.push(['RCA:', val('rca')]);
      if (t === 'designacion') { if (val('rca2')) refs.push(['', val('rca2')]); }
      else refs.push([t === 'nota' && val('etiqEval') !== 'auto' ? val('etiqEval') : generoEval(val('eval')), val('eval')]);
      const logo = e && e.logo ? await cargarLogo(e.clave) : null;
      if (e && e.logo && !logo) ojos.push('No se pudo cargar el logo de la empresa.');
      if (e && !e.logo) ojos.push('Esta empresa no tiene logo cargado: la nota sale sin membrete.');
      const anexos = (t === 'ratificacion' || t === 'designacion' || t === 'nota') ? S.anexos : [];
      const comprobante = (t === 'ot' || t === 'manifiestos' || t === 'nota') ? S.comp : null;
      if (S.formato !== 'pdf') {
        if (comprobante && comprobante.tipo === 'pdf') ojos.push('En Word no entra el comprobante en PDF (en el PDF sí). Subí una imagen o captura si lo querés en Word.');
        if (anexos.some(a => a.tipo === 'pdf')) ojos.push('En Word no entran los anexos en PDF (en el PDF sí).');
      }
      return { kind: 'carta', avisos, ojos, datos: {
        fecha, logo, destinatario: [val('destCargo'), val('destOrg'), val('destNombre')], saludo: val('saludo'), refs,
        parrafos: (t === 'nota' && val('apertura') ? [{ t: 'p', texto: val('apertura'), sangria: false }] : []).concat(parrafosDe(val('cuerpo'))), comprobante, cierre: cierreCarta(), anexos } };
    }

    // ---- CDF
    if (!val('gNom')) avisos.push('Falta el nombre del generador.');
    if (!val('tNom')) avisos.push('Falta el transportista.');
    S.cards.forEach((c, i) => {
      const r = S.cards.length > 1 ? ' (orden ' + (i + 1) + ')' : '';
      if (!String(c.mat).trim()) avisos.push('Falta el material' + r + '.');
      if (!(parseFloat(String(c.kg).replace(',', '.')) > 0)) avisos.push('Falta la cantidad en kg' + r + '.');
      if (!fechaDe(c.fec)) avisos.push('Falta la fecha de ingreso' + r + '.');
      if (!String(c.ot).trim()) ojos.push('Falta el N° de orden de transporte' + r + '.');
      if (!String(c.dest).trim()) ojos.push('Falta el destino del material' + r + '.');
    });
    const dup = S.cards.map(c => String(c.ot).trim()).filter((x, i, a) => x && a.indexOf(x) !== i);
    if (dup.length) ojos.push('Hay N° de OT repetidos: ' + [...new Set(dup)].join(', ') + '.');
    const n = Math.round(+val('numero') || 0);
    if (!(n > 0)) avisos.push('Falta el número de certificado.');
    const cdf = S.datos.cdf;
    $('numHint').textContent = 'Siguiente al último del Excel: ' + cdf.siguiente + (cdf.ultimo_excel ? ' (último cargado: ' + cdf.ultimo_excel + ' en ' + cdf.hoja + ')' : '') + '.';
    if (n > 0 && n < cdf.siguiente) ojos.push('El N° ' + n + ' ya figura como emitido (el siguiente libre es ' + cdf.siguiente + ').');
    if (n > cdf.siguiente) ojos.push('Se saltea el N° ' + cdf.siguiente + '.');
    const U = id => String(val(id)).toUpperCase();
    const c = combinar(S.cards);
    return { kind: 'cdf', avisos, ojos, n, datos: {
      fecha, numero: '0001-00000-' + String(n).padStart(3, '0'),
      generador: { nombre: U('gNom'), domicilio: U('gDom'), depto: U('gDep'), resolucion: val('gRes'), obs: U('gObs') },
      transportista: { nombre: U('tNom'), domicilio: U('tDom'), depto: U('tDep'), orden: c.ot, resolucion: val('tRes'), obs: U('tObs') },
      material: { tipo: c.tipo, cantidad: c.cantidad, forma: U('mForma'), ingreso: c.ingreso, obs: U('mObs') },
      reciclado: c.reciclado,
      membrete: S.datos.membrete,
      logo: await cargarAsset('logo-ri.jpg', 'jpg'),
      firma: val('firma') ? await cargarAsset('firma-ri.png', 'png') : null
    } };
  }

  async function armarPDF(r) {
    const bytes = r.kind === 'carta' ? await GHPDF.generarCarta(r.datos) : await GHPDF.generarCDF(r.datos);
    return bytes;
  }
  async function armarWord(r) {
    return r.kind === 'carta' ? await GHWORD.generarCarta(r.datos) : await GHWORD.generarCDF(r.datos);
  }

  /* ------------------------------------------------------------ vista previa */
  function setEstado(txt, clase) { $('estado').textContent = txt; $('punto').className = 'punto ' + (clase || ''); }
  function pedirRender() {
    clearTimeout(S.timer); setEstado('Actualizando…', 'trab');
    S.timer = setTimeout(render, 350);
  }
  function marcarCambio() { S.guardadoOk = false; pedirRender(); }

  function pintarAvisos(r) {
    let h = r.avisos.map(a => '<div class="aviso mal">' + esc(a) + '</div>').join('') + r.ojos.map(a => '<div class="aviso ojo">' + esc(a) + '</div>').join('');
    if (S.pendienteReg) {
      h += '<div class="aviso mal" style="flex-direction:column;gap:8px"><div>Los archivos ya se guardaron, pero <b>no se registró en el Excel</b>: ' + esc(S.pendienteReg.mensaje) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn chico" type="button" id="btnReReg">Reintentar</button>' +
        (S.pendienteReg.motivo === 'abierto' ? '<button class="btn chico" type="button" id="btnForzarReg">Registrar igual</button>' : '') + '</div></div>';
    }
    $('avisos').innerHTML = h;
    if ($('btnReReg')) $('btnReReg').onclick = () => registrarExcel(false);
    if ($('btnForzarReg')) $('btnForzarReg').onclick = () => registrarExcel(true);
  }

  async function render() {
    const my = ++S.gen;
    try {
      if (!$('nombreArch').dataset.manual) $('nombreArch').value = nombreSugerido();
      if (S.tipo === 'cdf') pintarCarpetasCDF();
      const r = await armarDatos();
      if (my !== S.gen) return;
      const bytes = await armarPDF(r);
      if (my !== S.gen) return;
      S.pdf = { r, bytes };
      if (S.url) URL.revokeObjectURL(S.url);
      S.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      $('visor').src = S.url + '#toolbar=1&navpanes=0';
      $('vacio').style.display = 'none';
      pintarAvisos(r);
      const ok = !r.avisos.length;
      const destinoOk = S.tipo === 'cdf' ? !!$('anioSel').value : !!$('carpeta').value;
      $('btnGuardar').disabled = !ok || !destinoOk || S.guardadoOk; $('btnBajar').disabled = !ok;
      $('btnGuardar').lastChild.textContent = S.guardadoOk ? 'Guardado ✓' : (S.tipo === 'cdf' ? 'Guardar y registrar' : 'Guardar en la carpeta');
      setEstado(ok ? 'Vista previa lista' : 'Faltan datos', ok ? 'ok' : 'mal');
    } catch (e) {
      console.error(e); setEstado('Error al armar el documento: ' + e.message, 'mal');
    }
  }

  /* ------------------------------------------------------------ guardar / descargar */
  const aB64 = bytes => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(new Blob([bytes])); });
  function nombreFinal() { let n = val('nombreArch') || nombreSugerido(); return n.replace(/\.(pdf|docx)$/i, ''); }
  const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

  async function archivosAGenerar() {
    const { r, bytes } = S.pdf, salida = [];
    if (S.formato === 'pdf' || S.formato === 'ambos') salida.push({ ext: 'pdf', bytes });
    if (S.formato === 'docx' || S.formato === 'ambos') salida.push({ ext: 'docx', bytes: (await armarWord(r)).bytes });
    return salida;
  }

  function payloadExcel() {
    const r = S.pdf.r;
    return {
      generador: String(val('gNom')).toUpperCase(), transportista: String(val('tNom')).toUpperCase(), cdf: r.n,
      filas: S.cards.map(c => ({ material: String(c.mat).trim().toUpperCase(), ot: String(c.ot).trim(), fecha: c.fec, kg: String(c.kg).replace(',', '.'), mts: String(c.mts).replace(',', '.'), cont: String(c.cont).trim() }))
    };
  }

  async function registrarExcel(forzar) {
    const reg = S.pendienteReg; if (!reg) return;
    try {
      const res = await API.post('/api/cdf/registrar', { anio: reg.anio, mes: reg.mes, datos: reg.datos, forzar: !!forzar });
      if (!res.ok) { S.pendienteReg = Object.assign(reg, { mensaje: res.mensaje, motivo: res.motivo }); pintarAvisos(S.pdf.r); return; }
      S.pendienteReg = null;
      toast('Registrado en ' + res.hoja + ' (filas ' + res.filas[0] + '–' + res.filas[1] + ')' + (res.creada ? '. Se creó la hoja del mes.' : '.'), 6000);
      await terminarCDF();
    } catch (e) { S.pendienteReg = Object.assign(reg, { mensaje: e.message, motivo: 'error' }); pintarAvisos(S.pdf.r); }
  }

  async function terminarCDF() {
    await refrescarDatos();
    const ult = S.cards[S.cards.length - 1];
    S.cards = [Object.assign(tarjetaVacia(), { mat: ult.mat, dest: ult.dest, destManual: ult.destManual, mts: ult.mts, cont: ult.cont })];
    pintarTarjetas(); setVal('numero', S.datos.cdf.siguiente);
    $('nombreArch').dataset.manual = ''; S.guardadoOk = false; pintarHist(); render();
  }

  async function guardar() {
    const pdf = S.pdf; if (!pdf || pdf.r.avisos.length) return;
    const btn = $('btnGuardar'); btn.disabled = true;
    try {
      let carpeta, anio, mes;
      if (S.tipo === 'cdf') {
        anio = +$('anioSel').value; mes = +$('mesSel').value;
        const reg = S.datos.cdf.carpetas.find(x => x.anio === anio), f = reg.meses.find(x => x.num === mes);
        if (f) carpeta = S.datos.cdf.ruta + '/' + reg.nombre + '/' + f.nombre;
        else {
          if (!window.confirm('La carpeta de ' + cap(MESES_TXT[mes - 1]) + ' ' + anio + ' no existe en ' + reg.nombre + '.\n¿La creo?')) { btn.disabled = false; return; }
          carpeta = (await API.post('/api/cdf/crear-mes', { anio, mes })).rel;
          await refrescarDatos();
        }
      } else carpeta = val('carpeta');
      const meta = { tipo: S.tipo, empresa: S.tipo === 'cdf' ? 'RECICLADOS INDUSTRIALES' : val('emp') };
      if (S.tipo === 'nota') meta.destinatario = { cargo: val('destCargo'), org: val('destOrg'), nombre: val('destNombre') };
      if (S.tipo === 'cdf') {
        const g = pdf.r.datos.generador, t = pdf.r.datos.transportista;
        meta.numero = pdf.r.n;
        meta.generador = { nombre: g.nombre, domicilio: g.domicilio, depto: g.depto, resolucion: g.resolucion };
        meta.transportista = { nombre: t.nombre, domicilio: t.domicilio, depto: t.depto, resolucion: t.resolucion, resolucion_ultima: t.resolucion };
        meta.materiales = S.cards.map(c => ({ tipo: String(c.mat).trim().toUpperCase(), destino: String(c.dest).trim().toUpperCase() }));
      }
      const nombre = nombreFinal();
      const archivos = (await archivosAGenerar()).map(a => ({ nombre, ext: a.ext, datos: null, _b: a.bytes }));
      for (const a of archivos) { a.datos = await aB64(a._b); delete a._b; }
      const res = await API.post('/api/guardar', { carpeta, archivos, meta });
      S.guardadoOk = true;
      toast('Guardado: ' + res.archivos.join(' y ') + '\nen ' + res.carpeta.split('/').slice(-2).join(' / '), 6000);
      if (S.tipo === 'cdf' && $('regExcel').checked) {
        S.pendienteReg = { anio, mes, datos: payloadExcel(), mensaje: '', motivo: '' };
        await registrarExcel(false);
      } else if (S.tipo === 'cdf') { await terminarCDF(); S.guardadoOk = false; }
      else { await refrescarDatos(); pintarHist(); render(); }
    } catch (e) { toast('No se pudo guardar: ' + e.message, 7000); btn.disabled = false; }
  }

  async function descargar() {
    if (!S.pdf || S.pdf.r.avisos.length) return;
    const pref = S.tipo === 'cdf' ? '' : (val('emp') ? val('emp') + ' - ' : '');
    for (const a of await archivosAGenerar()) {
      const url = URL.createObjectURL(new Blob([a.bytes], { type: MIME[a.ext] }));
      const l = document.createElement('a'); l.href = url; l.download = pref + nombreFinal() + '.' + a.ext; l.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  async function refrescarDatos() {
    const d = await API.get('/api/datos'); S.datos = d;
  }
  function pintarHist() {
    const h = $('hist'); if (!h) return;
    const L = S.datos.historial || [];
    h.innerHTML = L.length ? L.map(x => '<div><b>' + esc(x.archivo) + '</b><span>' + esc(x.cuando.slice(5)) + '</span></div>').join('') : 'Todavía no se generó ninguno.';
  }

  /* ------------------------------------------------------------ cableado */
  function pintarTabs() {
    $('tabs').innerHTML = TIPOS.map(t => '<button role="tab" type="button" data-t="' + t.id + '" aria-selected="' + (t.id === S.tipo) + '">' + t.nombre + '</button>').join('');
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.dataset.t !== S.tipo) cambiarTipo(b.dataset.t); });
  }

  function cambiarTipo(t) {
    S.tipo = t; S.manual = false; S.comp = null; S.anexos = []; S.cards = [tarjetaVacia()];
    S.guardadoOk = false; S.pendienteReg = null; S.mesManual = false;
    pintarTabs(); construir();
  }

  function construir() {
    if (S.tipo === 'nota') S.manual = true;
    const col = $('col-form');
    col.innerHTML = formHTML();
    pintarArchivos(); pintarHist(); pintarTarjetas();
    if (esCarta()) { setVal('emp', S.empSel || ''); if (S.empSel) onEmpresa(); else { setVal('nombreEmp', ''); } }
    else { pintarCarpetasCDF(); }
    if ($('cuerpo')) $('cuerpo').value = textoAuto();
    $('btnGuardar').onclick = guardar; $('btnBajar').onclick = descargar;
    $('nombreArch').addEventListener('input', () => { $('nombreArch').dataset.manual = '1'; });
    if ($('btnAuto')) $('btnAuto').onclick = () => { S.manual = false; $('btnAuto').hidden = true; cambioGen(); };
    if ($('btnMasOT')) $('btnMasOT').onclick = () => agregarTarjeta();
    S.gen++; $('visor').removeAttribute('src'); $('vacio').style.display = ''; setEstado('Completá los datos', '');
    if (!esCarta()) render(); else if (S.empSel) render();
    $('btnGuardar').disabled = true; $('btnBajar').disabled = true;
  }

  function delegar() {
    const col = $('col-form');
    col.addEventListener('input', ev => {
      const id = ev.target.id;
      S.guardadoOk = false;
      if (id === 'cuerpo') { S.manual = true; if ($('btnAuto')) $('btnAuto').hidden = false; pedirRender(); return; }
      if (id === 'emp') return;
      if (onTarjeta(ev)) { pedirRender(); return; }
      if (id === 'exp') onExp();
      if (id === 'gNom' || id === 'tNom') autocompletarEntidad(id);
      if (ev.target.dataset.gen) cambioGen(); else pedirRender();
    });
    col.addEventListener('change', ev => {
      const id = ev.target.id;
      S.guardadoOk = false;
      if (id === 'emp') { onEmpresa(); return; }
      if (id === 'carpeta') { pedirRender(); return; }
      if (id === 'destPre') {
        const x = (S.datos.destinatarios || [])[+ev.target.value];
        if (x) { setVal('destCargo', x.cargo); setVal('destOrg', x.org || ''); setVal('destNombre', x.nombre || ''); }
        pedirRender(); return;
      }
      if (id === 'modelo') {
        const m = MODELOS[+ev.target.value];
        if (m && (!$('cuerpo').value.trim() || window.confirm('El texto actual se va a reemplazar por el modelo. ¿Seguimos?'))) { $('cuerpo').value = m.t; S.manual = true; }
        ev.target.value = ''; pedirRender(); return;
      }
      if (id === 'anioSel') { S.mesManual = true; pedirRender(); return; }
      if (id === 'mesSel') { S.mesManual = true; pedirRender(); return; }
      if (ev.target.closest && ev.target.closest('.mcard')) { onTarjeta(ev); pedirRender(); return; }
      if (ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT') { if (ev.target.dataset.gen) cambioGen(); else pedirRender(); }
    });
    col.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.add != null) { agregarTarjeta(+b.dataset.add); return; }
      if (b.dataset.del != null) { S.cards.splice(+b.dataset.del, 1); pintarTarjetas(); marcarCambio(); return; }
      if (b.dataset.f && b.closest('#formato')) {
        S.formato = b.dataset.f;
        try { localStorage.setItem('gh-formato', S.formato); } catch (e) { /* sin storage */ }
        b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
        S.guardadoOk = false; pedirRender();
      }
    });
    document.addEventListener('paste', async ev => {
      const it = [...(ev.clipboardData ? ev.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
      if (!it) return;
      const file = it.getAsFile(); if (!file) return;
      ev.preventDefault();
      try {
        const a = await leerArchivo(new File([file], 'captura pegada.png', { type: file.type }));
        if ($('compBox')) { S.comp = a; pintarArchivos(); cambioGen(); toast('Comprobante pegado.'); }
        else if ($('anexBox')) { S.anexos = S.anexos.concat(a); pintarArchivos(); pedirRender(); toast('Anexo pegado.'); }
      } catch (e) { toast(e.message); }
    });
  }

  function autocompletarEntidad(id) {
    const esG = id === 'gNom';
    const lista = esG ? ent().generadores : ent().transportistas;
    const x = lista.find(y => plano(y.nombre) === plano(val(id)));
    const p = esG ? 'g' : 't';
    if (!x) { $(p + 'Hint') && ($(p + 'Hint').textContent = val(id) ? 'Nuevo: se guarda al generar el certificado para completarse solo la próxima vez.' : ''); return; }
    setVal(p + 'Dom', x.domicilio); setVal(p + 'Dep', x.depto); setVal(p + 'Res', x.resolucion || 'S/D');
    $(p + 'Hint').textContent = 'Datos cargados de ' + x.usos + ' certificado' + (x.usos === 1 ? '' : 's') + ' anterior' + (x.usos === 1 ? '' : 'es') + ' (último: CDF ' + x.ultimo + ').';
    if (!esG) {
      const dif = x.resolucion_ultima && plano(x.resolucion_ultima) !== plano(x.resolucion);
      $('tResHint').textContent = dif ? 'Último CDF con este transportista: “' + x.resolucion_ultima + '”.' : '';
      return;
    }
    // transportistas que suelen trabajar con este generador, primero en la lista
    const pares = (ent().pares || {})[plano(x.nombre)] || [];
    const orden = pares.map(n => ent().transportistas.find(t => t.nombre === n)).filter(Boolean)
      .concat(ent().transportistas.filter(t => !pares.includes(t.nombre)));
    const dl = document.getElementById('dlTra');
    if (dl) dl.innerHTML = orden.map(t => '<option value="' + esc(t.nombre) + '">').join('');
    if (pares.length && !val('tNom')) $('tHint').textContent = 'Suele trabajar con: ' + pares.slice(0, 3).join(', ') + '.';
    const mg = (ent().material_generador || {})[plano(x.nombre)];
    const c0 = S.cards[0];
    if (mg && S.cards.length === 1 && !String(c0.mat).trim()) {
      c0.mat = mg; const m = catalogoMat(mg); if (m && !c0.destManual) c0.dest = m.destino;
      pintarTarjetas();
    }
  }

  async function iniciar() {
    try {
      await refrescarDatos();
      pintarTabs(); construir(); delegar();
    } catch (e) {
      $('col-form').innerHTML = '<div class="card"><div class="aviso mal">No se pudieron cargar los datos: ' + esc(e.message) + '</div><p class="hint">Recargá la página para reintentar.</p></div>';
    }
  }
  GH.entrar().then(iniciar);
})();
