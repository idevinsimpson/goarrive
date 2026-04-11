/**
 * FunnelPage — canonical funnel page renderer matching jv.goarrive.fit
 *
 * This is the single source of truth for the funnel layout.
 * Used by both the builder preview (with editable sections)
 * and will be used by the public funnel route.
 *
 * When `onEditSection` is provided, editable sections become tappable.
 * When omitted, it renders as a pure read-only page.
 */
import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import type { FunnelData } from '../../lib/funnelDefaults';
import { EditableSection } from './EditableSection';
import { FunnelHero } from './sections/FunnelHero';
import { FunnelTestimonials } from './sections/FunnelTestimonials';
import { FunnelFeatures } from './sections/FunnelFeatures';
import { FunnelCoachBio } from './sections/FunnelCoachBio';
import { FunnelFooterCTA } from './sections/FunnelFooterCTA';

export type EditSection = 'hero' | 'testimonials' | 'bio';

interface Props {
  data: FunnelData;
  coachName: string;
  /** When provided, sections become tappable for editing (builder mode). */
  onEditSection?: (section: EditSection) => void;
  /** Max height constraint — used in builder to keep it scrollable within the page. */
  maxHeight?: number;
}

export function FunnelPreview({
  data,
  coachName,
  onEditSection,
  maxHeight,
}: Props) {
  const editable = !!onEditSection;

  function wrapEditable(
    section: EditSection,
    children: React.ReactNode,
  ) {
    if (!editable) return <>{children}</>;
    return (
      <EditableSection onEdit={() => onEditSection!(section)}>
        {children}
      </EditableSection>
    );
  }

  return (
    <View style={[s.container, maxHeight ? { maxHeight } : undefined]}>
      <ScrollView
        style={s.scroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — editable: headline, subheadline, bullets */}
        {wrapEditable(
          'hero',
          <FunnelHero
            headline={data.funnelHeadline}
            subheadline={data.funnelSubheadline}
            bullets={data.funnelBullets}
            photoUrl={data.funnelPhotoUrl}
            coachName={coachName}
          />,
        )}

        {/* Testimonials — editable */}
        {wrapEditable(
          'testimonials',
          <FunnelTestimonials testimonials={data.funnelTestimonials} />,
        )}

        {/* Features — static (platform content) */}
        <FunnelFeatures />

        {/* Coach Bio — editable */}
        {wrapEditable(
          'bio',
          <FunnelCoachBio
            coachName={coachName}
            bio={data.funnelBio}
            photoUrl={data.funnelPhotoUrl}
          />,
        )}

        {/* Footer CTA — static */}
        <FunnelFooterCTA coachName={coachName} />
      </ScrollView>
    </View>
  );
}

const PAGE_BG = '#0A0C12';

const s = StyleSheet.create({
  container: {
    backgroundColor: PAGE_BG,
    borderRadius: 12,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
});
