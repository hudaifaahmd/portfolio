const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const api = require('../src/assets/js/taxi-dashboards.js');
test('monthly baseline exposes recorded fields and period-filterable layer counts',()=>{
  const rows=api.baseline(read('src/_data/taxiProject.json'));
  assert.equal(rows.current_monthly.length,32);
  assert.equal(rows.current_monthly[0].source_total_amount,'80342488.18');
  assert.equal(rows.current_monthly[0].unknown_zone_count,undefined);
  assert.equal(rows.current_layers.length,128);
  assert.equal(api.filterPeriods(rows.current_layers,['2024-01']).length,4);
});
test('query projection groups selected months and computes weighted percentages',()=>{
  const rows=[{source_period:'2024-01',gold_count:9,bronze_count:10,quarantine_count:1,source_total_amount:'0.10'}, {source_period:'2024-02',gold_count:1,bronze_count:2,quarantine_count:1,source_total_amount:'0.20'}];
  const fields=[{name:'amount',expression:'SUM(`source_total_amount`)'},{name:'rate',expression:'MEASURE(`Quarantine rate %`)'}];
  assert.equal(api.project(rows,fields)[0].amount,'0.30');
  assert.equal(api.project(rows,fields)[0].rate,100*2/12);
  assert.equal(api.project([{bronze_count:100,quarantine_count:null,source_total_amount:'0.10'}],fields)[0].rate,null);
  assert.equal(api.filterPeriods(rows,['2024-02']).length,1);
  assert.deepEqual(api.project([],fields),[]);
  assert.throws(()=>api.project(rows,[{name:'x',expression:'arbitrary()'}]));
});
test('every dashboard panel is complete for January 2024 and the full source range',()=>{
  const m=read('src/assets/project-code/dashboard-manifest.json');
  const datasets=api.baseline(read('src/_data/taxiProject.json'));
  assert.deepEqual(m.pages.map(p=>p.title),['Lakehouse','Data quality']);
  const selections=[...datasets.current_monthly.map(r=>[r.source_period]),datasets.current_monthly.map(r=>r.source_period)];
  for(const page of m.pages)for(const panel of page.panels)for(const periods of selections){
    assert.ok(datasets[panel.dataset],panel.title);
    const rows=api.project(api.filterPeriods(datasets[panel.dataset],periods),panel.fields);
    assert.ok(rows.length,panel.title);
    for(const row of rows)for(const f of panel.fields)assert.ok(row[f.name]!==undefined && row[f.name]!==null,panel.title+': '+f.name);
  }
  assert.equal(datasets.current_monthly[0].bronze_accounting_gap,0);
  assert.equal(datasets.current_monthly[0].silver_gold_gap,0);
  assert.equal(datasets.current_monthly.at(-1).source_period,'2026-08');
});
test('dashboard requires only filters, with no upload, download or pending panels',()=>{
  const template=fs.readFileSync(path.join(root,'src/projects/nyc-taxi-dashboards.njk'),'utf8');
  const js=fs.readFileSync(path.join(root,'src/assets/js/taxi-dashboards.js'),'utf8');
  assert.ok(!/type="file"|dashboard-import|export notebook/i.test(template));
  assert.ok(!/Download CSV|Aggregate export pending|evidenceDate|generatedAtUtc/.test(js));
  assert.match(template,/dashboard-periods/);
});
test('certificate slides reserve their own space before images load',()=>{
  const css=fs.readFileSync(path.join(root,'src/assets/css/style.css'),'utf8');
  const js=fs.readFileSync(path.join(root,'src/assets/js/main.js'),'utf8');
  assert.match(css,/\.cert-stage\s*\{[^}]*display:\s*grid/);
  assert.ok(!/stage\.style\.height/.test(js));
  for(const cert of read('src/_data/certifications.json'))assert.ok(cert.width>0 && cert.height>0);
});
test('built dashboard navigation resolves without replay analytics',()=>{
  const html=fs.readFileSync(path.join(root,'_site/projects/nyc-taxi-lakehouse/dashboards/index.html'),'utf8');
  assert.ok(!html.includes('clarity.ms') && !html.includes('gc.zgo.at'));
  for(const [,href] of html.matchAll(/href="(\/projects\/nyc-taxi-lakehouse\/[^"#]*|\/assets\/[^"#]+)(?:#[^"]*)?"/g)) {
    assert.ok(fs.existsSync(path.join(root,'_site',href.endsWith('/') ? href+'index.html':href)),href);
  }
  const evidence=read('src/_data/taxiEvidence.json');
  assert.equal(evidence.tables.length,9);
  assert.equal(evidence.notebooks.length,15);
});
