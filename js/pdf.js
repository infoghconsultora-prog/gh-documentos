/* Armado de los PDF. Todo pasa en el navegador con pdf-lib: no hace falta
 * Word ni LibreOffice. Los datos entran ya resueltos (ver app.js). */
(function () {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // pdf-lib solo dibuja lo que entra en WinAnsi; cualquier otra cosa da error.
  const san = s => String(s == null ? '' : s)
    .replace(/[^\u0009\u000A -~ -ÿ–—‘’“”…•€]/g, '?')
    .replace(/\t/g, '    ');

  function fechaLarga(d) { return d.getDate() + ' de ' + cap(MESES[d.getMonth()]) + ' de ' + d.getFullYear(); }
  function fechaCorta(d) {
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  async function fuentes(doc) {
    return {
      r: await doc.embedFont(StandardFonts.TimesRoman),
      b: await doc.embedFont(StandardFonts.TimesRomanBold),
      i: await doc.embedFont(StandardFonts.TimesRomanItalic),
      h: await doc.embedFont(StandardFonts.Helvetica),
      hb: await doc.embedFont(StandardFonts.HelveticaBold)
    };
  }

  function partir(texto, font, size, ancho, ancho1) {
    const out = [];
    let primera = true;
    san(texto).split('\n').forEach(parr => {
      const palabras = parr.split(/ +/).filter(Boolean);
      if (!palabras.length) { out.push({ pal: [], fin: true }); primera = false; return; }
      let act = [];
      let lim = primera && ancho1 != null ? ancho1 : ancho;
      palabras.forEach(p => {
        // palabras que no entran solas (listas tipo 123-456-789): cortar después de cada guion
        if (font.widthOfTextAtSize(p, size) > ancho && /-/.test(p)) {
          if (act.length) { out.push({ pal: act, fin: false }); act = []; lim = ancho; }
          let trozo = '';
          p.split(/(?<=-)/).forEach(seg => {
            if (trozo && font.widthOfTextAtSize(trozo + seg, size) > lim) { out.push({ pal: [trozo], fin: false }); trozo = ''; lim = ancho; }
            trozo += seg;
          });
          act = [trozo];
          return;
        }
        const prueba = act.concat(p).join(' ');
        if (act.length && font.widthOfTextAtSize(prueba, size) > lim) {
          out.push({ pal: act, fin: false });
          act = [p]; lim = ancho;
        } else act.push(p);
      });
      out.push({ pal: act, fin: true });
      primera = false;
    });
    return out;
  }

  async function incrustarImagen(doc, item) {
    if (item.tipo === 'jpg') return doc.embedJpg(item.bytes);
    return doc.embedPng(item.bytes);
  }

  // Dibuja `item` (imagen o PDF) dentro de una caja, centrado horizontalmente.
  async function dibujarAdjunto(doc, page, item, x, yTop, maxW, maxH) {
    let w, h, dibujar;
    if (item.tipo === 'pdf') {
      const [emb] = await doc.embedPdf(item.bytes, [0]);
      w = emb.width; h = emb.height;
      dibujar = (px, py, pw, ph) => page.drawPage(emb, { x: px, y: py, width: pw, height: ph });
    } else {
      const img = await incrustarImagen(doc, item);
      w = img.width; h = img.height;
      dibujar = (px, py, pw, ph) => page.drawImage(img, { x: px, y: py, width: pw, height: ph });
    }
    const k = Math.min(maxW / w, maxH / h, 1);
    const pw = w * k, ph = h * k;
    dibujar(x + (maxW - pw) / 2, yTop - ph, pw, ph);
    return ph;
  }

  async function medirAdjunto(doc, item, maxW, maxH) {
    let w, h;
    if (item.tipo === 'pdf') {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
      const pg = src.getPage(0); w = pg.getWidth(); h = pg.getHeight();
    } else {
      const img = await incrustarImagen(doc, item); w = img.width; h = img.height;
    }
    const k = Math.min(maxW / w, maxH / h, 1);
    return h * k;
  }

  // Paginas de anexo: imagenes en una hoja A4, PDF copiados tal cual.
  async function agregarAnexos(doc, F, anexos) {
    for (const a of anexos || []) {
      if (a.tipo === 'pdf') {
        const src = await PDFDocument.load(a.bytes, { ignoreEncryption: true });
        const pags = await doc.copyPages(src, src.getPageIndices());
        pags.forEach(p => doc.addPage(p));
      } else {
        const page = doc.addPage([595.28, 841.89]);
        const img = await incrustarImagen(doc, a);
        const k = Math.min(495 / img.width, 740 / img.height, 1.6);
        const w = img.width * k, h = img.height * k;
        page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
      }
    }
  }

  /* ------------------------------------------------------------------ cartas
   * d = { fecha:Date, logo:{bytes,tipo}|null, destinatario:[..], saludo:'',
   *       refs:[[etiqueta, valor]], parrafos:[{t:'p'|'li', texto}], comprobante, cierre, anexos } */
  async function generarCarta(d) {
    const doc = await PDFDocument.create();
    const F = await fuentes(doc);
    const W = 595.28, H = 841.89, ML = 64, MR = 64, MT = 54, MB = 56;
    const CW = W - ML - MR;
    const SZ = 12, LH = 15.5;
    let page = doc.addPage([W, H]);
    let y = H - MT;

    const nueva = () => { page = doc.addPage([W, H]); y = H - MT; };
    const asegurar = h => { if (y - h < MB) nueva(); };

    function lineas(texto, font, size, x, ancho, opts) {
      opts = opts || {};
      const lh = opts.lh || LH;
      const ls = partir(texto, font, size, ancho - (opts.sangria || 0), opts.sangria1 ? ancho - (opts.sangria || 0) - opts.sangria1 : null);
      ls.forEach((l, i) => {
        asegurar(lh);
        const indent = i === 0 ? (opts.sangria1 || 0) : 0;
        const base = y - size;
        const txt = l.pal.join(' ');
        const anchoTxt = font.widthOfTextAtSize(txt, size);
        let px = x + (opts.sangria || 0) + indent;
        const disp = ancho - (opts.sangria || 0) - indent;
        if (opts.align === 'right') px = x + ancho - anchoTxt;
        if (opts.align === 'justify' && !l.fin && l.pal.length > 1) {
          const suma = l.pal.reduce((s, p) => s + font.widthOfTextAtSize(p, size), 0);
          const esp = (disp - suma) / (l.pal.length - 1);
          l.pal.forEach(p => {
            page.drawText(p, { x: px, y: base, size, font });
            px += font.widthOfTextAtSize(p, size) + esp;
          });
        } else if (txt) {
          page.drawText(txt, { x: px, y: base, size, font });
        }
        y -= lh;
      });
    }

    // logo
    if (d.logo) {
      const img = await incrustarImagen(doc, d.logo);
      const k = Math.min(170 / img.width, 78 / img.height);
      const w = img.width * k, h = img.height * k;
      page.drawImage(img, { x: ML, y: y - h, width: w, height: h });
      y -= h + 10;
    } else y -= 26;

    // fecha (derecha)
    lineas('San Juan, ' + fechaLarga(d.fecha), F.r, SZ, ML, CW, { align: 'right' });
    y -= 16;

    // destinatario
    d.destinatario.filter(Boolean).forEach(t => lineas(t, F.r, SZ, ML, CW));
    if (d.saludo) lineas(d.saludo, F.r, SZ, ML, CW);
    y -= 12;

    // referencias (bloque a la derecha)
    const refs = (d.refs || []).filter(r => r[1]);
    if (refs.length) {
      const textos = refs.map(r => r[0] + ' ' + r[1]);
      const anchoMax = Math.max.apply(null, textos.map(t => F.b.widthOfTextAtSize(san(t), SZ)));
      const bw = Math.min(Math.max(anchoMax + 4, 200), CW - 120);
      const bx = ML + CW - bw;
      refs.forEach(r => {
        const etiqueta = san(r[0]);
        const valor = san(r[1]);
        asegurar(LH);
        const anchoE = etiqueta ? F.b.widthOfTextAtSize(etiqueta, SZ) + 4 : 0;
        const ls = partir(valor, F.b, SZ, bw - anchoE);
        ls.forEach((l, i) => {
          asegurar(LH);
          if (i === 0) page.drawText(etiqueta, { x: bx, y: y - SZ, size: SZ, font: F.b });
          page.drawText(l.pal.join(' '), { x: bx + (i === 0 ? anchoE : anchoE), y: y - SZ, size: SZ, font: F.b });
          y -= LH;
        });
      });
      y -= 14;
    }

    // cuerpo
    (d.parrafos || []).forEach((p, idx) => {
      if (p.t === 'li') {
        asegurar(LH);
        const yy = y;
        page.drawText('•', { x: ML + 14, y: yy - SZ, size: SZ, font: F.r });
        lineas(p.texto, F.r, SZ, ML, CW, { align: 'justify', sangria: 32 });
        y -= 3;
      } else {
        lineas(p.texto, F.r, SZ, ML, CW, { align: 'justify', sangria1: p.sangria === false ? 0 : 36 });
        y -= 8;
      }
    });

    // comprobante embebido: se achica para entrar en la hoja si queda lugar razonable
    if (d.comprobante) {
      const maxW = Math.min(CW * 0.72, 380);
      let libre = y - MB - 90;
      if (libre < 220) { nueva(); libre = y - MB - 90; }
      y -= 6;
      const ph = await dibujarAdjunto(doc, page, d.comprobante, ML + (CW - maxW) / 2, y, maxW, Math.min(380, libre));
      y -= ph + 14;
    }

    // cierre
    y -= 8;
    asegurar(LH * 3);
    lineas(d.cierre, F.r, SZ, ML, CW, { align: 'right' });

    await agregarAnexos(doc, F, d.anexos);
    return doc.save();
  }

  /* ------------------------------------------------------------------ CDF
   * d = { fecha:Date, numero:'0001-00000-725', generador:{nombre,domicilio,depto,resolucion,obs},
   *       transportista:{nombre,domicilio,depto,orden,resolucion,obs},
   *       material:{tipo,cantidad,forma,ingreso,obs}, reciclado, logo, firma } */
  // Si con mucho contenido (muchas OT) se pasa de una hoja, se reintenta en modo compacto.
  async function generarCDF(d) {
    const normal = await cdfInterno(d, false);
    const n = (await PDFDocument.load(normal)).getPageCount();
    return n > 1 ? cdfInterno(d, true) : normal;
  }

  async function cdfInterno(d, compacto) {
    const K = compacto ? 0.6 : 1;
    const doc = await PDFDocument.create();
    const F = await fuentes(doc);
    const W = 612, H = 792, M = 34;
    let page = doc.addPage([W, H]);
    const CW = W - 2 * M;
    const negro = rgb(0, 0, 0), gris = rgb(0.95, 0.95, 0.95), tinta = rgb(0.16, 0.16, 0.16);
    let y = H - (compacto ? 22 : 28);

    // encabezado
    let logoW = 0;
    if (d.logo) {
      const img = await incrustarImagen(doc, d.logo);
      const k = Math.min(96 / img.width, (compacto ? 70 : 106) / img.height) * (compacto ? 0.8 : 1);
      logoW = img.width * k;
      page.drawImage(img, { x: W - M - logoW, y: y - img.height * k + 4, width: logoW, height: img.height * k });
    }
    const anchoTxt = CW - logoW - 14;
    page.drawText(d.membrete.nombre, { x: M, y: y - 16, size: 19, font: F.hb, color: tinta });
    y -= 28;
    const dir = d.membrete.dir;
    partir(dir, F.hb, 8.6, anchoTxt).forEach(l => {
      page.drawText(l.pal.join(' '), { x: M, y: y - 9, size: 8.6, font: F.hb, color: tinta });
      y -= 11.5;
    });
    y -= 10 * K;
    page.drawText('CERTIFICADO DE RECEPCIÓN Y OPERACIÓN DE RSU', { x: M, y: y - 18, size: 17.5, font: F.r });
    y -= 34 * K;
    page.drawText('FECHA EMISIÓN: ' + fechaCorta(d.fecha), { x: M + 6, y: y - 12, size: 12.5, font: F.b });
    page.drawText('CERTIFICADO Nº:' + san(d.numero), { x: M + 300, y: y - 12, size: 12.5, font: F.b });
    y -= 28 * K;

    function tabla(titulo, filas) {
      const c1 = CW * 0.46, c2 = CW - c1, PAD = 6;
      // titulo
      const hT = 26;
      if (y - hT - 60 < 20) { page = doc.addPage([W, H]); y = H - 34; }
      page.drawRectangle({ x: M, y: y - hT, width: CW, height: hT, color: gris, borderColor: negro, borderWidth: 1 });
      const tw = F.r.widthOfTextAtSize(san(titulo), 14.5);
      page.drawText(san(titulo), { x: M + (CW - tw) / 2, y: y - hT + 8, size: 14.5, font: F.r });
      y -= hT;
      filas.forEach(f => {
        const fontV = f.negrita ? F.b : F.r;
        const lE = partir(f.etiqueta, F.r, 10.5, c1 - 2 * PAD);
        let szV = 12, lhV = 14;
        let lV = partir(f.valor, fontV, szV, c2 - 2 * PAD);
        if (lV.length > 3) { szV = 10; lhV = 11.5; lV = partir(f.valor, fontV, szV, c2 - 2 * PAD); }
        const n = Math.max(lE.length, lV.length, 1);
        const h = Math.max(compacto ? 18 : 21, Math.max(lE.length * 12.5, lV.length * lhV) + (compacto ? 6 : 10));
        if (y - h < 20) { page = doc.addPage([W, H]); y = H - 34; }
        page.drawRectangle({ x: M, y: y - h, width: c1, height: h, borderColor: negro, borderWidth: 1 });
        page.drawRectangle({ x: M + c1, y: y - h, width: c2, height: h, borderColor: negro, borderWidth: 1 });
        lE.forEach((l, i) => {
          const t = l.pal.join(' ');
          const w = F.r.widthOfTextAtSize(t, 10.5);
          const ty = y - h / 2 + (lE.length * 12.5) / 2 - 10 - i * 12.5 + 3;
          page.drawText(t, { x: M + (c1 - w) / 2, y: ty, size: 10.5, font: F.r, color: rgb(0.2, 0.2, 0.2) });
        });
        lV.forEach((l, i) => {
          const ty = y - h / 2 + (lV.length * lhV) / 2 - szV + 1 - i * lhV;
          page.drawText(l.pal.join(' '), { x: M + c1 + PAD, y: ty, size: szV, font: fontV });
        });
        y -= h;
      });
      y -= 11 * K;
    }

    const g = d.generador, t = d.transportista, m = d.material;
    tabla('DATOS DEL GENERADOR', [
      { etiqueta: 'NOMBRE DEL GENERADOR', valor: g.nombre },
      { etiqueta: 'DOMICILIO', valor: g.domicilio },
      { etiqueta: 'DEPARTAMENTO – PROVINCIA', valor: g.depto },
      { etiqueta: 'RESOLUCIÓN GENERADOR RSU', valor: g.resolucion },
      { etiqueta: 'OBSERVACIONES', valor: g.obs }
    ]);
    tabla('DATOS DEL TRANSPORTISTA', [
      { etiqueta: 'RAZÓN SOCIAL', valor: t.nombre },
      { etiqueta: 'DOMICILIO TRANSPORTISTA', valor: t.domicilio },
      { etiqueta: 'DEPARTAMENTO – PROVINCIA', valor: t.depto },
      { etiqueta: 'Nº ORDEN DE TRANSPORTE', valor: t.orden, negrita: true },
      { etiqueta: 'Nº RESOLUCIÓN HABILITACIÓN DE TRANSPORTE DE RSU DE LA SAYDS', valor: t.resolucion, negrita: true },
      { etiqueta: 'OBSERVACIONES', valor: t.obs }
    ]);
    tabla('INFORMACIÓN DE MATERIAL RECIBIDO', [
      { etiqueta: 'RESIDUO TIPO', valor: m.tipo, negrita: true },
      { etiqueta: 'CANTIDAD RECIBIDA (Peso en Kg.)', valor: m.cantidad, negrita: true },
      { etiqueta: 'FORMA DE RECEPCIÓN', valor: m.forma, negrita: true },
      { etiqueta: 'FECHA DE INGRESO', valor: m.ingreso, negrita: true },
      { etiqueta: 'OBSERVACIONES', valor: m.obs }
    ]);
    tabla('LUGAR DE RECICLADO', [
      { etiqueta: 'SE ENVIÓ A', valor: d.reciclado, negrita: true }
    ]);

    if (d.firma) {
      const img = await incrustarImagen(doc, d.firma);
      const libre = Math.max(y - 16, 40);
      const k = Math.min(150 / img.width, libre / img.height, 1);
      const w = img.width * k, h = img.height * k;
      page.drawImage(img, { x: W - M - w - 6, y: Math.max(y - h - 2, 12), width: w, height: h });
    }
    return doc.save();
  }

  window.GHPDF = { generarCarta, generarCDF, fechaLarga, fechaCorta, MESES };
})();
