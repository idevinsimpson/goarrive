import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Icon } from '../../Icon';
import type { FunnelData } from '../../../lib/funnelDefaults';
import { FG, FB, MUTED, GOLD, RED } from '../../../lib/theme';

const INPUT_BG = '#1A2035';
const INPUT_BORDER = '#2A3548';

interface Props {
  data: FunnelData;
  onUpdate: (data: FunnelData) => void;
}

export function HeroEditor({ data, onUpdate }: Props) {
  function setField<K extends keyof FunnelData>(key: K, val: FunnelData[K]) {
    onUpdate({ ...data, [key]: val });
  }

  function updateBullet(index: number, text: string) {
    const next = [...data.funnelBullets];
    next[index] = text;
    setField('funnelBullets', next);
  }

  function removeBullet(index: number) {
    setField('funnelBullets', data.funnelBullets.filter((_, i) => i !== index));
  }

  function addBullet() {
    if (data.funnelBullets.length < 4) {
      setField('funnelBullets', [...data.funnelBullets, '']);
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.label}>Headline</Text>
      <TextInput
        style={s.input}
        value={data.funnelHeadline}
        onChangeText={(t) => setField('funnelHeadline', t.slice(0, 60))}
        placeholder="Your main headline"
        placeholderTextColor="#4A5568"
        maxLength={60}
      />
      <Text style={s.charCount}>{data.funnelHeadline.length}/60</Text>

      <Text style={[s.label, { marginTop: 18 }]}>Subheadline</Text>
      <TextInput
        style={[s.input, s.textArea]}
        value={data.funnelSubheadline}
        onChangeText={(t) => setField('funnelSubheadline', t.slice(0, 200))}
        placeholder="Describe your coaching approach"
        placeholderTextColor="#4A5568"
        multiline
        maxLength={200}
      />
      <Text style={s.charCount}>{data.funnelSubheadline.length}/200</Text>

      <Text style={[s.label, { marginTop: 18 }]}>Value Props (max 4)</Text>
      {data.funnelBullets.map((b, i) => (
        <View key={i} style={s.bulletRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={b}
            onChangeText={(t) => updateBullet(i, t.slice(0, 80))}
            placeholder={`Bullet ${i + 1}`}
            placeholderTextColor="#4A5568"
            maxLength={80}
          />
          {data.funnelBullets.length > 1 && (
            <Pressable onPress={() => removeBullet(i)} hitSlop={8} style={s.removeBtn}>
              <Icon name="x" size={16} color={RED} />
            </Pressable>
          )}
        </View>
      ))}
      {data.funnelBullets.length < 4 && (
        <Pressable style={s.addBtn} onPress={addBullet}>
          <Icon name="plus" size={14} color={GOLD} />
          <Text style={s.addBtnText}>Add Bullet</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {},
  label: { fontSize: 13, fontWeight: '600', color: FG, fontFamily: FB, marginBottom: 6 },
  input: {
    backgroundColor: INPUT_BG,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: MUTED, fontFamily: FB, textAlign: 'right', marginTop: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  removeBtn: { padding: 6 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontWeight: '600', color: GOLD, fontFamily: FB },
});
