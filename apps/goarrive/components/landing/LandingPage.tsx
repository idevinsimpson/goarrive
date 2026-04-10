/**
 * LandingPage — GoArrive public homepage
 *
 * Positions GoArrive as a premium online fitness coaching firm —
 * not a self-serve SaaS product. Two audiences:
 *   - Members seeking personalized online coaching
 *   - Coaches who want to apply to join the G➲A ecosystem
 *
 * Sections:
 *   1. Navigation bar
 *   2. Hero (dual-audience)
 *   3. What is GoArrive
 *   4. For Members
 *   5. For Coaches
 *   6. The G➲A Difference
 *   7. How It Works (member journey)
 *   8. Coach Application CTA
 *   9. FAQ
 *  10. Footer
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  StyleSheet,
  Platform,
  Dimensions,
  Linking,
  LayoutChangeEvent,
} from 'react-native';
import { router } from 'expo-router';

/* ─── Brand Tokens ─── */
const C = {
  bg:        '#0F1117',
  surface:   '#1A1D27',
  surfaceAlt:'#141821',
  card:      '#1E2233',
  border:    '#2A3347',
  borderSub: '#1E2A3A',
  green:     '#7BA05B',
  blue:      '#7BA7D4',
  gold:      '#F5A623',
  goldDim:   'rgba(245,166,35,0.12)',
  greenDim:  'rgba(123,160,91,0.10)',
  blueDim:   'rgba(123,167,212,0.10)',
  text:      '#E8EAF0',
  textSoft:  '#A0A8BC',
  muted:     '#7A7F94',
  white:     '#FFFFFF',
  dark:      '#0E1117',
  error:     '#E05252',
};

const FONT_H = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_B = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

/* ─── Responsive helper ─── */
function useWidth() {
  const [w, setW] = useState(Dimensions.get('window').width);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setW(e.nativeEvent.layout.width);
  }, []);
  return { w, onLayout };
}

/* ─── Reusable atoms ─── */
function SectionLabel({ text, color }: { text: string; color?: string }) {
  return (
    <Text style={[a.sectionLabel, color ? { color } : null]}>{text}</Text>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text style={a.sectionTitle}>{text}</Text>;
}

function SectionSub({ text }: { text: string }) {
  return <Text style={a.sectionSub}>{text}</Text>;
}

function PrimaryButton({ label, onPress, large }: { label: string; onPress: () => void; large?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [a.primaryBtn, large && a.primaryBtnLg, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <Text style={[a.primaryBtnText, large && a.primaryBtnTextLg]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [a.secondaryBtn, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <Text style={a.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function GreenButton({ label, onPress, large }: { label: string; onPress: () => void; large?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [a.greenBtn, large && a.primaryBtnLg, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <Text style={[a.greenBtnText, large && a.primaryBtnTextLg]}>{label}</Text>
    </Pressable>
  );
}

function Divider() {
  return <View style={a.divider} />;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN COMPONENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function LandingPage() {
  const { w, onLayout } = useWidth();
  const isMobile = w < 768;
  const scrollRef = useRef<ScrollView>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const goLogin = () => router.push('/(auth)/login');
  // Coach apply — currently routes to coach-signup; will be replaced
  // with a dedicated application flow in the future.
  const goCoachApply = () => router.push('/coach-signup');
  const goMemberStart = () => router.push('/intake');

  /* Section ref map for scroll-to */
  const sectionOffsets = useRef<Record<string, number>>({});
  const scrollToSection = (key: string) => {
    const offset = sectionOffsets.current[key];
    if (offset != null && scrollRef.current) {
      scrollRef.current.scrollTo({ y: offset - 70, animated: true });
    }
  };
  const onSectionLayout = (key: string) => (e: LayoutChangeEvent) => {
    sectionOffsets.current[key] = e.nativeEvent.layout.y;
  };

  /* ─── 1. NAVIGATION ─── */
  const NavBar = (
    <View style={[n.bar, Platform.OS === 'web' && ({ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 } as any)]}>
      <View style={[n.inner, { maxWidth: 1200, width: '100%' as any }]}>
        <Image
          source={require('../../assets/logo.png')}
          style={n.logo}
          resizeMode="contain"
          accessibilityLabel="GoArrive"
        />
        {isMobile ? (
          <Pressable onPress={() => setMobileMenuOpen(!mobileMenuOpen)} style={n.hamburger}>
            <Text style={n.hamburgerText}>{mobileMenuOpen ? '✕' : '☰'}</Text>
          </Pressable>
        ) : (
          <View style={n.links}>
            <Pressable onPress={() => scrollToSection('members')}><Text style={n.link}>For Members</Text></Pressable>
            <Pressable onPress={() => scrollToSection('coaches')}><Text style={n.link}>For Coaches</Text></Pressable>
            <Pressable onPress={() => scrollToSection('difference')}><Text style={n.link}>Why G➲A</Text></Pressable>
            <Pressable onPress={() => scrollToSection('faq')}><Text style={n.link}>FAQ</Text></Pressable>
            <Pressable onPress={goLogin} style={n.signInBtn}><Text style={n.signInText}>Sign In</Text></Pressable>
            <GreenButton label="Apply to Coach" onPress={goCoachApply} />
          </View>
        )}
      </View>
      {mobileMenuOpen && isMobile && (
        <View style={n.mobileMenu}>
          <Pressable onPress={() => { scrollToSection('members'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>For Members</Text></Pressable>
          <Pressable onPress={() => { scrollToSection('coaches'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>For Coaches</Text></Pressable>
          <Pressable onPress={() => { scrollToSection('difference'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>Why G➲A</Text></Pressable>
          <Pressable onPress={() => { scrollToSection('faq'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>FAQ</Text></Pressable>
          <Divider />
          <Pressable onPress={() => { goLogin(); setMobileMenuOpen(false); }}><Text style={[n.mobileLink, { color: C.gold }]}>Sign In</Text></Pressable>
          <GreenButton label="Apply to Coach" onPress={() => { goCoachApply(); setMobileMenuOpen(false); }} />
        </View>
      )}
    </View>
  );

  /* ─── 2. HERO ─── */
  const Hero = (
    <View style={[h.wrap, { paddingTop: isMobile ? 100 : 130, paddingBottom: isMobile ? 60 : 90 }]}>
      <View style={h.gradientOrb} />
      <View style={h.gradientOrb2} />

      <View style={[h.inner, { maxWidth: 820 }]}>
        <View style={h.badge}>
          <Text style={h.badgeText}>Premium Online Fitness Coaching</Text>
        </View>
        <Text style={[h.headline, isMobile && { fontSize: 34, lineHeight: 40 }]}>
          Real Coaches. Real Programs.{'\n'}Real Results.
        </Text>
        <Text style={[h.sub, isMobile && { fontSize: 16 }]}>
          GoArrive is building a better future for fitness coaching. Personalized
          programming, dedicated accountability, and a premium experience —
          delivered by coaches who are held to a higher standard.
        </Text>
        <View style={[h.ctas, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
          <PrimaryButton label="Start Your Coaching Journey" onPress={goMemberStart} large />
          <GreenButton label="Apply to Coach with G➲A" onPress={goCoachApply} large />
        </View>
      </View>
    </View>
  );

  /* ─── 3. WHAT IS G➲A ─── */
  const WhatIsGA = (
    <View style={wi.wrap}>
      <View style={wi.inner}>
        <SectionLabel text="WHO WE ARE" color={C.gold} />
        <SectionTitle text="More Than an App. A Coaching Firm." />
        <Text style={wi.body}>
          GoArrive is a premium online fitness coaching company with a growing team
          of vetted coaches and a proprietary coaching infrastructure behind them.
          We are not a marketplace. We are not a generic software subscription.
          We are building a coaching ecosystem where members get a genuinely
          personalized experience and coaches get the structure, support, and
          technology to do their best work.
        </Text>
        <View style={[wi.pillars, isMobile && { flexDirection: 'column' }]}>
          {[
            { label: 'Curated Coaches', desc: 'Every coach in the G➲A ecosystem is vetted. We set high standards because your results depend on it.' },
            { label: 'Personalized Coaching', desc: 'No templates. No one-size-fits-all. Your program is built for you by a real coach who knows your goals.' },
            { label: 'Serious Infrastructure', desc: 'Technology-enabled coaching with scheduling, video, payments, and progress tracking — all handled for you.' },
          ].map((item, i) => (
            <View key={i} style={[wi.pillar, isMobile && { width: '100%' as any }]}>
              <View style={[wi.pillarAccent, { backgroundColor: i === 0 ? C.greenDim : i === 1 ? C.goldDim : C.blueDim }]}>
                <Text style={[wi.pillarDot, { color: i === 0 ? C.green : i === 1 ? C.gold : C.blue }]}>●</Text>
              </View>
              <Text style={wi.pillarTitle}>{item.label}</Text>
              <Text style={wi.pillarDesc}>{item.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 4. FOR MEMBERS ─── */
  const memberPoints = [
    { icon: '🎯', title: 'A Program Built for You', desc: 'Your coach designs a workout program based on your goals, experience, and schedule. Every session has a purpose.' },
    { icon: '🤝', title: 'Dedicated Coach Guidance', desc: 'You are not alone. Your coach reviews your progress, adjusts your plan, and keeps you moving forward — every week.' },
    { icon: '📹', title: 'Video-Guided Workouts', desc: 'Every movement in your program comes with professional demonstrations so you always know exactly what to do.' },
    { icon: '📊', title: 'Accountability That Works', desc: 'Post-workout reflections, session check-ins, and coach follow-ups keep you honest and motivated without being invasive.' },
    { icon: '📅', title: 'Seamless Scheduling', desc: 'Book live sessions with your coach, get calendar reminders, and join video calls — all from one place.' },
    { icon: '✨', title: 'A Premium Experience', desc: 'From your first intake to your hundredth workout, the G➲A member experience is designed to feel personal, polished, and supportive.' },
  ];

  const ForMembers = (
    <View style={fm.wrap} onLayout={onSectionLayout('members')}>
      <View style={fm.inner}>
        <SectionLabel text="FOR MEMBERS" color={C.gold} />
        <SectionTitle text="Coaching That Meets You Where You Are" />
        <SectionSub text="Whether you are just starting out or pushing past a plateau, G➲A connects you with a dedicated coach and a program designed around your life. This is not a generic workout app — this is your coach, in your corner." />

        <View style={[fm.grid, isMobile && { flexDirection: 'column' }]}>
          {memberPoints.map((mp, i) => (
            <View key={i} style={[fm.card, isMobile ? { width: '100%' as any } : { width: '30%' as any, minWidth: 280 }]}>
              <Text style={fm.cardIcon}>{mp.icon}</Text>
              <Text style={fm.cardTitle}>{mp.title}</Text>
              <Text style={fm.cardDesc}>{mp.desc}</Text>
            </View>
          ))}
        </View>

        <View style={fm.ctaWrap}>
          <PrimaryButton label="Find Your Coach" onPress={goMemberStart} large />
        </View>
      </View>
    </View>
  );

  /* ─── 5. FOR COACHES ─── */
  const coachPoints = [
    { icon: '🏛', title: 'A Curated Ecosystem', desc: 'G➲A is not open to everyone. Coaches apply to join, are vetted for quality and alignment, and become part of a growing professional coaching network.' },
    { icon: '⚙️', title: 'Infrastructure That Works', desc: 'Workout programming, member management, scheduling, video sessions, and automated payments — all built in. You coach. We handle the operations.' },
    { icon: '📈', title: 'Grow Within the System', desc: 'G➲A coaches operate inside a proven structure with growth-based earnings, support from the team, and a brand that adds credibility to your coaching.' },
    { icon: '🎓', title: 'Standards That Matter', desc: 'We believe coaching quality matters. G➲A sets expectations for responsiveness, programming quality, and member experience — and supports coaches in meeting them.' },
    { icon: '🛡', title: 'Support, Not Isolation', desc: 'Independent coaching can be lonely. G➲A provides a professional home — community, operational support, and a team that wants you to succeed.' },
    { icon: '💡', title: 'Technology-Enabled Coaching', desc: 'Purpose-built tools that make you a better coach — not a SaaS product you have to figure out. The technology serves the coaching, not the other way around.' },
  ];

  const ForCoaches = (
    <View style={fco.wrap} onLayout={onSectionLayout('coaches')}>
      <View style={fco.inner}>
        <SectionLabel text="FOR COACHES" color={C.green} />
        <SectionTitle text="Build Your Coaching Career Inside a Serious Ecosystem" />
        <SectionSub text="G➲A is looking for dedicated coaches who care about their craft. If you want a professional home with real infrastructure, real standards, and real growth potential — we want to hear from you." />

        <View style={[fco.grid, isMobile && { flexDirection: 'column' }]}>
          {coachPoints.map((cp, i) => (
            <View key={i} style={[fco.card, isMobile ? { width: '100%' as any } : { width: '30%' as any, minWidth: 280 }]}>
              <Text style={fco.cardIcon}>{cp.icon}</Text>
              <Text style={fco.cardTitle}>{cp.title}</Text>
              <Text style={fco.cardDesc}>{cp.desc}</Text>
            </View>
          ))}
        </View>

        <View style={fco.ctaWrap}>
          <GreenButton label="Apply to Coach with G➲A" onPress={goCoachApply} large />
        </View>
      </View>
    </View>
  );

  /* ─── 6. THE G➲A DIFFERENCE ─── */
  const differences = [
    { title: 'Human-First, Technology-Enabled', desc: 'Coaching is a human relationship. Our technology amplifies that relationship — it never replaces it. Every feature exists to help coaches serve members better.' },
    { title: 'Quality Over Quantity', desc: 'We are not trying to onboard thousands of random coaches. We are building a curated team of professionals who share a commitment to excellence.' },
    { title: 'A Premium Member Experience', desc: 'From intake to workout delivery to post-session reflection, every touchpoint is designed to feel personal, polished, and worthy of your investment.' },
    { title: 'A Bigger Vision', desc: 'GoArrive is building toward something larger — a coaching ecosystem where great coaches thrive and members get an experience that does not exist anywhere else.' },
  ];

  const DifferenceSection = (
    <View style={ds.wrap} onLayout={onSectionLayout('difference')}>
      <View style={ds.inner}>
        <SectionLabel text="WHY G➲A" color={C.blue} />
        <SectionTitle text="What Makes GoArrive Different" />
        <SectionSub text="This is not another fitness app. This is not a marketplace where anyone can list themselves as a coach. GoArrive is a coaching firm with standards, infrastructure, and a genuine commitment to results." />

        <View style={[ds.grid, isMobile && { flexDirection: 'column' }]}>
          {differences.map((d, i) => (
            <View key={i} style={[ds.card, isMobile && { width: '100%' as any }]}>
              <View style={ds.cardAccent} />
              <Text style={ds.cardTitle}>{d.title}</Text>
              <Text style={ds.cardDesc}>{d.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 7. HOW IT WORKS (MEMBER JOURNEY) ─── */
  const memberSteps = [
    {
      num: '01',
      title: 'Tell Us About Yourself',
      desc: 'Complete a short intake that covers your goals, experience, schedule, and preferences. This is how we match you with the right coach.',
      color: C.green,
    },
    {
      num: '02',
      title: 'Get Matched with Your Coach',
      desc: 'A G➲A coach reviews your intake and builds a personalized program designed around your life. You are never just a number.',
      color: C.blue,
    },
    {
      num: '03',
      title: 'Train, Reflect, Progress',
      desc: 'Follow your program, log your workouts, and check in with your coach. Real coaching means real feedback, real adjustments, and real results over time.',
      color: C.gold,
    },
  ];

  const HowItWorks = (
    <View style={hi.wrap} onLayout={onSectionLayout('how-it-works')}>
      <View style={hi.inner}>
        <SectionLabel text="THE MEMBER JOURNEY" color={C.blue} />
        <SectionTitle text="How G➲A Coaching Works" />
        <SectionSub text="Getting started is simple. The hard part — the programming, the accountability, the progress — that is what your coach is for." />

        <View style={[hi.steps, isMobile && { flexDirection: 'column' }]}>
          {memberSteps.map((step, i) => (
            <View key={i} style={[hi.step, isMobile && { width: '100%' as any, flexDirection: 'row', gap: 16 }]}>
              <View style={[hi.numCircle, { borderColor: step.color }]}>
                <Text style={[hi.num, { color: step.color }]}>{step.num}</Text>
              </View>
              <View style={isMobile ? { flex: 1 } : {}}>
                <Text style={hi.stepTitle}>{step.title}</Text>
                <Text style={hi.stepDesc}>{step.desc}</Text>
              </View>
              {!isMobile && i < memberSteps.length - 1 && (
                <View style={hi.connector}>
                  <Text style={hi.connectorArrow}>→</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={hi.ctaWrap}>
          <PrimaryButton label="Start Your Coaching Journey" onPress={goMemberStart} large />
        </View>
      </View>
    </View>
  );

  /* ─── 8. COACH APPLICATION CTA ─── */
  const CoachCta = (
    <View style={cc.wrap}>
      <View style={cc.gradientOrb} />
      <View style={cc.inner}>
        <SectionLabel text="FOR COACHES" color={C.green} />
        <Text style={[cc.headline, isMobile && { fontSize: 28 }]}>
          Ready to Coach at a Higher Level?
        </Text>
        <Text style={cc.sub}>
          GoArrive is selectively growing its coaching team. If you are a qualified
          fitness coach who values quality, accountability, and professional growth,
          we would like to hear from you. Apply to join the G➲A coaching ecosystem.
        </Text>
        <View style={[cc.ctas, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
          <GreenButton label="Apply to Coach with G➲A" onPress={goCoachApply} large />
          <SecondaryButton label="Contact Us" onPress={() => Linking.openURL('mailto:coaches@goa.fit')} />
        </View>
        <Text style={cc.note}>
          Coach positions are application-based. We review every application personally.
        </Text>
      </View>
    </View>
  );

  /* ─── 9. FAQ ─── */
  const faqs = [
    {
      q: 'What is GoArrive?',
      a: 'GoArrive is a premium online fitness coaching firm. We connect members with dedicated, vetted coaches who build personalized programs and provide ongoing guidance and accountability. Our proprietary coaching infrastructure handles everything from workout delivery to scheduling to payments — so coaches can focus on coaching and members can focus on results.',
    },
    {
      q: 'How is GoArrive different from a fitness app?',
      a: 'Fitness apps give you generic workouts and leave you on your own. GoArrive gives you a real coach — someone who builds your program, reviews your progress, adjusts your plan, and holds you accountable. The technology is there to make that coaching relationship seamless, not to replace it.',
    },
    {
      q: 'How do I get started as a member?',
      a: 'Start by completing a short intake form. Based on your goals, experience, and preferences, a G➲A coach will review your information and reach out to build your personalized coaching plan. From there, you will have a dedicated coach and a custom program designed for you.',
    },
    {
      q: 'Can anyone become a G➲A coach?',
      a: 'No. Coaching positions at GoArrive are application-based. We look for qualified coaches who are committed to quality programming, responsiveness, and a premium member experience. If you believe you are a good fit, we encourage you to apply.',
    },
    {
      q: 'What does the coaching include?',
      a: 'G➲A coaching includes a personalized workout program with video-guided movements, regular coach check-ins, live session scheduling, post-workout reflections, and ongoing program adjustments. The specifics depend on the coaching plan you and your coach agree on.',
    },
    {
      q: 'How are payments handled?',
      a: 'Payments are processed securely through Stripe. Members subscribe to a coaching plan and payments are handled automatically — no awkward invoicing or manual transactions. Your investment goes directly to supporting your coaching experience.',
    },
    {
      q: 'What technology does GoArrive use?',
      a: 'GoArrive has built a proprietary coaching platform that includes workout programming and delivery, member management, scheduling with video integration, automated reminders, and secure payments. This technology is purpose-built to support the coaching relationship — it is not a generic SaaS product.',
    },
    {
      q: 'Is GoArrive a marketplace?',
      a: 'No. GoArrive is not a marketplace where coaches list themselves and compete for attention. It is a coaching firm with a curated team, shared standards, and a unified member experience. Think of it as a professional coaching ecosystem — not a directory.',
    },
  ];

  const FaqSection = (
    <View style={fq.wrap} onLayout={onSectionLayout('faq')}>
      <View style={fq.inner}>
        <SectionLabel text="FAQ" color={C.blue} />
        <SectionTitle text="Frequently Asked Questions" />

        <View style={fq.list}>
          {faqs.map((item, i) => (
            <Pressable key={i} style={fq.item} onPress={() => setOpenFaq(openFaq === i ? null : i)}>
              <View style={fq.qRow}>
                <Text style={fq.qText}>{item.q}</Text>
                <Text style={fq.chevron}>{openFaq === i ? '−' : '+'}</Text>
              </View>
              {openFaq === i && <Text style={fq.aText}>{item.a}</Text>}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 10. FOOTER ─── */
  const Footer = (
    <View style={ft.wrap}>
      <View style={[ft.inner, isMobile && { flexDirection: 'column', gap: 32 }]}>
        <View style={ft.brandCol}>
          <Image
            source={require('../../assets/logo.png')}
            style={ft.footerLogo}
            resizeMode="contain"
          />
          <Text style={ft.brandDesc}>
            Premium online fitness coaching. Real coaches, real programs, real results.
            GoArrive is building a better future for the coaching industry.
          </Text>
        </View>

        <View style={ft.linksCol}>
          <Text style={ft.colTitle}>Members</Text>
          <Pressable onPress={() => scrollToSection('members')}><Text style={ft.footerLink}>Member Experience</Text></Pressable>
          <Pressable onPress={() => scrollToSection('how-it-works')}><Text style={ft.footerLink}>How It Works</Text></Pressable>
          <Pressable onPress={goMemberStart}><Text style={ft.footerLink}>Get Started</Text></Pressable>
        </View>

        <View style={ft.linksCol}>
          <Text style={ft.colTitle}>Coaches</Text>
          <Pressable onPress={() => scrollToSection('coaches')}><Text style={ft.footerLink}>Coach Ecosystem</Text></Pressable>
          <Pressable onPress={goCoachApply}><Text style={ft.footerLink}>Apply to Coach</Text></Pressable>
          <Pressable onPress={() => Linking.openURL('mailto:coaches@goa.fit')}><Text style={ft.footerLink}>Coach Inquiries</Text></Pressable>
        </View>

        <View style={ft.linksCol}>
          <Text style={ft.colTitle}>Company</Text>
          <Pressable onPress={() => scrollToSection('difference')}><Text style={ft.footerLink}>About G➲A</Text></Pressable>
          <Pressable onPress={() => Linking.openURL('mailto:support@goa.fit')}><Text style={ft.footerLink}>Contact</Text></Pressable>
          <Pressable onPress={goLogin}><Text style={ft.footerLink}>Sign In</Text></Pressable>
        </View>
      </View>

      <View style={ft.bottom}>
        <Text style={ft.copyright}>© {new Date().getFullYear()} GoArrive. All rights reserved.</Text>
        <Text style={ft.legal}>GoArrive is a premium online fitness coaching firm providing personalized coaching programs, dedicated coach guidance, and technology-enabled member experiences. Payments processed securely via Stripe.</Text>
      </View>
    </View>
  );

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     RENDER
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }} onLayout={onLayout}>
      {NavBar}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 0 }}
        showsVerticalScrollIndicator={false}
      >
        {Hero}
        {WhatIsGA}
        {ForMembers}
        {ForCoaches}
        {DifferenceSection}
        {HowItWorks}
        {CoachCta}
        {FaqSection}
        {Footer}
      </ScrollView>
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STYLES
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* Shared / Atomic */
const a = StyleSheet.create({
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    color: C.green,
    fontFamily: FONT_H,
    textTransform: 'uppercase',
    marginBottom: 12,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 42,
    marginBottom: 16,
  },
  sectionSub: {
    fontSize: 17,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 640,
    alignSelf: 'center',
    marginBottom: 48,
  },
  primaryBtn: {
    backgroundColor: C.gold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnLg: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.dark,
    fontFamily: FONT_H,
  },
  primaryBtnTextLg: {
    fontSize: 17,
  },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: C.border,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textSoft,
    fontFamily: FONT_H,
  },
  greenBtn: {
    backgroundColor: C.green,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  greenBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.white,
    fontFamily: FONT_H,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    width: '100%' as any,
  },
});

/* Nav */
const n = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(15,17,23,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } as any : {}),
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignSelf: 'center',
  },
  logo: { width: 140, height: 32 },
  links: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  link: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textSoft,
    fontFamily: FONT_B,
  },
  signInBtn: { marginLeft: 8 },
  signInText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    fontFamily: FONT_B,
  },
  hamburger: { padding: 8 },
  hamburgerText: { fontSize: 24, color: C.text },
  mobileMenu: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
  },
  mobileLink: {
    fontSize: 16,
    fontWeight: '500',
    color: C.textSoft,
    fontFamily: FONT_B,
    paddingVertical: 4,
  },
});

/* Hero */
const h = StyleSheet.create({
  wrap: {
    paddingHorizontal: 24,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  gradientOrb: {
    position: 'absolute',
    top: -100,
    right: -150,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(123,160,91,0.06)',
  },
  gradientOrb2: {
    position: 'absolute',
    top: 100,
    left: -200,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(123,167,212,0.04)',
  },
  inner: { alignItems: 'center', zIndex: 1 },
  badge: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.18)',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.gold,
    fontFamily: FONT_B,
  },
  headline: {
    fontSize: 50,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 58,
    marginBottom: 20,
  },
  sub: {
    fontSize: 19,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 30,
    maxWidth: 600,
    marginBottom: 36,
  },
  ctas: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
});

/* What is G➲A */
const wi = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
  },
  inner: {
    maxWidth: 900,
    alignSelf: 'center',
    width: '100%' as any,
    alignItems: 'center',
  },
  body: {
    fontSize: 17,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 28,
    maxWidth: 700,
    marginBottom: 48,
  },
  pillars: {
    flexDirection: 'row',
    gap: 20,
    width: '100%' as any,
    justifyContent: 'center',
  },
  pillar: {
    width: '30%' as any,
    minWidth: 240,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: C.border,
  },
  pillarAccent: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  pillarDot: { fontSize: 18 },
  pillarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
  },
  pillarDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
  },
});

/* For Members */
const fm = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%' as any,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardIcon: { fontSize: 28, marginBottom: 12 },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
  },
  ctaWrap: {
    alignItems: 'center',
    marginTop: 40,
  },
});

/* For Coaches */
const fco = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
  },
  inner: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%' as any,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardIcon: { fontSize: 28, marginBottom: 12 },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
  },
  ctaWrap: {
    alignItems: 'center',
    marginTop: 40,
  },
});

/* G➲A Difference */
const ds = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%' as any,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    justifyContent: 'center',
  },
  card: {
    width: '46%' as any,
    minWidth: 280,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: C.border,
    position: 'relative',
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: C.gold,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
    marginTop: 4,
  },
  cardDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
  },
});

/* How It Works */
const hi = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
  },
  inner: {
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%' as any,
  },
  steps: {
    flexDirection: 'row',
    gap: 32,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  step: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  numCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    backgroundColor: C.surface,
  },
  num: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: FONT_H,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
    textAlign: 'center',
  },
  stepDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
    textAlign: 'center',
  },
  connector: {
    position: 'absolute',
    right: -20,
    top: 26,
  },
  connectorArrow: {
    fontSize: 20,
    color: C.muted,
  },
  ctaWrap: {
    alignItems: 'center',
    marginTop: 40,
  },
});

/* Coach Application CTA */
const cc = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  gradientOrb: {
    position: 'absolute',
    top: -50,
    width: 600,
    height: 600,
    borderRadius: 300,
    backgroundColor: 'rgba(123,160,91,0.05)',
  },
  inner: {
    alignItems: 'center',
    maxWidth: 620,
    zIndex: 1,
  },
  headline: {
    fontSize: 36,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 44,
    marginBottom: 16,
  },
  sub: {
    fontSize: 17,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 36,
  },
  ctas: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  note: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

/* FAQ */
const fq = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
  },
  inner: {
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%' as any,
  },
  list: {
    gap: 12,
  },
  item: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  qRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  qText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    fontFamily: FONT_H,
    flex: 1,
  },
  chevron: {
    fontSize: 22,
    color: C.gold,
    fontWeight: '700',
    fontFamily: FONT_H,
  },
  aText: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 24,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
});

/* Footer */
const ft = StyleSheet.create({
  wrap: {
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.borderSub,
    paddingTop: 48,
    paddingHorizontal: 24,
  },
  inner: {
    flexDirection: 'row',
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%' as any,
    justifyContent: 'space-between',
    paddingBottom: 40,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
  },
  brandCol: {
    maxWidth: 280,
    gap: 12,
  },
  footerLogo: { width: 120, height: 28 },
  brandDesc: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    lineHeight: 22,
  },
  linksCol: { gap: 10 },
  colTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 4,
  },
  footerLink: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
  },
  bottom: {
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%' as any,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  copyright: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
  },
  legal: {
    fontSize: 12,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 600,
    opacity: 0.7,
  },
});
