// Pure canvas draw helpers for the PiP canvas-stream overlay.
// No React, no side effects — all functions take a CanvasRenderingContext2D
// and paint synchronously.

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  movementName: string,
): void {
  if (videoEl && !videoEl.paused && videoEl.readyState >= 2) {
    // 4:5 crop: center-crop the source video into the target rect.
    const srcW = videoEl.videoWidth || videoEl.clientWidth || w;
    const srcH = videoEl.videoHeight || videoEl.clientHeight || h;
    const srcAspect = srcW / srcH;
    const dstAspect = w / h;
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (srcAspect > dstAspect) {
      // Source is wider — crop sides
      sw = srcH * dstAspect;
      sx = (srcW - sw) / 2;
    } else {
      // Source is taller — crop top/bottom
      sh = srcW / dstAspect;
      sy = (srcH - sh) / 2;
    }
    try {
      ctx.drawImage(videoEl, sx, sy, sw, sh, x, y, w, h);
    } catch {
      drawFallbackGradient(ctx, x, y, w, h, movementName);
    }
  } else {
    drawFallbackGradient(ctx, x, y, w, h, movementName);
  }
}

export function drawFallbackGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  movementName: string,
): void {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#0E1117');
  grad.addColorStop(1, '#1A2030');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  if (movementName) {
    const fontSize = Math.round(w * 0.07);
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Wrap long names
    const words = movementName.split(' ');
    const maxLineW = w * 0.8;
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxLineW && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    const lineH = fontSize * 1.3;
    const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + w / 2, startY + i * lineH);
    }
    ctx.restore();
  }
}

export function drawTimer(
  ctx: CanvasRenderingContext2D,
  timerString: string,
  x: number,
  y: number,
  fontPx: number,
): void {
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(timerString, x, y);
  ctx.restore();
}

export function drawMovementName(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  maxW: number,
): void {
  if (!name) return;
  const fontSize = Math.round(maxW * 0.055);
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;

  // Wrap at maxW
  const words = name.split(' ');
  const lineH = fontSize * 1.25;
  let line = '';
  let curY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxW && line) {
      ctx.fillText(line, x, curY);
      curY += lineH;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, x, curY);
  ctx.restore();
}

export function drawRepCount(
  ctx: CanvasRenderingContext2D,
  repsDone: number,
  target: number,
  x: number,
  y: number,
  fontPx: number,
): void {
  ctx.save();
  ctx.fillStyle = '#FFD700';
  ctx.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(`${repsDone}/${target}`, x, y);
  ctx.restore();
}

export function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  pct: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const clamped = Math.max(0, Math.min(1, pct));
  // Track background
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  // Fill
  if (clamped > 0) {
    ctx.fillStyle = '#4CAF90';
    ctx.beginPath();
    ctx.roundRect(x, y, w * clamped, h, h / 2);
    ctx.fill();
  }
  ctx.restore();
}
