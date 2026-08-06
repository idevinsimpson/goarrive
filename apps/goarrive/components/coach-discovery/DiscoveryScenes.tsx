import React, { ReactNode } from 'react';
import {
  ImageSourcePropType,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  COACH_LAUNCH_MODULES,
  CULTURE_PILLARS,
  DiscoverySceneMeta,
  EARNINGS_CAP_FACTS,
  INFRASTRUCTURE_ITEMS,
  PROGRAM_TERMS_NOTE,
} from '../../data/coachDiscoveryScenes';
import { AccessibleImage } from './AccessibleImage';
import { CoachSystemOrbit } from './CoachSystemOrbit';
import { CompensationPath } from './CompensationPath';
import { DeviceMockup } from './DeviceMockup';
import { GrowthPathways } from './GrowthPathways';
import { MemberJourney } from './MemberJourney';
import { SceneHeading, SupportingText } from './Scene';
import { accentColor, accentSoft, discoveryColors, discoveryFonts } from './tokens';

interface DiscoveryImageAsset {
  source: ImageSourcePropType;
  webSource: string;
}

const HERO_IMAGE: DiscoveryImageAsset = {
  source: require('../../assets/coach-discovery/hero-online-coaching.webp'),
  webSource: '/coach-discovery/hero-online-coaching.webp',
};
const MAYA_IMAGE: DiscoveryImageAsset = {
  source: require('../../assets/coach-discovery/member-maya-home.webp'),
  webSource: '/coach-discovery/member-maya-home.webp',
};
const REVIEW_IMAGE: DiscoveryImageAsset = {
  source: require('../../assets/coach-discovery/coach-review-session.webp'),
  webSource: '/coach-discovery/coach-review-session.webp',
};
const FUTURE_IMAGE: DiscoveryImageAsset = {
  source: require('../../assets/coach-discovery/coach-future-life.webp'),
  webSource: '/coach-discovery/coach-future-life.webp',
};
const LOGO = require('../../assets/logo.png');

interface DiscoverySceneContentProps {
  meta: DiscoverySceneMeta;
  isMobile: boolean;
  onNextStep: () => void;
}

export function DiscoverySceneContent({ meta, isMobile, onNextStep }: DiscoverySceneContentProps) {
  const headlineStyle = isMobile ? styles.headingMobile : styles.headingDesktop;
  const contentPad = [styles.sceneContent, isMobile ? styles.sceneContentMobile : styles.sceneContentDesktop];
  const heading = (align: 'left' | 'center' = 'left') => (
    <SceneHeading meta={meta} align={align} style={headlineStyle} />
  );

  switch (meta.number) {
    case 1:
      return (
        <ImageScene image={HERO_IMAGE} label="A coach listening to a member during an online coaching call" eager>
          <View style={[styles.heroCopy, isMobile ? styles.heroCopyMobile : styles.heroCopyDesktop]}>
            {heading()}
            <SupportingText style={styles.heroSupport}>
              A different way to coach.{`\n`}A better way to grow.
            </SupportingText>
            <AccessibleImage source={LOGO} webSource="/goarrive-logo.png" resizeMode="contain" label="GoArrive" eager style={styles.heroLogo} />
          </View>
        </ImageScene>
      );

    case 2:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide]}>
            <View style={styles.splitCopy}>
              {heading()}
              <View style={styles.notToList}>
                {['Not to chase invoices.', 'Not to manage spreadsheets.', 'Not to live inside your calendar.'].map((line, index) => (
                  <View key={line} style={[styles.notToLine, { opacity: 1 - index * 0.14 }]}>
                    <View style={styles.notToRule} />
                    <Text style={styles.notToText}>{line}</Text>
                  </View>
                ))}
              </View>
            </View>
            <PortraitCard image={HERO_IMAGE} label="Coach listening closely during a video call" position="bottom" />
          </View>
        </View>
      );

    case 3:
      return (
        <View style={contentPad}>
          {heading()}
          <View style={[styles.cardRow, !isMobile && styles.cardRowWide]}>
            <TensionCard number="01" title="Personal" detail="But limited by hours." symbol="1:1" />
            <TensionCard number="02" title="Scalable" detail="But often impersonal." symbol="∞" />
            <TensionCard number="03" title="Independent" detail="But responsible for everything." symbol="12×" />
          </View>
        </View>
      );

    case 4:
      const quietHeadingStyles = StyleSheet.flatten([styles.quietHeadline, headlineStyle]) as any;
      return (
        <View style={[contentPad, styles.quietScene]}>
          <View style={styles.blueGlow} />
          {Platform.OS === 'web'
            ? React.createElement(
                'h2',
                {
                  style: {
                    ...quietHeadingStyles,
                    lineHeight: typeof quietHeadingStyles?.lineHeight === 'number'
                      ? `${quietHeadingStyles.lineHeight}px`
                      : quietHeadingStyles?.lineHeight,
                  },
                },
                meta.headline,
              )
            : <Text accessibilityRole="header" style={[styles.quietHeadline, headlineStyle]}>{meta.headline}</Text>}
        </View>
      );

    case 5:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide, styles.centerVertically]}>
            <View style={styles.splitCopy}>
              {heading()}
              <SupportingText>An online fitness coaching firm powered by its own coaching operating system.</SupportingText>
              <View style={styles.statementStack}>
                <Text style={styles.statement}>Not software.</Text>
                <Text style={styles.statement}>Not a marketplace.</Text>
                <Text style={[styles.statement, { color: discoveryColors.blue }]}>A connected coaching ecosystem.</Text>
              </View>
            </View>
            <CoachSystemOrbit />
          </View>
        </View>
      );

    case 6:
      return (
        <View style={contentPad}>
          {heading()}
          <Text style={[styles.secondStatement, { color: discoveryColors.blue }]}>We remove friction.</Text>
          <View style={[styles.split, !isMobile && styles.splitWide]}>
            <PortraitCard image={HERO_IMAGE} label="Human coach and member interaction" position="bottom" />
            <View style={styles.systemList}>
              {['Scheduling', 'Billing', 'Plans', 'Workouts', 'Recording', 'Review'].map((item, index) => (
                <View key={item} style={styles.systemRow}>
                  <Text style={styles.systemNumber}>{String(index + 1).padStart(2, '0')}</Text>
                  <Text style={styles.systemText}>{item}</Text>
                  <View style={[styles.systemStatus, { backgroundColor: index < 3 ? discoveryColors.blue : discoveryColors.green }]} />
                </View>
              ))}
            </View>
          </View>
        </View>
      );

    case 7:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide, styles.centerVertically]}>
            <View style={styles.splitCopy}>
              {heading()}
              <SupportingText>
                This is not automation replacing care. It gives the coach more ways to notice and respond.
              </SupportingText>
              <View style={styles.wordGrid}>
                {['Notice.', 'Respond.', 'Adjust.', 'Encourage.'].map((word) => (
                  <Text key={word} style={styles.wordGridItem}>{word}</Text>
                ))}
              </View>
            </View>
            <PortraitCard image={REVIEW_IMAGE} label="Coach reviewing a recorded member workout" />
          </View>
        </View>
      );

    case 8:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide, styles.centerVertically]}>
            <PortraitCard image={MAYA_IMAGE} label="Generated member story portrait of Maya preparing to train at home" />
            <View style={styles.splitCopy}>
              {heading()}
              <View style={styles.mayaFacts}>
                {[
                  'Busy schedule.',
                  'Tried several programs.',
                  'Does not need more information.',
                  'Needs structure that fits her life.',
                ].map((fact, index) => (
                  <View key={fact} style={styles.mayaFact}>
                    <Text style={styles.mayaFactNumber}>{String(index + 1).padStart(2, '0')}</Text>
                    <Text style={styles.mayaFactText}>{fact}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.disclosure}>Maya is a generated story character, not a real member testimonial.</Text>
            </View>
          </View>
        </View>
      );

    case 9:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>Every step feels connected. The member always knows what comes next.</SupportingText>
          <MemberJourney isMobile={isMobile} />
        </View>
      );

    case 10:
      return (
        <View style={contentPad}>
          {heading()}
          <View style={[styles.productComposition, !isMobile && styles.productCompositionWide]}>
            <DeviceMockup title="Plan Builder" caption="Coach-facing plan design" variant={isMobile ? 'panel' : 'laptop'} accent="blue" />
            <DeviceMockup title="Member plan" caption="A clear path, built around real life" variant="phone" accent="green" style={!isMobile && styles.floatingPhone} />
          </View>
          <FeatureChips items={['Schedule', 'Support level', 'Coaching phases', 'Contract options', 'Investment', 'Next step']} accent="blue" />
        </View>
      );

    case 11:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide, styles.centerVertically]}>
            <View style={styles.splitCopy}>
              {heading()}
              <SupportingText>The member is not simply opening a list of movements.</SupportingText>
              <FeatureChips
                items={['Coach programming', 'Movement demonstrations', 'Spoken cues', 'Equipment prompts', 'Music', 'Intervals', 'Zoom accountability', 'Glow / Grow']}
                accent="blue"
              />
            </View>
            <DeviceMockup title="Workout Player" caption="Guided, coached, and connected" variant="phone" accent="blue" />
          </View>
        </View>
      );

    case 12:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>More flexibility without losing relationship.</SupportingText>
          <View style={[styles.stageFlow, !isMobile && styles.stageFlowWide]}>
            <StageCard number="01" title="Coach present" detail="Live Zoom accountability where full presence adds value." accent="green" />
            <FlowArrow />
            <StageCard number="02" title="Coach partially present" detail="A planned live window inside a guided session." accent="blue" />
            <FlowArrow />
            <StageCard number="03" title="Coach reviews afterward" detail="Recording and reflection enter the review flow." accent="gold" />
          </View>
        </View>
      );

    case 13:
      return (
        <View style={contentPad}>
          {heading()}
          <View style={styles.loopWrap}>
            {['Workout completed', 'Glow / Grow', 'Recording available', 'Coach Review Queue', 'Coach response', 'Plan adjustment'].map((item, index) => (
              <React.Fragment key={item}>
                <View style={[styles.loopStep, index === 3 && styles.loopStepActive]}>
                  <Text style={styles.loopNumber}>{String(index + 1).padStart(2, '0')}</Text>
                  <Text style={styles.loopText}>{item}</Text>
                </View>
                {index < 5 && <View style={styles.loopConnector} />}
              </React.Fragment>
            ))}
          </View>
          <SupportingText style={styles.loopConclusion}>Completion creates another opportunity to coach.</SupportingText>
        </View>
      );

    case 14:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>This is the operating system behind the relationship.</SupportingText>
          <View style={styles.screenStack}>
            <DeviceMockup title="Command Center" caption="What needs attention today" variant="laptop" accent="blue" />
            <View style={[styles.screenStackCards, !isMobile && styles.screenStackCardsWide]}>
              <DeviceMockup title="Build" variant="panel" compact accent="blue" />
              <DeviceMockup title="Coach Review" variant="panel" compact accent="green" />
              <DeviceMockup title="Billing" variant="panel" compact accent="gold" />
            </View>
          </View>
        </View>
      );

    case 15:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>The platform share supports an entire operating system—not one app.</SupportingText>
          <View style={[styles.infrastructureGrid, !isMobile && styles.infrastructureGridWide]}>
            {INFRASTRUCTURE_ITEMS.map((item, index) => (
              <View key={item} style={styles.infrastructureItem}>
                <View style={[styles.infrastructureIcon, { backgroundColor: index % 3 === 0 ? discoveryColors.blueSoft : 'rgba(255,255,255,0.04)' }]}>
                  <Text style={styles.infrastructureIconText}>{String(index + 1).padStart(2, '0')}</Text>
                </View>
                <Text style={styles.infrastructureText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      );

    case 16:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide, styles.centerVertically]}>
            <PortraitCard image={REVIEW_IMAGE} label="Coach focused on a member’s session" />
            <View style={styles.splitCopy}>
              {heading()}
              <View style={styles.peopleList}>
                {['Listen well.', 'Build the plan.', 'Coach the movement.', 'Notice the struggle.', 'Celebrate the win.', 'Help them grow.'].map((line, index) => (
                  <Text key={line} style={[styles.peopleLine, index === 5 && { color: discoveryColors.green }]}>{line}</Text>
                ))}
              </View>
            </View>
          </View>
        </View>
      );

    case 17:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>Learn the culture. Experience the system. Build confidence. Launch prepared.</SupportingText>
          <View style={styles.launchPath}>
            <View style={styles.launchLine} />
            {COACH_LAUNCH_MODULES.map((module, index) => (
              <View key={module} style={styles.launchModule}>
                <View style={[styles.launchMarker, index === COACH_LAUNCH_MODULES.length - 1 && styles.launchMarkerFinal]}>
                  <Text style={styles.launchMarkerText}>{index + 1}</Text>
                </View>
                <Text style={styles.launchModuleText}>{module}</Text>
              </View>
            ))}
          </View>
        </View>
      );

    case 18:
      return (
        <View style={contentPad}>
          {heading()}
          <View style={[styles.cultureGrid, !isMobile && styles.cultureGridWide]}>
            {CULTURE_PILLARS.map((pillar, index) => (
              <View key={pillar.name} style={styles.cultureCard}>
                <Text style={styles.cultureNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.cultureName}>{pillar.name}</Text>
                <Text style={styles.cultureDefinition}>{pillar.definition}</Text>
              </View>
            ))}
          </View>
        </View>
      );

    case 19:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>Progressive compensation aligned with active member engagement.</SupportingText>
          <CompensationPath isMobile={isMobile} />
        </View>
      );

    case 20:
      return (
        <View style={contentPad}>
          {heading()}
          <View style={styles.capVisual}>
            <View style={styles.capTrack}>
              <View style={styles.capProgress} />
              <View style={styles.capMarker} />
            </View>
            <View style={styles.capLabels}>
              <Text style={styles.capSmall}>Progress toward annual cap</Text>
              <Text style={styles.capReached}>CAP REACHED</Text>
            </View>
            <View style={styles.afterCapCard}>
              <Text style={styles.afterCapLabel}>AFTER THE CAP</Text>
              <Text style={styles.afterCapValue}>100%</Text>
              <Text style={styles.afterCapCopy}>of additional New Business revenue for the applicable term, minus the monthly admin technology fee</Text>
            </View>
          </View>
          <View style={styles.factList}>
            {EARNINGS_CAP_FACTS.map((fact) => (
              <View key={fact} style={styles.factRow}>
                <View style={styles.factDot} />
                <Text style={styles.factText}>{fact}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.legalNote}>{PROGRAM_TERMS_NOTE}</Text>
        </View>
      );

    case 21:
      return (
        <View style={contentPad}>
          {heading()}
          <SupportingText style={styles.sectionIntro}>Contribution can create more than one path forward.</SupportingText>
          <GrowthPathways isMobile={isMobile} />
        </View>
      );

    case 22:
      return (
        <View style={[contentPad, styles.honestTradeScene]}>
          {heading('center')}
          <Text style={styles.tradeLead}>GoArrive shares in revenue because GoArrive shares in:</Text>
          <View style={styles.tradeWords}>
            {['Infrastructure', 'Risk', 'Support', 'Development', 'Administration', 'Growth'].map((word) => (
              <Text key={word} style={styles.tradeWord}>{word}</Text>
            ))}
          </View>
          <View style={styles.tradeRule} />
          <Text style={styles.tradeQuestion}>
            The question is not whether the percentage is noticeable.{`\n\n`}The question is whether the partnership helps you build more than you could build alone.
          </Text>
        </View>
      );

    case 23:
      return (
        <ImageScene image={FUTURE_IMAGE} label="Coach closing a laptop after an online coaching day">
          <View style={[styles.futureCopy, isMobile ? styles.futureCopyMobile : styles.futureCopyDesktop]}>
            {heading()}
            <View style={styles.futureList}>
              {['Meaningful member impact', 'A flexible schedule', 'A growing practice', 'Supportive community', 'Leadership', 'Multiple earning pathways', 'Room for family and life', 'Still loving coaching'].map((item) => (
                <View key={item} style={styles.futurePill}><Text style={styles.futurePillText}>{item}</Text></View>
              ))}
            </View>
            <Text style={styles.futureQualifier}>Not guaranteed. But intentionally possible.</Text>
          </View>
        </ImageScene>
      );

    case 24:
      return (
        <View style={contentPad}>
          <View style={[styles.split, !isMobile && styles.splitWide, styles.centerVertically]}>
            <View style={styles.splitCopy}>
              {heading()}
              <View style={styles.fitList}>
                {['Care deeply.', 'Welcome feedback.', 'Value collaboration.', 'Keep learning.', 'Show up consistently.', 'Think long-term.', 'Want to build something larger than themselves.'].map((item) => (
                  <View key={item} style={styles.fitItem}>
                    <View style={styles.fitCheck}><Text style={styles.fitCheckText}>✓</Text></View>
                    <Text style={styles.fitText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.portraitMosaic}>
              <MosaicImage image={HERO_IMAGE} label="Online coach" />
              <MosaicImage image={REVIEW_IMAGE} label="Coach reviewing a session" />
              <MosaicImage image={FUTURE_IMAGE} label="Coach balancing work and life" />
              <MosaicImage image={MAYA_IMAGE} label="Member preparing to train" />
            </View>
          </View>
        </View>
      );

    case 25:
      return (
        <View style={[contentPad, styles.conversationScene]}>
          {heading('center')}
          <View style={styles.conversationPause} />
          <View style={styles.questionList}>
            {['What feels most limiting today?', 'What excites you here?', 'What questions or concerns remain?'].map((question, index) => (
              <View key={question} style={styles.questionRow}>
                <Text style={styles.questionNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.questionText}>{question}</Text>
              </View>
            ))}
          </View>
        </View>
      );

    case 26:
      return (
        <View style={contentPad}>
          {heading()}
          <View style={styles.nextStepPath}>
            {['Deeper fit conversation', 'Experience the platform', 'Coach Launch', 'Apprenticeship', 'First members', 'Long-term growth'].map((step, index) => (
              <React.Fragment key={step}>
                <View style={styles.nextStepItem}>
                  <Text style={styles.nextStepNumber}>{String(index + 1).padStart(2, '0')}</Text>
                  <Text style={styles.nextStepText}>{step}</Text>
                </View>
                {index < 5 && <View style={styles.nextStepLine} />}
              </React.Fragment>
            ))}
          </View>
          <SupportingText>We are looking for alignment, not a rushed decision.</SupportingText>
        </View>
      );

    case 27:
      return (
        <View style={[contentPad, styles.closeScene]}>
          <View style={styles.closeGlowGreen} />
          <View style={styles.closeGlowGold} />
          {heading('center')}
          <AccessibleImage source={LOGO} webSource="/goarrive-logo.png" resizeMode="contain" label="GoArrive" style={styles.closeLogo} />
          <Text style={styles.closeUrl}>GoArrive.fit</Text>
          <FinalButton onPress={onNextStep} />
        </View>
      );

    default:
      return null;
  }
}

function ImageScene({ image, label, children, eager = false }: { image: DiscoveryImageAsset; label: string; children: ReactNode; eager?: boolean }) {
  return (
    <View style={styles.imageScene}>
      <AccessibleImage source={image.source} webSource={image.webSource} resizeMode="cover" label={label} eager={eager} style={styles.fullBleedImage} />
      <View style={styles.imageOverlay} />
      <View style={styles.imageOverlayBottom} />
      {children}
    </View>
  );
}

function PortraitCard({ image, label, position = 'center' }: { image: DiscoveryImageAsset; label: string; position?: 'center' | 'bottom' }) {
  return (
    <View style={styles.portraitCard}>
      <AccessibleImage source={image.source} webSource={image.webSource} resizeMode="cover" label={label} style={[styles.portraitImage, position === 'bottom' && ({ objectPosition: 'center bottom' } as any)]} />
      <View style={styles.portraitOverlay} />
    </View>
  );
}

function MosaicImage({ image, label }: { image: DiscoveryImageAsset; label: string }) {
  return <AccessibleImage source={image.source} webSource={image.webSource} resizeMode="cover" label={label} style={styles.mosaicImage} />;
}

function TensionCard({ number, title, detail, symbol }: { number: string; title: string; detail: string; symbol: string }) {
  return (
    <View style={styles.tensionCard}>
      <View style={styles.tensionTop}>
        <Text style={styles.tensionNumber}>{number}</Text>
        <Text style={styles.tensionSymbol}>{symbol}</Text>
      </View>
      <Text style={styles.tensionTitle}>{title}</Text>
      <Text style={styles.tensionDetail}>{detail}</Text>
    </View>
  );
}

function FeatureChips({ items, accent }: { items: readonly string[]; accent: DiscoverySceneMeta['accent'] }) {
  return (
    <View style={styles.chips}>
      {items.map((item) => (
        <View key={item} style={[styles.chip, { backgroundColor: accentSoft(accent), borderColor: accentColor(accent) }]}>
          <Text style={[styles.chipText, { color: accentColor(accent) }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function StageCard({ number, title, detail, accent }: { number: string; title: string; detail: string; accent: DiscoverySceneMeta['accent'] }) {
  return (
    <View style={[styles.stageCard, { borderColor: accentColor(accent) }]}>
      <Text style={[styles.stageNumber, { color: accentColor(accent) }]}>{number}</Text>
      <Text style={styles.stageTitle}>{title}</Text>
      <Text style={styles.stageDetail}>{detail}</Text>
    </View>
  );
}

function FlowArrow() {
  return <Text accessibilityElementsHidden style={styles.flowArrow}>↓</Text>;
}

function FinalButton({ onPress }: { onPress: () => void }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue to the GoArrive coach application"
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.finalButton,
        focused && styles.finalButtonFocused,
        pressed && styles.finalButtonPressed,
      ]}
    >
      <Text style={styles.finalButtonText}>Continue the conversation</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sceneContent: {
    flex: 1,
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  sceneContentMobile: {
    paddingHorizontal: 24,
    paddingTop: 86,
    paddingBottom: 76,
    gap: 32,
  },
  sceneContentDesktop: {
    paddingHorizontal: 70,
    paddingVertical: 90,
    gap: 44,
  },
  headingMobile: {
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1.5,
  },
  headingDesktop: {
    fontSize: 70,
    lineHeight: 74,
    letterSpacing: -2.8,
  },
  imageScene: {
    flex: 1,
    width: '100%',
    minHeight: '100%',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  fullBleedImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,5,9,0.28)',
  },
  imageOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
    backgroundColor: 'rgba(3,5,9,0.54)',
  },
  heroCopy: {
    zIndex: 2,
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
  },
  heroCopyMobile: {
    paddingHorizontal: 24,
    paddingTop: 90,
    paddingBottom: 58,
  },
  heroCopyDesktop: {
    paddingHorizontal: 70,
    paddingBottom: 70,
  },
  heroSupport: {
    marginTop: 22,
    color: discoveryColors.text,
  },
  heroLogo: {
    width: 142,
    height: 34,
    marginTop: 34,
  },
  split: {
    width: '100%',
    gap: 34,
  },
  splitWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 58,
  },
  splitCopy: {
    flex: 1,
    width: '100%',
    gap: 28,
    justifyContent: 'center',
  },
  centerVertically: {
    alignItems: 'center',
  },
  portraitCard: {
    flex: 1,
    width: '100%',
    minHeight: 460,
    maxHeight: 670,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
  },
  portraitImage: {
    width: '100%',
    height: '100%',
  },
  portraitOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,11,18,0.08)',
  },
  notToList: {
    gap: 14,
  },
  notToLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notToRule: {
    width: 28,
    height: 1,
    backgroundColor: discoveryColors.green,
  },
  notToText: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 17,
    lineHeight: 24,
  },
  cardRow: {
    gap: 12,
  },
  cardRowWide: {
    flexDirection: 'row',
  },
  tensionCard: {
    flex: 1,
    minHeight: 280,
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
    justifyContent: 'flex-end',
  },
  tensionTop: {
    position: 'absolute',
    top: 22,
    left: 22,
    right: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tensionNumber: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    letterSpacing: 1.3,
    fontWeight: '700',
  },
  tensionSymbol: {
    color: 'rgba(255,255,255,0.16)',
    fontFamily: discoveryFonts.heading,
    fontSize: 42,
    lineHeight: 44,
    fontWeight: '700',
  },
  tensionTitle: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '700',
  },
  tensionDetail: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  quietScene: {
    alignItems: 'center',
  },
  blueGlow: {
    position: 'absolute',
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: discoveryColors.blueGlow,
    opacity: 0.24,
  },
  quietHeadline: {
    margin: 0,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontWeight: '700',
    textAlign: 'center',
    zIndex: 2,
  },
  statementStack: {
    gap: 6,
  },
  statement: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.heading,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '600',
  },
  secondStatement: {
    fontFamily: discoveryFonts.heading,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    marginTop: -22,
  },
  systemList: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  systemRow: {
    minHeight: 62,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  systemNumber: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
  },
  systemText: {
    flex: 1,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 16,
    fontWeight: '600',
  },
  systemStatus: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  wordGridItem: {
    color: discoveryColors.green,
    fontFamily: discoveryFonts.heading,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '700',
  },
  mayaFacts: {
    gap: 8,
  },
  mayaFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: discoveryColors.borderSoft,
  },
  mayaFactNumber: {
    color: discoveryColors.green,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  mayaFactText: {
    flex: 1,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.body,
    fontSize: 16,
    lineHeight: 23,
  },
  disclosure: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    lineHeight: 15,
  },
  sectionIntro: {
    marginTop: -16,
    marginBottom: 12,
  },
  productComposition: {
    width: '100%',
    alignItems: 'center',
    gap: 18,
  },
  productCompositionWide: {
    position: 'relative',
    paddingRight: 120,
  },
  floatingPhone: {
    position: 'absolute',
    right: 0,
    bottom: -40,
    transform: [{ rotate: '2deg' }],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    fontFamily: discoveryFonts.body,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  stageFlow: {
    gap: 12,
    alignItems: 'center',
  },
  stageFlowWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stageCard: {
    flex: 1,
    width: '100%',
    minHeight: 230,
    padding: 22,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: discoveryColors.surface,
  },
  stageNumber: {
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    letterSpacing: 1.3,
    fontWeight: '700',
  },
  stageTitle: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 56,
  },
  stageDetail: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  flowArrow: {
    alignSelf: 'center',
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.heading,
    fontSize: 20,
    lineHeight: 28,
  },
  loopWrap: {
    width: '100%',
  },
  loopStep: {
    minHeight: 74,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  loopStepActive: {
    borderColor: discoveryColors.green,
    backgroundColor: discoveryColors.greenSoft,
  },
  loopNumber: {
    color: discoveryColors.green,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  loopText: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 16,
    fontWeight: '600',
  },
  loopConnector: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(110,187,122,0.36)',
    marginLeft: 37,
  },
  loopConclusion: {
    marginTop: 18,
    color: discoveryColors.green,
  },
  screenStack: {
    width: '100%',
    gap: 18,
  },
  screenStackCards: {
    gap: 12,
  },
  screenStackCardsWide: {
    flexDirection: 'row',
    transform: [{ translateY: -54 }],
    paddingHorizontal: 36,
  },
  infrastructureGrid: {
    gap: 8,
  },
  infrastructureGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  infrastructureItem: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 94,
    padding: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infrastructureIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infrastructureIconText: {
    color: discoveryColors.blue,
    fontFamily: discoveryFonts.body,
    fontSize: 9,
    fontWeight: '700',
  },
  infrastructureText: {
    flex: 1,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.body,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  peopleList: {
    gap: 5,
  },
  peopleLine: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.heading,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '600',
  },
  launchPath: {
    position: 'relative',
    width: '100%',
    gap: 8,
  },
  launchLine: {
    position: 'absolute',
    left: 20,
    top: 20,
    bottom: 20,
    width: 1,
    backgroundColor: 'rgba(245,166,35,0.28)',
  },
  launchModule: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  launchMarker: {
    width: 41,
    height: 41,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.44)',
    backgroundColor: discoveryColors.backgroundAlt,
    zIndex: 2,
  },
  launchMarkerFinal: {
    backgroundColor: discoveryColors.gold,
  },
  launchMarkerText: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  launchModuleText: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  cultureGrid: {
    gap: 12,
  },
  cultureGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cultureCard: {
    flexBasis: '46%',
    flexGrow: 1,
    minHeight: 250,
    padding: 22,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.26)',
    backgroundColor: discoveryColors.surface,
  },
  cultureNumber: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '700',
  },
  cultureName: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '700',
    marginTop: 66,
  },
  cultureDefinition: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  capVisual: {
    width: '100%',
    padding: 22,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.28)',
    backgroundColor: discoveryColors.surface,
  },
  capTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    position: 'relative',
  },
  capProgress: {
    width: '78%',
    height: 6,
    borderRadius: 3,
    backgroundColor: discoveryColors.gold,
  },
  capMarker: {
    position: 'absolute',
    left: '77%',
    top: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: discoveryColors.gold,
    borderWidth: 3,
    borderColor: discoveryColors.surface,
  },
  capLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  capSmall: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 9,
  },
  capReached: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '700',
  },
  afterCapCard: {
    marginTop: 28,
    padding: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.22)',
  },
  afterCapLabel: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    letterSpacing: 1.3,
    fontWeight: '700',
  },
  afterCapValue: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 60,
    lineHeight: 64,
    fontWeight: '700',
    letterSpacing: -2.5,
    marginTop: 10,
  },
  afterCapCopy: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 620,
  },
  factList: {
    gap: 10,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  factDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: discoveryColors.gold,
    marginTop: 7,
  },
  factText: {
    flex: 1,
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 12,
    lineHeight: 19,
  },
  legalNote: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    lineHeight: 16,
  },
  honestTradeScene: {
    alignItems: 'center',
  },
  tradeLead: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  tradeWords: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    maxWidth: 720,
  },
  tradeWord: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '600',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
  },
  tradeRule: {
    width: 60,
    height: 1,
    backgroundColor: discoveryColors.textSoft,
    opacity: 0.42,
  },
  tradeQuestion: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 720,
  },
  futureCopy: {
    zIndex: 2,
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
  },
  futureCopyMobile: {
    paddingHorizontal: 24,
    paddingTop: 86,
    paddingBottom: 56,
  },
  futureCopyDesktop: {
    paddingHorizontal: 70,
    paddingBottom: 70,
  },
  futureList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    maxWidth: 740,
    marginTop: 26,
  },
  futurePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(8,11,18,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.34)',
  },
  futurePillText: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.body,
    fontSize: 11,
    lineHeight: 14,
  },
  futureQualifier: {
    color: discoveryColors.green,
    fontFamily: discoveryFonts.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 18,
  },
  fitList: {
    gap: 10,
  },
  fitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fitCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: discoveryColors.greenSoft,
  },
  fitCheckText: {
    color: discoveryColors.green,
    fontSize: 12,
    fontWeight: '700',
  },
  fitText: {
    flex: 1,
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 15,
    lineHeight: 22,
  },
  portraitMosaic: {
    flex: 1,
    width: '100%',
    minHeight: 520,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mosaicImage: {
    width: '48%',
    height: '48%',
    minHeight: 230,
    borderRadius: 18,
  },
  conversationScene: {
    alignItems: 'center',
  },
  conversationPause: {
    width: 1,
    height: 90,
    backgroundColor: 'rgba(245,166,35,0.34)',
  },
  questionList: {
    width: '100%',
    maxWidth: 720,
    gap: 8,
  },
  questionRow: {
    minHeight: 74,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: discoveryColors.borderSoft,
  },
  questionNumber: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  questionText: {
    flex: 1,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
  },
  nextStepPath: {
    width: '100%',
  },
  nextStepItem: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
  },
  nextStepNumber: {
    color: discoveryColors.blue,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  nextStepText: {
    flex: 1,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 17,
    fontWeight: '600',
  },
  nextStepLine: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(91,155,213,0.34)',
    marginLeft: 37,
  },
  closeScene: {
    alignItems: 'center',
  },
  closeGlowGreen: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: 200,
    left: -150,
    bottom: -190,
    backgroundColor: discoveryColors.greenGlow,
    opacity: 0.22,
  },
  closeGlowGold: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    right: -150,
    top: -120,
    backgroundColor: discoveryColors.goldGlow,
    opacity: 0.16,
  },
  closeLogo: {
    width: 250,
    height: 64,
    marginTop: 10,
  },
  closeUrl: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 13,
    letterSpacing: 1.4,
    marginTop: -10,
  },
  finalButton: {
    minHeight: 52,
    paddingHorizontal: 24,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: discoveryColors.green,
    marginTop: 22,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  finalButtonFocused: {
    borderColor: discoveryColors.white,
  },
  finalButtonPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.98 }],
  },
  finalButtonText: {
    color: '#07100A',
    fontFamily: discoveryFonts.body,
    fontSize: 14,
    fontWeight: '700',
  },
});
