import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import type { FunnelData } from '../../lib/funnelDefaults';
import { EditableSection } from './EditableSection';
import { PreviewHeader } from './preview/PreviewHeader';
import { PreviewHero } from './preview/PreviewHero';
import { PreviewSocialProof } from './preview/PreviewSocialProof';
import { PreviewServices } from './preview/PreviewServices';
import { PreviewCoachProfile } from './preview/PreviewCoachProfile';
import { PreviewFooterCTA } from './preview/PreviewFooterCTA';

export type EditSection = 'hero' | 'testimonials' | 'bio';

interface Props {
  data: FunnelData;
  coachName: string;
  onEditSection: (section: EditSection) => void;
}

export function FunnelPreview({ data, coachName, onEditSection }: Props) {
  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {/* Header — not editable (name + photo managed above) */}
        <PreviewHeader coachName={coachName} photoUrl={data.funnelPhotoUrl} />

        {/* Hero — tap to edit headline, subheadline, bullets */}
        <EditableSection label="Edit Hero" onEdit={() => onEditSection('hero')}>
          <PreviewHero
            headline={data.funnelHeadline}
            subheadline={data.funnelSubheadline}
            bullets={data.funnelBullets}
          />
        </EditableSection>

        {/* Testimonials — tap to edit */}
        <EditableSection
          label="Edit Testimonials"
          onEdit={() => onEditSection('testimonials')}
        >
          <PreviewSocialProof testimonials={data.funnelTestimonials} />
        </EditableSection>

        {/* Services — static, not editable */}
        <PreviewServices />

        {/* Coach Bio — tap to edit */}
        <EditableSection label="Edit Bio" onEdit={() => onEditSection('bio')}>
          <PreviewCoachProfile
            coachName={coachName}
            bio={data.funnelBio}
            photoUrl={data.funnelPhotoUrl}
          />
        </EditableSection>

        {/* Footer CTA — static */}
        <PreviewFooterCTA coachName={coachName} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    maxHeight: 520,
    borderWidth: 1,
    borderColor: '#2A3548',
  },
  scroll: {
    flex: 1,
  },
});
