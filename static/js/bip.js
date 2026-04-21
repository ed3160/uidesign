// bip.js — cursor-tracking character (vanilla JS + jQuery-friendly)
const NAVY='#274982', SOFT='#C9DDFF', MID='#7797CD';
let scopeCounter = 0;

function faceSVG(scope, expression){
  const browRaise = expression==='wow'?4:expression==='confused'?2:0;
  const eyeRx = expression==='wow'?7:6;
  const eyeRy = expression==='happy'?5:expression==='wow'?10:9;
  const mouth = expression==='wow'
    ? `<ellipse cx="100" cy="140" rx="5" ry="6" fill="${NAVY}" />`
    : expression==='thinking'
    ? `<path d="M 92 140 L 104 140" stroke="${NAVY}" stroke-width="2.6" stroke-linecap="round" />`
    : `<path data-mouth d="M 92 138 Q 100 139.6 108 138" stroke="${NAVY}" stroke-width="2.6" stroke-linecap="round" fill="none" />`;
  return `
    <defs>
      <radialGradient id="${scope}-face" cx="42%" cy="30%" r="78%">
        <stop offset="0%" stop-color="#fff"/><stop offset="55%" stop-color="${SOFT}"/><stop offset="100%" stop-color="${MID}"/>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="92" fill="url(#${scope}-face)"/>
    <g fill="${NAVY}">
      <rect data-brow-l x="56" y="${72-browRaise}" width="20" height="3.2" rx="1.6"/>
      <rect data-brow-r x="114" y="${72-browRaise}" width="20" height="3.2" rx="1.6"/>
    </g>
    <g fill="${NAVY}">
      <ellipse data-eye-l cx="76" cy="96" rx="${eyeRx}" ry="${eyeRy}"/>
      <ellipse data-eye-r cx="124" cy="96" rx="${eyeRx}" ry="${eyeRy}"/>
    </g>
    <path data-nose d="M 95.8 114.8 L 104.2 114.8 L 100 123.2 Z" fill="${NAVY}"/>
    ${mouth}
  `;
}

function accessorySVG(kind){
  if(!kind) return '';
  if(kind==='book') return `<g transform="translate(150,10)"><rect width="60" height="72" fill="${NAVY}" rx="2"/><text x="30" y="42" text-anchor="middle" fill="#fff" font-weight="700" font-size="14">BOOK</text></g>`;
  if(kind==='phone') return `<g transform="translate(-5,30)"><rect width="30" height="54" fill="${NAVY}" rx="4"/><rect x="4" y="6" width="22" height="38" fill="${SOFT}" rx="1"/></g>`;
  if(kind==='question') return `<g transform="translate(158,42)"><rect width="32" height="32" fill="${NAVY}" rx="4"/><text x="16" y="24" text-anchor="middle" fill="#fff" font-weight="700" font-size="22">?</text></g>`;
  return '';
}

function bodySVG(scope, expression, pose, acc){
  const arms = ({
    wave:[[40,150,10,80],[160,150,195,210]], wave2:[[40,150,10,70],[160,150,192,70]],
    think:[[40,170,60,220],[160,150,140,80]], stand:[[45,160,20,210],[155,160,180,210]],
  })[pose] || [[45,160,20,210],[155,160,180,210]];
  const headR=82, hx=100, hy=105, scale=(headR*2)/200, tx=hx-headR, ty=hy-headR;
  return `<svg viewBox="0 0 200 280">
    <defs><radialGradient id="${scope}-body" cx="42%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#fff"/><stop offset="60%" stop-color="${SOFT}"/><stop offset="100%" stop-color="${MID}"/>
    </radialGradient></defs>
    <g stroke="${MID}" stroke-width="10" stroke-linecap="round">
      <line x1="78" y1="220" x2="74" y2="262"/><line x1="122" y1="220" x2="126" y2="262"/>
    </g>
    <g fill="${MID}"><ellipse cx="70" cy="266" rx="12" ry="7"/><ellipse cx="130" cy="266" rx="12" ry="7"/></g>
    <g stroke="url(#${scope}-body)" stroke-width="14" stroke-linecap="round">
      <line x1="${arms[0][0]}" y1="${arms[0][1]}" x2="${arms[0][2]}" y2="${arms[0][3]}"/>
      <line x1="${arms[1][0]}" y1="${arms[1][1]}" x2="${arms[1][2]}" y2="${arms[1][3]}"/>
    </g>
    <circle cx="${hx}" cy="${hy}" r="${headR}" fill="url(#${scope}-body)"/>
    <g transform="translate(${tx},${ty}) scale(${scale})">${faceSVG(scope, expression)}</g>
    ${accessorySVG(acc)}
  </svg>`;
}

function headSVG(scope, expression){
  return `<svg viewBox="0 0 200 200">${faceSVG(scope, expression)}</svg>`;
}

const faces = new Set();
let cx_=-9999, cy_=-9999;

function updateFace(f){
  const r = f.el.getBoundingClientRect();
  const cx = r.left+r.width/2, cy = r.top+r.height*0.38;
  const vx = cx_-cx, vy = cy_-cy;
  const dist = Math.hypot(vx,vy);
  const norm = Math.min(1, dist/420);
  const ang = Math.atan2(vy,vx);
  const dx = Math.cos(ang)*norm, dy = Math.sin(ang)*norm;
  const vAbove = Math.max(-1, Math.min(1, -vy/260));
  const tilt = dx*2.5;
  const q = (s)=>f.el.querySelector(s);
  const le=q('[data-eye-l]'), re=q('[data-eye-r]');
  if(le){le.setAttribute('cx',76+dx*5);le.setAttribute('cy',96+dy*4);}
  if(re){re.setAttribute('cx',124+dx*5);re.setAttribute('cy',96+dy*4);}
  const bl=q('[data-brow-l]'), br=q('[data-brow-r]');
  if(bl) bl.setAttribute('transform',`translate(${dx*3},${-dy*3}) rotate(${-tilt} 76 73)`);
  if(br) br.setAttribute('transform',`translate(${dx*3},${-dy*3}) rotate(${-tilt} 124 73)`);
  const nose=q('[data-nose]'); if(nose) nose.setAttribute('transform',`translate(${dx*2},${dy*2})`);
  const m=q('[data-mouth]');
  if(m){
    const base={neutral:0.4,happy:1,confused:0.15,thinking:0.3,wow:0.1}[f.expr]||0.4;
    const depth = Math.max(-3, Math.min(4.5, base*4 + vAbove*1.5));
    m.setAttribute('d',`M 92 138 Q 100 ${138+depth} 108 138`);
  }
}

window.addEventListener('pointermove', e => {
  cx_=e.clientX; cy_=e.clientY;
  faces.forEach(updateFace);
});

function mountHead(el, opts){
  opts = opts||{};
  const scope = 'bip'+(++scopeCounter);
  el.innerHTML = headSVG(scope, opts.expression||'neutral');
  const f = {el, expr: opts.expression||'neutral'};
  faces.add(f); updateFace(f);
}

function mountBody(el, opts){
  opts = opts||{};
  const scope = 'bip'+(++scopeCounter);
  el.innerHTML = bodySVG(scope, opts.expression||'neutral', opts.pose||'stand', opts.accessory);
  const f = {el, expr: opts.expression||'neutral'};
  faces.add(f); updateFace(f);
}
