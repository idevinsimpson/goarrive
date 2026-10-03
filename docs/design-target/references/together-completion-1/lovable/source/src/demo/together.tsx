import { useEffect, useRef, useState } from "react";
import togetherMark from "../assets/together-mark.png.asset.json";
import togetherWordmark from "../assets/together-wordmark.png.asset.json";
import { calibratedFillInset } from "./together-area";
import { fmt, progress } from "./model";

export interface TogetherResult {
  amount: number;
  movement: string;
  communityName: string;
  goalTitle: string;
  before: number | null;
  after: number | null;
  target?: number | null | undefined;
  status?: "open" | "reachedOpen" | "closedReached" | "closedUnfinished" | undefined;
  fresh: boolean;
  crossed: boolean;
}

export function togetherOutcome(crossed: boolean, before: number | null, after: number | null, target: number | null, animate: boolean) {
  const known = before != null && after != null && target != null && target > 0;
  const alreadyReached = known && before >= target;
  return {
    crossed,
    animate: animate && known && (crossed || !alreadyReached),
    headline: crossed ? "WE did it. Together." : alreadyReached || !known ? "Your contribution is recorded." : "You moved us closer.",
  };
}

export function hasShareableSnapshot(result: TogetherResult) {
  return result.before != null && result.after != null && result.target != null && result.target > 0;
}

function useDialogLifecycle(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')).filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = focusables(), first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);
}

function useTogetherMotion({ active, crossed, fromRatio, toRatio, stageRef, markRef, fillRef, onSettled }: {
  active: boolean; crossed: boolean; fromRatio: number; toRatio: number;
  stageRef: React.RefObject<HTMLDivElement | null>; markRef: React.RefObject<HTMLDivElement | null>;
  fillRef: React.RefObject<HTMLDivElement | null>; onSettled: () => void;
}) {
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  useEffect(() => {
    const stage = stageRef.current, logo = markRef.current, fill = fillRef.current;
    if (!stage || !logo || !fill) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setFill = (ratio: number) => fill.style.setProperty("--fill-inset", `${calibratedFillInset(ratio)}%`);
    setFill(active && !reduced.matches ? fromRatio : toRatio);
    if (!active || reduced.matches) { settledRef.current(); return; }

    const box = stage.getBoundingClientRect(), logoBox = logo.getBoundingClientRect();
    const width = Math.max(1, box.width), height = Math.max(1, box.height);
    const centerX = logoBox.left - box.left + logoBox.width / 2, centerY = logoBox.top - box.top + logoBox.height / 2;
    const canvas = document.createElement("canvas");
    canvas.className = "together-canvas"; canvas.setAttribute("aria-hidden", "true");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); stage.appendChild(canvas);
    const g = canvas.getContext("2d");
    if (!g) { canvas.remove(); settledRef.current(); return; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let frame = 0, fillFrame = 0, disposed = false, settled = false;
    const animations: Animation[] = [];
    const timers: number[] = [];
    const settle = () => { if (settled) return; settled = true; setFill(toRatio); settledRef.current(); };
    const stop = (finish = false) => { if (disposed) return; disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(fillFrame); timers.forEach(clearTimeout); animations.forEach((animation) => animation.cancel()); canvas.remove(); if (finish) settle(); };
    const pulse = logo.animate([
      { scale: "1", offset: 0 }, { scale: ".96", offset: .28 }, { scale: ".94", offset: .46 },
      { scale: crossed ? "1.13" : "1.10", offset: .57 }, { scale: ".99", offset: .72 }, { scale: "1.018", offset: .83 }, { scale: "1", offset: 1 },
    ], { duration: 2700, easing: "cubic-bezier(.2,.65,.3,1)" });
    animations.push(pulse);
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    const ease = (n: number) => n * n * (3 - 2 * n);
    type Point = { x: number; y: number };
    type Piece = { delay: number; duration: number; breadth: number; length: number; color: string; points: Point[] };
    const curve = (points: Point[], n: number) => { const q=1-n,p0=points[0]??{x:0,y:0},p1=points[1]??p0,p2=points[2]??p1,p3=points[3]??p2; return { x:q*q*q*p0.x+3*q*q*n*p1.x+3*q*n*n*p2.x+n*n*n*p3.x, y:q*q*q*p0.y+3*q*q*n*p1.y+3*q*n*n*p2.y+n*n*n*p3.y }; };
    const pieces: Piece[] = [];
    const count = crossed ? 28 : 24;
    for (let i=0;i<count;i+=1) { const angle=Math.PI*2*i/count+.10,targetX=centerX+Math.sin(i*2.39)*logoBox.width*.22,targetY=centerY+Math.cos(i*1.73)*logoBox.height*.16; pieces.push({delay:80+(i%6)*53,duration:1220+(i%3)*55,breadth:5.5+(i%3)*2,length:26+(i%4)*7,color:i%5===0?"242,255,244":"145,203,125",points:[{x:centerX+Math.cos(angle)*width*.77,y:centerY+Math.sin(angle)*height*.73},{x:centerX+Math.cos(angle+.27)*width*.68,y:centerY+Math.sin(angle+.27)*height*.51},{x:targetX+Math.cos(angle+.49)*width*.25,y:targetY+Math.sin(angle+.49)*height*.17},{x:targetX,y:targetY}]}); }
    const drawPiece = (piece: Piece, ms: number) => { const p=(ms-piece.delay)/piece.duration;if(p<0||p>1)return;const u=p*p*.62+p*.38,head=curve(piece.points,u),tangent=curve(piece.points,Math.min(1,u+.018)),alpha=clamp(p*7)*clamp((1-p)*9),tailU=Math.max(0,u-.19),tail=curve(piece.points,tailU),trail=g.createLinearGradient(tail.x,tail.y,head.x,head.y);trail.addColorStop(0,`rgba(${piece.color},0)`);trail.addColorStop(1,`rgba(${piece.color},${alpha*.47})`);g.beginPath();for(let j=0;j<=10;j+=1){const point=curve(piece.points,tailU+(u-tailU)*j/10);if(j===0)g.moveTo(point.x,point.y);else g.lineTo(point.x,point.y);}g.lineWidth=1.7;g.strokeStyle=trail;g.stroke();g.save();g.translate(head.x,head.y);g.rotate(Math.atan2(tangent.y-head.y,tangent.x-head.x));const length=piece.length*(1-p*.53),breadth=piece.breadth*(1-p*.2);g.fillStyle=`rgba(${piece.color},${alpha})`;g.shadowColor=`rgba(145,203,125,${alpha*.55})`;g.shadowBlur=12;g.beginPath();g.moveTo(-length/2,-breadth/2);g.lineTo(length/2,-breadth/2);g.lineTo(length/2+breadth*.65,breadth/2);g.lineTo(-length/2+breadth*.65,breadth/2);g.closePath();g.fill();g.restore(); };
    const drawWave = (ms:number,delay:number,strength:number) => { const raw=(ms-delay)/900;if(raw<0||raw>1)return;const p=1-Math.pow(1-raw,3),radius=28+p*width*.85,alpha=Math.pow(1-raw,1.4)*strength;g.save();g.translate(centerX,centerY);g.scale(1,.87);g.beginPath();g.arc(0,0,radius,0,Math.PI*2);g.lineWidth=(1-raw)*7+.5;g.strokeStyle=`rgba(145,203,125,${alpha})`;g.shadowColor=`rgba(145,203,125,${alpha*.6})`;g.shadowBlur=15;g.stroke();g.restore(); };
    const started = performance.now();
    const draw = (now:number) => { if(disposed)return;const ms=now-started;g.clearRect(0,0,width,height);const gather=ease(clamp((ms-280)/1180)),release=1-ease(clamp((ms-1610)/920)),alpha=gather*release;if(alpha>0){const radius=Math.max(180,width*.59),glow=g.createRadialGradient(centerX,centerY,4,centerX,centerY,radius);glow.addColorStop(0,`rgba(145,203,125,${alpha*.3})`);glow.addColorStop(.4,`rgba(145,203,125,${alpha*.12})`);glow.addColorStop(1,"rgba(145,203,125,0)");g.fillStyle=glow;g.fillRect(0,0,width,height);}pieces.forEach((piece)=>drawPiece(piece,ms));drawWave(ms,1460,.55);drawWave(ms,1640,.22);if(crossed)drawWave(ms,1810,.12);if(ms<2900)frame=requestAnimationFrame(draw);};
    frame=requestAnimationFrame(draw);
    timers.push(window.setTimeout(() => { const fillStarted=performance.now(); const tick=(now:number)=>{if(disposed)return;const p=Math.min((now-fillStarted)/700,1),ratio=fromRatio+(toRatio-fromRatio)*(1-Math.pow(1-p,3));setFill(ratio);if(p<1)fillFrame=requestAnimationFrame(tick);};fillFrame=requestAnimationFrame(tick); },1450));
    timers.push(window.setTimeout(() => stop(true),3400));
    const onReduce = () => { if(reduced.matches) stop(true); };
    reduced.addEventListener("change",onReduce);
    return () => { reduced.removeEventListener("change",onReduce); stop(false); };
  }, [active, crossed, fillRef, fromRatio, markRef, stageRef, toRatio]);
}

export function TogetherReceipt({ result, onPresented, onClose, onShare, onFinish }: { result: TogetherResult; onPresented: () => void; onClose: () => void; onShare: () => void; onFinish: () => void }) {
  const dialogRef=useRef<HTMLElement>(null),stageRef=useRef<HTMLDivElement>(null),markRef=useRef<HTMLDivElement>(null),fillRef=useRef<HTMLDivElement>(null);
  const [settled,setSettled]=useState(!result.fresh);
  const presentedRef=useRef(false);
  const outcome=togetherOutcome(result.crossed,result.before,result.after,result.target??null,result.fresh);
  const complete=()=>{setSettled(true);if(!presentedRef.current){presentedRef.current=true;onPresented();}};
  useDialogLifecycle(dialogRef,onClose);
  const beforeRatio=result.before!=null&&result.target?result.before/result.target:0;
  const afterRatio=result.after!=null&&result.target?result.after/result.target:0;
  useTogetherMotion({active:outcome.animate&&!settled,crossed:outcome.crossed,fromRatio:beforeRatio,toRatio:afterRatio,stageRef,markRef,fillRef,onSettled:complete});
  const p=result.after!=null?progress(result.after,result.target??null):null;
  const canShare=hasShareableSnapshot(result);
  const markMask={"--mark-mask":`url(${togetherMark.url})`} as React.CSSProperties;
  return <section ref={dialogRef} className={`together-receipt ${outcome.animate&&!settled?"is-fresh":"is-static"} ${outcome.crossed?"is-crossed":""}`} role="dialog" aria-modal="true" aria-labelledby="together-title">
    <header className="together-head"><img src={togetherWordmark.url} alt="WE STAY FIT"/><button type="button" onClick={onClose}>Close</button></header>
    <div className="together-community"><strong>{result.communityName}</strong><span>{result.goalTitle}</span></div>
    <div className="together-scene" ref={stageRef}>
      <div className="together-effort"><span>YOU ADDED</span><strong>+{fmt(result.amount)}</strong><em>{result.movement}</em></div>
      <div className="together-mark" ref={markRef} style={markMask} role="img" aria-label={p&&result.after!=null&&result.target!=null?`Living WE filled to ${p.label}. Confirmed shared total ${fmt(result.after)} of ${fmt(result.target)}.`:"Shared progress snapshot unavailable."}><div className="together-mark-base"/><div ref={fillRef} className="together-mark-fill"/></div>
      <h2 id="together-title" data-autofocus tabIndex={-1}>{outcome.headline === "WE did it. Together." ? <>WE did it.<br/>Together.</> : outcome.headline === "You moved us closer." ? <>You moved<br/>us closer.</> : <>Your contribution<br/>is recorded.</>}</h2>
    </div>
    <footer className="together-footer">
      {result.before!=null&&result.after!=null&&result.target!=null?<><div className="together-total"><span>{fmt(result.before)} → </span><strong>{fmt(result.after)}</strong><span> / {fmt(result.target)}</span></div><p>{p?.reached?`${fmt(p.overshoot)} beyond our goal · ${result.status==="reachedOpen"?"Still open":"Closed"}`:`${p?.label??"Progress unavailable"} of our goal`}</p></>:<><div className="together-total"><strong>Shared total unavailable</strong></div><p>This older receipt has no saved shared snapshot.</p></>}
      <button type="button" className="together-primary" onClick={onFinish}>Back to community</button>
      {canShare && <button type="button" className="together-share" onClick={onShare}>Share preview</button>}
      <small>{outcome.crossed?"Goal reached · ":""}Your {fmt(result.amount)} {result.movement} are recorded locally in this demo</small>
    </footer>
  </section>;
}