// Real CalendarWeekView + production CSS; no authenticated/backend operations.
// PIXEL_BROWSER_TOOLS=/path/to/node_modules PIXEL_CALENDAR_EVIDENCE=/tmp/evidence node tests/calendar-palette.browser.mjs
// PIXEL_CALENDAR_BASELINE=1 captures the unmodified baseline (no new-palette assertions).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = path.resolve(process.env.PIXEL_CALENDAR_SOURCE || path.join(import.meta.dirname, '..'));
const tools = process.env.PIXEL_BROWSER_TOOLS;
assert.ok(tools, 'Set PIXEL_BROWSER_TOOLS (external esbuild/playwright; no production dependencies added)');
const { build } = require(path.join(tools, 'esbuild'));
const { chromium } = require(path.join(tools, 'playwright'));
require('tsx/cjs');
const config = require('../tailwind.config.ts').default;
config.content = [source + '/app/**/*.{ts,tsx}'];
const css = (await require('postcss')([require('tailwindcss')(config), require('autoprefixer')]).process(
  fs.readFileSync(source + '/app/globals.css', 'utf8') + '\n' + fs.readFileSync(source + '/app/precision-skin.css', 'utf8'), { from: source + '/app/globals.css' })).css;
const statuses = ['Confirmed', 'Requested', 'Shot', 'Editing', 'Delivered', 'Cancelled', 'Pending'];
// Match page.tsx calendarStatusPill; Pending is a defensive unknown label,
// while Cancelled is deliberately excluded by the live page query.
const pillClasses={Requested:'border-realtor-accent/40 bg-realtor-accent/15 text-realtor-text',Confirmed:'border-realtor-primary/25 bg-realtor-primary/10 text-realtor-primary',Shot:'border-sky-700/20 bg-sky-50 text-sky-900',Editing:'border-amber-700/20 bg-amber-50 text-amber-900',Delivered:'border-realtor-muted/20 bg-realtor-soft text-realtor-text',Cancelled:'border-red-700/20 bg-red-50 text-red-800'};
const fixtures = statuses.map((statusLabel, i) => ({id: 'booking-'+i, kind:'booking', title:statusLabel+' fixture', subtitle:'Realtor · Photography', startsAt:`2026-09-13T${String(13+i).padStart(2,'0')}:00:00Z`, endsAt:`2026-09-13T${String(14+i).padStart(2,'0')}:00:00Z`, localDate:'2026-09-13', href:'/fixture', statusLabel, statusClass:pillClasses[statusLabel]||pillClasses.Confirmed}));
fixtures.push({ ...fixtures[0], id:'overlap', title:'Overlap fixture', startsAt:'2026-09-13T13:30:00Z', endsAt:'2026-09-13T14:30:00Z' });
fixtures.push({ ...fixtures[0], id:'block', kind:'block', title:'Blocked fixture', statusLabel:undefined, startsAt:'2026-09-13T20:00:00Z', endsAt:'2026-09-13T21:00:00Z' });
for (const [i, sourceColor] of ['#8e24aa','#e67c73','#0b8043',undefined].entries()) fixtures.push({ ...fixtures[0], id:'google-'+i, kind:'google', title:'Google '+i+' fixture', statusLabel:'Connected calendar', statusClass:'border-sky-200 bg-sky-100 text-sky-800', sourceColor, startsAt:`2026-09-13T${14+i}:00:00Z`, endsAt:`2026-09-13T${15+i}:00:00Z` });
const bundle = await build({stdin:{contents:`
import React from 'react'; import {createRoot} from 'react-dom/client';
import Calendar from './app/admin/calendar/CalendarWeekView';
const days=Array.from({length:7},(_,i)=>({key:'2026-09-'+(13+i),dateInput:'2026-09-'+(13+i),label:'Sep '+(13+i),shortLabel:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],enabled:true,workStartMinutes:540,workEndMinutes:1020}));
const f=window.fixture;
createRoot(document.getElementById('root')).render(<div className={f.app?'pixel-app-skin admin-earth realtor-theme realtor-backdrop':'admin-earth realtor-theme realtor-backdrop'} data-pixel-default-palette={f.defaultOrg?true:undefined} style={f.custom?{'--realtor-primary':'#993366','--realtor-primary-rgb':'153 51 102'}:{}}><aside style={{fontSize:12,padding:8}}>LOCAL REAL CALENDAR FIXTURE · Fictional data · No submissions</aside><Calendar days={days} items={f.items} catalogItems={[]} navigation={{previousHref:'/fixture',todayHref:'/fixture',nextHref:'/fixture',search:'',weekValue:null,clearSearchHref:null}} calendarMenu={<span>Fixture sources</span>}/></div>);
`,resolveDir:source,loader:'tsx'},bundle:true,write:false,metafile:true,format:'iife',platform:'browser',jsx:'automatic',tsconfig:source+'/tsconfig.json',plugins:[{name:'readonly-boundaries',setup(b){
  b.onResolve({filter:/AddressAutocomplete$/},a=>({path:a.path,namespace:'address'}));
  b.onLoad({filter:/.*/,namespace:'address'},()=>({contents:'export default function AddressAutocomplete(){return null}'}));
  b.onResolve({filter:/^next\/|\/actions$/},a=>({path:a.path,namespace:'boundary'}));
  b.onLoad({filter:/.*/,namespace:'boundary'},a=>({contents:a.path==='next/link'?'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}':`export const useRouter=()=>({refresh(){}});const denied=()=>{window.deniedActions=(window.deniedActions||0)+1;throw Error('No fixture writes')};export const updateBookingServicesFromCalendar=denied,addCalendarBlock=denied,deleteCalendarBlock=denied,updateCalendarBlock=denied,createAdminShoot=denied,moveCalendarBlock=denied,rescheduleCalendarShoot=denied,searchRealtors=denied;`,resolveDir:source}));
  b.onLoad({filter:/\.[jt]sx?$/},a=>{if(a.path.startsWith(source+'/')&&!a.path.includes('/node_modules/')&&!['app/admin/calendar/CalendarWeekView.tsx','lib/booking/timezone.ts','lib/booking/catalog-rules.ts'].includes(path.relative(source,a.path)))throw Error('Non-allowlisted module '+a.path);});
}}]});
const evidence = process.env.PIXEL_CALENDAR_EVIDENCE;
const baseline = Boolean(process.env.PIXEL_CALENDAR_BASELINE);
if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'module-manifest.json'),JSON.stringify(bundle.metafile,null,2));}
const browser = await chromium.launch({channel:'chrome',headless:true});
const results=[], failures=[];
function check(value,message){if(!value)failures.push(message);}
const rgb = value => value.match(/[\d.]+/g).slice(0,3).map(Number);
function contrast(fg,bg,opacity=1){
 const back=rgb(bg),front=rgb(fg).map((v,i)=>v*opacity+back[i]*(1-opacity));
 const luminance=c=>c.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
 const a=luminance(front),b=luminance(back);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
try {
 for(const width of [390,1440,320]) for(const variant of ['default','custom','unknown','nonapp','root-only']){
  const page=await browser.newPage({viewport:{width,height:1000}});
  const external=[];page.on('request',r=>external.push(r.url()));
  await page.route('**/*',r=>r.abort());
  await page.setContent('<div id="root"></div>');
  if(variant==='root-only')await page.evaluate(()=>document.body.setAttribute('data-pixel-default-palette','true'));
  await page.addStyleTag({content:css});
  await page.evaluate(f=>{window.fixture=f},{items:fixtures,custom:variant==='custom'||variant==='root-only',app:variant!=='nonapp',defaultOrg:variant==='default'||variant==='nonapp'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByText('Confirmed fixture',{exact:true}).filter({visible:true}).first().waitFor();
  // Mobile starts on the real day view. Collect its cards and desktop cards,
  // including below-the-fold events without changing their geometry.
  const cards=await page.evaluate(()=>Array.from(document.querySelectorAll('button,div')).filter(e=>e.classList.contains('absolute')&&e.classList.contains('border-l-[3px]')&&e.getBoundingClientRect().width>0).map(e=>{
   const s=getComputedStyle(e),r=e.getBoundingClientRect();return {text:e.innerText,bg:s.backgroundColor,color:s.color,border:s.borderColor,left:s.borderLeftColor,shadow:s.boxShadow,geometry:[r.x,r.y,r.width,r.height],radius:s.borderRadius,overflow:[s.overflowX,s.overflowY,e.scrollWidth,e.scrollHeight,e.clientWidth,e.clientHeight],children:Array.from(e.querySelectorAll('p,span')).map(p=>({text:p.textContent,color:getComputedStyle(p).color,opacity:getComputedStyle(p).opacity,radius:getComputedStyle(p).borderRadius}))};
  }));
  for(const card of cards)check(baseline||card.radius===(variant==='default'?'4px':'12px'),`${width}/${variant}: event corner radius ${card.text}: ${card.radius}`);
  const controls=await page.locator('button,a,input,select').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width>0&&!e.classList.contains('absolute')).map(e=>({text:e.textContent,radius:getComputedStyle(e).borderRadius})));
  const confirmed=cards.find(c=>c.text.includes('Confirmed fixture'));
  check(cards.length===fixtures.length,`${width}/${variant}: all ${fixtures.length} event fixtures rendered`);
  check(!!confirmed,`${width}/${variant}: confirmed visible`);
  if(variant!=='default')check(confirmed?.bg==='rgb(220, 233, 220)',`${width}/${variant}: legacy tenant/nonapp confirmed fill unchanged`);
  for(const [status,bg] of Object.entries({Requested:'rgb(233, 238, 246)',Shot:'rgb(231, 238, 241)',Editing:'rgb(243, 237, 223)',Delivered:'rgb(239, 238, 233)',Cancelled:'rgb(220, 233, 220)',Pending:'rgb(220, 233, 220)'}))check(cards.find(c=>c.text.includes(status+' fixture'))?.bg===bg,`${width}/${variant}: ${status} surface unchanged`);
  if(!baseline&&variant==='default'){
   check(confirmed?.bg==='rgb(232, 242, 255)',`${width}: confirmed light blue, got ${confirmed?.bg}`);
   check(confirmed?.left==='rgb(8, 102, 216)',`${width}: crisp blue edge`);
   check(confirmed?.color==='rgb(23, 50, 77)',`${width}: deep blue text`);
   const block=cards.find(c=>c.text.includes('Blocked fixture'));
   check(block?.bg==='rgb(239, 242, 246)',`${width}: cool gray block, got ${block?.bg}`);
   for(const card of [confirmed,block]){
    card.contrast={title:contrast(card.color,card.bg),edge:contrast(card.left,card.bg),captions:card.children.filter(c=>c.opacity!=='1').map(c=>contrast(c.color,card.bg,Number(c.opacity)))};
    check(card.contrast.title>=4.5,`${width}: title contrast`);
    check(card.contrast.edge>=3,`${width}: accent edge contrast`);
    check(card.contrast.captions.every(c=>c>=4.5),`${width}: caption contrast with actual opacity`);
   }
  }
  for(const c of cards.filter(c=>c.text.includes('Google '))){const index=Number(c.text.match(/Google (\d)/)[1]);const color=fixtures.find(f=>f.id==='google-'+index).sourceColor;if(color){const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16));check(c.bg===`rgba(${rgb.join(', ')}, 0.18)`,`${width}/${variant}: configured source background retained`);check(c.shadow.includes(`rgb(${rgb.join(', ')})`),`${width}/${variant}: configured source edge retained`);}}
  if(evidence&&variant==='default')await page.screenshot({path:path.join(evidence,`calendar-${width}.png`),fullPage:false});
  if(evidence&&variant==='default'){
   const block=page.getByText('Blocked fixture',{exact:true}).filter({visible:true}).first();
   await block.evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement){if(getComputedStyle(p).overflowY==='auto'&&p.scrollHeight>p.clientHeight){p.scrollTop+=e.getBoundingClientRect().top-p.getBoundingClientRect().top-p.clientHeight/2;break;}}});
   await page.waitForTimeout(200);
   await page.screenshot({path:path.join(evidence,`calendar-statuses-${width}.png`),fullPage:false});
  }
  // Hover remains a tint, not a geometry change.
  if(!baseline&&variant==='default'){
   const blockTarget=page.getByText('Blocked fixture',{exact:true}).filter({visible:true}).first();
   await blockTarget.hover();await page.waitForTimeout(200);
   const blockHover=await blockTarget.evaluate(e=>{const s=getComputedStyle(e.closest('button'));return {bg:s.backgroundColor,color:s.color}});
   check(contrast(blockHover.color,blockHover.bg,0.7)>=4.5,`${width}: blocked hover time contrast`);
  }
  const target=page.getByText('Confirmed fixture',{exact:true}).filter({visible:true}).first();
  await target.hover();await page.waitForTimeout(200);
  const hover=await target.evaluate(e=>{const s=getComputedStyle(e.closest('button'));return s.backgroundColor});
  if(!baseline&&variant==='default')check(hover==='rgb(220, 235, 255)',`${width}: hover tint ${hover}`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  check(!overflow,`${width}/${variant}: document overflow`);
  check(external.length===0,`${width}/${variant}: no external requests`);
  results.push({width,variant,cards,controls,hover,overflow,external});
  await page.getByRole('button',{name:'agenda',exact:true}).filter({visible:true}).click();
  const agenda=[];
  for(const fixture of fixtures){
   const row=page.getByText(fixture.title,{exact:true}).filter({visible:true});
   agenda.push(await row.evaluate(e=>{const b=e.closest('button'),s=getComputedStyle(b),r=b.getBoundingClientRect();return {text:b.textContent,radius:s.borderRadius,bg:s.backgroundColor,geometry:[r.x,r.y,r.width,r.height],overflow:[b.scrollWidth,b.scrollHeight,b.clientWidth,b.clientHeight],pills:Array.from(b.querySelectorAll('span')).map(p=>({text:p.textContent,radius:getComputedStyle(p).borderRadius,color:getComputedStyle(p).color,bg:getComputedStyle(p).backgroundColor}))}}));
  }
  check(agenda.every(r=>r.radius==='0px'),`${width}/${variant}: agenda rows square already`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${variant}: agenda no document overflow`);
  results.push({width,variant,agenda});
  if(evidence&&variant==='default')await page.screenshot({path:path.join(evidence,`calendar-agenda-${width}.png`)});
  await page.getByRole('button',{name:width===1440?'week':'day',exact:true}).filter({visible:true}).click();
  await target.hover();await page.waitForTimeout(200);
  if(width===1440){
   const box=await target.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+48,{steps:10});
   const ghost=page.locator('[aria-hidden="true"]').filter({hasText:'Move here'});
   await ghost.waitFor();
   const drag=await ghost.evaluate(e=>{const s=getComputedStyle(e);return {radius:s.borderRadius,bg:s.backgroundColor,border:s.borderColor,color:s.color,geometry:[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight],children:Array.from(e.querySelectorAll('p')).map(p=>({text:p.textContent,color:getComputedStyle(p).color}))}});
   check(baseline||drag.radius===(variant==='default'?'4px':'12px'),`${width}/${variant}: drag corner radius ${drag.radius}`);
   if(!baseline&&variant==='default'){
    check(drag.bg==='rgb(232, 242, 255)','drag blue tint');check(drag.border==='rgb(8, 102, 216)','drag blue edge');
    check(drag.children.every(c=>contrast(c.color,drag.bg)>=4.5),'drag text contrast');
   }
   if(variant!=='default')check(drag.bg==='rgba(232, 241, 232, 0.95)','nondefault drag palette unchanged');
   if(evidence&&variant==='default')await page.screenshot({path:path.join(evidence,'calendar-drag-1440.png')});
   results.push({width,variant,drag});
  }
  check(await page.evaluate(()=>window.deniedActions||0)===0,'No mutation boundary invoked');
  await page.close(); // Never pointer-up a fixture drag: no rescheduling submitted.
 }
} finally {await browser.close();}
if(process.env.PIXEL_CALENDAR_COMPARE){
 const previous=JSON.parse(fs.readFileSync(process.env.PIXEL_CALENDAR_COMPARE,'utf8')).results;
 for(const row of results.filter(r=>r.agenda||r.drag)){
  const old=previous.find(r=>r.width===row.width&&r.variant===row.variant&&(row.agenda?r.agenda:r.drag));
  check(!!old,'baseline agenda/drag exists');
  if(!old)continue;
  if(row.agenda)check(JSON.stringify(row.agenda)===JSON.stringify(old.agenda),'agenda geometry/pills/colors unchanged');
  if(row.drag){const {radius,...current}=row.drag;const {radius:oldRadius,...prior}=old.drag;check(JSON.stringify(current)===JSON.stringify(prior),'drag geometry/colors unchanged');if(row.variant!=='default')check(radius===oldRadius,'custom drag radius unchanged');}
 }
 for(const row of results.filter(r=>r.cards)){
  const old=previous.find(r=>r.width===row.width&&r.variant===row.variant);
  check(!!old,`baseline exists ${row.width}/${row.variant}`);
  if(!old)continue;
  check(JSON.stringify(old.controls)===JSON.stringify(row.controls),'controls retain corners');
  check(old.cards.length===row.cards.length,'before/after event counts identical');
  for(const [i,card] of row.cards.entries()){
   const was=old.cards[i];
   check(JSON.stringify(card.geometry)===JSON.stringify(was.geometry),'before/after event geometry identical');
   check(card.text===was.text,'before/after labels identical');
   // Corner-only refinement must preserve every palette and clipping metric.
   for(const key of ['bg','border','left','color','shadow','children','overflow'])check(JSON.stringify(card[key])===JSON.stringify(was[key]),`${row.width}/${row.variant}: untouched ${key} ${card.text}`);
  }
 }
}
if(evidence)fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({baseline,results,failures},null,2));
console.log(JSON.stringify({baseline,scenarios:results.length,failures},null,2));
assert.deepEqual(failures,[]);
