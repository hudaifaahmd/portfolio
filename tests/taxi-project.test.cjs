const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('public snapshot reconciles to independently verified SQL totals', () => {
  const data = JSON.parse(read('src/_data/taxiProject.json'));
  assert.equal(data.months.length, 32);
  assert.equal(new Set(data.months.map(m => m.period)).size, 32);
  const sum = key => data.months.reduce((s, m) => s + m[key], 0);
  assert.equal(sum('bronze'), 119595677);
  assert.equal(sum('silver'), 115842411);
  assert.equal(sum('gold'), 115842411);
  assert.equal(sum('quarantine'), 3753266);
  assert.equal(sum('boundary'), 661);
  assert.equal(data.months.reduce((s,m) => s + BigInt(m.amountCents), 0n), 338815859579n);
  for (const m of data.months) {
    assert.equal(m.bronze, m.silver + m.quarantine);
    assert.equal(m.silver, m.gold);
  }
  assert.equal(data.publicFeedConnected, false);
  assert.equal(data.verifiedOn, '2026-10-18');
  assert.doesNotMatch(JSON.stringify(data), /batch_id|@gmail|\/Workspace\/|cloud\.databricks|C:\\/i);
});

test('year selection uses a weighted quarantine rate and exact cents', () => {
  const { summarize, selectMonths } = require('../src/assets/js/taxi-project.js');
  const { months } = JSON.parse(read('src/_data/taxiProject.json'));
  assert.equal(selectMonths(months, '2024').length, 12);
  assert.equal(selectMonths(months, '2026').length, 8);
  assert.equal(selectMonths(months, 'all').length, 32);
  const all = summarize(months);
  assert.ok(Math.abs(all.quarantinePct - 3.13829570946783) < 1e-10);
  assert.equal(all.amountCents, 338815859579n);
  assert.equal(summarize([]).quarantinePct, 0);
});

test('next monthly report expands coverage and every supported quality total',async()=>{
  const {loadSnapshot,summarize}=require('../src/assets/js/taxi-project.js');
  const snapshot=JSON.parse(read('src/_data/taxiProject.json'));
  const next={...snapshot,schemaVersion:1,evidenceThroughUtc:'2026-10-20T00:00:00Z',generatedAtUtc:'2026-10-20T01:00:00Z',months:[...snapshot.months,{period:'2026-09',bronze:10,silver:8,gold:8,quarantine:2,amountCents:'100',boundary:1}]};
  const result=await loadSnapshot(async()=>({ok:true,text:async()=>JSON.stringify(next)}),{enabled:true,url:'https://raw.githubusercontent.com/hudaifaahmd/nyc-taxi-public-summary/main/reports/snapshot.json'});
  assert.equal(result.data.months.length,33);
  assert.equal(result.data.months.at(-1).period,'2026-09');
  const totals=summarize(result.data.months);
  assert.equal(totals.silver,115842419);
  assert.equal(totals.boundary,662);
  assert.equal(totals.amountCents,338815859679n);
});

test('project links to dashboard resources in the requested sections without run-history dates',()=>{
  const page=read('src/projects/nyc-taxi-lakehouse.njk'),dashboard=read('src/projects/nyc-taxi-dashboards.njk');
  assert.ok(!/id="evidence"|Execution evidence|Unchanged-source rerun|October 18|October 19/.test(page));
  const results=page.split('id="results"')[1].split('</section>')[0];
  assert.match(results,/Explore interactive dashboards/);
  assert.ok(!/id="table-structures"|id="notebook-index"/.test(page));
  const source=page.split('id="source"')[1];
  assert.match(source,/dashboards\/#table-structures/);
  assert.match(source,/dashboards\/#notebook-index/);
  assert.match(dashboard,/id="table-structures"/);
  assert.match(dashboard,/id="notebook-index"/);
  assert.ok(!/1,536|49 individual|All 32/.test(page));
  const js=read('src/assets/js/taxi-project.js');
  for(const id of ['taxi-quality-range','taxi-quality-equation','taxi-quality-preservation','taxi-quality-boundary','taxi-quality-rate','taxi-home-bronze','taxi-home-months','taxi-home-gold']) assert.ok(js.includes("text('"+id+"'"),id);
});

test('report loader validates remote data and falls back without credentials', async () => {
  const { loadSnapshot, validateSnapshot } = require('../src/assets/js/taxi-project.js');
  const snapshot = JSON.parse(read('src/_data/taxiProject.json'));
  assert.equal(validateSnapshot(snapshot).months.length,32);
  assert.throws(()=>validateSnapshot({...snapshot,months:[{...snapshot.months[0],gold:1}]}));
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,options});
    if(url.startsWith('https:')) throw new Error('Unavailable');
    return {ok:true,text:async()=>JSON.stringify(snapshot)};
  };
  const result=await loadSnapshot(fetcher,{enabled:true,url:'https://raw.githubusercontent.com/hudaifaahmd/nyc-taxi-public-summary/main/reports/snapshot.json'});
  assert.equal(result.source,'bundled');
  assert.equal(result.unavailable,true);
  assert.equal(calls[0].options.credentials,'omit');
  const published=await loadSnapshot(async()=>({ok:true,text:async()=>JSON.stringify({...snapshot,schemaVersion:1,evidenceThroughUtc:'2026-10-17T13:23:23+00:00',generatedAtUtc:'2026-10-19T14:51:45+00:00'})}),{enabled:true,url:'https://raw.githubusercontent.com/hudaifaahmd/nyc-taxi-public-summary/main/reports/snapshot.json'});
  assert.equal(published.source,'published');
});

test('homepage links to the separate project page without replacing employer cases', () => {
  const home = read('src/index.njk');
  assert.match(home, /id="hands-on-projects"/);
  assert.match(home, /href="\/projects\/nyc-taxi-lakehouse\/"/);
  assert.match(home, /Sanitized case studies/);
  assert.match(home, /for p in projects/);
  assert.ok(home.indexOf('id="projects"') < home.indexOf('id="hands-on-projects"'), 'Professional cases must appear before the personal project');
  assert.equal(JSON.parse(read('src/_data/site.json')).nav.find(n => n.label === 'Projects').href, '/#projects');
  const page = read('src/projects/nyc-taxi-lakehouse.njk');
  assert.match(page, /verified snapshot/i);
  assert.match(page, /not a live public feed/i);
  assert.match(page, /not validated net revenue/i);
});

test('built project downloads and local anchors resolve', () => {
  const html = read('_site/projects/nyc-taxi-lakehouse/index.html');
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  for (const link of links) {
    if (link.startsWith('#')) assert.ok(html.includes('id="' + link.slice(1) + '"'), link);
    if (link.startsWith('/assets/')) assert.ok(fs.existsSync(path.join(root, '_site', link)), link);
  }
  assert.deepEqual(JSON.parse(read('_site/assets/project-code/snapshot.json')), JSON.parse(read('src/_data/taxiProject.json')));
  const casesHash = require('node:crypto').createHash('sha256').update(JSON.stringify(JSON.parse(read('src/_data/projects.json')))).digest('hex');
  assert.equal(casesHash, '67bf4a99a0e1bf8f87364fc9e84a4ddec046a8fbdc7c861f01197c5766f023ee');
});
