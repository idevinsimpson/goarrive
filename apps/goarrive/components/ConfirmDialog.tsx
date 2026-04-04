/**
 * ConfirmDialog — Reusable confirmation modal
 *
 * Shows a centered dialog with title, message, and confirm/cancel buttons.
 * Used for destructive actions like archive, unassign, etc.
 *
 * Slice 1, Week 4 — Hardening
 */
import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
} from 'react-native';
import { Icon } from './Icon';
import { FB, FH } from '../lib/theme';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  icon?: string;
  iconColor?: string;
  /** Visual variant — 'danger'/'destructive' uses red styling (default) */
  variant?: 'danger' | 'warning' | 'info' | 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = '#E05252',
  icon = 'warning',
  iconColor = '#E05252',
  variant: _variant,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Pressable style={s.dialog} onPress={(e) => e.stopPropagation()}>
          <View style={s.iconWrap}>
            <Icon name={icon as any} size={32} color={iconColor} />
          </View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.message}>{message}</Text>
          <View style={s.btnRow}>
            <Pressable style={s.cancelBtn} onPress={onCancel}>
              <Text style={s.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[s.confirmBtn, { backgroundColor: confirmColor }]}
              onPress={onConfirm}
            >
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#1A2035',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(224,82,82,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2A3347',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: FB,
  },
});
