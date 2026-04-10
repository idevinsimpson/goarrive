import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { FunnelData } from '../../../lib/funnelDefaults';
import { FG, FB, MUTED } from '../../../lib/theme';

const INPUT_BG = '#1A2035';
const INPUT_BORDER = '#2A3548';

interface Props {
  data: FunnelData;
  onUpdate: (data: FunnelData) => void;
}

export function BioEditor({ data, onUpdate }: Props) {
  return (
    <View>
      <Text style={s.label}>About You</Text>
      <Text style={s.hint}>
        Tell potential members about your coaching experience and approach.
      </Text>
      <TextInput
        style={[s.input, s.textArea]}
        value={data.funnelBio}
        onChangeText={(t) =>
          onUpdate({ ...data, funnelBio: t.slice(0, 300) })
        }
        placeholder="Your coaching bio..."
        placeholderTextColor="#4A5568"
        multiline
        maxLength={300}
      />
      <Text style={s.charCount}>{data.funnelBio.length}/300</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: FG, fontFamily: FB, marginBottom: 6 },
  hint: { fontSize: 12, color: MUTED, fontFamily: FB, marginBottom: 12, lineHeight: 17 },
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
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: MUTED, fontFamily: FB, textAlign: 'right', marginTop: 4 },
});
