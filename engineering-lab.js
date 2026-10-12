(() => {
  const root = document.querySelector('.engineering-lab');
  if (!root) return;
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const $ = selector => root.querySelector(selector);
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const demos = [
    { title: 'Point Cloud Registration', tag: '01 / Geometry', text: 'Watch two offset scans converge into a shared coordinate frame. Correspondences reveal the geometry behind point cloud registration.', stages: ['Source & reference', 'Find correspondences', 'Refine alignment'], legends: ['Reference cloud', 'Source cloud'], link: 'Explore my engineering background', href: 'resume_en.pdf' },
    { title: 'Point Cloud Completion', tag: '02 / 3D perception', text: 'A demonstration of recovering a complete 3D shape from a partial point cloud, inspired by my SplAttN research.', stages: ['Partial observation', 'Recover structure', 'Complete geometry'], legends: ['Observed points', 'Completed points'], link: 'SplAttN · paper & code', href: '#publication' },
    { title: 'LiDAR Mapping & SLAM', tag: '03 / Localization', text: 'A moving sensor accumulates LiDAR returns, estimates a trajectory, and revisits its starting point. Loop closure illustrates how a map can correct accumulated drift.', stages: ['Scan & localize', 'Accumulate the map', 'Close the loop'], legends: ['LiDAR map / corrected path', 'Odometry with drift'], link: 'See the mobile robot', href: '#robotics-demo' },
    { title: 'Object Detection', tag: '04 / Visual perception', text: 'An object detection example with manually annotated vehicles in a traffic photograph.', stages: ['Acquire image', 'Localize vehicles', 'Review detections'], legends: ['Car / van', 'Truck'], link: 'Explore my engineering background', href: 'resume_en.pdf' },
    { title: 'Glass Defect Inspection', tag: '05 / Industrial vision', text: 'A visual inspection example showing a damaged pane and a close-up of the impact area.', stages: ['Acquire & isolate ROI', 'Localize the defect', 'Review the damage'], legends: ['Inspection region', 'Impact damage'], link: 'Project details in my CV', href: 'resume_en.pdf' }
  ];
  const clamp = x => Math.max(0, Math.min(1, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  let selected = 0, progress = 0, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = false, raf = 0, previous = 0, width = 800, height = 420;
  const cyan = '#65d9ff', gold = '#e8b575', green = '#6ce2b8';
  function line(points, color, size = 1, dash = []) {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.setLineDash(dash);
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
  }
  function dot(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function label(text, x, y, color = '#9db3c7', size = 10) { ctx.fillStyle = color; ctx.font = `${size}px ui-monospace, monospace`; ctx.fillText(text, x, y); }
  function box(x, y, w, h, color, text) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    for (const [a, b, sx, sy] of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]) line([[a+sx*8,b],[a,b],[a,b+sy*8]],color,2);
    if (text) { ctx.fillStyle = '#080f19dd'; ctx.fillRect(x, y - 19, text.length * 6.5 + 12, 18); label(text, x + 5, y - 6, color); }
  }
  // Deterministic surface samples keep scrubbing and replay exactly reproducible.
  const cloud = [];
  function cuboid(cx, cy, cz, sx, sy, sz, n) {
    for (let f = 0; f < 6; f++) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const p = [(a / (n - 1) - .5), (b / (n - 1) - .5)];
      const axis = f >> 1, q = [0, 0, 0]; q[axis] = f % 2 ? .5 : -.5; q[(axis + 1) % 3] = p[0]; q[(axis + 2) % 3] = p[1];
      cloud.push([cx + q[0] * sx, cy + q[1] * sy, cz + q[2] * sz]);
    }
  }
  cuboid(0, .05, 0, 1.3, .15, 1.2, 13); cuboid(0, .78, .52, 1.3, 1.3, .12, 13);
  for (const x of [-.53, .53]) for (const z of [-.48, .48]) cuboid(x, -.58, z, .13, 1.15, .13, 7);
  function geometry(p, completion) {
    const turn = -.55 + p * .6, scale = Math.min(width * .205, height * .28);
    const project = ([x,y,z]) => { const a=x*Math.cos(turn)-z*Math.sin(turn), b=x*Math.sin(turn)+z*Math.cos(turn); return [width*.5+a*scale, height*.54-y*scale+b*scale*.34]; };
    for (let i=-4;i<=4;i++) {
      line([project([i*.4,-1.17,-1.6]), project([i*.4,-1.17,1.6])], '#223346');
      line([project([-1.6,-1.17,i*.4]), project([1.6,-1.17,i*.4])], '#223346');
    }
    const t = smooth((p-.15)/.65), offset=1-t;
    cloud.forEach((point,i) => {
      const [x,y] = project(point), observed = point[0] < -.12 || point[2] < -.42;
      if (!completion || observed) dot(x,y,1.15,cyan+'bb');
      if (completion) {
        if (!observed && (i % 97)/97 < t) {
          const q=project([point[0]+offset*.25*Math.sin(i),point[1]+offset*.4,point[2]]); dot(q[0],q[1],1.25,gold);
        }
      } else {
        const angle=offset*.6, q=project([point[0]*Math.cos(angle)-point[2]*Math.sin(angle)+offset*.65,point[1]+offset*.35,point[0]*Math.sin(angle)+point[2]*Math.cos(angle)]);
        dot(q[0],q[1],1.1,gold+'b0');
        if (i%80===0 && p>.2 && p<.8) line([[x,y],q], '#e8b57540');
      }
    });
    label(completion ? 'PARTIAL → COMPLETE' : 'SOURCE → SHARED FRAME',24,height-60);
    const bx=width-115, by=height-80; line([[bx,by],[bx+35,by]],'#e69e92');line([[bx,by],[bx,by-35]],green);line([[bx,by],[bx-20,by+15]],cyan);label('x',bx+40,by+3);label('y',bx-3,by-42);label('z',bx-30,by+20);
  }
  const walls = [[-2.5,-1.65,2.5,-1.65],[2.5,-1.65,2.5,1.65],[2.5,1.65,-2.5,1.65],[-2.5,1.65,-2.5,-1.65],[-.6,-.65,.6,-.65],[.6,-.65,.6,.65],[.6,.65,-.6,.65],[-.6,.65,-.6,-.65]];
  function mapping(p) {
    const scale=Math.min(width/6.6,height/4.8), project=([x,y])=>[width/2+x*scale,height/2+y*scale];
    const route=t=>[1.7*Math.cos(t*Math.PI*2),1.12*Math.sin(t*Math.PI*2)];
    const t=Math.min(p/.85,1), robot=route(t), r=project(robot), correction=smooth((p-.85)/.15);
    walls.forEach(([x,y,a,b])=>line([project([x,y]),project([a,b])],'#263a4a',3));
    const points=[];
    for(let j=0;j<100;j++) {
      const rp=route(j/99); if(j/99>t) break;
      walls.forEach(([x,y,a,b],k)=>{
        for(let n=0;n<=26;n++) {
          const q=[x+(a-x)*n/26,y+(b-y)*n/26];
          if(Math.hypot(q[0]-rp[0],q[1]-rp[1])<1.65 && j%4===0) points.push(project([q[0]+Math.sin(n*31+k)*.012,q[1]+Math.cos(n*17)*.012]));
        }
      });
    }
    points.forEach(q=>dot(...q,1.2,cyan+'99'));
    const path=[], drift=[];
    for(let i=0;i<=100*t;i++){ const q=route(i/100); path.push(project(q)); drift.push(project([q[0]+i*.0035*(1-correction),q[1]+i*.0028*(1-correction)])); }
    line(drift,gold,1.5,[4,4]);line(path,cyan,2);
    for(let i=0;i<40;i++){const angle=p*25+i*.025;line([r,[r[0]+Math.cos(angle)*scale*1.5,r[1]+Math.sin(angle)*scale*1.5]],'#65d9ff0b');}
    for(let i=0;i<8;i++){const q=points[(i*71)%Math.max(points.length,1)];if(q)line([r,q],'#65d9ff26');}
    dot(...r,12,'#65d9ff20'); dot(...r,5,cyan);
    if(p>.85){ctx.strokeStyle=green;ctx.lineWidth=2;ctx.beginPath();ctx.arc(...project(route(0)),19,0,Math.PI*2);ctx.stroke();label('LOOP CLOSURE',24,height-60,green);}
    else label('SCAN MATCHING / POSE GRAPH',24,height-60);
    label('N',width-35,65);line([[width-32,90],[width-32,72]],'#7993aa');
  }
  const photos = {};
  function loadPhoto(index) {
    if (photos[index]) return;
    const photo = new Image(); photos[index] = photo;
    photo.onload = () => render();
    photo.onerror = () => { photo.dataset.failed = 'true'; render(); };
    photo.src = index === 3 ? 'assets/engineering/traffic.jpg' : 'assets/engineering/inspection-window.jpg';
  }
  function photoBackground(index) {
    const photo = photos[index];
    canvas.dataset.photoReady = String(Boolean(photo?.complete && photo.naturalWidth));
    if (!photo?.complete || !photo.naturalWidth) {
      label(photo?.dataset.failed ? 'Image unavailable. Please reload to retry.' : 'Loading reference photograph…', 24, height / 2);
      return null;
    }
    const scale = Math.min((width - 24) / photo.naturalWidth, (height - 88) / photo.naturalHeight);
    const w = photo.naturalWidth * scale, h = photo.naturalHeight * scale;
    const x = (width - w) / 2, y = (height - h) / 2;
    ctx.drawImage(photo, x, y, w, h);
    ctx.fillStyle = '#06111b26'; ctx.fillRect(x, y, w, h);
    return { x, y, w, h };
  }
  function detection(p) {
    const frame = photoBackground(3); if (!frame) return;
    const { x, y, w, h } = frame;
    const annotations = [
      [.085,.61,.138,.169,'car',cyan], [.359,.614,.139,.191,'car',cyan],
      [.37,.451,.119,.18,'van',cyan], [.755,.222,.134,.211,'truck',gold],
      [.63,.243,.082,.089,'car',cyan], [.587,.489,.13,.151,'car',cyan]
    ];
    annotations.forEach(([bx,by,bw,bh,name,color], i) => {
      ctx.globalAlpha = smooth((p - .12 - i * .055) / .1);
      box(x + bx*w, y + by*h, bw*w, bh*h, color, p > .58 ? name : 'object');
    });
    ctx.globalAlpha = 1;
    if (p < .6) { const sx = x + w * clamp(p / .6); line([[sx,y],[sx,y+h]],cyan+'99',1); }
  }
  function inspection(p) {
    const photo = photos[4];
    canvas.dataset.photoReady = String(Boolean(photo?.complete && photo.naturalWidth));
    if (!photo?.complete || !photo.naturalWidth) {
      label(photo?.dataset.failed ? 'Image unavailable. Please reload to retry.' : 'Loading reference photograph…', 24, height / 2);
      return;
    }
    // Crops refer to the original photograph; boxes follow the visible impact hole.
    const contextCrop = [.30, .20, .36, .44], detailCrop = [.328, .374, .14, .122];
    const gap = 20, margin = 20, available = width - margin * 2 - gap;
    const drawCrop = (crop, left, slotWidth) => {
      const [sx, sy, sw, sh] = crop;
      const aspect = sw * photo.naturalWidth / (sh * photo.naturalHeight);
      const h = Math.min(height - 132, slotWidth / aspect), w = h * aspect;
      const x = left + (slotWidth - w) / 2, y = (height - h) / 2;
      ctx.drawImage(photo, sx * photo.naturalWidth, sy * photo.naturalHeight, sw * photo.naturalWidth, sh * photo.naturalHeight, x, y, w, h);
      return { x, y, w, h };
    };
    const overview = drawCrop(contextCrop, margin, available * .43);
    const detail = drawCrop(detailCrop, margin + available * .43 + gap, available * .57);
    label('OVERVIEW', overview.x, overview.y - 14);
    label('DETAIL', detail.x, detail.y - 14);
    const rx = overview.x + (detailCrop[0] - contextCrop[0]) / contextCrop[2] * overview.w;
    const ry = overview.y + (detailCrop[1] - contextCrop[1]) / contextCrop[3] * overview.h;
    const rw = detailCrop[2] / contextCrop[2] * overview.w, rh = detailCrop[3] / contextCrop[3] * overview.h;
    box(rx, ry, rw, rh, cyan);
    line([[rx + rw, ry + rh / 2], [detail.x, detail.y + detail.h / 2]], cyan + '70', 1, [3, 4]);
    if (p < .65) {
      const scan = detail.x + detail.w * clamp(p / .65);
      line([[scan, detail.y], [scan, detail.y + detail.h]], cyan, 1.5);
    }
    ctx.globalAlpha = smooth((p - .35) / .2);
    box(detail.x + detail.w * .23, detail.y + detail.h * .27, detail.w * .31, detail.h * .39, gold);
    ctx.globalAlpha = 1;
    if (p > .65) label('IMPACT DAMAGE', detail.x, detail.y + detail.h + 24, gold);
  }
  function render() {
    ctx.clearRect(0,0,width,height);
    const glow=ctx.createRadialGradient(width*.5,height*.45,0,width*.5,height*.45,width*.6);glow.addColorStop(0,'#152a3b');glow.addColorStop(1,'#080f19');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
    for(let x=0;x<width;x+=32)line([[x,0],[x,height]],'#8aacc008');for(let y=0;y<height;y+=32)line([[0,y],[width,y]],'#8aacc008');
    if(selected<2)geometry(progress,selected===1);else if(selected===2)mapping(progress);else if(selected===3)detection(progress);else inspection(progress);
    $('[data-lab-progress]').value=String(Math.round(progress*1000));
    $('[data-lab-percent]').textContent=`${Math.round(progress*100)}%`;
    root.querySelectorAll('[data-lab-steps] li').forEach((li,i)=>li.classList.toggle('is-current',i===Math.min(2,Math.floor(progress*3))));
  }
  function frame(now) { raf=0;if(!playing||!visible||document.hidden)return; if(previous)progress=(progress+Math.min(now-previous,60)/14000)%1;previous=now;render();raf=requestAnimationFrame(frame); }
  function sync() { cancelAnimationFrame(raf);raf=0;previous=0;$('[data-lab-play]').textContent=playing?'Pause':'Play';$('[data-lab-play]').setAttribute('aria-pressed',String(playing));if(playing&&visible&&!document.hidden)raf=requestAnimationFrame(frame); }
  function select(index) {
    selected=index;progress=0;const d=demos[index];
    $('.engineering-stage').classList.toggle('is-photo', index >= 3);
    $('[data-lab-medium]').textContent = index >= 3 ? 'ANNOTATED EXAMPLE' : 'CONCEPT DEMO';
    const credit = $('[data-photo-credit]'); credit.hidden = index < 3;
    if (index >= 3) {
      loadPhoto(index);
      credit.innerHTML = index === 3
        ? 'Photo: <a href="https://commons.wikimedia.org/wiki/File:Cars_in_traffic_in_Auckland,_New_Zealand_-_copyright-free_photo_released_to_public_domain.jpg" target="_blank" rel="noopener noreferrer">Kiwiev</a> · CC0.'
        : 'Photo: <a href="https://commons.wikimedia.org/wiki/File:Broken_glass_in_window.JPG" target="_blank" rel="noopener noreferrer">Dmitry G</a> · Public domain.';
    }
    tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
    $('[role="tabpanel"]').setAttribute('aria-labelledby',tabs[index].id);
    $('[data-lab-title]').textContent=d.title;$('[data-lab-tag]').textContent=d.tag;$('[data-lab-text]').textContent=d.text;
    $('[data-lab-steps]').replaceChildren(...d.stages.map(s=>{const li=document.createElement('li');li.textContent=s;return li;}));
    $('[data-lab-legend]').replaceChildren(...d.legends.map(s=>{const el=document.createElement('span');el.textContent=s;return el;}));
    $('[data-lab-link]').textContent=d.link;$('[data-lab-link]').href=d.href;canvas.setAttribute('aria-label',`${d.title} ${d.text}`);render();
  }
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>select(i));tab.addEventListener('keydown',e=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();select(n);tabs[n].focus();});});
  $('[data-lab-play]').addEventListener('click',()=>{playing=!playing;sync();});
  $('[data-lab-progress]').addEventListener('input',e=>{playing=false;progress=Number(e.target.value)/1000;sync();render();});
  const resize=new ResizeObserver(()=>{width=canvas.clientWidth;height=canvas.clientHeight;const dpr=Math.min(devicePixelRatio,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);render();});resize.observe(canvas);
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});observer.observe(root);
  document.addEventListener('visibilitychange',sync);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{if(e.matches){playing=false;sync();}});
  select(0);sync();
})();
