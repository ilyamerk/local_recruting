/*
 * model.js — Движок расчёта ПЛР (План локального рекрутинга).
 *
 * Реализует формулы из исходной Excel-таблицы «План локального рекрутинга»
 * (листы «ПЛР Ресторан N», «Текучесть и отпуска», «ПЛР Территория»).
 *
 * Соответствие строк Excel:
 *   т/о               -> to        (R4)
 *   SPMH              -> spmh      (R5)  — цель по производительности
 *   TCPH              -> tcph      (R6)  = tx/spmh (можно переопределить)
 *   транзакции        -> tx        (R7)
 *   кадровый резерв   -> reserve   (R8)
 *   плановая текучесть-> из ставок (R9)  = ИТОГО текучести (FTE)
 *   отпуска+больничные-> из ставок (R10) = ИТОГО отпусков (FTE)
 *   часы (SPMH)       = to/spmh          (R11)
 *   часы (TCPH)       = tx/tcph          (R12)
 *   сотрудники SPMH   = часыSPMH/avgLoad (R13)
 *   сотрудники TCPH   = часыTCPH/avgLoad (R14)
 *   всего отраб. часов-> totalHours (R15)
 *   средняя загрузка  -> avgLoad    (R16)
 *   действующие       = totalHours/avgLoad (R17)
 *   ПОТРЕБНОСТЬ       = (сотрSPMH+сотрTCPH)/2 - действующие + отпуска + текучесть + резерв (R18)
 *   ПРИНЯТЬ (обуч.20д)= сдвиг потребности (R19)
 */

(function (global) {
  'use strict';

  const M = 12; // месяцев в году

  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн',
                        'Июл','Авг','Сен','Окт','Ноя','Дек'];

  // Ставки из Excel: Ставка1=1 (100–170 ч/мес), Ставка2=1.5 (>170 ч/мес), Ставка3=0.5 (<100 ч/мес)
  const RATES = [
    { key: 'r05', label: '0,5 ставки', hint: 'менее 100 ч/мес', weight: 0.5 },
    { key: 'r10', label: '1 ставка',   hint: '100–170 ч/мес',   weight: 1.0 },
    { key: 'r15', label: '1,5 ставки', hint: 'более 170 ч/мес',  weight: 1.5 },
  ];

  // --- вспомогательные --------------------------------------------------
  function num(v) {
    if (v === '' || v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  // деление как в Excel, но без #DIV/0!: при нулевом делителе -> 0
  function safeDiv(a, b) {
    a = num(a); b = num(b);
    return b === 0 ? 0 : a / b;
  }
  function arr(a) {
    const out = new Array(M).fill(0);
    if (Array.isArray(a)) for (let i = 0; i < M; i++) out[i] = a[i];
    return out;
  }
  // FTE (ИТОГО) по разбивке ставок: [c05, c10, c15] -> c05*0.5 + c10*1 + c15*1.5
  function rowFTE(counts) {
    if (!Array.isArray(counts)) return 0;
    return RATES.reduce((s, r, i) => s + num(counts[i]) * r.weight, 0);
  }
  // headcount (просто сумма людей)
  function rowHeads(counts) {
    if (!Array.isArray(counts)) return 0;
    return counts.reduce((s, c) => s + num(c), 0);
  }
  // FTE по месяцам для категории текучести/отпусков/действующих
  function monthlyFTE(matrix) {
    const out = new Array(M).fill(0);
    for (let m = 0; m < M; m++) out[m] = rowFTE(matrix && matrix[m]);
    return out;
  }
  function monthlyHeads(matrix) {
    const out = new Array(M).fill(0);
    for (let m = 0; m < M; m++) out[m] = rowHeads(matrix && matrix[m]);
    return out;
  }

  /**
   * Расчёт одного ресторана.
   * @param {object} r  состояние ресторана { plr, turnover }
   * @returns {object}  вычисленные ряды (по 12 месяцев)
   */
  function computeRestaurant(r) {
    r = r || {};
    const p = r.plr || {};
    const t = r.turnover || {};

    const to        = arr(p.to);
    const spmh      = arr(p.spmh);
    const tx        = arr(p.tx);
    const reserve   = arr(p.reserve);
    const totalHours= arr(p.totalHours);
    const avgLoad   = arr(p.avgLoad);
    const tcphOv    = Array.isArray(p.tcph) ? p.tcph : new Array(M).fill('');

    const leavingFTE  = monthlyFTE(t.leaving);
    const vacationFTE = monthlyFTE(t.vacation);
    const activeFTE   = monthlyFTE(t.active);
    const leavingHeads  = monthlyHeads(t.leaving);
    const vacationHeads = monthlyHeads(t.vacation);
    const activeHeads   = monthlyHeads(t.active);

    const out = {
      to, spmh, tx, reserve, totalHours, avgLoad,
      tcph: new Array(M).fill(0),
      hoursSpmh: new Array(M).fill(0),
      hoursTcph: new Array(M).fill(0),
      empSpmh: new Array(M).fill(0),
      empTcph: new Array(M).fill(0),
      empCurrent: new Array(M).fill(0),
      turnover: leavingFTE,   // R9  (FTE)
      vacation: vacationFTE,  // R10 (FTE)
      active: activeFTE,
      leavingHeads, vacationHeads, activeHeads,
      need: new Array(M).fill(0),
      hire: new Array(M).fill(0),
    };

    for (let m = 0; m < M; m++) {
      // R6: TCPH = tx/spmh, либо ручное переопределение
      const ov = tcphOv[m];
      const tcph = (ov !== '' && ov !== null && ov !== undefined)
        ? num(ov)
        : safeDiv(tx[m], spmh[m]);
      out.tcph[m] = tcph;

      out.hoursSpmh[m]  = safeDiv(to[m], spmh[m]);          // R11
      out.hoursTcph[m]  = safeDiv(tx[m], tcph);             // R12
      out.empSpmh[m]    = safeDiv(out.hoursSpmh[m], avgLoad[m]); // R13
      out.empTcph[m]    = safeDiv(out.hoursTcph[m], avgLoad[m]); // R14
      out.empCurrent[m] = safeDiv(totalHours[m], avgLoad[m]);    // R17

      // R18: ПОТРЕБНОСТЬ
      out.need[m] = (out.empSpmh[m] + out.empTcph[m]) / 2
        - out.empCurrent[m]
        + vacationFTE[m] + leavingFTE[m] + num(reserve[m]);
    }

    // R19: ПРИНЯТЬ (с учётом обучения ~20 дней) — сдвиг потребности на месяц вперёд.
    //   Январь = потр.(янв) + потр.(фев);  далее = потр. следующего месяца;
    //   Декабрь = планируется по данным января след. года (ручной ввод).
    for (let m = 0; m < M; m++) {
      if (m === 0) out.hire[0] = out.need[0] + out.need[1];
      else if (m < M - 1) out.hire[m] = out.need[m + 1];
      else out.hire[M - 1] = num(p.hireNextJan);
    }

    return out;
  }

  /**
   * Агрегация «Территория» = поэлементная сумма ресторанов, как в исходном листе.
   * Потребность и Принять пересчитываются из агрегированных значений (эквивалентно
   * сумме, т.к. формула линейна).
   */
  function computeTerritory(restaurantOutputs, hireNextJan) {
    const sum = () => new Array(M).fill(0);
    const T = {
      to: sum(), tx: sum(), reserve: sum(),
      empSpmh: sum(), empTcph: sum(), empCurrent: sum(),
      hoursSpmh: sum(), hoursTcph: sum(),
      turnover: sum(), vacation: sum(), active: sum(),
      need: sum(), hire: sum(),
    };
    const keysToSum = ['to','tx','reserve','empSpmh','empTcph','empCurrent',
                       'hoursSpmh','hoursTcph','turnover','vacation','active'];
    restaurantOutputs.forEach((o) => {
      for (const k of keysToSum) for (let m = 0; m < M; m++) T[k][m] += num(o[k][m]);
    });
    for (let m = 0; m < M; m++) {
      T.need[m] = (T.empSpmh[m] + T.empTcph[m]) / 2
        - T.empCurrent[m] + T.vacation[m] + T.turnover[m] + T.reserve[m];
    }
    for (let m = 0; m < M; m++) {
      if (m === 0) T.hire[0] = T.need[0] + T.need[1];
      else if (m < M - 1) T.hire[m] = T.need[m + 1];
      else T.hire[M - 1] = num(hireNextJan);
    }
    return T;
  }

  const API = {
    M, MONTHS, MONTHS_SHORT, RATES,
    num, safeDiv, rowFTE, rowHeads,
    computeRestaurant, computeTerritory,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.PLR = API;
})(typeof window !== 'undefined' ? window : globalThis);
