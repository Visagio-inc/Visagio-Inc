const els = {
  preview: document.getElementById('preview'),
  overlay: document.getElementById('overlay'),
  detectCount: document.getElementById('detectCount'),
  symVal: document.getElementById('symVal'),
  skinVal: document.getElementById('skinVal'),
  gauge: document.getElementById('gauge'),
  scoreNum: document.getElementById('scoreNum'),
  symmetryScore: document.getElementById('symmetryScore'),
  propScore: document.getElementById('propScore'),
  featScore: document.getElementById('featScore'),
  skinScore: document.getElementById('skinScore'),
  bars: {
    sym: document.getElementById('barSym'),
    prop: document.getElementById('barProp'),
    feat: document.getElementById('barFeat'),
    skin: document.getElementById('barSkin')
  },
  tips: document.getElementById('tipsList'),
  modelStatus: document.getElementById('modelStatus'),
  file: document.getElementById('file')
};

// Footer year
document.getElementById('year').textContent = new Date().getFullYear();

// Load face-api models (tries /models first; falls back to CDN)
async function loadModels() {
  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models')
    ]);
    els.modelStatus.innerHTML = '<span class="dot-blue"></span> Models ready';
  } catch (e) {
    els.modelStatus.innerHTML = '<span class="dot-blue"></span> Models not found — using CDN fallback';
    try {
      const cdn = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(cdn),
        faceapi.nets.faceLandmark68Net.loadFromUri(cdn)
      ]);
      els.modelStatus.innerHTML = '<span class="dot-blue"></span> Models ready (CDN)';
    } catch (err) {
      els.modelStatus.innerHTML = '<span class="dot-blue"></span> Failed to load models';
      console.error(err);
    }
  }
}
loadModels();

// Drag & drop
const dropzone = document.getElementById('dropzone');
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) loadImage(file);
});

// File input
els.file.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadImage(f);
});

// Demo images (replace with your own)
document.getElementById('sample1').addEventListener('click', () => demo('assets/demo1.jpg'));
document.getElementById('sample2').addEventListener('click', () => demo('assets/demo2.jpg'));
document.getElementById('clear').addEventListener('click', () => { els.preview.src = ''; clearCanvas(); resetUI(); });

function demo(path){ els.preview.src = path; els.preview.onload = () => analyze(); }

function loadImage(file){
  const reader = new FileReader();
  reader.onload = e => { els.preview.src = e.target.result; };
  reader.readAsDataURL(file);
  els.preview.onload = () => analyze();
}

function clearCanvas(){ const c = els.overlay; const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); }

function resetUI(){
  setGauge(0);
  els.scoreNum.textContent = '—';
  els.detectCount.textContent = '0';
  els.symVal.textContent = '–';
  els.skinVal.textContent = '–';
  ['sym','prop','feat','skin'].forEach(k=>{
    els.bars[k].style.width = '0%';
    document.getElementById(k+"Score").textContent = '—';
  });
  els.tips.innerHTML = '';
}

function setGauge(val){
  const v = Math.max(0, Math.min(100, Math.round(val)));
  els.gauge.style.setProperty('--val', v);
  els.scoreNum.textContent = v;
}

function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

async function analyze(){
  if (!els.preview.complete || !els.preview.src) return;

  const rect = els.preview.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  els.overlay.width = width; els.overlay.height = height;

  const detection = await faceapi.detectSingleFace(els.preview).withFaceLandmarks();
  clearCanvas();

  if(!detection){ els.detectCount.textContent = '0'; resetUI(); return; }

  els.detectCount.textContent = '1';
  const ctx = els.overlay.getContext('2d');
  const resized = faceapi.resizeResults(detection, { width, height });
  faceapi.draw.drawFaceLandmarks(els.overlay, resized);

  // Landmarks
  const pts = resized.landmarks.positions;
  const idx = n => pts[n];
  const faceWidth = dist(idx(0), idx(16));
  const faceHeight = dist(idx(8), idx(27));
  const leftEyeCenter = avgPt([36,37,38,39]);
  const rightEyeCenter = avgPt([42,43,44,45]);
  const interocular = dist(leftEyeCenter, rightEyeCenter);
  const eyeWidthL = dist(idx(36), idx(39));
  const eyeHeightL = (dist(idx(37), idx(41)) + dist(idx(38), idx(40))) / 2;
  const eyeWidthR = dist(idx(42), idx(45));
  const eyeHeightR = (dist(idx(43), idx(47)) + dist(idx(44), idx(46))) / 2;
  const noseWidth = dist(idx(31), idx(35));
  const mouthWidth = dist(idx(48), idx(54));

  function avgPt(indices){
    const p = indices.map(i => pts[i]);
    const x = p.reduce((s,a)=>s+a.x,0)/p.length;
    const y = p.reduce((s,a)=>s+a.y,0)/p.length;
    return {x,y};
  }

  // --- Symmetry ---
  const mid = idx(27);
  const pairs = [ [36,45], [39,42], [31,35], [48,54], [3,13], [5,11] ];
  let symErrors = 0;
  pairs.forEach(([l,r]) => {
    const dl = dist(idx(l), mid);
    const dr = dist(idx(r), mid);
    symErrors += Math.abs(dl - dr);
  });
  const symNorm = 1 - Math.min(1, (symErrors / pairs.length) / (faceWidth * 0.5)); // 0..1
  const symmetryScore = Math.round(symNorm * 100);

  // --- Proportions ---
  const ratio = (v, target, tol=0.1) => {
    const d = Math.abs(v - target);
    const t = tol * target;
    const s = Math.max(0, 1 - d / t);
    return s; // 0..1
  };
  const faceRatio = faceHeight / faceWidth;              // ideal ~0.9–1.1
  const r_face = ratio(faceRatio, 1.0, 0.25);
  const eyeSpacing = interocular / faceWidth;            // ideal ~0.46 ± 0.12
  const r_eye = ratio(eyeSpacing, 0.46, 0.26);
  const r_prop = (r_face + r_eye) / 2;
  const propScore = Math.round(r_prop * 100);

  // --- Feature ratios ---
  const noseRatio = noseWidth / faceWidth;               // ideal ~0.22 ± 0.09
  const mouthRatio = mouthWidth / faceWidth;             // ideal ~0.34 ± 0.12
  const eyeOpennessL = eyeHeightL / eyeWidthL;           // ideal ~0.3 ± 0.2
  const eyeOpennessR = eyeHeightR / eyeWidthR;
  const r_nose = ratio(noseRatio, 0.22, 0.4);
  const r_mouth = ratio(mouthRatio, 0.34, 0.35);
  const r_eyeOpen = (ratio(eyeOpennessL, 0.3, 0.7) + ratio(eyeOpennessR, 0.3, 0.7)) / 2;
  const r_feat = (r_nose + r_mouth + r_eyeOpen) / 3;
  const featScore = Math.round(r_feat * 100);

  // --- Skin evenness (brightness variance in face box) ---
  const box = resized.detection.box;
  const skin = brightnessVariance(els.preview, box);
  const skinScore = Math.max(0, Math.min(100, Math.round(100 - 500 * skin)));

  // --- Weighted total ---
  const overall = Math.round( symmetryScore * 0.30 + propScore * 0.30 + featScore * 0.20 + skinScore * 0.20 );

  // Update UI
  setGauge(overall);
  updateBar('sym', symmetryScore);
  updateBar('prop', propScore);
  updateBar('feat', featScore);
  updateBar('skin', skinScore);
  els.symVal.textContent = (symNorm*100).toFixed(1) + '%';
  els.skinVal.textContent = skinScore;

  // Tips
  renderTips({ symmetryScore, propScore, featScore, skinScore }, { faceRatio, eyeSpacing, noseRatio, mouthRatio, eyeOpennessL, eyeOpennessR });

  // Visual centerline
  const ctx2 = els.overlay.getContext('2d');
  ctx2.strokeStyle = '#13a8ff'; ctx2.lineWidth = 2; ctx2.setLineDash([6,4]);
  ctx2.beginPath(); ctx2.moveTo(mid.x, 0); ctx2.lineTo(mid.x, height); ctx2.stroke(); ctx2.setLineDash([]);

  function updateBar(key, val){
    els.bars[key].style.width = Math.max(0, Math.min(100,val)) + '%';
    document.getElementById(key + 'Score').textContent = val;
  }

  function brightnessVariance(img, box){
    const c = document.createElement('canvas');
    const ctx2 = c.getContext('2d');
    const w = Math.max(1, Math.floor(box.width));
    const h = Math.max(1, Math.floor(box.height));
    c.width = w; c.height = h;
    ctx2.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, w, h);
    const data = ctx2.getImageData(0,0,w,h).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i=0;i<data.length;i+=4){
      const y = 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2];
      sum += y; sum2 += y*y; n++;
    }
    const mean = sum / n; const variance = sum2/n - mean*mean;
    return variance / (255*255);
  }
}

function renderTips(scores, ratios){
  const tips = [];

  if (ratios.faceRatio > 1.15) {
    tips.push({ t: 'Balance a longer face', p: 'More volume at the sides, slight fringe; avoid extra height on top. Bold-frame glasses can shorten the look.' });
  } else if (ratios.faceRatio < 0.85) {
    tips.push({ t: 'Elongate a shorter face', p: 'Add a bit of height with hair, keep sides tighter, use vertical lines in styling.' });
  }
  if (ratios.eyeSpacing < 0.38) {
    tips.push({ t: 'Broaden close-set eyes', p: 'Lighten inner corners, keep brows slightly wider apart, pick a part that opens the center.' });
  } else if (ratios.eyeSpacing > 0.54) {
    tips.push({ t: 'Bring wide-set together', p: 'Darker inner-corner definition and slightly closer brow shape can narrow spacing.' });
  }
  if (ratios.noseRatio > 0.30) {
    tips.push({ t: 'Balance a wider nose', p: 'Light stubble and a slightly wider hairstyle distribute width. Frames with a bold bridge draw focus centrally.' });
  }
  if (ratios.mouthRatio < 0.26) {
    tips.push({ t: 'Enhance lip presence', p: 'Hydration, gentle tint, and smiling slightly in photos help balance proportions.' });
  }
  if (scores.symmetryScore < 70) {
    tips.push({ t: 'Photo posture for symmetry', p: 'Camera at eye level, face straight to lens, chin slightly down; even lighting reduces shadow asymmetry.' });
  }
  if (scores.skinScore < 75) {
    tips.push({ t: 'Even out skin appearance', p: 'Simple routine: gentle cleanse, moisturizer, daily SPF 30+, consider niacinamide (2–5%). Patch-test new products.' });
  }
  if (scores.featScore < 70) {
    tips.push({ t: 'Sharpen jaw & cheek definition', p: 'Good posture, light facial hair to outline jaw, relaxed tongue posture for better photos.' });
  }
  tips.push({ t: 'Mindset', p: 'This score is a rough heuristic. Confidence, kindness, grooming and fitness habits matter far more than millimeters.' });

  els.tips.innerHTML = '';
  tips.slice(0,6).forEach(({t,p}) => {
    const div = document.createElement('div');
    div.className = 'tip';
    div.innerHTML = `<h4>${t}</h4><p>${p}</p>`;
    els.tips.appendChild(div);
  });
}
