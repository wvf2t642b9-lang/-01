'use strict';
const people = window.ATLAS;
const app = document.querySelector('#app');
const poster = document.querySelector('#plate');
const byId = Object.fromEntries(people.map(p => [p.slug,p]));
const portraits = id => byId[id]?.thumb || '';
window.ATLAS_MEDIA = {};
const pendingMedia = new Map();
function loadMedia(id){
  if(window.ATLAS_MEDIA[id]) return Promise.resolve(window.ATLAS_MEDIA[id]);
  if(!pendingMedia.has(id)){
    pendingMedia.set(id,new Promise((resolve,reject)=>{
      const tag=document.createElement('script');
      tag.src='assets/'+id+'.js';
      tag.onload=()=>window.ATLAS_MEDIA[id]?resolve(window.ATLAS_MEDIA[id]):reject(new Error('Missing image pack'));
      tag.onerror=()=>reject(new Error('Unable to load image pack'));
      document.head.appendChild(tag);
    }).catch(error=>{pendingMedia.delete(id);throw error;}));
  }
  return pendingMedia.get(id);
}
const pendingScenes = new Map();
function eventScenes(person) {
  if (!pendingScenes.has(person)) {
    const request = fetch('assets/chronology/' + person + '.json?v=timeline-3').then(response => {
      if (!response.ok) throw new Error('Unable to load event illustrations');
      return response.json();
    }).catch(error => {
      pendingScenes.delete(person);
      throw error;
    });
    pendingScenes.set(person, request);
  }
  return pendingScenes.get(person);
}
const sceneObserver = new IntersectionObserver(changes => {
  for (const {target, isIntersecting} of changes) {
    if (!isIntersecting) continue;
    sceneObserver.unobserve(target);
    const image = target.querySelector('img[data-scene]');
    eventScenes(image.dataset.person).then(scenes => {
      const source = scenes?.[image.dataset.scene];
      if (!image.isConnected || !source) return;
      image.src = source;
      image.hidden = false;
    }).catch(() => {});
  }
});
function observeScenes(panel) {
  for (const image of panel.querySelectorAll('img[data-scene]')) {
    sceneObserver.observe(image.closest('.entry'));
  }
}
function downloadPdf(person,pack){
  const raw=atob(pack.pdf.split(',')[1]), bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const link=document.createElement('a');
  link.href=url; link.download=person.name+'_A3.pdf'; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const flat = people.flatMap(p => p.events.map(e => ({...e,person:p.slug,name:p.name})));
const palette = ['#805022','#1d6864','#9f3227','#414f80','#74485d'];
const pointOK = e => Array.isArray(e.point) && e.point.length===2;
const esc = val => String(val ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = e => e.person+'-'+e.n;
const nameAliases = new Map([
  ['定军山（汉中）','定军山'], ['汉中·定军山','定军山'], ['定军山战区','定军山'],
  ['荆州江陵','江陵'], ['南郡·江陵','江陵'], ['洛阳城','洛阳'],
  ['合肥旧城','合肥'], ['合肥旧城一带','合肥'], ['襄阳·樊城','樊城']
]);
function locationKey(e){
  const cleaned=e.place.replace(/\s+/g,'');
  return nameAliases.get(cleaned) || cleaned;
}
function close(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1])<.44;}
const locations=[];
for(const e of flat.filter(pointOK)){
  const title=locationKey(e);
  let node=locations.find(n=>n.title===title && close(n.point,e.point));
  if(!node){node={id:'p'+locations.length,title,point:e.point,events:[]};locations.push(node);}
  node.events.push(e);
}
const eventLocation=Object.fromEntries(locations.flatMap(l=>l.events.map(e=>[key(e),l])));
const coordinates = ([lon,lat]) => [(lon-99)*50,(43.2-lat)*1300/21.9];
const matchesYear=(e,y)=>{
  if(!e.years.length)return false;
  if(e.years.length===1)return !/年前|年以前|年后|年以后|年以来/.test(e.year)&&y===e.years[0];
  return y>=Math.min(...e.years)&&y<=Math.max(...e.years);
};
const years=flat.flatMap(e=>e.years);
const minYear=Math.min(...years), maxYear=Math.max(...years);
let search='', currentYear=219, selectedLocation='', selectedEvent='', viewBox=null, renderedMode='';
const safeUrl=s=>typeof s==='string' && /^https?:\/\//i.test(s)?s:'';
function route(){
  const [page,id,extra]=location.hash.slice(1).split('/');
  return [page||'people',id,extra];
}
function cards(list){
  return list.map(p=>'<a class="card" href="#person/'+p.slug+'"><img src="'+portraits(p.slug)+'" alt="'+esc(p.name)+'立像" loading="lazy"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.courtesy?'字'+p.courtesy:p.id)+'</small></div></a>').join('') || '<p class="empty">未找到符合条件的人物。</p>';
}
function gallery(){
  app.innerHTML='<section class="hero"><div class="hero-art" aria-hidden="true">'+['sg-006','sg-022','sg-003'].map(id=>'<img src="'+portraits(id)+'" alt="">').join('')+'</div><div class="hero-copy"><h1>三国群英图鉴</h1><p>沿着山河与纪年，读'+people.length+'位三国人物的行迹。<br>从一位人物出发，也可以从一个地名读起。</p><div class="actions"><a class="action primary" href="#map">打开行迹地图</a><a class="action" href="#years">浏览纪年</a></div></div></section>'
    +'<section class="wrap"><div class="bar"><div><h2>人物名录</h2><p class="muted" id="count"></p></div><input id="search" class="search" type="search" aria-label="搜索人物" placeholder="搜索姓名、字号或编号"></div><div id="list" class="grid"></div></section>';
  const input=document.querySelector('#search');
  input.value=search;
  const update=()=>{
    search=input.value.trim();
    const hits=people.filter(p=>[p.name,p.courtesy,p.id].some(s=>String(s).toLowerCase().includes(search.toLowerCase())));
    document.querySelector('#list').innerHTML=cards(hits);
    document.querySelector('#count').textContent=hits.length+' 位人物';
  };
  input.addEventListener('input',update);update();
}
function entries(events, options={}){
  return events.map(e=>{
    const loc=eventLocation[key(e)], active=key(e)===selectedEvent;
    const peopleHere=loc ? [...new Map(loc.events.filter(a=>a.person!==e.person).map(a=>[a.person,a])).values()] : [];
    const sourceList=byId[e.person].sources;
    const names=(Array.isArray(e.source)?e.source:e.source?[e.source]:[]).map(s=>sourceList.find(x=>x.id===s)?.title||s);
    const title=esc(e.year)+' · '+esc(e.place);
    return '<article id="event-'+key(e)+'" class="entry'+(active?' active':'')+'"><button type="button" data-event="'+key(e)+'"'
      +(!loc?' aria-label="'+title+'，无地图落点"':'')+'><b>'+title+'</b>'+(options.person?'':' <span>'+esc(e.name)+'</span>')+'</button>'
      +(e.title?'<p><strong>'+esc(e.title)+'</strong></p>':'')
      +(e.modern?'<small>'+esc(e.modern)+'</small>':'')
      +(options.person||options.timeline?'<img class="scene" width="384" height="256" data-person="'+esc(e.person)+'" data-scene="'+esc(e.n)+'" alt="'+esc(e.title||e.place)+'插画" decoding="async" hidden>':'')
      +(e.body?'<p>'+esc(e.body)+'</p>':'')+(e.note?'<small>'+esc(e.note)+'</small>':'')
      +(names.length?'<p><small>'+esc(names.join('、'))+'</small></p>':'')
      +(!options.person?'<small><a href="#person/'+e.person+'/'+e.n+'">查看'+esc(e.name)+'的人物图鉴</a></small>':'')
      +(options.person&&peopleHere.length?'<div class="related"><a href="#map/'+loc.id+'">同地纪事 · '+peopleHere.length+' 位其他人物</a></div>':'')+'</article>';
  }).join('') || '<p class="empty">这一年在现有图鉴中没有可确定纪年的事件。</p>';
}
function panel(title,sub,content){
  return '<aside class="panel"><div class="panel-top"><h3>'+esc(title)+'</h3><p>'+esc(sub)+'</p></div><div class="entries">'+content+'</div></aside>';
}
function mobileNav(){
  return '<div class="mobile-nav"><button data-jump="#terrain">看地图</button><button data-jump="#read">读纪事</button></div>';
}
function bindMobileNav(){
  app.querySelectorAll('[data-jump]').forEach(btn=>btn.onclick=()=>{
    document.querySelector(btn.dataset.jump)?.scrollIntoView({block:'start',behavior:'smooth'});
  });
}
function shellMap(){
  return '<div class="canvas"><svg id="terrain" aria-label="可探索的三国地望地图" role="group"></svg><div class="mapBtns" aria-label="地图操作"><button data-zoom=".78" aria-label="放大地图">＋</button><button data-zoom="1.28" aria-label="缩小地图">−</button><button data-reset aria-label="恢复地图范围">全图</button></div><p class="map-note">拖动地图或使用缩放按钮。虚圈示大致地望，分色虚线连接选取的纪事节点。水系为现代参照。</p></div>';
}
function fitPoints(nodes){
  if(!nodes.length)return [0,0,1450,1300];
  const p=nodes.map(l=>coordinates(l.point)), xs=p.map(a=>a[0]), ys=p.map(a=>a[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const w=Math.min(1450,Math.max(270,(x1-x0)+215)),h=Math.min(1300,Math.max(240,(y1-y0)+180));
  return [Math.max(0, Math.min(1450-w,(x0+x1-w)/2)),Math.max(0, Math.min(1300-h,(y0+y1-h)/2)),w,h];
}
function setBox(svg,box){
  viewBox=box;
  svg.setAttribute('viewBox',box.join(' '));
}
function drawMap(nodes, person, onSelect, fit=false){
  const svg=document.querySelector('#terrain');
  if(!svg)return;
  const active=locations.find(l=>l.id===selectedLocation);
  const va=fitPoints(nodes);
  const initial=viewBox || (fit?va:[0,0,1450,1300]);
  const nodesDense=nodes.length>42;
  const marker='<defs>'+palette.map((c,i)=>'<marker id="arr'+i+'" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto"><path d="M0 0L6 2.5L0 5Z" fill="'+c+'"/></marker>').join('')+'</defs>';
  const rivers=[['秦岭',108.7,34],['汉水',109.4,32.67],['长江',112.9,29.7],['大别山',116.1,31.45],['四川盆地',105.3,30.5],['黄河',114.8,36.3],['太行山',113.2,38.2],['辽东',122,40.9]];
  const captions=rivers.map(([t,x,y])=>{const [a,b]=coordinates([x,y]);return '<text class="terrain-label" x="'+a+'" y="'+b+'" text-anchor="middle">'+t+'</text>';}).join('');
  let lines='';
  if(person){
    const endpoint=id=>typeof id==='number'?person.events.find(e=>e.n===id)?.point:person.waypoints?.[id];
    lines=person.routes.map(path=>{
      if(!Array.isArray(path))return '';
      const [a,b,phase,bend]=path, p=endpoint(a),q=endpoint(b);
      if(!Array.isArray(p)||!Array.isArray(q))return '';
      const [x,y]=coordinates(p),[u,v]=coordinates(q),d=Math.hypot(u-x,v-y);
      if(d<9)return '';
      const stopX=u-(u-x)/d*9,stopY=v-(v-y)/d*9,k=Math.min(42,Math.max(-42,Number(bend)||0))*.55;
      const midX=(x+u)/2-(v-y)*k/d,midY=(y+v)/2+(u-x)*k/d,i=(Number(phase)||0)%palette.length;
      return '<path d="M'+x+' '+y+' Q'+midX+' '+midY+' '+stopX+' '+stopY+'" fill="none" stroke="'+palette[i]+'" stroke-width="3.5" stroke-dasharray="7 5" marker-end="url(#arr'+i+')"/>';
    }).join('');
  }
  const r=nodesDense?5:nodes.length>14?7:8;
  const dots=nodes.map(l=>{
    const [x,y]=coordinates(l.point);
    const own=l.events.filter(e=>!person||e.person===person.slug);
    const selected=active?.id===l.id;
    const color=selected?'#ac3d30':person?palette[(Number(own[0]?.phase)||0)%palette.length]:'#4f352b';
    const approx=own.some(e=>/region|origin|approx/.test(e.scope));
    const label=!nodesDense||selected;
    return '<g class="map-point" tabindex="0" role="button" aria-label="'+esc(l.title)+'" data-pin="'+l.id+'"><title>'+esc(l.title)+'</title><circle cx="'+x+'" cy="'+y+'" r="'+(selected?r+4:r)+'" fill="'+(approx&&!selected?'#e3c68b':color)+'" stroke="'+(approx?'#724129':'#fff0b9')+'" stroke-width="'+(selected?3:1.5)+'" '+(approx&&!selected?'stroke-dasharray="3 2"':'')+'/>'+(label?'<text class="map-label" x="'+(x+r+3)+'" y="'+(y-5)+'" font-size="'+(nodes.length>14?15:13)+'">'+esc(l.title)+'</text>':'')+'</g>';
  }).join('');
  svg.innerHTML=marker+'<image href="assets/relief.webp" width="1450" height="1300"/>'+captions+lines+dots;
  setBox(svg,initial);
  svg.querySelectorAll('[data-pin]').forEach(el=>{
    const pick=()=>onSelect(locations.find(l=>l.id===el.dataset.pin));
    el.addEventListener('click',pick);
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
  });
  function zoom(factor){
    const [x,y,w,h]=viewBox;
    if(w*factor<130||w*factor>2400)return;
    setBox(svg,[x+(w-w*factor)/2,y+(h-h*factor)/2,w*factor,h*factor]);
  }
  svg.parentElement.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>zoom(Number(b.dataset.zoom)));
  svg.parentElement.querySelector('[data-reset]').onclick=()=>setBox(svg,fit?va:[0,0,1450,1300]);
  let drag=null;
  svg.addEventListener('pointerdown',e=>{
    if(e.target.closest('[data-pin]'))return;
    const scale=svg.getScreenCTM()?.a||1;
    svg.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,box:[...viewBox],scale};
  });
  svg.addEventListener('pointermove',e=>{
    if(!drag)return;
    const [x,y,w,h]=drag.box;
    setBox(svg,[x-(e.clientX-drag.x)/drag.scale,y-(e.clientY-drag.y)/drag.scale,w,h]);
  });
  for(const t of ['pointerup','pointercancel'])svg.addEventListener(t,()=>drag=null);
}
function eventClicks(events,redraw,center=true){
  app.querySelectorAll('[data-event]').forEach(el=>el.onclick=()=>{
    const e=events.find(a=>key(a)===el.dataset.event);
    if(!e)return;
    selectedEvent=key(e);
    const loc=eventLocation[selectedEvent];selectedLocation=loc?.id||'';
    if(loc&&center){
      const [x,y]=coordinates(loc.point);
      viewBox=[x-205,y-155,410,310];
    }
    redraw();
    const chosen=document.getElementById('event-'+selectedEvent);
    chosen?.scrollIntoView({block:'nearest',behavior:'smooth'});
    chosen?.querySelector('button')?.focus({preventScroll:true});
  });
}
function detail(person, initial){
  const events=flat.filter(e=>e.person===person.slug);
  if(initial && !selectedEvent){
    const e=events.find(e=>e.n===Number(initial));
    if(e){
      selectedEvent=key(e);selectedLocation=eventLocation[selectedEvent]?.id||'';
      if(e.point){const [x,y]=coordinates(e.point);viewBox=[x-205,y-155,410,310];}
    }
  }
  const nodes=locations.filter(l=>l.events.some(e=>e.person===person.slug));
  app.innerHTML='<section class="wrap"><div class="detail-head"><img src="'+portraits(person.slug)+'" alt="'+esc(person.name)+'立像"><div><a class="muted" href="#people">人物名录</a><h1>'+esc(person.name)+'</h1><p>'+esc(person.courtesy?'字'+person.courtesy+' · ':'')+esc(person.span)+'</p><div class="actions"><button id="openPoster" class="primary">放大图鉴</button><button id="pdfButton" class="action">下载 A3 PDF</button><span role="status" id="assetStatus"></span></div></div></div>'+mobileNav()+'<div class="split">'+shellMap()+'<div id="read"></div></div><details class="sources"><summary>史料与地望说明</summary><p>'+esc(person.note)+'</p>'+person.sources.map(s=>safeUrl(s.url)?'<a target="_blank" rel="noopener" href="'+esc(safeUrl(s.url))+'">'+esc(s.title)+'</a><br>':esc(s.title)+'<br>').join('')+'</details></section>';
  const status=document.querySelector('#assetStatus');
  const detailPortrait=app.querySelector('.detail-head img');
  const mediaReady=()=>loadMedia(person.slug).catch(()=>{status.textContent='图像加载失败，请重试。';});
  document.querySelector('#openPoster').onclick=async()=>{
    const pack=await mediaReady();
    if(!pack || !detailPortrait.isConnected) return;
    const img=poster.querySelector('img');img.src=pack.poster;img.alt=person.name+'原版图鉴';poster.showModal();
  };
  document.querySelector('#pdfButton').onclick=async()=>{
    const pack=await mediaReady();
    if(pack && detailPortrait.isConnected)downloadPdf(person,pack);
  };
  mediaReady().then(pack=>{
    if(!pack || !detailPortrait.isConnected) return;
    detailPortrait.src=pack.portrait;
  });
  function reread(){
    const read = document.querySelector('#read');
    sceneObserver.disconnect();
    read.innerHTML=panel('大事年表',events.length+' 条纪事 · 点选条目定位地图',entries(events,{person:true}));
    observeScenes(read);
    drawMap(nodes,person,l=>{
      selectedLocation=l.id;
      selectedEvent=key(l.events.find(e=>e.person===person.slug));
      reread();document.getElementById('event-'+selectedEvent)?.scrollIntoView({block:'nearest',behavior:'smooth'});
    },true);
    eventClicks(events,reread);
  }
  reread();
}
function atlas(id){
  let s='';
  if(id&&locations.some(l=>l.id===id)){
    selectedLocation=id;
    const l=locations.find(l=>l.id===id); const [x,y]=coordinates(l.point);viewBox=[x-290,y-250,580,500];
  }
  app.innerHTML='<section class="wrap"><div class="bar"><div><h2>行迹地图</h2><p class="muted">按古地名、现代地名或人物查找纪事</p></div><input id="placeSearch" class="search" type="search" aria-label="搜索地名或人物" placeholder="例如 定军山、樊城、黄忠"></div><div class="filters suggestions" id="suggest"></div>'+mobileNav()+'<div class="split">'+shellMap()+'<div id="read"></div></div></section>';
  function update(){
    const subset=s ? locations.filter(l=>(l.title+' '+l.events.map(e=>e.modern+' '+e.name+' '+e.place).join(' ')).includes(s)):locations;
    const loc=subset.find(l=>l.id===selectedLocation);
    const curated=['定军山','樊城','合肥','成都','洛阳','江陵','攸县'].map(n=>locations.find(l=>l.title===n)).filter(Boolean);
    const choices=s?subset.slice(0,15):curated;
    document.querySelector('#suggest').innerHTML=choices.map(l=>'<button data-choice="'+l.id+'">'+esc(l.title)+' · '+l.events.length+'</button>').join('');
    const choose=l=>{
      selectedLocation=l.id;
      const [x,y]=coordinates(l.point);
      viewBox=[x-265,y-205,530,410];
      history.replaceState(null,'','#map/'+l.id);update();
    };
    document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>choose(locations.find(l=>l.id===b.dataset.choice)));
    document.querySelector('#read').innerHTML=loc?panel(loc.title,loc.events.length+' 条相关纪事',entries(loc.events)) :panel(s?'搜索结果':'同地纪事',s?subset.length+' 处匹配':'点地图落点或上方地名，查看途经此地的人物。',s&&subset.length===0?'<p class="empty">没有找到相关地点。</p>':'');
    drawMap(subset,null,choose,Boolean(s));
    if(loc)eventClicks(loc.events,update,false);
  }
  document.querySelector('#placeSearch').oninput=e=>{
    s=e.target.value.trim();viewBox=null;selectedLocation='';
    history.replaceState(null,'','#map');update();
  };
  update();
}
function chronology(){
  app.innerHTML='<section class="wrap"><div class="bar"><div><h2>纪年</h2><p class="muted">查看同一年里，各处发生的事</p></div></div><div class="filters year-ctrl"><button id="prevYear" aria-label="上一年">−</button><input id="yr" type="number" min="'+minYear+'" max="'+maxYear+'" value="'+currentYear+'" aria-label="年份"><span>年</span><button id="nextYear" aria-label="下一年">＋</button><input id="slider" type="range" min="'+minYear+'" max="'+maxYear+'" value="'+currentYear+'" aria-label="切换年份"></div>'+mobileNav()+'<div class="split">'+shellMap()+'<div id="read"></div></div></section>';
  function update(){
    const events=flat.filter(e=>matchesYear(e,currentYear));
    const nodes=[...new Map(events.filter(pointOK).map(e=>{const l=eventLocation[key(e)];return [l.id,l];})).values()];
    const loc=nodes.find(l=>l.id===selectedLocation);
    const chosen=loc?events.filter(e=>eventLocation[key(e)]?.id===loc.id):events;
    const read = document.querySelector('#read');
    sceneObserver.disconnect();
    read.innerHTML=panel(loc?currentYear+'年 · '+loc.title:currentYear+'年','共 '+events.length+' 条纪事 · 约年与范围按原图注记', (loc?'<div class="entry"><button id="clearLoc">显示该年全部纪事</button></div>':'')+entries(chosen,{timeline:true}));
    observeScenes(read);
    document.querySelector('#clearLoc')?.addEventListener('click',()=>{selectedLocation='';viewBox=null;update();});
    drawMap(nodes,null,l=>{selectedLocation=l.id;update();},true);
    eventClicks(chosen,update);
  }
  function set(y){
    if(!Number.isFinite(y))return;
    currentYear=Math.max(minYear,Math.min(maxYear,Math.trunc(y)));
    document.querySelector('#yr').value=currentYear;
    document.querySelector('#slider').value=currentYear;
    viewBox=null;selectedLocation='';selectedEvent='';update();
  }
  document.querySelector('#slider').oninput=e=>set(Number(e.target.value));
  const yearField=document.querySelector('#yr');
  yearField.oninput=()=>{
    if(yearField.value.length===3) {
      const y=Number(yearField.value);
      if(y>=minYear && y<=maxYear)set(y);
    }
  };
  yearField.onchange=()=>{if(yearField.value)set(Number(yearField.value));};
  yearField.onkeydown=e=>{if(e.key==='Enter' && yearField.value)set(Number(yearField.value));};

  document.querySelector('#prevYear').onclick=()=>set(currentYear-1);
  document.querySelector('#nextYear').onclick=()=>set(currentYear+1);
  update();
}
function render(){
  sceneObserver.disconnect();
  const [page,id,extra]=route();
  const mode=page==='person'?'person/'+id:page;
  if(mode!==renderedMode){viewBox=null;selectedLocation='';selectedEvent='';renderedMode=mode;}
  document.querySelectorAll('nav a').forEach(a=>{
    if(a.hash==='#'+(page==='person'?'people':page))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  if(page==='person'&&byId[id]){detail(byId[id],extra);}
  else if(page==='map'){atlas(id);}
  else if(page==='years'){chronology();}
  else{gallery();}
  bindMobileNav();
}
window.addEventListener('hashchange',()=>{selectedEvent='';render();window.scrollTo(0,0);});
render();

