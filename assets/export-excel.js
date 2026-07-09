/*
 * export-excel.js — экспорт результата в Excel.
 * Генерирует многолистовой Excel-файл в формате SpreadsheetML 2003 (.xls),
 * который открывается в Microsoft Excel, LibreOffice и Google Таблицах.
 * Без внешних библиотек.
 */
(function (global) {
  'use strict';

  const { M, MONTHS_SHORT, RATES, num } = PLR;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Ячейка: number|''|string -> XML <Cell>
  function cell(value, styleId, forceText) {
    const st = styleId ? ' ss:StyleID="' + styleId + '"' : '';
    if (value === '' || value === null || value === undefined) return '<Cell' + st + '/>';
    if (!forceText && typeof value === 'number' && isFinite(value)) {
      return '<Cell' + st + '><Data ss:Type="Number">' + value + '</Data></Cell>';
    }
    return '<Cell' + st + '><Data ss:Type="String">' + esc(value) + '</Data></Cell>';
  }

  function row(cells) { return '<Row>' + cells.join('') + '</Row>'; }

  // строка-заголовок таблицы: «Показатель | Янв..Дек»
  function headerRow() {
    const c = [cell('Показатель', 'hdr', true)];
    for (let m = 0; m < M; m++) c.push(cell(MONTHS_SHORT[m], 'hdr', true));
    return row(c);
  }
  // строка-раздел на всю ширину
  function sectionRow(title) {
    const c = [cell(title, 'sect', true)];
    for (let m = 0; m < M; m++) c.push(cell('', 'sect'));
    return row(c);
  }
  // строка данных: подпись + 12 значений с общим стилем
  function dataRow(label, values, styleId, round) {
    const c = [cell(label, 'lbl', true)];
    for (let m = 0; m < M; m++) {
      let v = values[m];
      v = (v === '' || v === null || v === undefined) ? '' : num(v);
      if (v !== '' && round !== undefined) v = Math.round(v * Math.pow(10, round)) / Math.pow(10, round);
      c.push(cell(v, styleId));
    }
    return row(c);
  }

  // лист ПЛР по вычисленным данным out
  function plrSheet(name, out, opts) {
    opts = opts || {};
    const rows = [];
    rows.push(headerRow());
    if (!opts.aggregate) {
      rows.push(sectionRow('Прогноз и цели'));
      rows.push(dataRow('Планируемый т/о, ₽', out.to, 'int'));
      rows.push(dataRow('Цель по производительности SPMH', out.spmh, 'int'));
      rows.push(dataRow('Плановое кол-во транзакций / мес', out.tx, 'int'));
      rows.push(dataRow('Цель по продуктивности TCPH', out.tcph, 'emp', 1));
      rows.push(sectionRow('Персонал и часы'));
      rows.push(dataRow('Кадровый резерв, чел', out.reserve, 'emp', 1));
      rows.push(dataRow('Всего отработанных часов', out.totalHours, 'int'));
      rows.push(dataRow('Средняя загрузка по часам', out.avgLoad, 'int'));
    } else {
      rows.push(sectionRow('Исходные (сумма)'));
      rows.push(dataRow('Планируемый т/о, ₽', out.to, 'int'));
      rows.push(dataRow('Транзакций / мес', out.tx, 'int'));
      rows.push(dataRow('Кадровый резерв, чел', out.reserve, 'emp', 1));
    }
    rows.push(dataRow('Плановая текучесть (FTE)', out.turnover, 'cEmp', 1));
    rows.push(dataRow('Отпуска + больничные (FTE)', out.vacation, 'cEmp', 1));
    rows.push(sectionRow('Расчёт'));
    rows.push(dataRow('Необходимо часов (SPMH)', out.hoursSpmh, 'cInt', 0));
    rows.push(dataRow('Необходимо часов (TCPH)', out.hoursTcph, 'cInt', 0));
    rows.push(dataRow('Сотрудников по SPMH', out.empSpmh, 'cEmp', 1));
    rows.push(dataRow('Сотрудников по TCPH', out.empTcph, 'cEmp', 1));
    rows.push(dataRow('Действующих сотрудников', out.empCurrent, 'cEmp', 1));
    rows.push(sectionRow('Результат'));
    rows.push(dataRow('Потребность, чел', out.need, 'rEmp', 1));
    rows.push(dataRow('Необходимо принять (обучение 20 дн)', out.hire, 'rEmp', 1));

    // блоки текучести/отпусков по ставкам (для ресторана)
    if (!opts.aggregate && opts.turnoverData) {
      const cats = [
        ['Действующие сотрудники', 'active'],
        ['Плановая текучесть (под увольнение)', 'leaving'],
        ['Отпуска + длительные больничные', 'vacation'],
      ];
      cats.forEach(([title, key]) => {
        rows.push(row([cell('', 'lbl')]));
        rows.push(sectionRow(title + ' — разбивка по ставкам'));
        const hd = [cell('Ставка \\ месяц', 'hdr', true)];
        for (let m = 0; m < M; m++) hd.push(cell(MONTHS_SHORT[m], 'hdr', true));
        rows.push(row(hd));
        RATES.forEach((rt, ri) => {
          const vals = [];
          for (let m = 0; m < M; m++) vals[m] = num(opts.turnoverData[key][m][ri]) || '';
          rows.push(dataRow(rt.label + ' (' + rt.hint + ')', vals, 'emp', 1));
        });
        const fte = [];
        for (let m = 0; m < M; m++) fte[m] = PLR.rowFTE(opts.turnoverData[key][m]) || '';
        rows.push(dataRow('ИТОГО (FTE)', fte, 'cEmp', 1));
      });
    }

    return '<Worksheet ss:Name="' + esc(name) + '"><Table>' + rows.join('') + '</Table></Worksheet>';
  }

  const STYLES = [
    '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/></Style>',
    '<Style ss:ID="title"><Font ss:Bold="1" ss:Size="13"/></Style>',
    '<Style ss:ID="hdr"><Font ss:Bold="1"/><Alignment ss:Horizontal="Center"/><Interior ss:Color="#E9ECF0" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#C0C6CF"/></Borders></Style>',
    '<Style ss:ID="sect"><Font ss:Bold="1" ss:Color="#5A6473"/><Interior ss:Color="#F2F4F7" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="lbl"><Alignment ss:Horizontal="Left"/></Style>',
    '<Style ss:ID="int"><NumberFormat ss:Format="#,##0"/></Style>',
    '<Style ss:ID="emp"><NumberFormat ss:Format="0.0"/></Style>',
    '<Style ss:ID="cInt"><NumberFormat ss:Format="#,##0"/><Interior ss:Color="#FFF6D9" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="cEmp"><NumberFormat ss:Format="0.0"/><Interior ss:Color="#FFF6D9" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="rEmp"><Font ss:Bold="1"/><NumberFormat ss:Format="0.0"/><Interior ss:Color="#DCECFF" ss:Pattern="Solid"/></Style>',
  ].join('');

  function buildWorkbook(state) {
    const sheets = [];
    const usedNames = {};
    const safeName = (n) => {
      // Excel: имя листа ≤31 символ, без : \ / ? * [ ]
      let s = String(n).replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 28).trim() || 'Лист';
      let base = s, i = 2;
      while (usedNames[s.toLowerCase()]) { s = (base.slice(0, 25) + ' ' + i++); }
      usedNames[s.toLowerCase()] = true;
      return s;
    };

    const outs = state.restaurants.map((r) => PLR.computeRestaurant(r));
    state.restaurants.forEach((r, i) => {
      sheets.push(plrSheet(safeName(r.name || ('Ресторан ' + (i + 1))), outs[i],
        { turnoverData: r.turnover }));
    });
    const hireNextJan = state.restaurants.reduce((s, r) => s + num(r.plr.hireNextJan), 0);
    const T = PLR.computeTerritory(outs, hireNextJan);
    sheets.push(plrSheet(safeName(state.territoryName || 'Территория'), T, { aggregate: true }));

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:html="http://www.w3.org/TR/REC-html40">' +
      '<Styles>' + STYLES + '</Styles>' +
      sheets.join('') +
      '</Workbook>';
  }

  function download(state) {
    const xml = buildWorkbook(state);
    // BOM для корректной кириллицы в Excel
    const blob = new Blob(['﻿', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ПЛР-результат-' + new Date().toISOString().slice(0, 10) + '.xls';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  global.PLRExport = { download, buildWorkbook };
})(typeof window !== 'undefined' ? window : globalThis);
