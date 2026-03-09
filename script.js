/**
 * script.js — Intro Hoa + Canvas Image Trail
 * ─────────────────────────────────────────────
 * Tối ưu:
 *  1. Object Pool cố định — không push/shift/GC
 *  2. Idle-aware RAF — tự cancelAnimationFrame khi rảnh
 *  3. Throttled events — 1 lần cập nhật pos mỗi frame
 *  4. Lazy + look-ahead preload — không nghẽn RAM
 *  5. Hard spawn cap — pool đầy thì bỏ qua, không overwrite
 */

/* ═══════════════════════════════════════════
   TRANG 1 — HOA INTRO
═══════════════════════════════════════════ */
setTimeout(function () {
  document.body.classList.remove('not-loaded');
}, 1000);

var btnNext = document.getElementById('btn-next');
function goPage2() {
  document.body.classList.add('go-page2');
  setTimeout(initTrail, 950);
}
btnNext.addEventListener('click', goPage2);
btnNext.addEventListener('touchend', function (e) { e.preventDefault(); goPage2(); });

/* ═══════════════════════════════════════════
   DEVICE DETECT
═══════════════════════════════════════════ */
var IS_TOUCH  = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
var IS_MOBILE = IS_TOUCH && window.screen.width <= 900;

/* ═══════════════════════════════════════════
   BASE URL — tự động detect cho GitHub Pages
═══════════════════════════════════════════ */
var BASE_URL = (function () {
  var loc = window.location.href.split('?')[0].split('#')[0];
  if (loc.charAt(loc.length - 1) !== '/') {
    loc = loc.substring(0, loc.lastIndexOf('/') + 1);
  }
  return loc;
})();


/* ═══════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════ */
var CFG = {
  totalImages : 10,
  imgDir      : BASE_URL + 'img/',
  imgExt      : '.png',
  minDist     : IS_MOBILE ? 55  : 90,
  poolSize    : IS_MOBILE ? 6   : 10,
  imgW        : IS_MOBILE ? 110 : 210,
  imgH        : IS_MOBILE ? 83  : 158,
  totalFrames : IS_MOBILE ? 36  : 65,
  fpsCap      : IS_MOBILE ? 30  : 60,
  prewarmN    : 10,  // load hết toàn bộ ngay từ đầu
  lookAheadN  : 5
};

/* ═══════════════════════════════════════════
   IMAGE CACHE — lazy + sequential
   _cache[i] = null      : chưa bắt đầu
   _cache[i] = 'loading' : đang load
   _cache[i] = 'error'   : lỗi
   _cache[i] = Image     : sẵn sàng ✓
═══════════════════════════════════════════ */
var _cache = [];
(function(){ for(var i=0;i<CFG.totalImages;i++) _cache[i]=null; })();

function loadImg(idx) {
  if (_cache[idx] !== null) return; // đã load hoặc đang load
  _cache[idx] = 'loading';
  (function(i){
    var im = new Image();
    im.onload  = function () { _cache[i] = im; };
    im.onerror = function () { _cache[i] = 'error'; };
    im.src = CFG.imgDir + 'img' + (i + 1) + CFG.imgExt;
  })(idx);
}

function isReady(idx) {
  return (_cache[idx] instanceof Image);
}

function prewarm(onAllLoaded) {
  var total = CFG.totalImages;
  var done  = 0;

  // Build bee loading bar HTML
  var hintEl = document.getElementById('surprise-hint');
  if (hintEl) {
    hintEl.innerHTML =
      '<div class="bee-track">' +
        '<div class="bee-fill" id="bee-fill"></div>' +
        '<img class="bee-icon" id="bee-icon" src="' + BASE_URL + 'bee.png" alt="">' +
      '</div>' +
      '<span class="bee-label" id="bee-label">Đang tải... 0 / ' + total + '</span>';
  }

  var fillEl  = document.getElementById('bee-fill');
  var iconEl  = document.getElementById('bee-icon');
  var labelEl = document.getElementById('bee-label');

  function updateBar() {
    var pct = Math.round((done / total) * 100);
    if (fillEl)  fillEl.style.width = pct + '%';
    if (iconEl)  iconEl.style.left  = pct + '%';
    if (labelEl) labelEl.textContent = 'Đang tải... ' + done + ' / ' + total;
  }
  updateBar();

  for (var i = 0; i < total; i++) {
    if (_cache[i] !== null) { done++; updateBar(); continue; }
    _cache[i] = 'loading';
    (function(idx) {
      var im = new Image();
      im.onload = function () {
        _cache[idx] = im;
        done++; updateBar();
        if (done >= total && onAllLoaded) onAllLoaded();
      };
      im.onerror = function () {
        _cache[idx] = 'error';
        done++; updateBar();
        if (done >= total && onAllLoaded) onAllLoaded();
      };
      im.src = CFG.imgDir + 'img' + (idx + 1) + CFG.imgExt;
    })(i);
  }
}

function lookAhead(fromIdx) {
  for (var k = 1; k <= CFG.lookAheadN; k++) {
    loadImg((fromIdx + k) % CFG.totalImages);
  }
}

/* ═══════════════════════════════════════════
   OBJECT POOL — kích thước cố định, vòng tròn
   Không bao giờ tạo object mới sau khi init
═══════════════════════════════════════════ */
function makeSlot() {
  return { img: null, imgIdx: -1, x: 0, y: 0, rot: 0, age: 0, maxAge: 0, alive: false, imgW: 0, imgH: 0 };
}

function Pool(size) {
  this.slots = [];
  this.head  = 0;
  this.count = 0;
  for (var i = 0; i < size; i++) this.slots.push(makeSlot());
}

/* Luôn spawn được — ghi đè slot cũ nhất khi pool đầy */
Pool.prototype.spawn = function (imgIdx, img, x, y, rot, maxAge, imgW, imgH) {
  var p = this.slots[this.head];
  this.head = (this.head + 1) % this.slots.length;
  if (!p.alive) this.count++;
  p.imgIdx = imgIdx;
  p.img    = img;
  p.x      = x;    p.y   = y;
  p.rot    = rot;   p.age = 0;
  p.maxAge = maxAge;
  p.alive  = true;
  p.imgW   = imgW || CFG.imgW;
  p.imgH   = imgH || CFG.imgH;
};

Pool.prototype.anyAlive = function () { return this.count > 0; };

/* ═══════════════════════════════════════════
   CANVAS TRAIL
═══════════════════════════════════════════ */
function CanvasTrail(canvas, pos) {
  this.canvas    = canvas;
  this.ctx       = canvas.getContext('2d');
  this.pos       = pos;
  this.lastSpawn = { x: -9999, y: -9999 };
  this.nextImg   = 0;
  this.pool      = new Pool(CFG.poolSize);
  this.dpr       = Math.min(window.devicePixelRatio || 1, 2);
  this.rafId     = null;
  this.isIdle    = true;
  this.idleTimer = null;
  this.interval  = 1000 / CFG.fpsCap;
  this.lastTime  = 0;

  this._resize();
  window.addEventListener('resize', this._resize.bind(this));
}

CanvasTrail.prototype._resize = function () {
  this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = window.innerWidth, h = window.innerHeight;
  this.canvas.width  = w * this.dpr;
  this.canvas.height = h * this.dpr;
  this.canvas.style.width  = w + 'px';
  this.canvas.style.height = h + 'px';
  this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
};

CanvasTrail.prototype.wakeUp = function () {
  this.isIdle = false;
  clearTimeout(this.idleTimer);
  if (!this.rafId) {
    var self = this;
    this.rafId = requestAnimationFrame(function loop(ts) {
      if (self.isIdle && !self.pool.anyAlive()) {
        cancelAnimationFrame(self.rafId);
        self.rafId = null;
        self.ctx.clearRect(0, 0, self.canvas.width / self.dpr, self.canvas.height / self.dpr);
        return;
      }
      self.rafId = requestAnimationFrame(loop);
      if (ts - self.lastTime < self.interval) return;
      self.lastTime = ts;
      self._tick();
    });
  }
  var self = this;
  this.idleTimer = setTimeout(function () { self.isIdle = true; }, 3000);
};

CanvasTrail.prototype._dist = function (a, b) {
  var dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

CanvasTrail.prototype._spawn = function (x, y) {
  // Tìm ảnh tiếp theo đã load — tối đa thử 20 slot liên tiếp
  var img = null, idx, tries = 0;
  while (tries < 20) {
    idx = this.nextImg % CFG.totalImages;
    this.nextImg++;
    tries++;
    loadImg(idx);
    lookAhead(idx);
    if (isReady(idx)) { img = _cache[idx]; break; }
  }
  if (!img) return;

  // Giữ đúng tỉ lệ ảnh thật, giới hạn cạnh dài nhất
  var maxLong = IS_MOBILE ? 130 : 240;
  var nw = img.naturalWidth  || CFG.imgW;
  var nh = img.naturalHeight || CFG.imgH;
  var ratio = nw / nh;
  var imgW, imgH;
  if (nw >= nh) {
    imgW = maxLong;
    imgH = Math.round(maxLong / ratio);
  } else {
    imgH = maxLong;
    imgW = Math.round(maxLong * ratio);
  }

  var rot = (Math.random() - 0.5) * 24 * Math.PI / 180;
  this.pool.spawn(idx, img, x, y, rot, CFG.totalFrames, imgW, imgH);
};

CanvasTrail.prototype._tick = function () {
  var ctx = this.ctx;
  var W   = this.canvas.width  / this.dpr;
  var H   = this.canvas.height / this.dpr;

  if (this._dist(this.pos, this.lastSpawn) >= CFG.minDist) {
    this._spawn(this.pos.x, this.pos.y);
    this.lastSpawn.x = this.pos.x;
    this.lastSpawn.y = this.pos.y;
  }

  ctx.clearRect(0, 0, W, H);

  var slots = this.pool.slots;
  for (var i = 0; i < slots.length; i++) {
    var p = slots[i];
    if (!p.alive) continue;

    // Nếu ảnh chưa load lúc spawn, thử lấy lại
    if (!p.img && p.imgIdx >= 0 && isReady(p.imgIdx)) {
      p.img = _cache[p.imgIdx];
    }

    p.age++;
    var t = p.age / p.maxAge;

    if (p.age >= p.maxAge) {
      p.alive = false;
      p.img   = null;
      this.pool.count--;
      continue;
    }

    if (!p.img) continue; // vẫn chưa load → skip render nhưng giữ slot

    var alpha;
    if      (t < 0.30) { alpha = t / 0.30; }
    else if (t < 0.60) { alpha = 1.0; }
    else               { alpha = 1.0 - (t - 0.60) / 0.40; }
    alpha *= 0.92;

    var sc;
    if      (t < 0.30) { sc = 0.6 + (t / 0.30) * 0.4; }
    else if (t < 0.60) { sc = 1.0; }
    else               { sc = 1.0 - (t - 0.60) / 0.40 * 0.15; }

    var w = p.imgW * sc;
    var h = p.imgH * sc;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);

    // Bo góc tự nhiên — radius ~12% cạnh ngắn
    var r = Math.min(w, h) * 0.12;
    var x0 = -w * 0.5, y0 = -h * 0.5;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x0 + w - r, y0);
    ctx.quadraticCurveTo(x0 + w, y0,         x0 + w, y0 + r);
    ctx.lineTo(x0 + w, y0 + h - r);
    ctx.quadraticCurveTo(x0 + w, y0 + h,     x0 + w - r, y0 + h);
    ctx.lineTo(x0 + r, y0 + h);
    ctx.quadraticCurveTo(x0,     y0 + h,     x0, y0 + h - r);
    ctx.lineTo(x0,     y0 + r);
    ctx.quadraticCurveTo(x0,     y0,         x0 + r, y0);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(p.img, x0, y0, w, h);
    ctx.restore();
  }
};

/* ═══════════════════════════════════════════
   CURSOR (desktop only)
═══════════════════════════════════════════ */
function Cursor(el, pos) {
  var tx = 0, ty = 0;
  el.style.opacity = 0;
  window.addEventListener('mousemove', function onFirst() {
    tx = pos.x - 40; ty = pos.y - 40;
    gsap.to(el, { duration: 0.7, opacity: 1 });
    (function loop() {
      tx += (pos.x - 40 - tx) * 0.18;
      ty += (pos.y - 40 - ty) * 0.18;
      el.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
      requestAnimationFrame(loop);
    })();
    window.removeEventListener('mousemove', onFirst);
  });
}

/* ═══════════════════════════════════════════
   INIT TRAIL
═══════════════════════════════════════════ */
var trailInited = false;

function initTrail() {
  if (trailInited) return;
  trailInited = true;

  document.body.classList.remove('loading');

  var page2      = document.getElementById('page2');
  var btnSurprise = document.getElementById('btn-surprise');
  var hintEl     = document.getElementById('surprise-hint');
  var pos        = { x: -9999, y: -9999 };
  var trail;
  var eventsEnabled = false;

  // Hiện bee loading bar ngay khi vào trang 2
  if (hintEl) {
    hintEl.classList.add('visible');
  }

  // Throttle helper
  var pendingX = 0, pendingY = 0, pending = false;
  function scheduleUpdate(x, y) {
    pendingX = x; pendingY = y;
    if (!pending) {
      pending = true;
      requestAnimationFrame(function () { pos.x = pendingX; pos.y = pendingY; pending = false; });
    }
  }

  // Bật events — chỉ gọi sau khi bấm nút
  function enableEvents() {
    if (eventsEnabled) return;
    eventsEnabled = true;
    if (!IS_TOUCH) {
      window.addEventListener('mousemove', function (ev) {
        scheduleUpdate(ev.clientX, ev.clientY);
        if (trail) trail.wakeUp();
      }, { passive: true });
    }
    page2.addEventListener('touchmove', function (ev) {
      ev.preventDefault();
      scheduleUpdate(ev.touches[0].clientX, ev.touches[0].clientY);
      if (trail) trail.wakeUp();
    }, { passive: false });
    page2.addEventListener('touchstart', function (ev) {
      scheduleUpdate(ev.touches[0].clientX, ev.touches[0].clientY);
      if (trail) trail.wakeUp();
    }, { passive: true });
  }

  // Canvas trail (tạo sẵn, chưa chạy)
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:20;will-change:transform;transform:translateZ(0);';
  page2.appendChild(canvas);
  trail = new CanvasTrail(canvas, pos);

  // Cursor desktop
  if (!IS_TOUCH) {
    var cursorEl = document.querySelector('.cursor');
    if (cursorEl) new Cursor(cursorEl, pos);
  }

  // Bấm nút → bắt đầu trail
  function activateSurprise() {
    if (btnSurprise) {
      btnSurprise.style.pointerEvents = 'none';
      btnSurprise.classList.remove('visible');
      setTimeout(function () { btnSurprise.style.display = 'none'; }, 500);
    }
    if (hintEl) {
      hintEl.classList.remove('visible');
      setTimeout(function () { hintEl.style.display = 'none'; }, 500);
    }
    // Hiện chữ KNKT + dòng sub
    page2.classList.add('revealed');
    // Hiện nút xem lời chúc sau 1s
    var btnWishEl = document.getElementById('btn-wish');
    if (btnWishEl) setTimeout(function(){ btnWishEl.classList.add('visible'); }, 1000);
    enableEvents();
    if (trail) trail.wakeUp();
  }

  if (btnSurprise) {
    btnSurprise.addEventListener('click', activateSurprise);
    btnSurprise.addEventListener('touchend', function (e) { e.preventDefault(); activateSurprise(); });
  } else {
    enableEvents(); // fallback nếu không có nút
  }

  // Load 10 ảnh — CHỈ hiện nút khi load xong hoàn toàn
  prewarm(function onAllLoaded() {
    var fillEl  = document.getElementById('bee-fill');
    var iconEl  = document.getElementById('bee-icon');
    var labelEl = document.getElementById('bee-label');
    if (fillEl)  fillEl.style.width = '100%';
    if (iconEl)  iconEl.style.left  = '100%';
    if (labelEl) labelEl.textContent = '✨ Sẵn sàng rồi!';
    if (hintEl) {
      setTimeout(function () { hintEl.classList.remove('visible'); }, 900);
    }
    if (btnSurprise) {
      setTimeout(function () { btnSurprise.classList.add('visible'); }, 700);
    }
  });
}


/* ═══════════════════════════════════════════
   TRANG 3 — LỜI CHÚC
═══════════════════════════════════════════ */
function goPage3() {
  document.body.classList.add('go-page3');
  initPetals();
}

function initPetals() {
  var container = document.getElementById('petalShower');
  if (!container || container._inited) return;
  container._inited = true;
  var colors = [
    'rgba(255,105,135,0.75)',
    'rgba(255,150,170,0.65)',
    'rgba(255,80,110,0.7)',
    'rgba(220,60,90,0.6)',
    'rgba(255,180,190,0.55)',
    'rgba(255,200,210,0.5)'
  ];
  for (var i = 0; i < 35; i++) {
    (function(idx) {
      var el = document.createElement('div');
      el.className = 'petal';
      var size = 10 + Math.random() * 14;
      el.style.cssText = [
        'left:'            + (Math.random() * 100) + 'vw',
        'width:'           + size + 'px',
        'height:'          + (size * 1.5) + 'px',
        'background:'      + colors[idx % colors.length],
        'animation-duration:' + (4 + Math.random() * 6) + 's',
        'animation-delay:' + (Math.random() * 8) + 's',
        'border-radius:'   + (Math.random() > 0.5 ? '50% 0 50% 0' : '0 50% 0 50%')
      ].join(';');
      container.appendChild(el);
    })(i);
  }
}

// Nút chuyển sang trang 3
var btnWish = document.getElementById('btn-wish');
if (btnWish) {
  btnWish.addEventListener('click', goPage3);
  btnWish.addEventListener('touchend', function(e){ e.preventDefault(); goPage3(); });
}

// Nút quay lại trang 2
var btnBack = document.getElementById('btn-back');
if (btnBack) {
  btnBack.addEventListener('click', function() {
    document.body.classList.remove('go-page3');
  });
  btnBack.addEventListener('touchend', function(e) {
    e.preventDefault();
    document.body.classList.remove('go-page3');
  });
}
