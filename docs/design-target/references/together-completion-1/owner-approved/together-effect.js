(function () {
  'use strict';

  window.wsfEffects = window.wsfEffects || {};

  // Decorative motion only. The parent owns confirmation, totals and WE fill.
  window.wsfEffects.together = function (ctx) {
    if (ctx.reduced) return;

    const stageBox = ctx.stage.getBoundingClientRect();
    const logoBox = ctx.logo.getBoundingClientRect();
    const width = Math.max(1, stageBox.width);
    const height = Math.max(1, stageBox.height);
    const centerX = logoBox.left - stageBox.left + logoBox.width / 2;
    const centerY = logoBox.top - stageBox.top + logoBox.height / 2;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.stage.appendChild(canvas);

    const g = canvas.getContext('2d');
    if (!g) {
      canvas.remove();
      return;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frame = 0;
    let disposed = false;
    const animations = [];
    const cleanup = function () {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      animations.forEach(function (animation) { animation.cancel(); });
      canvas.remove();
    };
    ctx.onCleanup(cleanup);

    // A gathering breath, one clear impact, and a fast return to the real result.
    // Individual scale preserves any layout transform on the supplied logo.
    const logoPulse = ctx.logo.animate([
      { scale: '1', offset: 0 },
      { scale: '.96', offset: .28 },
      { scale: '.94', offset: .46 },
      { scale: ctx.reached ? '1.13' : '1.10', offset: .57 },
      { scale: '.99', offset: .72 },
      { scale: '1.018', offset: .83 },
      { scale: '1', offset: 1 }
    ], { duration: 2700, easing: 'cubic-bezier(.2,.65,.3,1)' });
    animations.push(logoPulse);
    ctx.registerAnimation(logoPulse);

    const clamp = function (n) { return Math.max(0, Math.min(1, n)); };
    const ease = function (n) { return n * n * (3 - 2 * n); };
    const curve = function (p, n) {
      const q = 1 - n;
      return {
        x: q * q * q * p[0].x + 3 * q * q * n * p[1].x + 3 * q * n * n * p[2].x + n * n * n * p[3].x,
        y: q * q * q * p[0].y + 3 * q * q * n * p[1].y + 3 * q * n * n * p[2].y + n * n * n * p[3].y
      };
    };

    const pieces = [];
    const count = ctx.reached ? 28 : 24;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.PI * 2 * i / count + .10;
      const white = i % 5 === 0;
      const targetX = centerX + Math.sin(i * 2.39) * logoBox.width * .22;
      const targetY = centerY + Math.cos(i * 1.73) * logoBox.height * .16;
      pieces.push({
        delay: 80 + (i % 6) * 53,
        duration: 1220 + (i % 3) * 55,
        breadth: 5.5 + (i % 3) * 2,
        length: 26 + (i % 4) * 7,
        color: white ? '242,255,244' : '145,203,125',
        points: [
          { x: centerX + Math.cos(angle) * width * .77, y: centerY + Math.sin(angle) * height * .73 },
          { x: centerX + Math.cos(angle + .27) * width * .68, y: centerY + Math.sin(angle + .27) * height * .51 },
          { x: targetX + Math.cos(angle + .49) * width * .25, y: targetY + Math.sin(angle + .49) * height * .17 },
          { x: targetX, y: targetY }
        ]
      });
    }

    function drawPiece(piece, ms) {
      const progress = (ms - piece.delay) / piece.duration;
      if (progress < 0 || progress > 1) return;
      // A long, curved intake accelerates into the brand mark.
      const u = progress * progress * .62 + progress * .38;
      const head = curve(piece.points, u);
      const tangent = curve(piece.points, Math.min(1, u + .018));
      const alpha = clamp(progress * 7) * clamp((1 - progress) * 9);
      const tailU = Math.max(0, u - .19);
      const tail = curve(piece.points, tailU);
      const trail = g.createLinearGradient(tail.x, tail.y, head.x, head.y);
      trail.addColorStop(0, 'rgba(' + piece.color + ',0)');
      trail.addColorStop(1, 'rgba(' + piece.color + ',' + (alpha * .47) + ')');
      g.beginPath();
      for (let j = 0; j <= 10; j += 1) {
        const p = curve(piece.points, tailU + (u - tailU) * j / 10);
        if (j === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.lineWidth = 1.7;
      g.strokeStyle = trail;
      g.stroke();

      g.save();
      g.translate(head.x, head.y);
      g.rotate(Math.atan2(tangent.y - head.y, tangent.x - head.x));
      const length = piece.length * (1 - progress * .53);
      const breadth = piece.breadth * (1 - progress * .2);
      g.fillStyle = 'rgba(' + piece.color + ',' + alpha + ')';
      g.shadowColor = 'rgba(145,203,125,' + (alpha * .55) + ')';
      g.shadowBlur = 12;
      g.beginPath();
      g.moveTo(-length / 2, -breadth / 2);
      g.lineTo(length / 2, -breadth / 2);
      g.lineTo(length / 2 + breadth * .65, breadth / 2);
      g.lineTo(-length / 2 + breadth * .65, breadth / 2);
      g.closePath();
      g.fill();
      g.restore();
    }

    function drawGlow(ms) {
      const gather = ease(clamp((ms - 280) / 1180));
      const release = 1 - ease(clamp((ms - 1610) / 920));
      const alpha = gather * release;
      if (alpha <= 0) return;
      const radius = Math.max(180, width * .59);
      const glow = g.createRadialGradient(centerX, centerY, 4, centerX, centerY, radius);
      glow.addColorStop(0, 'rgba(145,203,125,' + (alpha * .30) + ')');
      glow.addColorStop(.4, 'rgba(145,203,125,' + (alpha * .12) + ')');
      glow.addColorStop(1, 'rgba(145,203,125,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, width, height);
    }

    function drawWave(ms, delay, strength) {
      const raw = (ms - delay) / 900;
      if (raw < 0 || raw > 1) return;
      const p = 1 - Math.pow(1 - raw, 3);
      const radius = 28 + p * width * .85;
      const alpha = Math.pow(1 - raw, 1.4) * strength;
      g.save();
      g.translate(centerX, centerY);
      g.scale(1, .87);
      g.beginPath();
      g.arc(0, 0, radius, 0, Math.PI * 2);
      g.lineWidth = (1 - raw) * 7 + .5;
      g.strokeStyle = 'rgba(145,203,125,' + alpha + ')';
      g.shadowColor = 'rgba(145,203,125,' + (alpha * .6) + ')';
      g.shadowBlur = 15;
      g.stroke();
      g.restore();
    }

    const started = performance.now();
    function draw(now) {
      if (disposed) return;
      const ms = now - started;
      g.clearRect(0, 0, width, height);
      drawGlow(ms);
      pieces.forEach(function (piece) { drawPiece(piece, ms); });
      drawWave(ms, 1460, .55);
      drawWave(ms, 1640, .22);
      if (ctx.reached) drawWave(ms, 1810, .12);
      if (ms < 2900) frame = requestAnimationFrame(draw);
      else cleanup();
    }
    frame = requestAnimationFrame(draw);
    // Guard removal even if animation frames stop arriving while leaving the view.
    const timer = setTimeout(cleanup, 3200);
    ctx.registerTimer(timer);
  };
}());
