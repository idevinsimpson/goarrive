/**
 * CoachAgreementSignaturePad
 *
 * A zero-dependency signature pad for the Coach Agreement signing flow inside
 * Coach Launch. Web-only: uses a raw HTML <canvas> with Pointer Events so that
 * touch, stylus, and mouse all draw. Emits a PNG data URL on every stroke end.
 *
 * On native (React Native iOS/Android), we render a fallback message pointing
 * the coach to the web PWA — there is no native signature capture in the app
 * yet and this module is designed for the web coaching portal.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BG, BORDER, CARD, FB, FG, GOLD, MUTED } from '../lib/theme';

type CoachAgreementSignaturePadProps = {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
};

export function CoachAgreementSignaturePad({
  value,
  onChange,
  disabled,
}: CoachAgreementSignaturePadProps) {
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.nativeFallback}>
        <Text style={styles.nativeFallbackText}>
          Coach Agreement signing is available on the GoArrive web app.
          Open Coach Launch on the web to sign.
        </Text>
      </View>
    );
  }
  return (
    <SignaturePadWeb value={value} onChange={onChange} disabled={disabled} />
  );
}

function SignaturePadWeb({
  value,
  onChange,
  disabled,
}: CoachAgreementSignaturePadProps) {
  const canvasRef = useRef<any>(null);
  const containerRef = useRef<any>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasStrokesRef = useRef(false);
  const [width, setWidth] = useState(0);
  const height = 180;

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { width: 0 };
    const w = Math.floor(rect.width) || 0;
    if (w > 0) setWidth(w);
  }, []);

  useEffect(() => {
    measure();
    if (typeof window === 'undefined') return;
    const win: any = window;
    win.addEventListener('resize', measure);
    return () => win.removeEventListener('resize', measure);
  }, [measure]);

  const scale =
    (typeof window !== 'undefined' && (window as any).devicePixelRatio) || 1;

  // Prime canvas backing store + reload existing signature when value/size changes.
  useEffect(() => {
    const canvas: any = canvasRef.current;
    if (!canvas || width === 0) return;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    hasStrokesRef.current = false;
    if (value) {
      const img: any =
        typeof (window as any).Image !== 'undefined'
          ? new (window as any).Image()
          : null;
      if (img) {
        img.onload = () => {
          ctx.drawImage(img, 0, 0, width, height);
          hasStrokesRef.current = true;
        };
        img.src = value;
      }
    }
  }, [width, height, scale, value]);

  const localPoint = useCallback((evt: any) => {
    const canvas: any = canvasRef.current;
    if (!canvas || !canvas.getBoundingClientRect) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    };
  }, []);

  const beginStroke = useCallback(
    (evt: any) => {
      if (disabled) return;
      evt.preventDefault?.();
      const canvas: any = canvasRef.current;
      if (canvas?.setPointerCapture && evt.pointerId != null) {
        try {
          canvas.setPointerCapture(evt.pointerId);
        } catch {}
      }
      drawingRef.current = true;
      lastPointRef.current = localPoint(evt);
    },
    [disabled, localPoint]
  );

  const extendStroke = useCallback(
    (evt: any) => {
      if (!drawingRef.current || disabled) return;
      evt.preventDefault?.();
      const canvas: any = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx || !lastPointRef.current) return;
      const next = localPoint(evt);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      lastPointRef.current = next;
      hasStrokesRef.current = true;
    },
    [disabled, localPoint]
  );

  const endStroke = useCallback(
    (evt: any) => {
      if (!drawingRef.current) return;
      evt.preventDefault?.();
      drawingRef.current = false;
      lastPointRef.current = null;
      const canvas: any = canvasRef.current;
      if (canvas?.toDataURL && hasStrokesRef.current) {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          onChange(dataUrl);
        } catch {}
      }
    },
    [onChange]
  );

  const clear = useCallback(() => {
    if (disabled) return;
    const canvas: any = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    hasStrokesRef.current = false;
    onChange('');
  }, [disabled, width, height, onChange]);

  return (
    <View style={styles.wrap}>
      <View
        ref={containerRef}
        style={styles.canvasBox}
        onLayout={measure}
      >
        {width > 0 &&
          React.createElement('canvas', {
            ref: canvasRef,
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            style: {
              width: `${width}px`,
              height: `${height}px`,
              touchAction: 'none',
              cursor: disabled ? 'not-allowed' : 'crosshair',
              backgroundColor: '#ffffff',
              borderRadius: 8,
              display: 'block',
            },
            onPointerDown: beginStroke,
            onPointerMove: extendStroke,
            onPointerUp: endStroke,
            onPointerCancel: endStroke,
            onPointerLeave: endStroke,
          })}
      </View>
      <View style={styles.padFooter}>
        <Text style={styles.padHint}>Sign inside the box.</Text>
        <Pressable
          onPress={clear}
          disabled={disabled}
          style={[styles.clearBtn, disabled && styles.clearBtnDisabled]}
        >
          <Text style={styles.clearBtnText}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
  },
  canvasBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    minHeight: 180,
  },
  padFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  padHint: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  clearBtnDisabled: {
    opacity: 0.5,
  },
  clearBtnText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
  },
  nativeFallback: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
  },
  nativeFallbackText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
});
