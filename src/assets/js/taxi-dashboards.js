(function () {
  'use strict';
  const amountField = name => /amount$/.test(name);
  const cents = value => {
    const match = /^(-?)(\d{1,16})(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) throw new Error('Invalid currency precision');
    return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2,'0')));
  };
  const decimal = value => (value < 0n ? '-' : '') + (value < 0n ? -value : value)/100n + '.' + String((value < 0n ? -value : value)%100n).padStart(2,'0');
  function baseline(snapshot) {
    const monthly = snapshot.months.map(m=>({source_period:m.period,bronze_count:m.bronze,silver_count:m.silver,gold_count:m.gold,quarantine_count:m.quarantine,quarantine_pct:m.quarantine/m.bronze*100,source_total_amount:decimal(BigInt(m.amountCents)),bronze_accounting_gap:m.bronze-m.silver-m.quarantine,silver_gold_gap:m.silver-m.gold,boundary_count:m.boundary}));
    return {current_monthly:monthly,current_layers:monthly.flatMap(m=>['Bronze','Quarantine','Silver','Gold'].map(layer=>({source_period:m.source_period,layer,row_count:m[layer.toLowerCase()+'_count']})))};
  }
  const filterPeriods = (rows, periods) => rows.filter(r=>!Object.hasOwn(r,'source_period') || periods.includes(r.source_period));
  function project(rows,fields) {
    const parsed = fields.map(f=>{
      let m = /^`([a-z_]+)`$/.exec(f.expression);
      if(m) return {...f,kind:'raw',key:m[1]};
      m = /^SUM\(`([a-z_]+)`\)$/.exec(f.expression);
      if(m) return {...f,kind:'sum',key:m[1]};
      if(f.expression==='MEASURE(`Quarantine rate %`)') return {...f,kind:'rate'};
      throw new Error('Unsupported panel expression');
    });
    if(!parsed.some(f=>f.kind!=='raw')) return rows.map(r=>Object.fromEntries(parsed.map(f=>[f.name,r[f.key] ?? null])));
    const groups = new Map();
    for(const row of rows) {
      const key = JSON.stringify(parsed.filter(f=>f.kind==='raw').map(f=>row[f.key]));
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(row);
    }
    return [...groups.values()].map(group=>Object.fromEntries(parsed.map(f=>{
      let value;
      if(f.kind==='raw') value=group[0][f.key] ?? null;
      else if(f.kind==='rate') {
        const measured=group.every(r=>r.bronze_count!==undefined && r.bronze_count!==null && r.quarantine_count!==undefined && r.quarantine_count!==null);
        const b=measured ? group.reduce((n,r)=>n+r.bronze_count,0):0;
        value=b ? 100*group.reduce((n,r)=>n+r.quarantine_count,0)/b : null;
      } else if(group.some(r=>r[f.key]===undefined || r[f.key]===null)) value=null;
      else value=amountField(f.key) ? decimal(group.reduce((n,r)=>n+cents(r[f.key]),0n)) : group.reduce((n,r)=>n+Number(r[f.key]),0);
      return [f.name,value];
    })));
  }
  if(typeof module!=='undefined') module.exports={baseline,filterPeriods,project};
  if(typeof document==='undefined' || !document.getElementById('dashboard-panels')) return;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const integer=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  function format(value,name) {
    if(value===undefined || value===null) return '\u2014';
    if(amountField(name) || name==='selected_amount') {
      const v=cents(value),abs=v<0n ? -v:v;
      return (v<0n ? '-':'')+'$'+(abs/100n).toLocaleString('en-US')+'.'+String(abs%100n).padStart(2,'0');
    }
    if(/pct$/.test(name)) return integer.format(Number(value))+'%';
    return typeof value==='number' ? integer.format(value):String(value);
  }
  function table(container,rows,fields,title) {
    let page=0,sort=null,ascending=true,search='';
    const toolbar=el('div',undefined,'dash-table-tools');
    const input=el('input');input.type='search';input.placeholder='Search rows';input.setAttribute('aria-label','Search '+title);
    toolbar.append(input);container.append(toolbar);
    const scroll=el('div',undefined,'taxi-table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',title);
    const grid=el('table'),thead=el('thead'),head=el('tr'),body=el('tbody');
    grid.append(thead,body);thead.append(head);scroll.append(grid);container.append(scroll);
    const paging=el('div',undefined,'dash-paging'),prev=el('button','Previous'),next=el('button','Next'),status=el('span');status.setAttribute('aria-live','polite');paging.append(prev,status,next);container.append(paging);
    const buttons=[];
    for(const f of fields) {
      const th=el('th'),button=el('button',f.name.replaceAll('_',' '));th.scope='col';button.type='button';button.title='Sort by '+f.name;th.append(button);head.append(th);buttons.push([th,f.name]);
      button.onclick=()=>{ascending=sort===f.name ? !ascending:true;sort=f.name;page=0;render();};
    }
    function selected() {
      const list=rows.filter(r=>fields.some(f=>String(r[f.name] ?? '').toLowerCase().includes(search)));
      if(sort) list.sort((a,b)=>{const x=a[sort],y=b[sort];if(x==null)return y==null ? 0:1;if(y==null)return -1;const cmp=amountField(sort) ? (cents(x)>cents(y) ? 1:cents(x)<cents(y) ? -1:0) : typeof x==='number' && typeof y==='number' ? x-y:String(x).localeCompare(String(y),undefined,{numeric:true});return cmp*(ascending ? 1:-1);});
      return list;
    }
    function render() {
      const list=selected();page=Math.min(page,Math.max(0,Math.ceil(list.length/20)-1));body.replaceChildren();
      for(const r of list.slice(page*20,page*20+20)) {const tr=el('tr');for(const f of fields)tr.append(el('td',format(r[f.name],f.name)));body.append(tr);}
      if(!list.length){const td=el('td','No matching rows');td.colSpan=fields.length;const tr=el('tr');tr.append(td);body.append(tr);}
      status.textContent=list.length ? `${page*20+1}-${Math.min(list.length,page*20+20)} of ${list.length}`:'0 rows';prev.disabled=page===0;next.disabled=(page+1)*20>=list.length;
      for(const [th,name] of buttons)th.setAttribute('aria-sort',sort===name ? ascending ? 'ascending':'descending':'none');
    }
    input.oninput=()=>{search=input.value.toLowerCase();page=0;render();};prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};render();
  }
  function chart(container,rows,panel) {
    const enc=panel.encodings, horizontal=enc.x.scale.type==='quantitative';
    const category=horizontal ? enc.y.fieldName:enc.x.fieldName,value=horizontal ? enc.x.fieldName:enc.y.fieldName;
    const values=rows.map(r=>Number(r[value])),max=Math.max(1,...values.filter(Number.isFinite));
    if(panel.type==='line') {
      const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 255');svg.setAttribute('role','img');svg.setAttribute('aria-label',panel.title+'; exact figures in the table');svg.classList.add('dash-line');
      const node=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
      svg.append(node('line',{x1:65,y1:205,x2:880,y2:205,stroke:'currentColor'}));
      const coords=rows.map((r,i)=>[65+i*810/Math.max(1,rows.length-1),205-Number(r[value])/max*175]);
      svg.append(node('polyline',{points:coords.map(p=>p.join(',')).join(' '),fill:'none',stroke:'var(--taxi-teal)','stroke-width':3}));
      coords.forEach(([x,y],i)=>{const dot=node('circle',{cx:x,cy:y,r:4,fill:'var(--taxi-teal)',tabindex:0});const tip=node('title',{});tip.textContent=String(rows[i][category])+': '+format(rows[i][value],value);dot.append(tip);svg.append(dot);if(i%Math.max(1,Math.ceil(rows.length/7))===0 || i===rows.length-1){const label=node('text',{x,y:231,'text-anchor':i===rows.length-1?'end':'start','font-size':12,fill:'currentColor'});label.textContent=String(rows[i][category]).slice(0,10);svg.append(label);}});
      for(const [y,label] of [[28,format(max,value)],[205,'0']]){const t=node('text',{x:2,y,'font-size':11,fill:'currentColor'});t.textContent=label;svg.append(t);}
      container.append(svg);
    } else {
      const bars=el('div',undefined,'dash-bars');
      for(const r of rows){const bar=el('div',undefined,'dash-bar-row'),label=el('span',String(r[category])),track=el('div',undefined,'dash-bar-track'),fill=el('span');fill.style.width=(Number(r[value])/max*100)+'%';track.append(fill);bar.append(label,track,el('span',format(r[value],value)));bars.append(bar);}container.append(bars);
    }
  }
  async function start() {
    async function read(name){if(window.TAXI_DASHBOARD_ASSETS)return window.TAXI_DASHBOARD_ASSETS[name];const r=await fetch('/assets/project-code/'+name+'.json',{credentials:'omit'});if(!r.ok)throw new Error('Dashboard asset unavailable');return r.json();}
    const [manifest,bundled]=await Promise.all([read('dashboard-manifest'),read('snapshot')]);
    let snapshot=window.TaxiReport.validateSnapshot(bundled),datasets=baseline(snapshot),active=0,selected=new Set(),periods=[];
    const host=document.getElementById('dashboard-panels'),tabs=document.getElementById('dashboard-tabs'),periodList=document.getElementById('dashboard-periods'),note=document.getElementById('dashboard-provenance');
    function refreshPeriods(keepSelection=false) {
      const wasAll=selected.size===periods.length,previous=selected;
      periods=snapshot.months.map(m=>m.period);selected=keepSelection && !wasAll ? new Set(periods.filter(p=>previous.has(p))):new Set(periods);periodList.replaceChildren();
      for(const p of periods){const label=el('label'),check=el('input');check.type='checkbox';check.value=p;check.checked=selected.has(p);check.onchange=()=>{check.checked ? selected.add(p):selected.delete(p);render();};label.append(check,document.createTextNode(p));periodList.append(label);}
      note.textContent='Source-month coverage: '+periods[0]+' to '+periods.at(-1)+' / '+periods.length+' months';
    }
    function render() {
      const page=manifest.pages[active];host.replaceChildren();host.setAttribute('aria-labelledby','dash-tab-'+active);
      [...tabs.children].forEach((b,i)=>{b.setAttribute('aria-selected',String(i===active));b.tabIndex=i===active ? 0:-1;});
      document.getElementById('dashboard-view-note').textContent='Selected: '+selected.size+' of '+periods.length+' source months. Source total amount is not validated net revenue.';
      for(const panel of page.panels){
        const section=el('section',undefined,'dash-panel'+(panel.type==='counter'?' dash-counter':''));section.append(el('h2',panel.title));host.append(section);
        const source=datasets[panel.dataset];
        const rows=project(filterPeriods(source,[...selected]),panel.fields);
        if(!rows.length){section.append(el('p','No rows for this selection.','dash-pending'));continue;}
        if(panel.type==='counter'){const key=panel.encodings.value.fieldName;section.append(el('strong',format(rows[0][key],key),'dash-value'));}
        else if(panel.type==='table')table(section,rows,panel.fields,panel.title);
        else {if(rows.every(r=>panel.fields.every(f=>r[f.name]!==null)))chart(section,rows,panel);const details=el('details'),summary=el('summary','Exact figures');details.append(summary);table(details,rows,panel.fields,panel.title);section.append(details);}
      }
    }
    manifest.pages.forEach((page,i)=>{const b=el('button',page.title);b.type='button';b.id='dash-tab-'+i;b.setAttribute('role','tab');b.setAttribute('aria-controls','dashboard-panels');b.onclick=()=>{active=i;render();};b.onkeydown=e=>{let target=i,n=manifest.pages.length;if(e.key==='ArrowRight')target=(i+1)%n;else if(e.key==='ArrowLeft')target=(i+n-1)%n;else if(e.key==='Home')target=0;else if(e.key==='End')target=n-1;else return;e.preventDefault();tabs.children[target].click();tabs.children[target].focus();};tabs.append(b);});
    document.getElementById('dashboard-all').onclick=()=>{selected=new Set(periods);periodList.querySelectorAll('input').forEach(c=>c.checked=true);render();};
    document.getElementById('dashboard-none').onclick=()=>{selected.clear();periodList.querySelectorAll('input').forEach(c=>c.checked=false);render();};
    refreshPeriods();render();
    const boundedFetch=async(url,options)=>{
      if(url==='/assets/project-code/snapshot.json')return {ok:true,text:async()=>JSON.stringify(bundled)};
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
      try {const r=await fetch(url,{...options,signal:controller.signal}),body=await r.text();return {ok:r.ok,text:async()=>body};} finally {clearTimeout(timeout);}
    };
    window.TaxiReport.loadSnapshot(boundedFetch,{enabled:true,url:'https://raw.githubusercontent.com/hudaifaahmd/nyc-taxi-public-summary/main/reports/snapshot.json'}).then(result=>{
      if(result.source!=='published')return;
      snapshot=result.data;datasets=baseline(snapshot);refreshPeriods(true);render();
    }).catch(()=>{});
  }
  start().catch(()=>{document.getElementById('dashboard-message').textContent='Dashboard assets could not load. Please open the portable preview or the served site.';});
}());
