/* Versión Word (.docx) de cada documento, armada con docx.js en el navegador.
 * Recibe los mismos datos que js/pdf.js. */
(function () {
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell,
    WidthType, BorderStyle, ShadingType, VerticalAlign, TabStopType, PageBreak, TableLayoutType } = D;
  const PX = 96 / 72; // docx pide pixeles; trabajamos en puntos
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const fechaLarga = d => d.getDate() + ' de ' + cap(MESES[d.getMonth()]) + ' de ' + d.getFullYear();
  const fechaCorta = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();

  // Tamaño en pixeles leyendo el encabezado (sirve en el navegador y en Node).
  function dimsImagen(bytes, tipo) {
    const b = bytes;
    if (tipo === 'png') return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return { w: 600, h: 400 };
  }

  function imagen(item, maxWpt, maxHpt) {
    const d = dimsImagen(item.bytes, item.tipo);
    const k = Math.min(maxWpt / d.w, maxHpt / d.h, 1);
    return new ImageRun({ type: item.tipo === 'png' ? 'png' : 'jpg', data: item.bytes,
      transformation: { width: Math.round(d.w * k * PX), height: Math.round(d.h * k * PX) } });
  }

  const run = (text, o) => new TextRun(Object.assign({ text: String(text == null ? '' : text), font: 'Times New Roman', size: 24 }, o || {}));

  async function generarCarta(d) {
    const hijos = [];
    const omitidos = [];
    const P = (children, o) => new Paragraph(Object.assign({ children }, o || {}));

    if (d.logo) hijos.push(P([imagen(d.logo, 170, 78)], { spacing: { after: 120 } }));
    else hijos.push(P([run('')], { spacing: { after: 360 } }));
    hijos.push(P([run('San Juan, ' + fechaLarga(d.fecha))], { alignment: AlignmentType.RIGHT, spacing: { after: 360 } }));
    d.destinatario.filter(Boolean).forEach(t => hijos.push(P([run(t)])));
    if (d.saludo) hijos.push(P([run(d.saludo)]));
    hijos.push(P([run('')]));
    (d.refs || []).filter(r => r[1]).forEach(r =>
      hijos.push(P([run(r[0] + ' ', { bold: true }), run(r[1], { bold: true })], { indent: { left: 5000 } })));
    hijos.push(P([run('')]));
    (d.parrafos || []).forEach(p => {
      if (p.t === 'li') {
        hijos.push(P([run('•\t' + p.texto)], { alignment: AlignmentType.JUSTIFIED, indent: { left: 640, hanging: 320 }, tabStops: [{ type: TabStopType.LEFT, position: 640 }], spacing: { after: 60 } }));
      } else {
        hijos.push(P([run(p.texto)], { alignment: AlignmentType.JUSTIFIED, indent: p.sangria === false ? undefined : { firstLine: 720 }, spacing: { after: 160 } }));
      }
    });
    if (d.comprobante) {
      if (d.comprobante.tipo === 'pdf') omitidos.push('el comprobante en PDF (subí una imagen o captura para verlo en Word)');
      else hijos.push(P([imagen(d.comprobante, 380, 380)], { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 240 } }));
    }
    hijos.push(P([run(d.cierre)], { alignment: AlignmentType.RIGHT, spacing: { before: 240 } }));
    (d.anexos || []).forEach(a => {
      if (a.tipo === 'pdf') { omitidos.push('el anexo PDF "' + (a.nombre || '') + '"'); return; }
      hijos.push(P([new PageBreak()]));
      hijos.push(P([imagen(a, 495, 700)], { alignment: AlignmentType.CENTER }));
    });

    const doc = new Document({
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1280, right: 1280 } } }, children: hijos }]
    });
    return { bytes: new Uint8Array(await Packer.toArrayBuffer(doc)), omitidos };
  }

  /* ------------------------------------------------------------ CDF */
  const LINEA = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const BORDES = { top: LINEA, bottom: LINEA, left: LINEA, right: LINEA };
  const SIN = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const SINBORDES = { top: SIN, bottom: SIN, left: SIN, right: SIN };

  async function generarCDF(d) {
    const TOTAL = 10800, C1 = Math.round(TOTAL * 0.46), C2 = TOTAL - C1;
    const arial = (text, o) => new TextRun(Object.assign({ text, font: 'Arial', size: 17, bold: true }, o || {}));
    const hijos = [];

    const dir = d.membrete.dir;
    const celdaIzq = new TableCell({
      borders: SINBORDES, width: { size: 8300, type: WidthType.DXA },
      children: [new Paragraph({ children: [arial(d.membrete.nombre, { size: 38 })], spacing: { after: 60 } }), new Paragraph({ children: [arial(dir)] })]
    });
    const celdaDer = new TableCell({
      borders: SINBORDES, width: { size: 2500, type: WidthType.DXA },
      children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: d.logo ? [imagen(d.logo, 96, 106)] : [] })]
    });
    hijos.push(new Table({ width: { size: TOTAL, type: WidthType.DXA }, columnWidths: [8300, 2500], borders: { top: SIN, bottom: SIN, left: SIN, right: SIN, insideHorizontal: SIN, insideVertical: SIN }, rows: [new TableRow({ children: [celdaIzq, celdaDer] })] }));
    hijos.push(new Paragraph({ children: [run('CERTIFICADO DE RECEPCIÓN Y OPERACIÓN DE RSU', { size: 35 })], spacing: { before: 120, after: 240 } }));
    hijos.push(new Paragraph({
      tabStops: [{ type: TabStopType.LEFT, position: 6000 }], spacing: { after: 280 },
      children: [run('FECHA EMISIÓN: ' + fechaCorta(d.fecha), { bold: true, size: 25 }), run('\tCERTIFICADO Nº:' + d.numero, { bold: true, size: 25 })]
    }));

    const tabla = (titulo, filas) => {
      const rows = [new TableRow({
        children: [new TableCell({ columnSpan: 2, borders: BORDES, shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' }, verticalAlign: VerticalAlign.CENTER,
          width: { size: TOTAL, type: WidthType.DXA }, margins: { top: 60, bottom: 60 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(titulo, { size: 29 })] })] })]
      })];
      filas.forEach(f => rows.push(new TableRow({
        children: [
          new TableCell({ borders: BORDES, width: { size: C1, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 50, bottom: 50, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(f.etiqueta, { size: 21, color: '333333' })] })] }),
          new TableCell({ borders: BORDES, width: { size: C2, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 50, bottom: 50, left: 100, right: 100 },
            children: [new Paragraph({ children: [run(f.valor || '', { size: 24, bold: !!f.negrita })] })] })
        ]
      })));
      hijos.push(new Table({ width: { size: TOTAL, type: WidthType.DXA }, columnWidths: [C1, C2], layout: TableLayoutType.FIXED, rows }));
      hijos.push(new Paragraph({ children: [run('', { size: 10 })], spacing: { after: 120 } }));
    };

    const g = d.generador, t = d.transportista, m = d.material;
    tabla('DATOS DEL GENERADOR', [
      { etiqueta: 'NOMBRE DEL GENERADOR', valor: g.nombre }, { etiqueta: 'DOMICILIO', valor: g.domicilio },
      { etiqueta: 'DEPARTAMENTO – PROVINCIA', valor: g.depto }, { etiqueta: 'RESOLUCIÓN GENERADOR RSU', valor: g.resolucion },
      { etiqueta: 'OBSERVACIONES', valor: g.obs }]);
    tabla('DATOS DEL TRANSPORTISTA', [
      { etiqueta: 'RAZÓN SOCIAL', valor: t.nombre }, { etiqueta: 'DOMICILIO TRANSPORTISTA', valor: t.domicilio },
      { etiqueta: 'DEPARTAMENTO – PROVINCIA', valor: t.depto }, { etiqueta: 'Nº ORDEN DE TRANSPORTE', valor: t.orden, negrita: true },
      { etiqueta: 'Nº RESOLUCIÓN HABILITACIÓN DE TRANSPORTE DE RSU DE LA SAYDS', valor: t.resolucion, negrita: true },
      { etiqueta: 'OBSERVACIONES', valor: t.obs }]);
    tabla('INFORMACIÓN DE MATERIAL RECIBIDO', [
      { etiqueta: 'RESIDUO TIPO', valor: m.tipo, negrita: true }, { etiqueta: 'CANTIDAD RECIBIDA (Peso en Kg.)', valor: m.cantidad, negrita: true },
      { etiqueta: 'FORMA DE RECEPCIÓN', valor: m.forma, negrita: true }, { etiqueta: 'FECHA DE INGRESO', valor: m.ingreso, negrita: true },
      { etiqueta: 'OBSERVACIONES', valor: m.obs }]);
    tabla('LUGAR DE RECICLADO', [{ etiqueta: 'SE ENVIÓ A', valor: d.reciclado, negrita: true }]);
    if (d.firma) hijos.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [imagen(d.firma, 150, 85)] }));

    const doc = new Document({
      sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 500, bottom: 400, left: 720, right: 720 } } }, children: hijos }]
    });
    return { bytes: new Uint8Array(await Packer.toArrayBuffer(doc)), omitidos: [] };
  }

  window.GHWORD = { generarCarta, generarCDF };
})();
