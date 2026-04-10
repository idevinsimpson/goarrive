import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import type { FunnelData } from '../../lib/funnelDefaults';
import type { EditSection } from './FunnelPreview';
import { HeroEditor } from './editors/HeroEditor';
import { TestimonialsEditor } from './editors/TestimonialsEditor';
import { BioEditor } from './editors/BioEditor';
import { BG, FG, FH, FB, GOLD, BORDER } from '../../lib/theme';

interface Props {
  visible: boolean;
  section: EditSection | null;
  data: FunnelData;
  onUpdate: (data: FunnelData) => void;
  onClose: () => void;
}

const TITLES: Record<EditSection, string> = {
  hero: 'Edit Hero Section',
  testimonials: 'Edit Testimonials',
  bio: 'Edit Bio',
};

export function SectionEditor({ visible, section, data, onUpdate, onClose }: Props) {
  if (!section) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.overlay}
      >
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={s.sheet}>
          {/* Handle + header */}
          <View style={s.handleRow}>
            <View style={s.handle} />
          </View>
          <View style={s.header}>
            <Text style={s.title}>{TITLES[section]}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.done}>Done</Text>
            </Pressable>
          </View>

          {/* Editor content */}
          <ScrollView
            style={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {section === 'hero' && (
              <HeroEditor data={data} onUpdate={onUpdate} />
            )}
            {section === 'testimonials' && (
              <TestimonialsEditor data={data} onUpdate={onUpdate} />
            )}
            {section === 'bio' && (
              <BioEditor data={data} onUpdate={onUpdate} />
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  handleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A4558',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  title: { fontSize: 16, fontWeight: '700', color: FG, fontFamily: FH },
  done: { fontSize: 15, fontWeight: '600', color: GOLD, fontFamily: FB },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
});
