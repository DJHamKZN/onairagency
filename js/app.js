/* ===================== ЛОГИКА ПРИЛОЖЕНИЯ ===================== */
/* Зависит от SERVICES_DATA и CASES_DATA (js/data.js) и библиотек Tailwind + Lucide. */

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.getElementById('year').textContent = new Date().getFullYear();

/* ---- Render services ---- */
(function renderServices(){
  const grid = document.getElementById('services-grid');
  grid.innerHTML = SERVICES_DATA.map((s, i) => `
    <article class="reveal group relative rounded-3xl overflow-hidden glass-panel border border-white/10 hover:border-[#ff003c]/50 hover:shadow-[0_20px_50px_rgba(255,0,60,0.06)] p-8 sm:p-10 transition-all duration-500 flex flex-col justify-between">
      <div class="absolute -inset-px bg-gradient-to-br from-[#ff003c]/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
      <div>
        <div class="flex items-center justify-between mb-8">
          <div class="w-14 h-14 rounded-2xl bg-white/[0.02] border border-white/10 flex items-center justify-center p-3 text-[#ff003c] group-hover:bg-[#ff003c] group-hover:text-white group-hover:border-[#ff003c] group-hover:shadow-[0_0_20px_rgba(255,0,60,0.4)] transition-all duration-500">
            ${s.iconName === 'instagram'
              ? '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>'
              : '<i data-lucide="'+s.iconName+'" style="width:28px;height:28px;stroke-width:1.5"></i>'}
          </div>
          <span class="text-[10px] font-mono text-white/20 tracking-wider group-hover:text-[#ff003c]/50 transition-colors duration-500 font-bold">[0${i+1}]</span>
        </div>
        <h3 class="text-xl sm:text-2xl font-black text-white tracking-tight uppercase">${esc(s.title)}</h3>
        <p class="text-[#ff003c] text-xs font-mono font-medium tracking-wide mt-2 mb-4">${esc(s.tagline)}</p>
        <p class="text-white/60 text-sm leading-relaxed mb-8">${esc(s.description)}</p>
      </div>
      <div class="border-t border-white/10 pt-6 mt-auto">
        <h4 class="text-xs font-mono font-bold uppercase tracking-wider mb-4 text-white/50 group-hover:text-[#ff003c] transition-colors duration-500">Примеры задач в OnAir:</h4>
        <ul class="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-4">
          ${s.details.map(d => `<li class="flex items-start gap-2 text-xs text-[#cbd5e1] leading-snug"><i data-lucide="circle-check" class="text-[#ff003c] shrink-0 mt-0.5" style="width:14px;height:14px"></i><span>${esc(d)}</span></li>`).join('')}
        </ul>
      </div>
    </article>`).join('');
})();

/* ---- Render cases (accordion) ---- */
(function renderCases(){
  const stack = document.getElementById('cases-stack');
  stack.innerHTML = CASES_DATA.map((p, idx) => `
    <article data-case="${p.id}" class="reveal case-card group rounded-3xl border transition-all duration-500 overflow-hidden glass-panel border-white/10 hover:border-white/20 hover:bg-white/[0.02]">
      <div class="case-header p-8 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8 cursor-pointer relative select-none" role="button">
        <div class="space-y-4 max-w-xl">
          <div class="flex flex-wrap gap-2">
            ${p.tags.map(t => `<span class="case-tag text-[9px] font-mono tracking-widest uppercase px-2.5 py-1 rounded-full border bg-white/[0.02] text-gray-400 border-white/10 font-semibold">${esc(t)}</span>`).join('')}
          </div>
          <div>
            <h3 class="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none group-hover:text-gradient-neon transition-all duration-300">${esc(p.client)}</h3>
            <p class="text-[#ff003c] text-xs font-mono tracking-wider mt-1.5 uppercase font-medium">${esc(p.shortBrief)}</p>
          </div>
          <p class="text-gray-400 text-sm leading-relaxed font-light">${esc(p.description)}</p>
        </div>
        <div class="flex items-center gap-6 shrink-0 lg:text-right">
          <div class="space-y-1">
            <div class="text-4xl sm:text-6xl font-black font-display tracking-tight text-gradient-neon flex items-baseline">${esc(p.metricValue)}</div>
            <div class="text-white text-xs font-mono font-bold uppercase tracking-wider">${esc(p.metricLabel)}</div>
            <div class="text-gray-400 text-[10px] font-mono leading-none">${esc(p.metricContext)}</div>
          </div>
          <div class="case-chevron w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 shrink-0 bg-white/[0.03] text-gray-400 border border-white/10 group-hover:bg-white/10 group-hover:text-white">
            <i data-lucide="chevron-down" style="width:20px;height:20px"></i>
          </div>
        </div>
      </div>
      <div class="case-drawer" style="display:none">
        <div class="border-t border-white/10 bg-black/[0.15] px-8 py-8 sm:px-10 sm:py-10 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div class="space-y-4">
            <h4 class="text-sm font-mono font-bold tracking-widest text-[#ff003c] uppercase flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#ff003c]"></span>// Шаги реализации (Стратегия)</h4>
            <div class="space-y-3">
              ${p.strategyPoints.map((pt, i) => `<div class="flex gap-3 items-start"><div class="w-5 h-5 rounded bg-white/[0.02] border border-white/10 flex items-center justify-center shrink-0 mt-0.5 text-gray-400 text-[10px] font-mono font-bold">0${i+1}</div><p class="text-gray-300 text-sm font-light leading-normal">${esc(pt)}</p></div>`).join('')}
            </div>
          </div>
          <div class="space-y-4">
            <h4 class="text-sm font-mono font-bold tracking-widest text-white uppercase flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-white"></span>// Коммерческие итоги</h4>
            <div class="space-y-3">
              ${p.results.map(r => `<div class="flex gap-3 items-start"><div class="w-5 h-5 rounded bg-[#ff003c]/10 text-[#ff003c] flex items-center justify-center shrink-0 mt-0.5"><i data-lucide="check" style="width:12px;height:12px;stroke-width:2.5"></i></div><p class="text-gray-200 text-sm font-normal leading-normal">${esc(r)}</p></div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </article>`).join('');

  const cards = stack.querySelectorAll('.case-card');
  function setOpen(card, open){
    const drawer = card.querySelector('.case-drawer');
    const chevron = card.querySelector('.case-chevron');
    const tags = card.querySelectorAll('.case-tag');
    drawer.style.display = open ? 'block' : 'none';
    card.classList.toggle('glass-panel-neon', open);
    card.classList.toggle('ring-1', open);
    card.classList.toggle('ring-[#ff003c]/30', open);
    card.classList.toggle('shadow-[0_30px_60px_rgba(255,0,60,0.08)]', open);
    card.classList.toggle('glass-panel', !open);
    card.classList.toggle('border-white/10', !open);
    chevron.classList.toggle('bg-[#ff003c]', open);
    chevron.classList.toggle('text-white', open);
    chevron.classList.toggle('shadow-[0_0_15px_rgba(255,0,60,0.5)]', open);
    chevron.classList.toggle('bg-white/[0.03]', !open);
    chevron.classList.toggle('text-gray-400', !open);
    chevron.classList.toggle('border', !open);
    chevron.classList.toggle('border-white/10', !open);
    // rotate the chevron via CSS (icon stays a chevron-down, flips 180° when open)
    chevron.style.transition = 'transform 0.4s ease';
    chevron.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
    tags.forEach(t => {
      t.classList.toggle('bg-[#ff003c]/10', open);
      t.classList.toggle('text-[#ff003c]', open);
      t.classList.toggle('border-[#ff003c]/20', open);
      t.classList.toggle('bg-white/[0.02]', !open);
      t.classList.toggle('text-gray-400', !open);
      t.classList.toggle('border-white/10', !open);
    });
  }
  cards.forEach(card => {
    card.querySelector('.case-header').addEventListener('click', () => {
      const isOpen = card.querySelector('.case-drawer').style.display === 'block';
      cards.forEach(c => { if (c !== card) setOpen(c, false); });
      setOpen(card, !isOpen);
    });
  });
  // open first by default
  setOpen(cards[0], true);
})();

/* ---- Navigation, header, mobile menu ---- */
(function nav(){
  const header = document.getElementById('main-header');
  const drawer = document.getElementById('mobile-navigation-drawer');
  const toggle = document.getElementById('mobile-menu-toggle-btn');
  const menuIcon = document.getElementById('menu-icon');
  let open = false;

  function setHeader(){
    const scrolled = window.scrollY > 40;
    header.className = 'fixed top-0 left-0 w-full z-100 transition-all duration-500 border-b ' + (scrolled
      ? 'bg-white/5 backdrop-blur-xl py-4 border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.8)]'
      : 'bg-transparent py-5 border-transparent');
  }
  window.addEventListener('scroll', setHeader); setHeader();

  toggle.addEventListener('click', () => {
    open = !open;
    drawer.classList.toggle('hidden', !open);
    drawer.classList.toggle('flex', open);
    menuIcon.setAttribute('data-lucide', open ? 'x' : 'menu');
    lucide.createIcons();
  });

  function scrollToSection(id){
    open = false; drawer.classList.add('hidden'); drawer.classList.remove('flex');
    menuIcon.setAttribute('data-lucide','menu'); lucide.createIcons();
    const el = document.getElementById(id);
    if (el){
      const top = el.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top, behavior:'smooth' });
    }
  }
  document.querySelectorAll('[data-scroll]').forEach(b => b.addEventListener('click', () => scrollToSection(b.dataset.scroll)));
})();

/* ---- Reveal on scroll ---- */
(function reveal(){
  const els = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
})();

/* ---- Custom cursor ---- */
(function cursor(){
  const c = document.getElementById('custom-cursor');
  if (!c) return;
  document.addEventListener('mousemove', e => { c.style.left = e.clientX+'px'; c.style.top = e.clientY+'px'; });
  document.addEventListener('mousedown', () => { c.style.transform='translate(-50%,-50%) scale(0.7)'; c.style.backgroundColor='rgba(255,0,60,0.3)'; });
  document.addEventListener('mouseup', () => { c.style.transform='translate(-50%,-50%) scale(1)'; c.style.backgroundColor='transparent'; });
  const sel = 'a, button, select, input, [role="button"]';
  document.addEventListener('mouseover', e => { if (e.target.closest(sel)){ c.style.width='50px'; c.style.height='50px'; c.style.boxShadow='0 0 15px rgba(255,0,60,0.6)'; } });
  document.addEventListener('mouseout', e => { if (e.target.closest(sel)){ c.style.width='32px'; c.style.height='32px'; c.style.boxShadow='none'; } });
})();

/* ---- Animated network background (canvas) — connected constellation web ---- */
(function network(){
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, dpr, COUNT;
  let parts = [];
  const mouse = { x:0, y:0, tx:0, ty:0 };

  function build(){
    parts = [];
    // density tied to screen area -> even, connected coverage on any size
    COUNT = Math.round(Math.min(120, Math.max(60, (W*H)/13500)));
    for (let i=0;i<COUNT;i++){
      const ang = Math.random()*Math.PI*2;
      const sp = 4 + Math.random()*7;          // slow drift speed (px/sec)
      parts.push({
        x: Math.random()*W,
        y: Math.random()*H,
        vx: Math.cos(ang)*sp,
        vy: Math.sin(ang)*sp,
        size: 0.6 + Math.random()*1.9,          // varied sizes
        bright: 0.55 + Math.random()*0.45,
        tw: Math.random()*Math.PI*2             // twinkle phase
      });
    }
  }

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W+'px'; canvas.style.height = H+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    build();
  }
  window.addEventListener('resize', resize); resize();
  window.addEventListener('mousemove', e => { mouse.tx = (e.clientX/W*2-1); mouse.ty = (e.clientY/H*2-1); });

  const THRESH = 150;                            // connection radius
  const MARGIN = 40;
  let last = performance.now();
  function frame(now){
    const dt = Math.min(0.05, (now - last)/1000); last = now;
    const t = now/1000;
    mouse.x += (mouse.tx - mouse.x)*0.04;
    mouse.y += (mouse.ty - mouse.y)*0.04;
    const px = mouse.x*30, py = mouse.y*22;       // gentle parallax (render only)

    // move + wrap at edges -> continuous even field
    for (const p of parts){
      p.x += p.vx*dt; p.y += p.vy*dt;
      if (p.x < -MARGIN) p.x = W+MARGIN; else if (p.x > W+MARGIN) p.x = -MARGIN;
      if (p.y < -MARGIN) p.y = H+MARGIN; else if (p.y > H+MARGIN) p.y = -MARGIN;
      p.rx = p.x + px; p.ry = p.y + py;
    }

    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation = 'lighter';     // additive neon glow

    // connect ALL nearby pairs -> a real web
    ctx.lineWidth = 1;
    for (let i=0;i<COUNT;i++){
      const a = parts[i];
      for (let j=i+1;j<COUNT;j++){
        const b = parts[j];
        const dx = a.rx-b.rx, dy = a.ry-b.ry;
        const d2 = dx*dx + dy*dy;
        if (d2 < THRESH*THRESH){
          const d = Math.sqrt(d2);
          const al = (1 - d/THRESH) * 0.22;
          ctx.strokeStyle = 'rgba(255,0,60,'+al.toFixed(3)+')';
          ctx.beginPath(); ctx.moveTo(a.rx,a.ry); ctx.lineTo(b.rx,b.ry); ctx.stroke();
        }
      }
    }
    // glowing dots: bright core + soft halo, varied sizes & subtle twinkle
    for (const p of parts){
      const tw = 0.7 + 0.3*Math.sin(t*0.8 + p.tw);
      const rc = p.size * 1.5 + 0.5;              // core radius
      const halo = rc * 3.2;
      const core = p.bright * tw;
      const g = ctx.createRadialGradient(p.rx,p.ry,0,p.rx,p.ry,halo);
      g.addColorStop(0,    'rgba(255,75,115,'+core.toFixed(3)+')');
      g.addColorStop(0.3,  'rgba(255,0,60,'+(core*0.5).toFixed(3)+')');
      g.addColorStop(1,    'rgba(255,0,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.rx,p.ry,halo,0,Math.PI*2); ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---- Init icons ---- */
lucide.createIcons();
