import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Icon } from '../../Icon';
import type { FunnelData, Testimonial } from '../../../lib/funnelDefaults';
import { FG, FB, MUTED, GOLD, RED } from '../../../lib/theme';

const INPUT_BG = '#1A2035';
const INPUT_BORDER = '#2A3548';

interface Props {
  data: FunnelData;
  onUpdate: (data: FunnelData) => void;
}

export function TestimonialsEditor({ data, onUpdate }: Props) {
  const testimonials = data.funnelTestimonials;

  function update(index: number, field: keyof Testimonial, value: string) {
    const next = [...testimonials];
    next[index] = { ...next[index], [field]: value };
    onUpdate({ ...data, funnelTestimonials: next });
  }

  function remove(index: number) {
    onUpdate({
      ...data,
      funnelTestimonials: testimonials.filter((_, i) => i !== index),
    });
  }

  function add() {
    if (testimonials.length < 5) {
      onUpdate({
        ...data,
        funnelTestimonials: [...testimonials, { name: '', text: '' }],
      });
    }
  }

  return (
    <View>
      <Text style={s.hint}>Add up to 5 testimonials from your members.</Text>
      {testimonials.map((t, i) => (
        <View key={i} style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>Testimonial {i + 1}</Text>
            <Pressable onPress={() => remove(i)} hitSlop={8}>
              <Icon name="x" size={16} color={RED} />
            </Pressable>
          </View>
          <TextInput
            style={s.input}
            value={t.name}
            onChangeText={(v) => update(i, 'name', v)}
            placeholder="Name (e.g. Sarah M.)"
            placeholderTextColor="#4A5568"
          />
          <TextInput
            style={[s.input, s.textArea, { marginTop: 8 }]}
            value={t.text}
            onChangeText={(v) => update(i, 'text', v)}
            placeholder="What they said..."
            placeholderTextColor="#4A5568"
            multiline
          />
        </View>
      ))}
      {testimonials.length < 5 && (
        <Pressable style={s.addBtn} onPress={add}>
          <Icon name="plus" size={14} color={GOLD} />
          <Text style={s.addBtnText}>Add Testimonial</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: MUTED, fontFamily: FB, marginBottom: 12, lineHeight: 17 },
  card: {
    backgroundColor: INPUT_BG,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardLabel: { fontSize: 12, fontWeight: '600', color: MUTED, fontFamily: FB },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  textArea: { minHeight: 64, textAlignVertical: 'top' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontWeight: '600', color: GOLD, fontFamily: FB },
});
