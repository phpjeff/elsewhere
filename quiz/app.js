/* Country geometry and visit records are separate so a future account repository
   and per-country photo renderer can replace local storage without changing IDs. */
const COUNTRY_CODES = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW PS VA'.split(' ');
// State IDs are FIPS codes, namespaced to avoid country-code collisions.
const STATE_IDS=new Set('01 02 04 05 06 08 09 10 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56'.split(' '));
let worldFeatures=[],worldPlaces=[],stateFeatures=null,viewRequest=0;
const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
let selected=null,features=[],paths,projection,path,zoom,svg,layer,width,height,toastTimer;
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
let viewMode='map', globeRadius=1, lastTransform, drawingFrame=0, programmaticPan=false;
function redrawGlobe(){
  if(drawingFrame)return;
  drawingFrame=requestAnimationFrame(()=>{drawingFrame=0;layer.selectAll('path').attr('d',path);renderLabels()});
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
  renderLabels();
  $('tooltip').hidden=true;
  document.querySelectorAll('.ocean-label').forEach(el=>el.style.opacity=viewMode!=='map'||transform.k>1.3?'0':'.7');
}
function configureView(){
  stopNavigation();stopGlide();cancelAnimationFrame(drawingFrame);drawingFrame=0;
  width=innerWidth;height=innerHeight;
  const rotation=viewMode==='globe'&&projection?.rotate?projection.rotate():[-15,-20,0];
  if(viewMode==='globe'){
    globeRadius=Math.max(60,Math.min(width*.43,height*.34));
    projection=d3.geoOrthographic().translate([width/2,height*.55]).scale(globeRadius).rotate(rotation).clipAngle(90);
  }else if(viewMode==='states'){
    projection=d3.geoAlbersUsa().fitExtent([[22,height*.28],[width-22,height*.86]],{type:'FeatureCollection',features});
  }else{
    projection=d3.geoNaturalEarth1().fitExtent([[22,height*.18],[width-22,height*.87]],{type:'FeatureCollection',features:features.filter(f=>f.properties.ADM0_A3!=='ATA')});
  }
  path.projection(projection);
  layer.select('.globe-ocean').style('display',viewMode==='globe'?null:'none');
  layer.select('.graticule').style('display',viewMode==='states'?'none':null);
  layer.selectAll('path').attr('d',d=>viewMode==='states'&&d.type!=='Feature'?null:path(d));
  zoom.extent([[0,0],[width,height]]).translateExtent(viewMode==='globe'?[[-Infinity,-Infinity],[Infinity,Infinity]]:[[-width*.5,-height*.5],[width*1.5,height*1.5]]);
  lastTransform=d3.zoomIdentity;
  svg.call(zoom.transform,d3.zoomIdentity);
}
async function loadStates(){
  if(stateFeatures)return stateFeatures;
  for(const url of ['../assets/states.geojson','https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json','https://unpkg.com/us-atlas@3.0.1/states-10m.json']){
    try{
      const response=await fetch(url);
      if(!response.ok)continue;
      const data=await response.json();
      const collection=data.type==='Topology'?topojson.feature(data,data.objects.states):data;
      const result=collection.features.filter(f=>STATE_IDS.has(String(f.id).padStart(2,'0'))).map(f=>({...f,code:`state:${String(f.id).padStart(2,'0')}`,isState:true,properties:{...f.properties,CONTINENT:'UNITED STATES'}}));
      if(result.length!==50||new Set(result.map(f=>f.code)).size!==50)continue;
      stateFeatures=result;
      return result;
    }catch{}
  }
  throw new Error('State map unavailable');
}
async function switchView(mode){
  const request=++viewRequest;
  if(!svg||mode===viewMode)return;
  if(mode==='states'){
    notify('Loading US states…');
    try{await loadStates()}catch{if(request===viewRequest)notify('US states could not load. Check your connection and try again.');return}
    if(request!==viewRequest)return;
  }
  const changingDataset=(mode==='states')!==(viewMode==='states');
  viewMode=mode;
  if(changingDataset){
    selected=null;$('country-card').hidden=true;$('tooltip').hidden=true;
    $('search').value='';
    features=mode==='states'?stateFeatures:worldFeatures;
    places=mode==='states'?features.map(f=>({code:f.code,name:f.properties.name,isState:true})).sort((a,b)=>a.name.localeCompare(b.name)):worldPlaces;
    renderFeatures();
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mode)));
  document.body.classList.toggle('globe-view',mode==='globe');
  document.body.classList.toggle('states-view',mode==='states');
  const states=mode==='states';
  $('list-title').textContent=states?'EXPLORE THE UNITED STATES':'EXPLORE THE WORLD';
  $('focus-button').textContent=states?'Zoom to state ↗':'Zoom to country ↗';
  $('reset').setAttribute('aria-label',states?'Show all US states':'Show whole world');
  $('map').setAttribute('aria-label',`Interactive ${states?'US states':'world'} map. Arrow keys pan, plus and minus zoom, Home resets. Search to select ${states?'states':'countries'} with a keyboard.`);
  $('country-card').setAttribute('aria-label',states?'Selected state':'Selected country');
  $('close-card').setAttribute('aria-label',states?'Close state details':'Close country details');
  $('close-list').setAttribute('aria-label',states?'Close state list':'Close country list');
  
  document.querySelector('.hint').textContent=`Drag to explore · Scroll to zoom · Click a ${states?'state':'country'} to begin`;
  configureView();
  if(mode==='globe')projection.rotate([-15,-20,0]);
  if(selected)focusCountry(selected);
  else if(mode==='globe')redrawGlobe();
  update();
  if(states)notify('Explore all 50 US states');
}
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
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
const QUIZ_KEY='elsewhere.quiz.v1';
let answers={},graded={world:false,states:false},learning=false,learnAll=true;
try{const saved=JSON.parse(localStorage.getItem(QUIZ_KEY));if(saved?.version===1&&saved.answers&&typeof saved.answers==='object'){answers=Object.fromEntries(Object.entries(saved.answers).filter(([k,v])=>typeof v==='string'&&v.length<=100));graded={world:saved.graded?.world===true,states:saved.graded?.states===true}}}catch{}
const dataset=()=>viewMode==='states'?'states':'world';
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const aliases={US:['USA','United States of America'],GB:['UK','United Kingdom','Great Britain'],CZ:['Czech Republic'],TR:['Turkey','Türkiye'],CI:['Ivory Coast','Cote d’Ivoire'],CD:['DR Congo','DRC','Democratic Republic of the Congo','Congo Kinshasa'],CG:['Republic of the Congo','Congo Brazzaville'],KR:['South Korea','Republic of Korea'],KP:['North Korea'],VA:['Vatican City','Holy See'],SZ:['Swaziland'],MM:['Burma'],CV:['Cape Verde'],TL:['East Timor']};
function correct(place){return [place.name,...(aliases[place.code]||[])].some(name=>normalize(name)===normalize(answers[place.code]||''))}
function persist(){try{localStorage.setItem(QUIZ_KEY,JSON.stringify({version:1,answers,graded}))}catch{notify('Browser storage unavailable; answers last only this session.')}}
function revealed(place){return learning?(learnAll||selected?.code===place.code):(graded[dataset()]&&!!answers[place.code])}
function update(){
 const active=places.filter(p=>p.isState||p.isCountry!==false),entered=active.filter(p=>answers[p.code]),isGraded=graded[dataset()],right=entered.filter(correct).length;
 $('count').textContent=isGraded&&!learning?right:entered.length;
 document.querySelector('.denominator').textContent=` / ${isGraded&&!learning?entered.length:active.length}`;
 document.querySelector('.progress-caption').textContent=isGraded&&!learning?'correct answers':`${viewMode==='states'?'states':'countries'} answered`;
 $('percent').textContent=isGraded&&!learning?`${entered.length?Math.round(right/entered.length*100):0}% correct · ${active.length-entered.length} blank`:`${active.length-entered.length} still blank`;
 $('progress').style.width=`${(isGraded&&!learning?right:entered.length)/active.length*100||0}%`;
 $('grade').disabled=learning||!entered.length;
 $('quiz-mode').setAttribute('aria-pressed',String(!learning));
 $('learn-all').setAttribute('aria-pressed',String(learning&&learnAll));
 $('learn-click').setAttribute('aria-pressed',String(learning&&!learnAll));
 const canSearch=learning&&learnAll;
 $('search-wrap').hidden=!canSearch;
 if(!canSearch)$('search').value='';
 if(paths)paths.classed('selected',d=>d.code===selected?.code).style('fill',d=>learning?null:answers[d.code]?(isGraded?(correct(places.find(p=>p.code===d.code))?'#4d8a78':'#b77e83'):'#c49b53'):null).attr('aria-label',d=>{const p=places.find(p=>p.code===d.code);return revealed(p)?p.name:`Unnamed ${viewMode==='states'?'state':'country'} ${active.findIndex(p=>p.code===d.code)+1}`});
 renderLabels();renderList();if(selected)renderCard();
}
function labelPosition(feature){
 const {geometry,properties}=feature;
 const {LABEL_X:longitude,LABEL_Y:latitude}=properties;
 // Natural Earth provides label points so distant territories don't pull labels off the mainland.
 if(Number.isFinite(longitude)&&Number.isFinite(latitude)){
   const point=path.centroid({type:'Point',coordinates:[longitude,latitude]});
   if(point.every(Number.isFinite))return point;
 }

 if(geometry.type!=='MultiPolygon')return path.centroid(feature);
 let largestPolygon=null,largestArea=0;
 for(const coordinates of geometry.coordinates){
   const polygon={type:'Polygon',coordinates};
   const area=path.area(polygon);
   if(area>largestArea){
     largestPolygon=polygon;
     largestArea=area;
   }
 }
 return largestPolygon?path.centroid(largestPolygon):path.centroid(feature);
}
function renderLabels(){
 if(!layer||!path)return;
 const labels=new Map();
 for(const feature of features){
   const place=places.find(p=>p.code===feature.code);
   if(!place||!revealed(place)||labels.has(place.code))continue;
   const [x,y]=labelPosition(feature);
   if(Number.isFinite(x)&&Number.isFinite(y))labels.set(place.code,{code:place.code,name:place.name,x,y});
 }
 const k=viewMode==='globe'?1:(lastTransform?.k||1);
 layer.selectAll('.map-label').data([...labels.values()],d=>d.code).join('text')
   .attr('class','map-label')
   .attr('transform',d=>`translate(${d.x},${d.y}) scale(${1/k})`)
   .text(d=>d.name);
}
function choose(place){if(!place)return;selected=place;$('country-card').hidden=false;$('answer').value=answers[place.code]||'';update();if(!learning)$('answer').focus()}
function renderCard(){
 $('country-name').textContent=revealed(selected)?selected.name:`Name this ${viewMode==='states'?'state':'country'}`;
 $('region').textContent=learning?'LEARN & EXPLORE':'YOUR GEOGRAPHY QUIZ';
 $('country-status').textContent=learning?(learnAll?'All names are visible.':'Select a place to reveal its name.'):graded[dataset()]&&answers[selected.code]?`${correct(selected)?'✓ Correct':'✕ Incorrect'} · Your answer: ${answers[selected.code]}`:'Enter a name, then save your answer. Grade whenever you’re ready.';
 $('answer-form').hidden=learning;$('clear-answer').disabled=!answers[selected.code];
}
function renderList(){
 const query=$('search').value.trim().toLowerCase();$('results').replaceChildren();
 places.filter(p=>p.isCountry!==false).forEach((p,i)=>{const name=revealed(p)?p.name:answers[p.code]||`Unnamed ${viewMode==='states'?'state':'country'} ${i+1}`;if(!name.toLowerCase().includes(query))return;const b=document.createElement('button');b.className='result';b.textContent=name;b.onclick=()=>{choose(p);$('results-panel').hidden=true;focusCountry(p)};$('results').append(b)});
}
$('answer-form').onsubmit=event=>{
  event.preventDefault();
  if(!selected)return;
  const value=$('answer').value.trim();
  if(!value)return;
  answers[selected.code]=value;
  graded[dataset()]=false;
  persist();
  closeCard();
  notify('Answer saved. Select another place to continue.');
};
$('clear-answer').onclick=()=>{if(!selected)return;delete answers[selected.code];graded[dataset()]=false;$('answer').value='';persist();update()};
$('grade').onclick=()=>{graded[dataset()]=true;persist();update();notify('Graded. Names are shown only for places you answered.')};
$('learn-all').onclick=()=>{learning=true;learnAll=true;update()};
$('learn-click').onclick=()=>{learning=true;learnAll=false;update()};
$('quiz-mode').onclick=()=>{learning=false;update()};
$('new-quiz').onclick=()=>{if(!confirm(`Clear answers for ${viewMode==='states'?'US states':'countries'} and start again?`))return;for(const p of places)delete answers[p.code];graded[dataset()]=false;$('answer').value='';persist();update()};
$('focus-button').onclick=()=>focusCountry(selected);
function closeCard(){selected=null;$('country-card').hidden=true;update()}
$('close-card').onclick=closeCard;
function openList(){$('results-panel').hidden=false;$('list-toggle').setAttribute('aria-expanded','true');renderList()}
$('search').onfocus=openList;$('search').oninput=openList;
$('list-toggle').onclick=()=>{if($('results-panel').hidden)openList();else $('close-list').click()};
$('close-list').onclick=()=>{$('results-panel').hidden=true;$('list-toggle').setAttribute('aria-expanded','false')};
$('about-button').onclick=()=>$('about').showModal();$('close-about').onclick=()=>$('about').close();
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
  if(event.key==='/'&&!$('search-wrap').hidden){event.preventDefault();stopNavigation();$('search').focus();return}
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
async function loadData(){for(const url of ['../assets/countries.geojson','https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson','https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson']){try{const response=await fetch(url);if(response.ok){const data=await response.json();if(data.type==='FeatureCollection')return data}}catch{}}throw new Error('Map data unavailable')}
function renderFeatures(){
paths=layer.selectAll('.country').data(features,d=>d.code).join('path').attr('class','country').attr('tabindex',0).attr('role','button').on('click',(event,d)=>choose(places.find(c=>c.code===d.code))).on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(places.find(c=>c.code===d.code))}});
}
async function init(){update();try{if(!window.d3)throw new Error('Map library unavailable');const data=await loadData();features=data.features.map(normalizeFeature).filter(f=>f.isCountry);
// Very small states absent from generalized polygons remain visible and selectable.
const tiny={VA:[12.4534,41.9029],MC:[7.4246,43.7384],NR:[166.9315,-.5228],TV:[179.194,-8.5211]};for(const [code,coordinates] of Object.entries(tiny)){if(!features.some(f=>f.code===code))features.push({type:'Feature',code,properties:{CONTINENT:'SMALL STATES'},geometry:{type:'Point',coordinates}})}
places=buildPlaces(features);worldFeatures=features;worldPlaces=places;
svg=d3.select('#map');layer=svg.append('g');projection=d3.geoNaturalEarth1();path=d3.geoPath(projection).pointRadius(2);zoom=d3.zoom().scaleExtent([1,35]).clickDistance(6).on('start.inertia',startDrag).on('end.inertia',releaseDrag).on('zoom',renderZoom);svg.call(zoom).on('wheel.zoom',null).on('wheel.smooth',wheelZoom,{passive:false});layer.append('path').datum({type:'Sphere'}).attr('class','globe-ocean');layer.append('path').datum(d3.geoGraticule10()).attr('class','graticule');renderFeatures();
configureView();window.addEventListener('resize',configureView);$('loading').hidden=true;document.querySelectorAll('[data-view]').forEach(button=>button.disabled=false);update();const missing=countries.filter(c=>!features.some(f=>f.code===c.code));if(missing.length)console.warn('Search-only countries:',missing.map(c=>c.name));}catch(error){$('loading').textContent='The map couldn’t load. Check your internet connection and refresh. Your country checklist is still available through search.';console.error(error)}}
init();
