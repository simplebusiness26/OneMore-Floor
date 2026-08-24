(() => {
'use strict';

const W = 360, H = 640, GROUND = 560;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = true;

const $ = id => document.getElementById(id);
const ui = {
  menu:$('menu'), hud:$('hud'), pause:$('pause'), dead:$('dead'), dailyComplete:$('dailyComplete'), themes:$('themes'), tutorial:$('tutorial'),
  tutorialText:$('tutorialText'), floorLabel:$('floorLabel'), modifierLabel:$('modifierLabel'), menuBest:$('menuBest'), menuCoins:$('menuCoins'), deadFloor:$('deadFloor'), deadBest:$('deadBest'), dailyTime:$('dailyTime'), muteBtn:$('muteBtn'), themeGrid:$('themeGrid'), flash:$('flash')
};

const STORE = {best:'omf.best',coins:'omf.coins',theme:'omf.theme',sound:'omf.sound',tutorial:'omf.tutorial'};
const loadNum = (k,d=0) => Number(localStorage.getItem(k) ?? d) || d;
const save = (k,v) => localStorage.setItem(k,String(v));

const themes = [
  {name:'MINT', color:'#66f7d5', unlock:0},{name:'VOLT', color:'#d8ff4f', unlock:10},{name:'EMBER', color:'#ff6d5d', unlock:25},
  {name:'SKY', color:'#69a7ff', unlock:40},{name:'VIOLET', color:'#c587ff', unlock:70},{name:'GOLD', color:'#ffd45f', unlock:100}
];

let state='menu', mode='endless', floorNo=1, floor=null, player=null, seedBase=0, transitionTimer=0, runStart=0, last=performance.now();
let best=loadNum(STORE.best), bankCoins=loadNum(STORE.coins), selectedTheme=localStorage.getItem(STORE.theme)||'MINT';
let soundOn=localStorage.getItem(STORE.sound)!=='0', tutorialDone=localStorage.getItem(STORE.tutorial)==='1', tutorialStep=0, audio=null, runCoins=0, deathQueued=false, screenShake=0, floorBanner=0;

function theme(){return themes.find(t=>t.name===selectedTheme)||themes[0]}
function accent(){return theme().color}
function applyTheme(){document.documentElement.style.setProperty('--accent',accent())}
applyTheme();

function hashSeed(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function floorRng(n){return mulberry32((seedBase+Math.imul(n,0x9E3779B1))>>>0)}
function pick(arr,r){return arr[Math.floor(r()*arr.length)]}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rects(a,b,margin=0){return a.x+margin<b.x+b.w-margin&&a.x+a.w-margin>b.x+margin&&a.y+margin<b.y+b.h-margin&&a.y+a.h-margin>b.y+margin}

function ensureAudio(){if(!soundOn)return;if(!audio)audio=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume()}
function tone(freq=440,dur=.06,type='square',gain=.035,delay=0){if(!soundOn)return;ensureAudio();if(!audio)return;const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+dur+.02)}
function sfxJump(){tone(330,.055,'square',.025);tone(490,.04,'square',.018,.025)}
function sfxCoin(){tone(780,.05,'sine',.035);tone(1120,.07,'sine',.03,.045)}
function sfxDing(){tone(660,.075,'sine',.04);tone(990,.10,'sine',.03,.045)}
function sfxDeath(){tone(150,.16,'sawtooth',.045);tone(88,.25,'square',.03,.08)}
function haptic(ms){if(navigator.vibrate)navigator.vibrate(ms)}

function baseFloor(kind,name){return{kind,name,platforms:[{x:0,y:GROUND,w:360,h:80,solid:true}],hazards:[],coins:[],pads:[],switches:[],exit:{x:326,y:486,w:26,h:74,locked:false},speedMul:1,gravityMul:1,jumpMul:1,darkness:false,wall:null,laser:null,rotor:null,time:0,cleared:false,modifier:'',safe:true}}
function spike(x,w=24,y=GROUND-18){return{type:'spike',x,y,w,h:18,baseX:x,baseY:y}}
function platform(x,y,w,opts={}){return{x,y,w,h:12,solid:true,baseX:x,baseY:y,vx:0,vy:0,...opts}}
function coin(x,y){return{x,y,r:6,taken:false}}

function chooseKind(n,r){if(n===1)return'spikes';if(n%10===0)return'boss';if(n%13===0)return'bonus';const pool=['spikes','movingSpikes','lowCeiling','bounce','switch'];if(n>=4)pool.push('movingPlatforms','laser');if(n>=7)pool.push('collapse','disappear','wall');if(n>=10)pool.push('rotor','dark','double','mystery');return pick(pool,r)}

function createFloor(n){
  const r=floorRng(n),d=clamp((n-1)/55,0,1),kind=chooseKind(n,r),f=baseFloor(kind,kind.toUpperCase());
  const addCoinTrail=(ys=[510,480,510])=>ys.forEach((y,i)=>f.coins.push(coin(125+i*42,y)));
  switch(kind){
    case'spikes':{f.name='SPIKES';const x=145+Math.floor(r()*35);f.hazards.push(spike(x,26+d*10));if(n>10&&r()>.42)f.hazards.push(spike(x+78,22));break}
    case'movingSpikes':{f.name='MOVING SPIKES';const h=spike(178,28);h.motion={axis:'x',range:42,speed:1.62+d*1.02,phase:r()*6.28};f.hazards.push(h);if(n>26){const h2=spike(250,22);h2.motion={axis:'y',range:22,speed:1.86+d*1.12,phase:r()*6.28};f.hazards.push(h2)}break}
    case'movingPlatforms':{f.name='MOVING PLATFORMS';f.platforms=[platform(0,GROUND,105),platform(140,515,72,{motion:{axis:'y',range:24,speed:1.32+d*.55,phase:r()*6.28}}),platform(247,GROUND,113)];f.hazards.push({type:'pit',x:105,y:GROUND,w:142,h:80});f.coins.push(coin(176,475));break}
    case'collapse':{f.name='COLLAPSING TILES';f.platforms=[platform(0,GROUND,95),platform(100,GROUND,55,{collapse:true}),platform(160,GROUND,55,{collapse:true}),platform(220,GROUND,55,{collapse:true}),platform(280,GROUND,80)];f.hazards.push({type:'pit',x:95,y:GROUND,w:185,h:80});f.platforms.slice(1,4).forEach(p=>{p.collapseTimer=-1;p.fall=0});break}
    case'disappear':{f.name='DISAPPEARING';f.platforms=[platform(0,GROUND,100),platform(112,520,62,{disappear:true,phase:0}),platform(190,500,62,{disappear:true,phase:.48}),platform(270,GROUND,90)];f.hazards.push({type:'pit',x:100,y:GROUND,w:170,h:80});break}
    case'laser':{f.name='LASER';f.laser={x:142,y:505,w:112,h:5,phase:r()*.9,period:1.15-d*.16,onTime:.54};f.coins.push(coin(198,470));break}
    case'rotor':{f.name='ROTATING ARM';f.rotor={cx:207,cy:510,len:72,width:7,angle:r()*6.28,speed:2.35+d*1.05};break}
    case'wall':{f.name='DON’T STOP';f.wall={x:-64,w:48,speed:101+d*15};f.hazards.push(spike(170,22));break}
    case'lowCeiling':{f.name='KEEP IT LOW';f.hazards.push(spike(190,22));f.platforms.push({x:150,y:438,w:110,h:18,solid:true,ceiling:true});break}
    case'bounce':{f.name='BOUNCE';f.platforms=[platform(0,GROUND,145),platform(240,GROUND,120)];f.hazards.push({type:'pit',x:145,y:GROUND,w:95,h:80});f.pads.push({x:112,y:GROUND-8,w:28,h:8,power:490});f.coins.push(coin(195,430));break}
    case'switch':{f.name='HIT THE SWITCH';f.exit.locked=true;f.switches.push({x:190,y:474,w:18,h:18,hit:false});f.platforms.push(platform(168,518,62));break}
    case'dark':{f.name='LIGHTS OUT';f.darkness=true;f.hazards.push(spike(185,24));f.coins.push(coin(250,510));break}
    case'double':{f.name='DOUBLE SPEED';f.speedMul=1.48;f.modifier='×2 SPEED';f.hazards.push(spike(205,22));break}
    case'mystery':{f.name='MYSTERY';const mods=[()=>{f.speedMul=1.30;f.modifier='RUSH'},()=>{f.gravityMul=1.18;f.jumpMul=1.08;f.modifier='HEAVY'},()=>{f.jumpMul=1.18;f.modifier='SPRING'}];pick(mods,r)();f.hazards.push(spike(175,22));break}
    case'bonus':{f.name='COIN FLOOR';f.modifier='BONUS';addCoinTrail([515,475,445,475,515]);break}
    case'boss':{f.name=`BOSS ${Math.floor(n/10)}`;f.modifier='BOSS FLOOR';f.hazards.push(spike(130,24),spike(250,24));const mh=spike(192,25);mh.motion={axis:'y',range:24,speed:1.72+d*.78,phase:r()*6.28};f.hazards.push(mh);if(n>=30)f.laser={x:160,y:488,w:78,h:5,phase:.2,period:1.32,onTime:.45};if(n>=50)f.rotor={cx:285,cy:505,len:43,width:6,angle:0,speed:2.55};break}
  }
  return f;
}

function resetPlayer(){player={x:28,y:GROUND-26,w:22,h:26,vx:0,vy:0,prevY:GROUND-26,onGround:true,coyote:.1,jumpBuffer:0,landedPlatform:null,alive:true,trail:[]}}
function startRun(which='endless'){ensureAudio();mode=which;floorNo=1;runCoins=0;deathQueued=false;runStart=performance.now();seedBase=mode==='daily'?hashSeed(new Date().toISOString().slice(0,10)+'|ONE_MORE_FLOOR'):(Math.random()*0xffffffff)>>>0;tutorialStep=0;hideAll();state='playing';ui.hud.classList.add('show');floor=createFloor(1);resetPlayer();transitionTimer=.24;floorBanner=.42;syncHud();if(!tutorialDone){ui.tutorial.classList.add('show');ui.tutorialText.textContent='TAP TO JUMP'}}
function nextFloor(){floorNo++;if(mode==='daily'&&floorNo>100){completeDaily();return}bankCoins+=runCoins;runCoins=0;save(STORE.coins,bankCoins);floor=createFloor(floorNo);resetPlayer();transitionTimer=.20;floorBanner=.44;syncHud();sfxDing();haptic(14);flash()}
function syncHud(){ui.floorLabel.textContent=floorNo;ui.modifierLabel.textContent=floor?.modifier||floor?.name||''}
function hideAll(){[ui.menu,ui.pause,ui.dead,ui.dailyComplete,ui.themes].forEach(x=>x.classList.remove('show'));ui.hud.classList.remove('show')}
function showMenu(){state='menu';hideAll();ui.menu.classList.add('show');ui.tutorial.classList.remove('show');updateMenu()}
function updateMenu(){ui.menuBest.textContent=best;ui.menuCoins.textContent=bankCoins}
function flash(){ui.flash.classList.remove('go');void ui.flash.offsetWidth;ui.flash.classList.add('go')}

function kill(){if(!player?.alive||deathQueued)return;player.alive=false;deathQueued=true;screenShake=.22;sfxDeath();haptic([30,25,45]);const cleared=Math.max(0,floorNo-1);if(cleared>best){best=cleared;save(STORE.best,best)}bankCoins+=runCoins;runCoins=0;save(STORE.coins,bankCoins);setTimeout(()=>{if(!deathQueued)return;state='dead';hideAll();ui.dead.classList.add('show');ui.deadFloor.textContent=cleared;ui.deadBest.textContent=best;renderThemes()},250)}
function completeDaily(){const sec=(performance.now()-runStart)/1000;bankCoins+=runCoins+25;runCoins=0;save(STORE.coins,bankCoins);if(best<100){best=100;save(STORE.best,best)}state='dailyComplete';hideAll();ui.dailyComplete.classList.add('show');ui.dailyTime.textContent=`${sec.toFixed(1)}s · +25 COINS`;sfxDing();tone(1320,.18,'sine',.025,.1);haptic([25,40,25])}
function doJump(){if(state!=='playing'||transitionTimer>0||!player?.alive)return;player.jumpBuffer=.12;if(!tutorialDone&&tutorialStep===0){tutorialStep=1;ui.tutorialText.textContent='AVOID HAZARDS'}}
function input(){ensureAudio();if(state==='playing')doJump()}
canvas.addEventListener('pointerdown',e=>{e.preventDefault();input()},{passive:false});
window.addEventListener('keydown',e=>{if(['Space','ArrowUp','KeyW'].includes(e.code)){e.preventDefault();input()}if(e.code==='Escape'&&state==='playing')pauseGame()});

function floorPlatformUpdate(p,t,dt){if(p.motion){const v=Math.sin(t*p.motion.speed+p.motion.phase)*p.motion.range;if(p.motion.axis==='x')p.x=p.baseX+v;else p.y=p.baseY+v}if(p.collapse&&p.collapseTimer>=0){p.collapseTimer+=dt;if(p.collapseTimer>.42)p.fall+=900*dt;p.y+=p.fall*dt}if(p.disappear){const cyc=(t+p.phase)%1.34;p.opacity=cyc<.72?1:cyc<.91?1-(cyc-.72)/.19:cyc<1.16?0:(cyc-1.16)/.18;p.solid=p.opacity>.15}}

function update(dt){
  if(state!=='playing')return;if(transitionTimer>0){transitionTimer-=dt;floorBanner=Math.max(0,floorBanner-dt);return}if(!player?.alive)return;
  floor.time+=dt;const t=floor.time,prevY=player.y;player.prevY=player.y;player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);player.coyote=player.onGround?.10:Math.max(0,player.coyote-dt);
  const pace=108+clamp((floorNo-1)*.52,0,24);player.vx=pace*floor.speedMul;if(player.jumpBuffer>0&&(player.onGround||player.coyote>0)){player.vy=-325*floor.jumpMul;player.onGround=false;player.coyote=0;player.jumpBuffer=0;sfxJump();haptic(8)}
  player.vy+=900*floor.gravityMul*dt;player.vy=Math.min(player.vy,680);player.x+=player.vx*dt;player.y+=player.vy*dt;player.onGround=false;player.landedPlatform=null;
  for(const p of floor.platforms)floorPlatformUpdate(p,t,dt);
  if(player.vy>=0){const oldBottom=prevY+player.h,newBottom=player.y+player.h;let bestLanding=null;for(const p of floor.platforms){if(!p.solid||p.ceiling)continue;const overlapX=player.x+player.w-3>p.x&&player.x+3<p.x+p.w;if(overlapX&&oldBottom<=p.y+4&&newBottom>=p.y&&player.y<p.y){if(!bestLanding||p.y<bestLanding.y)bestLanding=p}}if(bestLanding){player.y=bestLanding.y-player.h;player.vy=0;player.onGround=true;player.landedPlatform=bestLanding;if(bestLanding.collapse&&bestLanding.collapseTimer<0)bestLanding.collapseTimer=0}}
  if(player.vy<0){for(const p of floor.platforms){if(!p.solid)continue;if(rects(player,p,2)&&prevY>=p.y+p.h-4){player.y=p.y+p.h;player.vy=30;break}}}
  for(const pad of floor.pads){if(player.x+player.w>pad.x&&player.x<pad.x+pad.w&&player.y+player.h>=pad.y-5&&player.y+player.h<=pad.y+16&&player.vy>=0){player.vy=-pad.power;player.onGround=false;tone(260,.05,'square',.025);tone(520,.08,'sine',.025,.03);haptic(12)}}
  for(const sw of floor.switches){if(!sw.hit&&rects(player,{x:sw.x-8,y:sw.y-8,w:sw.w+16,h:sw.h+16},1)){sw.hit=true;floor.exit.locked=false;tone(520,.06,'square',.03);tone(780,.08,'square',.025,.05);haptic(12);flash()}}
  for(const c of floor.coins){if(!c.taken){const rr={x:c.x-c.r,y:c.y-c.r,w:c.r*2,h:c.r*2};if(rects(player,rr,2)){c.taken=true;runCoins++;sfxCoin();haptic(5)}}}
  for(const h of floor.hazards){if(h.motion){const v=Math.sin(t*h.motion.speed+h.motion.phase)*h.motion.range;if(h.motion.axis==='x')h.x=h.baseX+v;else h.y=h.baseY+v}}
  if(floor.wall)floor.wall.x+=floor.wall.speed*dt;if(floor.rotor)floor.rotor.angle+=floor.rotor.speed*dt;
  if(floor.exit.locked&&player.x+player.w>floor.exit.x&&player.x<floor.exit.x+floor.exit.w)player.x=floor.exit.x-player.w;
  for(const h of floor.hazards){if(h.type==='spike'){const hb={x:h.x+5,y:h.y+4,w:Math.max(4,h.w-10),h:h.h-4};if(rects(player,hb,3)){kill();return}}}
  if(floor.wall&&rects(player,{x:floor.wall.x,y:120,w:floor.wall.w,h:440},2)){kill();return}
  if(floor.laser&&laserActive(floor.laser,t)&&rects(player,{x:floor.laser.x,y:floor.laser.y-4,w:floor.laser.w,h:9},4)){kill();return}
  if(floor.rotor&&rotorHitsPlayer(floor.rotor,player)){kill();return}
  if(player.y>H+35||player.x<-60){kill();return}
  if(!floor.exit.locked&&player.x+player.w>floor.exit.x+floor.exit.w*.7){floor.cleared=true;if(!tutorialDone&&floorNo===1){tutorialDone=true;save(STORE.tutorial,1);ui.tutorial.classList.remove('show')}if(floorNo>best){best=floorNo;save(STORE.best,best)}nextFloor();return}
  if(!tutorialDone&&tutorialStep===1&&player.x>115){tutorialStep=2;ui.tutorialText.textContent='REACH THE ELEVATOR'}
  player.trail.push({x:player.x,y:player.y,a:.32});if(player.trail.length>6)player.trail.shift();for(const q of player.trail)q.a*=.86;floorBanner=Math.max(0,floorBanner-dt)
}

function laserActive(l,t){return(t+l.phase)%l.period<l.onTime}
function rotorHitsPlayer(r,p){const ax=r.cx,ay=r.cy,bx=ax+Math.cos(r.angle)*r.len,by=ay+Math.sin(r.angle)*r.len,px=p.x+p.w/2,py=p.y+p.h/2,vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,c1=vx*wx+vy*wy,c2=vx*vx+vy*vy,u=clamp(c1/c2,0,1),dx=px-(ax+u*vx),dy=py-(ay+u*vy);return Math.hypot(dx,dy)<Math.min(p.w,p.h)*.38+r.width*.5}

function drawBackground(){ctx.fillStyle='#090a0d';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#151922';ctx.lineWidth=1;for(let y=120;y<GROUND;y+=44){ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(W,y+.5);ctx.stroke()}ctx.fillStyle='#0d1015';ctx.fillRect(0,GROUND,W,H-GROUND);ctx.fillStyle='#171c24';ctx.fillRect(0,GROUND,W,3)}
function drawExit(f){const e=f.exit;ctx.save();ctx.fillStyle=e.locked?'#1d222c':accent();ctx.globalAlpha=e.locked?.85:1;ctx.fillRect(e.x,e.y,e.w,e.h);ctx.fillStyle='#090a0d';ctx.fillRect(e.x+5,e.y+8,e.w-10,e.h-8);ctx.fillStyle=e.locked?'#626b7b':accent();ctx.fillRect(e.x+e.w-7,e.y+e.h*.54,3,3);if(e.locked){ctx.fillStyle='#9aa1ad';ctx.font='900 8px system-ui';ctx.textAlign='center';ctx.fillText('LOCK',e.x+e.w/2,e.y-8)}else{ctx.strokeStyle=accent();ctx.globalAlpha=.45+.25*Math.sin(f.time*5);ctx.strokeRect(e.x-3,e.y-3,e.w+6,e.h+6)}ctx.restore()}
function drawSpike(h){ctx.save();ctx.fillStyle='#ff5268';const count=Math.max(1,Math.round(h.w/12)),sw=h.w/count;ctx.beginPath();for(let i=0;i<count;i++){const x=h.x+i*sw;ctx.moveTo(x,h.y+h.h);ctx.lineTo(x+sw/2,h.y);ctx.lineTo(x+sw,h.y+h.h)}ctx.fill();ctx.restore()}
function drawPlatforms(f){for(const p of f.platforms){if(p.y>=H+30)continue;ctx.save();ctx.globalAlpha=p.opacity??1;ctx.fillStyle=p.ceiling?'#242a35':'#e9edf5';ctx.fillRect(p.x,p.y,p.w,p.h);if(p.collapse&&p.collapseTimer>=0){ctx.fillStyle='#ffb95c';ctx.fillRect(p.x,p.y,p.w*clamp(p.collapseTimer/.42,0,1),3)}ctx.restore()}}
function drawFloor(f){drawPlatforms(f);for(const h of f.hazards)if(h.type==='spike')drawSpike(h);for(const pad of f.pads){ctx.fillStyle=accent();ctx.fillRect(pad.x,pad.y,pad.w,pad.h);ctx.fillStyle='#fff';ctx.globalAlpha=.7;ctx.fillRect(pad.x+5,pad.y-4,pad.w-10,3);ctx.globalAlpha=1}for(const sw of f.switches){ctx.save();ctx.fillStyle=sw.hit?accent():'#ffcd56';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=sw.hit?14:8;ctx.fillRect(sw.x,sw.y,sw.w,sw.h);ctx.restore()}for(const c of f.coins){if(c.taken)continue;ctx.save();ctx.strokeStyle='#ffd45f';ctx.lineWidth=3;ctx.shadowColor='#ffd45f';ctx.shadowBlur=10;ctx.beginPath();ctx.arc(c.x,c.y,c.r,0,Math.PI*2);ctx.stroke();ctx.restore()}if(f.wall){ctx.fillStyle='#ff5268';ctx.fillRect(f.wall.x,120,f.wall.w,GROUND-120);for(let y=140;y<GROUND;y+=28){ctx.fillStyle='#0b0c10';ctx.fillRect(f.wall.x+f.wall.w-9,y,9,13)}}if(f.laser){const active=laserActive(f.laser,f.time);ctx.save();ctx.globalAlpha=active?1:.22;ctx.strokeStyle=active?'#ff4265':'#6c3340';ctx.lineWidth=active?5:2;ctx.shadowColor='#ff4265';ctx.shadowBlur=active?14:0;ctx.beginPath();ctx.moveTo(f.laser.x,f.laser.y);ctx.lineTo(f.laser.x+f.laser.w,f.laser.y);ctx.stroke();ctx.fillStyle=active?'#ff4265':'#472631';ctx.fillRect(f.laser.x-7,f.laser.y-9,7,18);ctx.fillRect(f.laser.x+f.laser.w,f.laser.y-9,7,18);ctx.restore()}if(f.rotor){const r=f.rotor,bx=r.cx+Math.cos(r.angle)*r.len,by=r.cy+Math.sin(r.angle)*r.len;ctx.save();ctx.strokeStyle='#ff5268';ctx.lineWidth=r.width;ctx.lineCap='round';ctx.shadowColor='#ff5268';ctx.shadowBlur=8;ctx.beginPath();ctx.moveTo(r.cx,r.cy);ctx.lineTo(bx,by);ctx.stroke();ctx.fillStyle='#e8edf5';ctx.beginPath();ctx.arc(r.cx,r.cy,8,0,Math.PI*2);ctx.fill();ctx.restore()}drawExit(f)}
function drawPlayer(p){for(const q of p.trail){ctx.globalAlpha=q.a;ctx.fillStyle=accent();ctx.fillRect(q.x,q.y,p.w,p.h)}ctx.globalAlpha=1;ctx.save();ctx.fillStyle='#f5f7fb';ctx.shadowColor=accent();ctx.shadowBlur=10;ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle='#090a0d';ctx.fillRect(p.x+p.w-7,p.y+7,3,3);ctx.restore()}
function drawDarkness(){if(!floor?.darkness||!player)return;ctx.save();ctx.fillStyle='rgba(0,0,0,.92)';ctx.fillRect(0,100,W,H-100);ctx.globalCompositeOperation='destination-out';const gx=player.x+player.w/2,gy=player.y+player.h/2,grad=ctx.createRadialGradient(gx,gy,32,gx,gy,105);grad.addColorStop(0,'rgba(0,0,0,1)');grad.addColorStop(.75,'rgba(0,0,0,.55)');grad.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=grad;ctx.beginPath();ctx.arc(gx,gy,105,0,Math.PI*2);ctx.fill();ctx.restore()}
function drawBanner(){if(floorBanner<=0)return;const a=clamp(floorBanner/.18,0,1);ctx.save();ctx.globalAlpha=Math.min(1,a);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='1000 68px system-ui';ctx.fillText(String(floorNo),W/2,252);ctx.fillStyle=accent();ctx.font='900 10px system-ui';ctx.fillText(floor?.name||'',W/2,278);ctx.restore()}
function render(){ctx.save();if(screenShake>0&&state==='playing'){const s=screenShake*16;ctx.translate((Math.random()-.5)*s,(Math.random()-.5)*s);screenShake=Math.max(0,screenShake-.018)}drawBackground();if(floor){drawFloor(floor);if(player)drawPlayer(player);drawDarkness();drawBanner()}else{ctx.fillStyle=accent();ctx.globalAlpha=.12;for(let i=0;i<7;i++)ctx.fillRect(45+i*16,520-i*52,270-i*32,2);ctx.globalAlpha=1}ctx.restore()}
function loop(now){const dt=Math.min(.033,(now-last)/1000||0);last=now;if(state==='playing'&&!document.hidden)update(dt);render();requestAnimationFrame(loop)}
requestAnimationFrame(loop);

function pauseGame(){if(state!=='playing')return;state='paused';ui.hud.classList.remove('show');ui.pause.classList.add('show')}
function resumeGame(){if(state!=='paused')return;state='playing';ui.pause.classList.remove('show');ui.hud.classList.add('show');last=performance.now()}
function renderThemes(){ui.themeGrid.innerHTML='';for(const t of themes){const unlocked=best>=t.unlock,b=document.createElement('button');b.className='themeCard'+(unlocked?'':' locked')+(selectedTheme===t.name?' selected':'');b.disabled=!unlocked;b.innerHTML=`<span class="swatch" style="background:${t.color};color:${t.color}"></span><span>${t.name}${unlocked?'':` · ${t.unlock}`}</span>`;b.addEventListener('click',()=>{selectedTheme=t.name;save(STORE.theme,t.name);applyTheme();renderThemes();tone(620,.06,'sine',.025)});ui.themeGrid.appendChild(b)}}

$('endlessBtn').addEventListener('click',()=>startRun('endless'));$('dailyBtn').addEventListener('click',()=>startRun('daily'));$('themesBtn').addEventListener('click',()=>{hideAll();renderThemes();ui.themes.classList.add('show');state='themes'});$('themesBackBtn').addEventListener('click',showMenu);$('pauseBtn').addEventListener('click',e=>{e.stopPropagation();pauseGame()});$('resumeBtn').addEventListener('click',resumeGame);$('quitBtn').addEventListener('click',()=>{deathQueued=false;showMenu()});$('muteBtn').addEventListener('click',()=>{soundOn=!soundOn;save(STORE.sound,soundOn?1:0);ui.muteBtn.textContent=`SOUND: ${soundOn?'ON':'OFF'}`;if(soundOn){ensureAudio();tone(520,.06,'sine',.025)}});$('oneMoreBtn').addEventListener('click',()=>{deathQueued=false;startRun(mode)});$('deadMenuBtn').addEventListener('click',()=>{deathQueued=false;showMenu()});$('dailyAgainBtn').addEventListener('click',()=>startRun('daily'));$('dailyMenuBtn').addEventListener('click',showMenu);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')pauseGame()});window.addEventListener('contextmenu',e=>e.preventDefault());
ui.muteBtn.textContent=`SOUND: ${soundOn?'ON':'OFF'}`;updateMenu();renderThemes();showMenu();if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

(function validateTemplates(){const oldSeed=seedBase;seedBase=0x51F10A2B;let errors=[];for(let n=1;n<=500;n++){const f=createFloor(n);if(!f.exit||f.exit.x<300||!Array.isArray(f.platforms)||!Array.isArray(f.hazards))errors.push(n);if(f.platforms.some(p=>!Number.isFinite(p.x+p.y+p.w+p.h)))errors.push(n)}seedBase=oldSeed;if(errors.length)console.warn('Floor validation issues',errors);else console.info('ONE MORE FLOOR: 500-floor template validation passed')})();
})();
