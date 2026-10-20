(function () {
  'use strict';
  const selectMonths = (months, year) => year === 'all' ? months : months.filter(m => m.period.startsWith(year + '-'));
  const summarize = months => {
    const totals = months.reduce((s, m) => ({bronze:s.bronze + m.bronze, silver:s.silver+m.silver, gold:s.gold + m.gold, quarantine:s.quarantine + m.quarantine, boundary:s.boundary+m.boundary, amountCents:s.amountCents + BigInt(m.amountCents)}), {bronze:0, silver:0, gold:0, quarantine:0, boundary:0, amountCents:0n});
    return {...totals, quarantinePct:totals.bronze ? totals.quarantine / totals.bronze * 100 : 0};
  };
  const publicUrl = 'https://raw.githubusercontent.com/hudaifaahmd/nyc-taxi-public-summary/main/reports/snapshot.json';
  function validateSnapshot(data) {
    if (!data || !Array.isArray(data.months) || !data.months.length || data.months.length > 1200) throw new Error('Invalid report');
    for (const key of ['verifiedOn','evidenceDate']) {
      if (typeof data[key] !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data[key]) || !Number.isFinite(Date.parse(data[key]))) throw new Error('Invalid date');
    }
    let last;
    for (const m of data.months) {
      if (typeof m.period !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(m.period)) throw new Error('Invalid month');
      const ordinal = Number(m.period.slice(0,4)) * 12 + Number(m.period.slice(5));
      if (last !== undefined && ordinal !== last + 1) throw new Error('Invalid coverage');
      last = ordinal;
      for (const key of ['bronze','silver','gold','quarantine','boundary']) {
        if (!Number.isSafeInteger(m[key]) || m[key] < 0) throw new Error('Invalid count');
      }
      if (!m.bronze || m.bronze !== m.silver + m.quarantine || m.silver !== m.gold || m.boundary > m.silver) throw new Error('Counts do not reconcile');
      if (typeof m.amountCents !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(m.amountCents) || BigInt(m.amountCents) > 9007199254740991n) throw new Error('Invalid cents');
    }
    if (data.generatedAtUtc && (!Number.isFinite(Date.parse(data.generatedAtUtc)) || !Number.isFinite(Date.parse(data.evidenceThroughUtc)) || Date.parse(data.generatedAtUtc) < Date.parse(data.evidenceThroughUtc))) throw new Error('Invalid evidence time');
    return data;
  }
  async function loadSnapshot(fetcher, config) {
    async function read(url) {
      const response = await fetcher(url, {credentials:'omit',cache:'no-cache',redirect:'error',referrerPolicy:'no-referrer'});
      if (!response.ok) throw new Error('Report unavailable');
      const text = await response.text();
      if (text.length > 262144) throw new Error('Report too large');
      return validateSnapshot(JSON.parse(text));
    }
    let unavailable = false;
    if (config.enabled && config.url === publicUrl) {
      try {
        const data = await read(config.url);
        if (data.schemaVersion !== 1 || !data.generatedAtUtc || !data.evidenceThroughUtc) throw new Error('Unsupported published contract');
        return {data,source:'published',unavailable:false};
      } catch (_) { unavailable = true; }
    }
    return {data:await read('/assets/project-code/snapshot.json'),source:'bundled',unavailable};
  }
  if (typeof module !== 'undefined') module.exports = { selectMonths, summarize, validateSnapshot, loadSnapshot };
  if (typeof document === 'undefined') return;
  window.TaxiReport = {loadSnapshot,validateSnapshot};
  const control = document.getElementById('taxi-year');
  const home = document.getElementById('taxi-home-summary');
  if (!control && !home) return;
  const results = document.getElementById('results') || home;
  const config = {enabled:results.dataset.feedEnabled === 'true',url:results.dataset.feedUrl};
  const boundedFetch = async (url, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url,{...options,signal:controller.signal});
      const text = await response.text();
      return {ok:response.ok,text:async()=>text};
    } finally { clearTimeout(timer); }
  };
  loadSnapshot(boundedFetch, config).then(({data,source,unavailable}) => {
    const format = new Intl.NumberFormat('en-US');
    const text = (id,value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    if (home) {
      const totals=summarize(data.months),compact=new Intl.NumberFormat('en-US',{notation:'compact',minimumFractionDigits:2,maximumFractionDigits:2});
      text('taxi-home-bronze',compact.format(totals.bronze));
      text('taxi-home-months',data.months.length);
      text('taxi-home-gold',compact.format(totals.gold));
      text('taxi-home-note','Source months: '+data.months[0].period+' to '+data.months.at(-1).period+(source==='published' ? '.':'. Bundled figures; public report unavailable.'));
      return;
    }
    text('taxi-publication-label','Source-month coverage');
    text('taxi-verification-date',data.months.length+' source months');
    text('taxi-coverage',data.months[0].period + ' - ' + data.months[data.months.length-1].period);
    const caption = document.querySelector('#results table caption');
    if (caption) caption.textContent = 'Source-month figures: '+data.months[0].period+' to '+data.months.at(-1).period;
    text('taxi-publication-note',source === 'published'
      ? 'Monthly batch results from the public report. This is not real-time trip data or a daily Job heartbeat.'
      : unavailable ? 'Public report unavailable. Showing the bundled monthly figures.'
      : 'Verified monthly figures, not real-time trip data.');
    if (source === 'published') document.getElementById('taxi-data-download').href = config.url;
    const years = [...new Set(data.months.map(m=>m.period.slice(0,4)))];
    control.replaceChildren(new Option('All years','all'),...years.map(y=>new Option(y,y)));
    const scale = Math.max(4500000,Math.ceil(Math.max(...data.months.map(m=>m.gold))/500000)*500000);
    text('taxi-chart-scale','Common scale: 0 to ' + (scale / 1000000).toFixed(1) + ' million trips');
    function element(tag,value,className) {
      const el = document.createElement(tag);
      if (value !== undefined) el.textContent = value;
      if (className) el.className = className;
      return el;
    }
    function render() {
      const months = selectMonths(data.months, control.value);
      const totals = summarize(months);
      for (const key of ['bronze', 'gold', 'quarantine']) document.getElementById('taxi-' + key).textContent = format.format(totals[key]);
      document.getElementById('taxi-rate').textContent = totals.quarantinePct.toFixed(2) + '%';
      const dollars = totals.amountCents / 100n;
      const cents = String(totals.amountCents % 100n).padStart(2, '0');
      document.getElementById('taxi-amount').textContent = '$' + format.format(dollars) + '.' + cents;
      document.getElementById('taxi-range').textContent = months[0].period + ' - ' + months[months.length - 1].period + ' / ' + months.length + ' source months';
      text('taxi-results-title',months.length + ' months, reconciled');
      text('taxi-quality-range','Source-month accounting: '+months[0].period+' to '+months.at(-1).period+'.');
      text('taxi-quality-equation',format.format(totals.bronze)+' = '+format.format(totals.silver)+' + '+format.format(totals.quarantine));
      text('taxi-quality-preservation',format.format(totals.silver)+' rows in each');
      text('taxi-quality-boundary',format.format(totals.boundary)+' accepted pickup-date observations outside their nominal source month');
      text('taxi-quality-rate',totals.quarantinePct.toFixed(2)+'% = total quarantine / total Bronze');
      const bars = [], rows = [];
      for (const m of months) {
        const bar = element('div',undefined,'taxi-bar');
        const track = element('div',undefined,'taxi-bar-track');
        const fill = element('span');
        fill.style.height = (m.gold / scale * 100) + '%';
        fill.title = m.period + ': ' + format.format(m.gold) + ' accepted trips';
        track.append(fill);
        bar.append(track,element('span',m.period,'taxi-bar-label'));
        bars.push(bar);
        const row = element('tr');
        const heading = element('th',m.period);
        heading.scope = 'row';
        const cents = BigInt(m.amountCents);
        row.append(heading,...[m.bronze,m.gold,m.quarantine].map(value=>element('td',format.format(value))),
          element('td',format.format(cents/100n) + '.' + String(cents%100n).padStart(2,'0')));
        rows.push(row);
      }
      document.getElementById('taxi-bars').replaceChildren(...bars);
      document.getElementById('taxi-months').replaceChildren(...rows);
    }
    render();
    control.disabled = false;
    control.addEventListener('change',render);
  }).catch(() => {
    if(home) document.getElementById('taxi-home-note').textContent='Bundled monthly figures shown; the public report is unavailable.';
    else document.getElementById('taxi-range').textContent = 'Bundled source months shown. Year selection unavailable; recorded figures remain visible.';
  });
  document.querySelectorAll('.taxi-flow a').forEach(link => link.addEventListener('click', () => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) target.open = true;
  }));
})();
