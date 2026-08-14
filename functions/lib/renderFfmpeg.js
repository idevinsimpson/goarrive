"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtTime = fmtTime;
exports.generateAss = generateAss;
exports.buildSegmentArgs = buildSegmentArgs;
const CANVAS_W = 720;
const CANVAS_H = 1440;
const TIMER_H = 160;
const MOVEMENT_H = 1280;
const OUTPUT_FPS = 30;
const OUTPUT_TIMESCALE = 30000;
function fmtTime(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtAssTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
}
function generateAss(durationSec, totalWorkoutStr, type, label) {
    const lines = [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${CANVAS_W}`,
        `PlayResY: ${CANVAS_H}`,
        'Collisions: Normal',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Timer,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,8,10,10,56,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    for (let sec = 0; sec < Math.ceil(durationSec); sec++) {
        const start = fmtAssTime(sec);
        const end = fmtAssTime(Math.min(sec + 1, durationSec));
        let text;
        if (type === 'rest') {
            const remaining = Math.max(0, durationSec - sec);
            const lbl = (label || 'REST').replace(/,/g, '').slice(0, 15).toUpperCase();
            text = `${lbl}  ${fmtTime(remaining)}`;
        }
        else {
            text = `${fmtTime(sec)} / ${totalWorkoutStr}`;
        }
        lines.push(`Dialogue: 0,${start},${end},Timer,,0,0,0,,${text}`);
    }
    return lines.join('\n');
}
function buildSegmentArgs(seg, assPath, outputPath) {
    const dur = seg.durationSec;
    const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    // Concat uses stream copy, so every branch must emit the same CFR and MP4
    // track time base. Otherwise a mixed-frame-rate input can stretch later
    // segments while their persisted offsets remain unchanged.
    const normalize = `fps=${OUTPUT_FPS},settb=1/${OUTPUT_TIMESCALE},setpts=PTS-STARTPTS`;
    const outputArgs = [
        '-t', String(dur),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-an',
        '-r', String(OUTPUT_FPS),
        '-video_track_timescale', String(OUTPUT_TIMESCALE),
        outputPath,
    ];
    if (seg.type === 'video') {
        const filter = [
            `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[mv]`,
            `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
            '[band][mv]vstack=inputs=2[canvas]',
            `[canvas]subtitles=${assEsc},${normalize}[out]`,
        ].join(';');
        return ['-y', '-i', seg._localPath, '-filter_complex', filter, '-map', '[out]', ...outputArgs];
    }
    if (seg.type === 'image') {
        const filter = [
            `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black[mv]`,
            `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
            '[band][mv]vstack=inputs=2[canvas]',
            `[canvas]subtitles=${assEsc},${normalize}[out]`,
        ].join(';');
        const inputArgs = seg._isGif
            ? ['-stream_loop', '-1', '-t', String(dur), '-i', seg._localPath]
            : ['-loop', '1', '-framerate', '30', '-t', String(dur), '-i', seg._localPath];
        return ['-y', ...inputArgs, '-filter_complex', filter, '-map', '[out]', ...outputArgs];
    }
    const filter = [
        `color=c=#2a2a2a:s=${CANVAS_W}x${MOVEMENT_H}:r=30,format=yuv420p[mv]`,
        `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
        '[band][mv]vstack=inputs=2[canvas]',
        `[canvas]subtitles=${assEsc},${normalize}[out]`,
    ].join(';');
    return ['-y', '-filter_complex', filter, '-map', '[out]', ...outputArgs];
}
//# sourceMappingURL=renderFfmpeg.js.map