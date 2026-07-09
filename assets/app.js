/* app.js — интерфейс калькулятора ПЛР. Работает поверх assets/model.js (window.PLR). */
(function () {
  'use strict';

  const { M, MONTHS, MONTHS_SHORT, RATES, num } = PLR;
  const STORAGE_KEY = 'plr_state_v1';
  const $ = (sel, root) => (root || document).querySelector(sel);

  // ---------- форматирование ----------
  const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  function fmt(v, kind) {
    if (v === '' || v === null || v === undefined) return '';
    const n = num(v);
    if (kind === 'int') return nfInt.format(Math.round(n));
    if (kind === 'emp') return nf1.format(n);
    if (kind === 'pct') return nf1.format(n) + '%';
    return nf2.format(n);
  }
  // показывать пусто вместо нулей у авто-строк, если считать не из чего
  const blankZero = (v) => (num(v) === 0 ? '' : v);

  // ---------- состояние ----------
  function emptyMonths() { return new Array(M).fill(''); }
  function emptyRateMatrix() { return Array.from({ length: M }, () => ['', '', '']); }

  function newRestaurant(name) {
    return {
      id: 'r' + Math.random().toString(36).slice(2, 8),
      name: name || 'Ресторан',
      plr: {
        to: emptyMonths(), spmh: emptyMonths(), tx: emptyMonths(), tcph: emptyMonths(),
        reserve: emptyMonths(), totalHours: emptyMonths(), avgLoad: emptyMonths(),
        hireNextJan: '',
      },
      turnover: { active: emptyRateMatrix(), leaving: emptyRateMatrix(), vacation: emptyRateMatrix() },
      sources: defaultSources(),
    };
  }

  function defaultSources() {
    const общие = ['Bitrix', 'Знакомые', 'Бывший сотрудник', 'HH.ru', '«Приведи друга»', 'Реклама в ресторане'];
    const локальные = ['Печатные издания', 'Лайтбокс на ж/д станции', 'Местная газета', 'Местное ТВ', 'Штендер у ресторана'];
    const mk = (name, group) => ({
      id: 's' + Math.random().toString(36).slice(2, 8), name, group,
      cost: emptyMonths(), hired: emptyMonths(), applied: emptyMonths(),
    });
    return [...общие.map((n) => mk(n, 'общие')), ...локальные.map((n) => mk(n, 'локальные'))];
  }

  function defaultState() {
    return {
      territoryName: 'Территория',
      restaurants: [newRestaurant('Ресторан 1'), newRestaurant('Ресторан 2')],
      active: null,     // id ресторана | 'territory'
      sub: 'plr',       // 'plr' | 'turnover' | 'sources'
      sourceMonth: 0,
    };
  }

  function migrate(s) {
    if (!s || !Array.isArray(s.restaurants)) return defaultState();
    s.restaurants.forEach((r) => {
      r.plr = r.plr || {};
      ['to','spmh','tx','tcph','reserve','totalHours','avgLoad'].forEach((k) => {
        if (!Array.isArray(r.plr[k])) r.plr[k] = emptyMonths();
      });
      if (r.plr.hireNextJan === undefined) r.plr.hireNextJan = '';
      r.turnover = r.turnover || {};
      ['active','leaving','vacation'].forEach((k) => {
        if (!Array.isArray(r.turnover[k])) r.turnover[k] = emptyRateMatrix();
      });
      if (!Array.isArray(r.sources)) r.sources = defaultSources();
    });
    if (!s.active) s.active = s.restaurants[0] ? s.restaurants[0].id : 'territory';
    if (!s.sub) s.sub = 'plr';
    if (s.sourceMonth === undefined) s.sourceMonth = 0;
    if (!s.territoryName) s.territoryName = 'Территория';
    return s;
  }

  let state;
  function load() {
    try { state = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (e) { state = defaultState(); }
    if (!state) state = defaultState();
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }, 200);
  }

  function getRestaurant(id) { return state.restaurants.find((r) => r.id === id); }

  // ---------- рендер: вкладки ----------
  function renderTabs() {
    const tabs = $('#tabs');
    tabs.innerHTML = '';
    state.restaurants.forEach((r) => {
      const b = document.createElement('button');
      b.className = 'tab' + (state.active === r.id ? ' active' : '');
      b.textContent = r.name || 'Ресторан';
      b.onclick = () => { state.active = r.id; state.sub = 'plr'; save(); render(); };
      tabs.appendChild(b);
    });
    const add = document.createElement('button');
    add.className = 'tab add';
    add.textContent = '+ ресторан';
    add.onclick = () => {
      const r = newRestaurant('Ресторан ' + (state.restaurants.length + 1));
      state.restaurants.push(r); state.active = r.id; state.sub = 'plr'; save(); render();
    };
    tabs.appendChild(add);

    const terr = document.createElement('button');
    terr.className = 'tab' + (state.active === 'territory' ? ' active' : '');
    terr.textContent = '∑ ' + (state.territoryName || 'Территория');
    terr.onclick = () => { state.active = 'territory'; save(); render(); };
    tabs.appendChild(terr);
  }

  // ---------- рендер: карточка-ячейка ввода ----------
  function inputCell(td, path, idx, kind, keyStr) {
    const inp = document.createElement('input');
    inp.className = 'cell';
    inp.type = 'text';
    inp.inputMode = 'decimal';
    if (keyStr) inp.dataset.key = keyStr;
    inp.value = path.arr[idx] === '' || path.arr[idx] === null || path.arr[idx] === undefined ? '' : path.arr[idx];
    if (path.placeholder) inp.placeholder = path.placeholder(idx);
    inp.addEventListener('input', () => {
      path.arr[idx] = inp.value.trim();
      save();
      path.onChange && path.onChange();
    });
    td.appendChild(inp);
    return inp;
  }

  // ---------- рендер ПЛР ----------
  function renderPLR(container, r, out) {
    const card = el('div', 'card');
    card.appendChild(cardHead(
      'Планирование потребности (ПЛР)',
      'Внесите прогноз т/о, транзакций и целевые SPMH / TCPH. Жёлтые строки считаются автоматически, голубые — итоговый результат.'
    ));

    const legend = el('div', 'legend');
    legend.innerHTML =
      '<span class="chip"><span class="box input"></span>ввод</span>' +
      '<span class="chip"><span class="box calc"></span>авторасчёт</span>' +
      '<span class="chip"><span class="box result"></span>результат</span>';
    card.appendChild(legend);

    const wrap = el('div', 'grid-wrap');
    const table = el('table', 'grid');

    // заголовок
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(th('Показатель', 'rowhead'));
    for (let m = 0; m < M; m++) htr.appendChild(th(MONTHS_SHORT[m]));
    thead.appendChild(htr);
    table.appendChild(thead);

    const tb = document.createElement('tbody');
    const rerender = () => { recomputeAndRefresh(); };

    // строки-вводы
    const inputRow = (label, hint, key, kind, placeholder) => {
      const tr = document.createElement('tr');
      tr.appendChild(rowhead(label, hint));
      for (let m = 0; m < M; m++) {
        const td = document.createElement('td');
        inputCell(td, { arr: r.plr[key], onChange: rerender, placeholder }, m, kind, 'plr:' + key + ':' + m);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    };
    // строки-расчёт (жёлтые)
    const calcRow = (label, hint, values, kind, opts) => {
      opts = opts || {};
      const tr = document.createElement('tr');
      tr.appendChild(rowhead(label, hint));
      for (let m = 0; m < M; m++) {
        const td = el('td', 'calc');
        const span = el('span', 'val');
        const raw = values[m];
        let disp = fmt(blankZero(raw), kind);
        span.textContent = disp;
        if (disp === '') span.classList.add('muted');
        td.appendChild(span);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    };
    // строки-результат (голубые)
    const resultRow = (label, hint, values, kind, editableLast) => {
      const tr = document.createElement('tr');
      tr.appendChild(rowhead(label, hint));
      for (let m = 0; m < M; m++) {
        const td = el('td', 'result');
        if (editableLast && m === M - 1) {
          // декабрь: план набора по данным января следующего года (ручной ввод)
          const inp = document.createElement('input');
          inp.className = 'cell';
          inp.type = 'text';
          inp.inputMode = 'decimal';
          inp.dataset.key = 'plr:hireNextJan';
          inp.value = r.plr.hireNextJan === '' ? '' : r.plr.hireNextJan;
          inp.placeholder = 'план';
          inp.oninput = () => { r.plr.hireNextJan = inp.value.trim(); save(); rerender(); };
          td.appendChild(inp);
        } else {
          const span = el('span', 'val');
          const v = values[m];
          span.textContent = fmt(v, kind);
          if (num(v) < 0) span.classList.add('neg');
          td.appendChild(span);
        }
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    };

    tb.appendChild(sectionRow('Прогноз и цели'));
    inputRow('Планируемый т/о, ₽', 'товарооборот за месяц', 'to', 'int');
    inputRow('Цель по производительности SPMH', 'выручка на 1 чел·час', 'spmh', 'money');
    inputRow('Плановое кол-во транзакций / мес', 'исходя из проходимости и сезонности', 'tx', 'int');
    inputRow('Цель по продуктивности TCPH', 'транзакций на 1 чел·час · пусто = т/о÷SPMH', 'tcph', 'emp',
      (m) => (num(out.tx[m]) && num(out.spmh[m]) ? 'авто ' + nf1.format(PLR.safeDiv(out.tx[m], out.spmh[m])) : ''));

    tb.appendChild(sectionRow('Персонал и часы'));
    inputRow('Кадровый резерв (на развитие), чел', 'сотрудники в кадровом резерве', 'reserve', 'emp');
    inputRow('Всего отработанных часов', 'за месяц по табелю', 'totalHours', 'int');
    inputRow('Средняя загрузка по часам', 'часов на 1 сотрудника', 'avgLoad', 'int');
    calcRow('Плановая текучесть (FTE)', 'из вкладки «Текучесть и отпуска»', out.turnover, 'emp');
    calcRow('Отпуска + больничные (FTE)', 'из вкладки «Текучесть и отпуска»', out.vacation, 'emp');

    tb.appendChild(sectionRow('Расчёт'));
    calcRow('Необходимо часов (SPMH)', '= т/о ÷ SPMH', out.hoursSpmh, 'int');
    calcRow('Необходимо часов (TCPH)', '= транзакции ÷ TCPH', out.hoursTcph, 'int');
    calcRow('Сотрудников по SPMH', '= часы SPMH ÷ ср. загрузка', out.empSpmh, 'emp');
    calcRow('Сотрудников по TCPH', '= часы TCPH ÷ ср. загрузка', out.empTcph, 'emp');
    calcRow('Действующих сотрудников', '= всего часов ÷ ср. загрузка', out.empCurrent, 'emp');

    tb.appendChild(sectionRow('Результат'));
    resultRow('Потребность, чел', '= (SPMH+TCPH)/2 − действующие + отпуска + текучесть + резерв', out.need, 'emp');
    resultRow('Необходимо принять (обучение 20 дн)', 'с учётом опережающего набора', out.hire, 'emp', true);

    table.appendChild(tb);
    wrap.appendChild(table);
    card.appendChild(wrap);

    const note = el('div', 'note');
    note.innerHTML = 'Отрицательная «потребность» (зелёным) означает избыток персонала — набор не требуется. ' +
      'Строка «Необходимо принять» сдвинута на месяц вперёд: набирайте заранее, чтобы к моменту потребности сотрудник уже прошёл обучение (~20 дней). Ячейка декабря — план по данным января следующего года.';
    card.appendChild(note);

    container.appendChild(card);
  }

  // ---------- рендер Текучесть/отпуска ----------
  function renderTurnover(container, r, out) {
    const card = el('div', 'card');
    card.appendChild(cardHead(
      'Текучесть и отпуска',
      'Распределите сотрудников по ставкам. ИТОГО (FTE) = сумма (количество × вес ставки) и автоматически попадает в расчёт ПЛР.'
    ));
    const rerender = () => recomputeAndRefresh();

    const cats = [
      { key: 'active',   title: 'Действующие сотрудники', hint: 'по табелю (справочно)' },
      { key: 'leaving',  title: 'Плановая текучесть (под увольнение)', hint: '→ строка «Плановая текучесть» в ПЛР' },
      { key: 'vacation', title: 'Отпуска + длительные больничные', hint: '→ строка «Отпуска+больничные» в ПЛР' },
    ];

    cats.forEach((cat) => {
      const wrap = el('div', 'grid-wrap');
      const table = el('table', 'grid turn-grid');
      const cap = document.createElement('caption');
      cap.innerHTML = cat.title + ' <span class="val muted" style="font-weight:500">— ' + cat.hint + '</span>';
      table.appendChild(cap);

      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      htr.appendChild(th('Месяц', 'rowhead'));
      RATES.forEach((rt) => htr.appendChild(th(rt.label)));
      htr.appendChild(th('ИТОГО (FTE)'));
      htr.appendChild(th('Чел.'));
      thead.appendChild(htr);
      table.appendChild(thead);

      const tb = document.createElement('tbody');
      for (let m = 0; m < M; m++) {
        const tr = document.createElement('tr');
        tr.appendChild(rowhead(MONTHS[m], ''));
        for (let ri = 0; ri < RATES.length; ri++) {
          const td = document.createElement('td');
          const inp = document.createElement('input');
          inp.className = 'cell'; inp.type = 'text'; inp.inputMode = 'numeric';
          inp.dataset.key = 'turn:' + cat.key + ':' + m + ':' + ri;
          inp.value = r.turnover[cat.key][m][ri] === '' ? '' : r.turnover[cat.key][m][ri];
          inp.oninput = () => { r.turnover[cat.key][m][ri] = inp.value.trim(); save(); rerender(); };
          td.appendChild(inp);
          tr.appendChild(td);
        }
        const fte = PLR.rowFTE(r.turnover[cat.key][m]);
        const heads = PLR.rowHeads(r.turnover[cat.key][m]);
        const tdT = el('td', 'total'); tdT.innerHTML = '<span class="val">' + (fte ? nf1.format(fte) : '') + '</span>';
        const tdH = el('td', 'calc'); tdH.innerHTML = '<span class="val ' + (heads ? '' : 'muted') + '">' + (heads ? nfInt.format(heads) : '') + '</span>';
        tr.appendChild(tdT); tr.appendChild(tdH);
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      wrap.appendChild(table);
      card.appendChild(wrap);
    });

    const note = el('div', 'note');
    note.innerHTML = 'Веса ставок: <code>0,5</code> — менее 100 ч/мес, <code>1</code> — 100–170 ч/мес, <code>1,5</code> — более 170 ч/мес. ' +
      'Летом студенты часто переходят с 0,5 на 1 ставку — учитывайте это при планировании.';
    card.appendChild(note);
    container.appendChild(card);
  }

  // ---------- рендер Источники набора ----------
  function renderSources(container, r) {
    const card = el('div', 'card');
    card.appendChild(cardHead(
      'Источники набора — факт',
      'Внесите фактические затраты, число принятых и обращений по каждому источнику. Метрики за год считаются автоматически.'
    ));

    // панель выбора месяца
    const tb0 = el('div', 'source-toolbar');
    const lbl = el('span'); lbl.textContent = 'Месяц ввода:';
    const sel = document.createElement('select'); sel.className = 'select';
    MONTHS.forEach((mn, i) => { const o = document.createElement('option'); o.value = i; o.textContent = mn; sel.appendChild(o); });
    sel.value = state.sourceMonth;
    sel.onchange = () => { state.sourceMonth = num(sel.value); save(); render(); };
    tb0.appendChild(lbl); tb0.appendChild(sel);
    const addBtn = el('button', 'btn btn-sm'); addBtn.textContent = '+ источник';
    addBtn.onclick = () => {
      r.sources.push({ id: 's' + Math.random().toString(36).slice(2, 8), name: 'Новый источник', group: 'локальные',
        cost: emptyMonths(), hired: emptyMonths(), applied: emptyMonths() });
      save(); render();
    };
    tb0.appendChild(addBtn);
    card.appendChild(tb0);

    const m = state.sourceMonth;
    const wrap = el('div', 'grid-wrap');
    const table = el('table', 'grid');
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(th('Источник — ' + MONTHS[m], 'rowhead'));
    htr.appendChild(th('Затраты, ₽'));
    htr.appendChild(th('Принято'));
    htr.appendChild(th('Обращений'));
    htr.appendChild(th('Год: ₽/принятого'));
    htr.appendChild(th('Год: ₽/обращение'));
    htr.appendChild(th('Год: конверсия'));
    htr.appendChild(th(''));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tb = document.createElement('tbody');

    const groups = ['общие', 'локальные'];
    groups.forEach((g) => {
      const gr = document.createElement('tr');
      const gtd = document.createElement('td'); gtd.colSpan = 8; gtd.className = 'section-row';
      gtd.textContent = g === 'общие' ? 'Общие источники' : 'Локальные источники';
      gr.appendChild(gtd); tb.appendChild(gr);

      r.sources.filter((s) => s.group === g).forEach((s) => {
        const tr = document.createElement('tr');
        // имя
        const tdName = el('td', 'rowhead');
        const ni = document.createElement('input'); ni.className = 'src-name-input'; ni.value = s.name;
        ni.oninput = () => { s.name = ni.value; save(); };
        tdName.appendChild(ni); tr.appendChild(tdName);
        // затраты/принято/обращений (за выбранный месяц)
        ['cost', 'hired', 'applied'].forEach((k) => {
          const td = document.createElement('td');
          const inp = document.createElement('input'); inp.className = 'cell'; inp.type = 'text'; inp.inputMode = 'decimal';
          inp.value = s[k][m] === '' ? '' : s[k][m];
          inp.oninput = () => { s[k][m] = inp.value.trim(); save(); refreshSourceMetrics(s, tr); };
          td.appendChild(inp); tr.appendChild(td);
        });
        // годовые метрики
        tr.appendChild(el('td', 'calc'));
        tr.appendChild(el('td', 'calc'));
        tr.appendChild(el('td', 'calc'));
        refreshSourceMetrics(s, tr);
        // удалить
        const tdDel = document.createElement('td');
        const del = el('button', 'icon-btn'); del.textContent = '✕'; del.title = 'Удалить источник';
        del.onclick = () => { r.sources = r.sources.filter((x) => x.id !== s.id); save(); render(); };
        tdDel.appendChild(del); tr.appendChild(tdDel);
        tb.appendChild(tr);
      });
    });

    table.appendChild(tb);
    wrap.appendChild(table);
    card.appendChild(wrap);
    container.appendChild(card);
  }

  function refreshSourceMetrics(s, tr) {
    const sum = (a) => a.reduce((x, v) => x + num(v), 0);
    const cost = sum(s.cost), hired = sum(s.hired), applied = sum(s.applied);
    const cells = tr.querySelectorAll('td.calc');
    if (cells.length < 3) return;
    cells[0].innerHTML = '<span class="val ' + (hired ? '' : 'muted') + '">' + (hired ? nfInt.format(cost / hired) : '') + '</span>';
    cells[1].innerHTML = '<span class="val ' + (applied ? '' : 'muted') + '">' + (applied ? nfInt.format(cost / applied) : '') + '</span>';
    cells[2].innerHTML = '<span class="val ' + (applied ? '' : 'muted') + '">' + (applied ? nf1.format(hired / applied * 100) + '%' : '') + '</span>';
  }

  // ---------- KPI сводка ----------
  function kpiBlock(out, label) {
    const box = el('div', 'kpis');
    const totalHire = out.hire.reduce((s, v) => s + Math.max(0, num(v)), 0);
    const yearNeed = out.need.reduce((s, v) => s + num(v), 0);
    const totalTo = out.to.reduce((s, v) => s + num(v), 0);
    const peakMonthIdx = out.need.reduce((bi, v, i, a) => (num(v) > num(a[bi]) ? i : bi), 0);
    const kpi = (l, val, sub, accent) => {
      const d = el('div', 'kpi' + (accent ? ' accent' : ''));
      d.innerHTML = '<div class="k-label">' + l + '</div><div class="k-val">' + val + '</div>' +
        (sub ? '<div class="k-sub">' + sub + '</div>' : '');
      return d;
    };
    box.appendChild(kpi('Принять за год', nf1.format(totalHire) + ' чел', 'сумма положительной потребности', true));
    box.appendChild(kpi('Пиковая потребность', nf1.format(num(out.need[peakMonthIdx])) + ' чел', MONTHS[peakMonthIdx]));
    box.appendChild(kpi('Плановый т/о за год', nfInt.format(totalTo) + ' ₽', label));
    box.appendChild(kpi('Годовая потребность', nf1.format(yearNeed) + ' чел', 'сумма по месяцам'));
    return box;
  }

  // ---------- рендер ресторана ----------
  function renderRestaurantView(view, r) {
    const out = PLR.computeRestaurant(r);

    const titleRow = el('div', 'rest-title-row');
    const nameInp = document.createElement('input');
    nameInp.className = 'rest-name-input'; nameInp.value = r.name;
    nameInp.oninput = () => { r.name = nameInp.value; save(); renderTabs(); };
    titleRow.appendChild(nameInp);
    if (state.restaurants.length > 1) {
      const del = el('button', 'btn btn-sm btn-danger'); del.textContent = 'Удалить ресторан';
      del.onclick = () => {
        if (!confirm('Удалить «' + r.name + '»? Данные будут потеряны.')) return;
        state.restaurants = state.restaurants.filter((x) => x.id !== r.id);
        state.active = state.restaurants[0] ? state.restaurants[0].id : 'territory';
        save(); render();
      };
      titleRow.appendChild(del);
    }
    view.appendChild(titleRow);

    view.appendChild(kpiBlock(out, r.name));

    // подвкладки
    const sub = el('div', 'subtabs');
    const subs = [['plr', 'Планирование (ПЛР)'], ['turnover', 'Текучесть и отпуска'], ['sources', 'Источники набора']];
    subs.forEach(([k, lbl]) => {
      const b = el('button', 'subtab' + (state.sub === k ? ' active' : ''));
      b.textContent = lbl;
      b.onclick = () => { state.sub = k; save(); render(); };
      sub.appendChild(b);
    });
    view.appendChild(sub);

    if (state.sub === 'plr') renderPLR(view, r, out);
    else if (state.sub === 'turnover') renderTurnover(view, r, out);
    else renderSources(view, r);
  }

  // ---------- рендер территории ----------
  function renderTerritoryView(view) {
    const outs = state.restaurants.map((r) => PLR.computeRestaurant(r));
    const hireNextJan = state.restaurants.reduce((s, r) => s + num(r.plr.hireNextJan), 0);
    const T = PLR.computeTerritory(outs, hireNextJan);

    const titleRow = el('div', 'rest-title-row');
    const nameInp = document.createElement('input');
    nameInp.className = 'rest-name-input'; nameInp.value = state.territoryName;
    nameInp.oninput = () => { state.territoryName = nameInp.value; save(); renderTabs(); };
    titleRow.appendChild(nameInp);
    const badge = el('span', 'note'); badge.style.padding = '0';
    badge.textContent = 'Σ по ' + state.restaurants.length + ' ресторан(ам) — считается автоматически';
    titleRow.appendChild(badge);
    view.appendChild(titleRow);

    view.appendChild(kpiBlock(T, 'все рестораны'));

    const card = el('div', 'card');
    card.appendChild(cardHead('Сводный ПЛР по территории', 'Поэлементная сумма показателей всех ресторанов.'));
    const wrap = el('div', 'grid-wrap');
    const table = el('table', 'grid');
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(th('Показатель', 'rowhead'));
    for (let m = 0; m < M; m++) htr.appendChild(th(MONTHS_SHORT[m]));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tb = document.createElement('tbody');

    const row = (label, values, kind, cls) => {
      const tr = document.createElement('tr');
      tr.appendChild(rowhead(label, ''));
      for (let m = 0; m < M; m++) {
        const td = el('td', cls || 'calc');
        const span = el('span', 'val');
        span.textContent = fmt(blankZero(values[m]), kind);
        if (num(values[m]) < 0) span.classList.add('neg');
        if (fmt(blankZero(values[m]), kind) === '') span.classList.add('muted');
        td.appendChild(span); tr.appendChild(td);
      }
      tb.appendChild(tr);
    };
    tb.appendChild(sectionRow('Исходные (сумма)'));
    row('Планируемый т/о, ₽', T.to, 'int');
    row('Транзакций / мес', T.tx, 'int');
    row('Кадровый резерв, чел', T.reserve, 'emp');
    row('Плановая текучесть (FTE)', T.turnover, 'emp');
    row('Отпуска + больничные (FTE)', T.vacation, 'emp');
    tb.appendChild(sectionRow('Расчёт (сумма)'));
    row('Необходимо часов (SPMH)', T.hoursSpmh, 'int');
    row('Необходимо часов (TCPH)', T.hoursTcph, 'int');
    row('Сотрудников по SPMH', T.empSpmh, 'emp');
    row('Сотрудников по TCPH', T.empTcph, 'emp');
    row('Действующих сотрудников', T.empCurrent, 'emp');
    tb.appendChild(sectionRow('Результат'));
    row('Потребность, чел', T.need, 'emp', 'result');
    row('Необходимо принять (обучение 20 дн)', T.hire, 'emp', 'result');

    table.appendChild(tb);
    wrap.appendChild(table);
    card.appendChild(wrap);
    view.appendChild(card);
  }

  // ---------- утилиты DOM ----------
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function th(txt, cls) { const e = document.createElement('th'); if (cls) e.className = cls; e.textContent = txt; return e; }
  function rowhead(label, hint) {
    const td = el('td', 'rowhead');
    td.innerHTML = label + (hint ? '<span class="cell-hint">' + hint + '</span>' : '');
    return td;
  }
  function sectionRow(txt) {
    const tr = document.createElement('tr'); tr.className = 'section-row';
    const td = document.createElement('td'); td.colSpan = M + 1; td.textContent = txt;
    tr.appendChild(td); return tr;
  }
  function cardHead(title, sub) {
    const h = el('div', 'card-head');
    const left = el('div');
    left.innerHTML = '<h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '');
    h.appendChild(left);
    return h;
  }

  // ---------- перерисовка только значений (без пересоздания фокуса) ----------
  function recomputeAndRefresh() {
    // Перерисовываем представление (чтобы обновились жёлтые/голубые строки),
    // затем возвращаем фокус и позицию курсора в то же поле по его data-key.
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.key : null;
    const ss = active && 'selectionStart' in active ? active.selectionStart : null;
    const se = active && 'selectionEnd' in active ? active.selectionEnd : null;
    renderView();
    if (key) {
      const next = document.querySelector('input.cell[data-key="' + key + '"]');
      if (next) {
        next.focus();
        if (ss !== null) { try { next.setSelectionRange(ss, se); } catch (e) {} }
      }
    }
  }

  // ---------- основной рендер ----------
  function renderView() {
    const view = $('#view');
    view.innerHTML = '';
    if (state.active === 'territory') renderTerritoryView(view);
    else {
      const r = getRestaurant(state.active) || state.restaurants[0];
      if (!r) { state.active = 'territory'; return renderTerritoryView(view); }
      state.active = r.id;
      renderRestaurantView(view, r);
    }
  }
  function render() { renderTabs(); renderView(); }

  // ---------- инструкция ----------
  const HELP_HTML = `
    <ol>
      <li>Откройте вкладку своего ресторана.</li>
      <li>Внесите прогноз по <b>товарообороту</b> и <b>транзакциям</b> на каждый месяц.</li>
      <li>Задайте целевые <b>SPMH</b> (выручка на чел·час) и <b>TCPH</b> (транзакций на чел·час). Если оставить TCPH пустым — подставится авто-значение <code>т/о ÷ SPMH</code>, как в исходной таблице.</li>
      <li>На вкладке <b>«Текучесть и отпуска»</b> распределите сотрудников по ставкам (0,5 / 1 / 1,5) и внесите планируемые увольнения, отпуска и длительные больничные. ИТОГО (FTE) автоматически попадёт в расчёт.</li>
      <li>На вкладке <b>«Планирование (ПЛР)»</b> внесите кадровый резерв, всего отработанных часов и среднюю загрузку по часам.</li>
      <li><b>Жёлтые</b> строки считаются автоматически. <b>Голубые</b> — итог: «Потребность» показывает нехватку персонала на текущий месяц, «Необходимо принять» — сколько набрать заранее с учётом обучения (~20 дней).</li>
      <li>Вкладка <b>«Источники набора»</b> — учёт факта по каналам: затраты, принято, обращений → стоимость найма и конверсия за год.</li>
      <li>Вкладка <b>«∑ Территория»</b> суммирует все рестораны автоматически.</li>
      <li>Ежемесячно корректируйте данные по факту для точного планирования.</li>
    </ol>
    <h3>Формулы (как в Excel)</h3>
    <ul>
      <li>Необходимо часов (SPMH) = <code>т/о ÷ SPMH</code></li>
      <li>Необходимо часов (TCPH) = <code>транзакции ÷ TCPH</code></li>
      <li>Сотрудников = <code>часы ÷ средняя загрузка</code></li>
      <li>Действующих = <code>всего часов ÷ средняя загрузка</code></li>
      <li>Потребность = <code>(сотр.SPMH + сотр.TCPH)/2 − действующие + отпуска + текучесть + резерв</code></li>
      <li>Необходимо принять = потребность следующего месяца (январь = янв + фев)</li>
    </ul>`;

  // ---------- события шапки ----------
  function bindHeader() {
    $('#btn-help').onclick = () => { $('#help-body').innerHTML = HELP_HTML; $('#help-modal').hidden = false; };
    $('#help-modal').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) $('#help-modal').hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#help-modal').hidden = true; });

    $('#btn-export').onclick = () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'plr-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); URL.revokeObjectURL(a.href);
    };
    $('#btn-import').onclick = () => $('#file-import').click();
    $('#file-import').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { state = migrate(JSON.parse(reader.result)); save(); render(); }
        catch (err) { alert('Не удалось прочитать файл: ' + err.message); }
      };
      reader.readAsText(f);
      e.target.value = '';
    };
    $('#btn-print').onclick = () => window.print();
    $('#btn-reset').onclick = () => {
      if (!confirm('Очистить все данные и вернуть шаблон по умолчанию?')) return;
      state = defaultState(); save(); render();
    };
  }

  // ---------- старт ----------
  load();
  if (!state.active) state.active = state.restaurants[0] ? state.restaurants[0].id : 'territory';
  bindHeader();
  render();
})();
