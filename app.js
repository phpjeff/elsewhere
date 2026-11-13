/* Country geometry and visit records are separate so a future account repository
   and per-country photo renderer can replace local storage without changing IDs. */
const COUNTRY_CODES = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW PS VA'.split(' ');
const KEY='elsewhere.visits.v1';
const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
const PALETTE=[
  {id:'fern',color:'#4d8a78',name:'Fern'},
  {id:'sage',color:'#8eaa7b',name:'Sage'},
  {id:'olive',color:'#a7a35e',name:'Olive'},
  {id:'ochre',color:'#c49b53',name:'Ochre'},
  {id:'clay',color:'#c18464',name:'Clay'},
  {id:'rose',color:'#b77e83',name:'Dusty rose'},
  {id:'heather',color:'#9b85a5',name:'Heather'},
  {id:'slate',color:'#7c91b1',name:'Slate blue'},
  {id:'coastal',color:'#65a1aa',name:'Coastal blue'},
  {id:'stone',color:'#978c7e',name:'Stone'}
];
const repository={
  read(){try{const raw=JSON.parse(localStorage.getItem(KEY)||'{}');return raw?.version===1?raw:{}}catch{return {}}},
  load(){const value=this.read().countries;return value&&typeof value==='object'&&!Array.isArray(value)?value:{}},
  loadCategories(){const names=this.read().categories;return Object.fromEntries(PALETTE.map(p=>[p.id,typeof names?.[p.id]==='string'&&names[p.id].trim()?names[p.id].trim().slice(0,32):p.name]))},
  save(countries){try{localStorage.setItem(KEY,JSON.stringify({version:1,countries,categories,categoryVisits}));return true}catch{return false}}
};
function loadCategoryVisits(){
  const saved=repository.read().categoryVisits;
  return Object.fromEntries(PALETTE.filter(({id})=>typeof saved?.[id]==='boolean')
    .map(({id})=>[id,saved[id]]));
}
let categories=repository.loadCategories(),categoryVisits=loadCategoryVisits(),categoryFilter='all';
function categoryFor(code){return PALETTE.find(p=>p.id===visits[code]?.categoryId)}
function saveChanges(message){const saved=repository.save(visits);update();notify(saved?message:'Browser storage unavailable. Changes last only this session.')}
let visits=repository.load(),selected=null,filter='all',features=[],paths,projection,path,zoom,svg,layer,width,height,toastTimer;
const $=id=>document.getElementById(id);
const countries=COUNTRY_CODES.map(code=>({code,name:countryNames.of(code)})).sort((a,b)=>a.name.localeCompare(b.name));
let places=[...countries];
// Preserve existing country keys; map areas outside the checklist get their own IDs.
function normalizeFeature(feature){
  const p=feature.properties;
  const overrides={FRA:'FR',NOR:'NO',SDS:'SS',PSX:'PS',VAT:'VA',KOS:null,SAH:null,SOL:null};
  const iso=Object.hasOwn(overrides,p.ADM0_A3)?overrides[p.ADM0_A3]:[p.ISO_A2_EH,p.ISO_A2].find(value=>/^[A-Z]{2}$/.test(value||''));
  const isCountry=COUNTRY_CODES.includes(iso);
  const code=isCountry?iso:`area:${p.ADM0_A3||p.SU_A3||p.NAME}`;
  return {...feature,code,isCountry};
}
function buildPlaces(mapFeatures){
  const entries=new Map(countries.map(country=>[country.code,{...country,isCountry:true}]));
  for(const feature of mapFeatures){
    if(!entries.has(feature.code))entries.set(feature.code,{code:feature.code,name:feature.properties.NAME_EN||feature.properties.ADMIN||feature.properties.NAME,isCountry:false});
  }
  return [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function visited(code){
  const category=categoryFor(code);
  // Keep older visits until their color gets a rule or the place is reassigned.
  return (category && categoryVisits[category.id]) ?? !!visits[code]?.visited;
}
let viewMode='map', globeRadius=1, lastTransform, drawingFrame=0, programmaticPan=false;
function redrawGlobe(){
  if(drawingFrame)return;
  drawingFrame=requestAnimationFrame(()=>{drawingFrame=0;layer.selectAll('path').attr('d',path)});
}
function panBy(x,y){
  programmaticPan=true;
  try{svg.call(zoom.translateBy,x,y)}finally{programmaticPan=false}
}
function renderZoom(event){
  sampleDrag(event);
  const transform=event.transform;
  if(viewMode==='globe'){
    const source=event.sourceEvent;
    const dragging=source?.type==='mousemove'||(source?.type==='touchmove'&&source.touches.length===1);
    if(lastTransform&&(dragging||programmaticPan)){
      const rotation=projection.rotate();
      const degrees=180/(Math.PI*globeRadius*transform.k);
      rotation[0]+=(transform.x-lastTransform.x)*degrees;
      rotation[1]=Math.max(-89.9,Math.min(89.9,rotation[1]-(transform.y-lastTransform.y)*degrees));
      projection.rotate(rotation);
    }
    projection.scale(globeRadius*transform.k);
    layer.attr('transform',null);
    redrawGlobe();
  }else layer.attr('transform',transform);
  lastTransform=transform;
  $('tooltip').hidden=true;
  document.querySelectorAll('.ocean-label').forEach(el=>el.style.opacity=viewMode==='globe'||transform.k>1.3?'0':'.7');
}
function configureView(){
  stopNavigation();stopGlide();cancelAnimationFrame(drawingFrame);drawingFrame=0;
  width=innerWidth;height=innerHeight;
  const rotation=viewMode==='globe'&&projection?.rotate?projection.rotate():[-15,-20,0];
  if(viewMode==='globe'){
    globeRadius=Math.max(60,Math.min(width*.43,height*.34));
    projection=d3.geoOrthographic().translate([width/2,height*.55]).scale(globeRadius).rotate(rotation).clipAngle(90);
  }else{
    projection=d3.geoNaturalEarth1().fitExtent([[22,height*.18],[width-22,height*.87]],{type:'FeatureCollection',features:features.filter(f=>f.properties.ADM0_A3!=='ATA')});
  }
  path.projection(projection);
  layer.select('.globe-ocean').style('display',viewMode==='globe'?null:'none');
  layer.selectAll('path').attr('d',path);
  zoom.extent([[0,0],[width,height]]).translateExtent(viewMode==='globe'?[[-Infinity,-Infinity],[Infinity,Infinity]]:[[-width*.5,-height*.5],[width*1.5,height*1.5]]);
  lastTransform=d3.zoomIdentity;
  svg.call(zoom.transform,d3.zoomIdentity);
}
function switchView(mode){
  if(!svg||mode===viewMode)return;
  viewMode=mode;
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mode)));
  document.body.classList.toggle('globe-view',mode==='globe');
  configureView();
  if(mode==='globe')projection.rotate([-15,-20,0]);
  if(selected)focusCountry(selected);
  else if(mode==='globe')redrawGlobe();
}
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('visited-only').onclick=()=>{
  const button=$('visited-only');
  const enabled=button.getAttribute('aria-checked')!=='true';
  button.setAttribute('aria-checked',String(enabled));
  $('map').classList.toggle('visited-only',enabled);
  $('tooltip').hidden=true;
};
function focusGlobe(feature){
  const center=d3.geoCentroid(feature);
  const start=projection.rotate();
  const targetLongitude=-center[0];
  const shortest=((targetLongitude-start[0]+540)%360)-180;
  const target=[start[0]+shortest,-center[1],0];
  const interpolate=d3.interpolateArray(start,target);
  const current=d3.zoomTransform(svg.node());
  svg.transition().duration(duration).ease(d3.easeCubicInOut)
    .tween('rotation',()=>t=>{projection.rotate(interpolate(t));redrawGlobe()})
    .call(zoom.transform,d3.zoomIdentity.translate(current.x,current.y).scale(1.7));
}
const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:650;
// Sample actual map movement so inertia follows the drag at every zoom level.
let glideFrame=0, dragSamples=[], dragEligible=false;
function stopGlide(){cancelAnimationFrame(glideFrame);glideFrame=0}
function startDrag(event){
  if(!event.sourceEvent)return;
  stopGlide();
  const source=event.sourceEvent;
  dragEligible=source.type==='mousedown'||(source.type==='touchstart'&&source.touches.length===1);
  dragSamples=dragEligible?[{x:event.transform.x,y:event.transform.y,time:performance.now()}]:[];
}
function sampleDrag(event){
  const source=event.sourceEvent;
  if(!source||!dragEligible)return;
  if(source.touches&&source.touches.length!==1){dragEligible=false;return}
  if(source.type!=='mousemove'&&source.type!=='touchmove')return;
  const time=performance.now();
  dragSamples.push({x:event.transform.x,y:event.transform.y,time});
  dragSamples=dragSamples.filter(sample=>time-sample.time<=100);
}
function releaseDrag(event){
  if(!event.sourceEvent)return;
  const eligible=dragEligible;
  dragEligible=false;
  if(!eligible||matchMedia('(prefers-reduced-motion: reduce)').matches||dragSamples.length<2||event.sourceEvent.type==='touchcancel')return;
  const first=dragSamples[0],last=dragSamples.at(-1),elapsed=last.time-first.time;
  // Holding still before release should never launch a stale flick.
  if(elapsed<8||performance.now()-last.time>80)return;
  let vx=(last.x-first.x)/elapsed,vy=(last.y-first.y)/elapsed;
  const speed=Math.hypot(vx,vy);
  if(speed<0.08)return;
  const cap=Math.min(1,1.8/speed);vx*=cap;vy*=cap;
  const decay=190; // milliseconds: a gentle glide, typically under one second
  let previous=performance.now();
  function frame(now){
    const dt=now-previous;previous=now;
    if(dt>100){stopGlide();return}
    const attenuation=Math.exp(-dt/decay);
    const before=d3.zoomTransform(svg.node());
    panBy(vx*decay*(1-attenuation)/before.k,vy*decay*(1-attenuation)/before.k);
    const after=d3.zoomTransform(svg.node());
    vx*=attenuation;vy*=attenuation;
    if(Math.abs(after.x-before.x)<0.001)vx=0;
    if(Math.abs(after.y-before.y)<0.001)vy=0;
    if(Math.hypot(vx,vy)>0.015)glideFrame=requestAnimationFrame(frame);
    else glideFrame=0;
  }
  glideFrame=requestAnimationFrame(frame);
}
// Capture input before D3 handles it; all new interactions take control immediately.
for(const type of ['pointerdown','touchstart','wheel','keydown'])
  window.addEventListener(type,stopGlide,{capture:true,passive:true});
window.addEventListener('touchstart',event=>{if(event.touches.length>1)dragEligible=false},{capture:true,passive:true});
window.addEventListener('blur',stopGlide);
document.addEventListener('visibilitychange',stopGlide);
function notify(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800)}
function update(){const count=countries.filter(c=>visited(c.code)).length;$('count').textContent=count;const areas=places.filter(p=>p.isCountry===false&&visited(p.code)).length;$('area-count').textContent=areas?`+ ${areas} other ${areas===1?'area':'areas'} visited`:'';$('area-count').hidden=!areas;$('percent').textContent=`${Math.round(count/195*100)}% of the world`;$('progress').style.width=`${count/195*100}%`;if(paths)paths.classed('visited',d=>visited(d.code)).classed('selected',d=>d.code===selected?.code).classed('categorized',d=>!!categoryFor(d.code)).style('--country-color',d=>categoryFor(d.code)?.color||null);renderCategoryFilter();renderList();if(selected)renderCard()}
function renderList(){const query=$('search').value.trim().toLowerCase();const matches=places.filter(c=>(filter!=='visited'||visited(c.code))&&(categoryFilter==='all'||(categoryFilter==='none'?!categoryFor(c.code):categoryFor(c.code)?.id===categoryFilter))&&(c.name.toLowerCase().includes(query)||c.code.toLowerCase()===query));$('results').replaceChildren();for(const country of matches){const button=document.createElement('button');button.className='result';const name=document.createElement('span');name.textContent=country.name;if(country.isCountry===false){const kind=document.createElement('span');kind.className='place-kind';kind.textContent='Territory / other area';name.append(kind)}const status=document.createElement('small');const category=categoryFor(country.code);status.textContent=(visited(country.code)?'✓ ':'')+(category?categories[category.id]:(visited(country.code)?'Visited':'↗'));if(category){status.className='category-badge';status.style.setProperty('--badge-color',category.color)}button.append(name,status);button.onclick=()=>{choose(country);$('results-panel').hidden=true;$('list-toggle').setAttribute('aria-expanded','false');focusCountry(country)};$('results').append(button)}if(!matches.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=query?'No places found. Try another name.':'Your next adventure starts here.';$('results').append(empty)}}
function choose(country){
  selected=country;
  $('country-card').hidden=false;
  loadCategoryForm();
  update();
}
function renderCard(){
  const feature=features.find(f=>f.code===selected.code);
  $('country-name').textContent=selected.name;
  $('region').textContent=feature?.properties.CONTINENT||'YOUR TRAVEL JOURNAL';
  $('country-status').textContent=visited(selected.code)?'✓ Visited':'Unvisited';
  $('place-note').hidden=selected.isCountry!==false;
  $('place-note').textContent='Territory / other area · saved separately from the 195-country count.';
  renderSwatches();
}
function loadCategoryForm(){
  const active=categoryFor(selected?.code);
  $('category-name').setCustomValidity('');
  $('category-name').value=active?categories[active.id]:'';
  $('category-counts-as-visited').checked=active?categoryVisits[active.id]===true:false;
}
function assignCategory(categoryId){
  const record={...visits[selected.code],updatedAt:new Date().toISOString()};
  delete record.visited;
  if(categoryId)record.categoryId=categoryId;
  else delete record.categoryId;
  visits[selected.code]=record;
  loadCategoryForm();
  saveChanges(categoryId?`${selected.name} grouped as ${categories[categoryId]}`:`Color and visit cleared for ${selected.name}`);
}
function renderCategoryFilter(){
  const select=$('category-filter');select.replaceChildren();
  const options=[['all','All categories'],['none','No category'],...PALETTE.map(p=>[p.id,`${categories[p.id]} (${places.filter(c=>categoryFor(c.code)?.id===p.id).length})`])];
  for(const [value,label] of options){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option)}
  select.value=categoryFilter;
}
function renderSwatches(){
  const active=categoryFor(selected.code);
  // Keep swatch elements stable so keyboard focus survives selection.
  if(!$('color-swatches').children.length){
    for(const color of PALETTE){
      const button=document.createElement('button');button.type='button';button.className='color-swatch';button.dataset.category=color.id;button.style.setProperty('--swatch',color.color);
      button.onclick=()=>{
        if(categoryFor(selected.code)?.id!==color.id)assignCategory(color.id);
      };
      $('color-swatches').append(button);
    }
  }
  for(const button of $('color-swatches').children){const color=PALETTE.find(p=>p.id===button.dataset.category);const checked=active?.id===color.id;button.setAttribute('aria-pressed',String(checked));button.setAttribute('aria-label',`${color.name}: ${categories[color.id]}`);button.title=categories[color.id];button.textContent=checked?'✓':''}
  $('category-form').hidden=!active;
  const isVisited=visited(selected.code);
  $('clear-category').disabled=!active&&!isVisited;
  $('clear-category').textContent=active?'Clear':'Clear visit';
  $('category-summary').textContent=active
    ? `Group: ${categories[active.id]}`
    : isVisited?'Choose a color to set how this place counts.':'Choose a color to assign a category.';
}
$('category-filter').onchange=event=>{categoryFilter=event.target.value;renderList()};
$('category-form').onsubmit=event=>{
  event.preventDefault();if(!selected)return;
  const category=categoryFor(selected.code),name=$('category-name').value.trim();
  if(!category)return;
  if(!name){$('category-name').setCustomValidity('Enter a category name.');$('category-name').reportValidity();return}
  categories[category.id]=name.slice(0,32);
  categoryVisits[category.id]=$('category-counts-as-visited').checked;
  loadCategoryForm();
  saveChanges('Category updated for all places using this color');
};
$('category-name').addEventListener('input',()=>$('category-name').setCustomValidity(''));
$('clear-category').onclick=()=>{if(selected)assignCategory(null)};
$('focus-button').onclick=()=>focusCountry(selected);
$('close-card').onclick=()=>{selected=null;$('country-card').hidden=true;update()};
function openList(){ $('results-panel').hidden=false;$('list-toggle').setAttribute('aria-expanded','true');renderList() }
$('search').addEventListener('focus',openList);$('search').addEventListener('input',openList);$('search').addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();$('results').querySelector('button')?.focus()}});
$('list-toggle').onclick=()=>{const open=$('results-panel').hidden;$('results-panel').hidden=!open;$('list-toggle').setAttribute('aria-expanded',String(open));renderList()};$('close-list').onclick=()=>{$('results-panel').hidden=true;$('list-toggle').setAttribute('aria-expanded','false')};
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===button));renderList()});
$('about-button').onclick=()=>$('about').showModal();$('close-about').onclick=()=>$('about').close();
window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){visits=repository.load();categories=repository.loadCategories();categoryVisits=loadCategoryVisits();loadCategoryForm();update()}});
// Keyboard motion uses elapsed time rather than OS key-repeat timing.
const navigationKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-']);
const heldKeys=new Set();
let keyFrame=0,keyTime=0,panX=0,panY=0,zoomSpeed=0,wheelTarget=null;
function stopNavigation(){
  cancelAnimationFrame(keyFrame);keyFrame=0;heldKeys.clear();panX=panY=zoomSpeed=0;
  wheelTarget=null;if(svg)svg.interrupt();
}
function keyboardFrame(now){
  const dt=Math.min(32,now-keyTime);keyTime=now;
  const dx=Number(heldKeys.has('ArrowLeft'))-Number(heldKeys.has('ArrowRight'));
  const dy=Number(heldKeys.has('ArrowUp'))-Number(heldKeys.has('ArrowDown'));
  const dz=Number(heldKeys.has('+')||heldKeys.has('='))-Number(heldKeys.has('-'));
  const length=Math.max(1,Math.hypot(dx,dy));
  const blend=1-Math.exp(-dt/(heldKeys.size?85:190));
  panX+=(dx/length*.7-panX)*blend;panY+=(dy/length*.7-panY)*blend;
  zoomSpeed+=(dz*.002-zoomSpeed)*blend;
  const transform=d3.zoomTransform(svg.node());
  if(Math.hypot(panX,panY)>.005)panBy(panX*dt/transform.k,panY*dt/transform.k);
  if(Math.abs(zoomSpeed)>.00001)svg.call(zoom.scaleBy,Math.exp(zoomSpeed*dt));
  if(heldKeys.size||Math.hypot(panX,panY)>.005||Math.abs(zoomSpeed)>.00001)keyFrame=requestAnimationFrame(keyboardFrame);
  else{keyFrame=0;panX=panY=zoomSpeed=0}
}
function reset(){stopNavigation();stopGlide();if(viewMode==='globe'){projection.rotate([-15,-20,0]);redrawGlobe()}if(svg)svg.transition().duration(duration).call(zoom.transform,d3.zoomIdentity)}
function scale(factor){stopNavigation();stopGlide();if(svg)svg.transition().duration(duration?420:0).ease(d3.easeCubicOut).call(zoom.scaleBy,factor)}
function wheelZoom(event){
  event.preventDefault();
  const previousTarget=wheelTarget;
  stopNavigation();stopGlide();
  const current=d3.zoomTransform(svg.node());
  const delta=-event.deltaY*(event.deltaMode===1?.05:event.deltaMode?.5:.002)*(event.ctrlKey?10:1);
  wheelTarget=Math.max(1,Math.min(35,(previousTarget??current.k)*Math.pow(2,Math.max(-1,Math.min(1,delta)))));
  svg.transition().duration(duration?260:0).ease(d3.easeCubicOut)
    .call(zoom.scaleTo,wheelTarget,d3.pointer(event,svg.node()))
    .on('end.wheel',()=>{wheelTarget=null});
}
$('zoom-in').onclick=()=>scale(1.6);$('zoom-out').onclick=()=>scale(1/1.6);$('reset').onclick=reset;
window.addEventListener('keydown',event=>{
  if($('about').open||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='Escape'){stopNavigation();$('close-list').click();$('close-card').click();$('search').blur();return}
  if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='/'){event.preventDefault();stopNavigation();$('search').focus();return}
  if(!svg)return;
  if(event.key==='Home'){event.preventDefault();reset();return}
  if(!navigationKeys.has(event.key))return;
  event.preventDefault();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){
    const offsets={ArrowLeft:[90,0],ArrowRight:[-90,0],ArrowUp:[0,90],ArrowDown:[0,-90]};
    if(offsets[event.key]){const k=d3.zoomTransform(svg.node()).k;panBy(...offsets[event.key].map(n=>n/k))}
    else svg.call(zoom.scaleBy,event.key==='-'?1/1.3:1.3);
    return;
  }
  svg.interrupt();wheelTarget=null;heldKeys.add(event.key);
  if(!keyFrame){keyTime=performance.now();keyFrame=requestAnimationFrame(keyboardFrame)}
});
window.addEventListener('keyup',event=>{heldKeys.delete(event.key);if(event.code==='Equal'){heldKeys.delete('+');heldKeys.delete('=')}});
for(const type of ['pointerdown','touchstart','blur'])window.addEventListener(type,stopNavigation,{capture:true,passive:true});
document.addEventListener('visibilitychange',stopNavigation);
document.addEventListener('focusin',event=>{if(event.target.id!=='map')stopNavigation()});
function focusCountry(country){stopNavigation();stopGlide();if(!svg)return;const feature=features.find(f=>f.code===country.code);if(!feature)return;if(viewMode==='globe'){focusGlobe(feature);return}const [[x0,y0],[x1,y1]]=path.bounds(feature);const k=Math.min(28,Math.max(1,Math.min(width*.58/(x1-x0||5),height*.58/(y1-y0||5))));svg.transition().duration(duration).call(zoom.transform,d3.zoomIdentity.translate(width/2,height/2).scale(k).translate(-(x0+x1)/2,-(y0+y1)/2))}
async function loadData(){for(const url of ['assets/countries.geojson','https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson','https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson']){try{const response=await fetch(url);if(response.ok){const data=await response.json();if(data.type==='FeatureCollection')return data}}catch{}}throw new Error('Map data unavailable')}
async function init(){update();try{if(!window.d3)throw new Error('Map library unavailable');const data=await loadData();features=data.features.map(normalizeFeature);
// Very small states absent from generalized polygons remain visible and selectable.
const tiny={VA:[12.4534,41.9029],MC:[7.4246,43.7384],NR:[166.9315,-.5228],TV:[179.194,-8.5211]};for(const [code,coordinates] of Object.entries(tiny)){if(!features.some(f=>f.code===code))features.push({type:'Feature',code,properties:{CONTINENT:'SMALL STATES'},geometry:{type:'Point',coordinates}})}
places=buildPlaces(features);
svg=d3.select('#map');layer=svg.append('g');projection=d3.geoNaturalEarth1();path=d3.geoPath(projection).pointRadius(2);zoom=d3.zoom().scaleExtent([1,35]).clickDistance(6).on('start.inertia',startDrag).on('end.inertia',releaseDrag).on('zoom',renderZoom);svg.call(zoom).on('wheel.zoom',null).on('wheel.smooth',wheelZoom,{passive:false});layer.append('path').datum({type:'Sphere'}).attr('class','globe-ocean');layer.append('path').datum(d3.geoGraticule10()).attr('class','graticule');paths=layer.selectAll('.country').data(features).join('path').attr('class',d=>COUNTRY_CODES.includes(d.code)?'country':'country territory').attr('aria-label',d=>places.find(p=>p.code===d.code)?.name).on('click',(event,d)=>{choose(places.find(c=>c.code===d.code));$('results-panel').hidden=true;$('list-toggle').setAttribute('aria-expanded','false')}).on('mousemove',(event,d)=>{const name=places.find(c=>c.code===d.code)?.name;$('tooltip').textContent=name+(visited(d.code)?' · Visited':'')+(categoryFor(d.code)?` · ${categories[categoryFor(d.code).id]}`:'');$('tooltip').hidden=false;$('tooltip').style.left=Math.min(event.clientX+14,width-180)+'px';$('tooltip').style.top=Math.min(event.clientY+16,height-45)+'px'}).on('mouseleave',()=>$('tooltip').hidden=true);
configureView();window.addEventListener('resize',configureView);$('loading').hidden=true;document.querySelectorAll('[data-view]').forEach(button=>button.disabled=false);$('visited-only').disabled=false;update();const missing=countries.filter(c=>!features.some(f=>f.code===c.code));if(missing.length)console.warn('Search-only countries:',missing.map(c=>c.name));}catch(error){$('loading').textContent='The map couldn’t load. Check your internet connection and refresh. Your country checklist is still available through search.';console.error(error)}}
init();
