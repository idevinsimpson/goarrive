/**
 * LandingPage — GoArrive public homepage
 *
 * Member-first, premium positioning. Single conversion path.
 * Coach recruiting is secondary (nav link + bottom section).
 *
 * Design reference: JV.goarrive.fit funnel patterns —
 * generous spacing, text-forward layout, single CTA dominance,
 * testimonial-driven trust, clean reading rhythm.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

/* ─── Brand Tokens ─── */
const C = {
  bg:        '#0F1117',
  surface:   '#161A24',
  surfaceAlt:'#121620',
  card:      '#1C2030',
  border:    '#252B3D',
  borderSub: '#1E2538',
  green:     '#7BA05B',
  greenGlow: 'rgba(123,160,91,0.25)',
  blue:      '#7BA7D4',
  gold:      '#F5A623',
  goldGlow:  'rgba(245,166,35,0.20)',
  goldDim:   'rgba(245,166,35,0.08)',
  text:      '#E8EAF0',
  textSoft:  '#9BA3B8',
  muted:     '#6B7280',
  white:     '#FFFFFF',
  dark:      '#0E1117',
};

const FONT_H = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_B = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

/* ─── Responsive ─── */
function useWidth() {
  const [w, setW] = useState(Dimensions.get('window').width);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setW(e.nativeEvent.layout.width);
  }, []);
  return { w, onLayout };
}

/* ─── Buttons ─── */
function CtaButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [s.ctaBtn, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
      onPress={onPress}
    >
      <Text style={s.ctaBtnText}>{label}</Text>
    </Pressable>
  );
}

function CoachCtaButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [s.coachCtaBtn, pressed && { opacity: 0.88 }]}
      onPress={onPress}
    >
      <Text style={s.coachCtaBtnText}>{label}</Text>
    </Pressable>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function LandingPage() {
  const { w, onLayout } = useWidth();
  const isMobile = w < 768;
  const scrollRef = useRef<ScrollView>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const navTopPad = Platform.OS === 'web' ? Math.max(14, insets.top + 6) : 14;
  const navBottomPad = 14;
  const heroTopBase = isMobile ? 110 : 150;
  const heroTopPad = Platform.OS === 'web' ? heroTopBase + Math.max(0, insets.top) : heroTopBase;

  const goStart = () => router.push('/intake');
  const goLogin = () => router.push('/(auth)/login');
  const goCoachApply = () => router.push('/coach-apply');

  const offsets = useRef<Record<string, number>>({});
  const scrollTo = (key: string) => {
    const y = offsets.current[key];
    if (y != null && scrollRef.current) scrollRef.current.scrollTo({ y: y - 70, animated: true });
  };
  const mark = (key: string) => (e: LayoutChangeEvent) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };

  /* ─── NAV ─── */
  const Nav = (
    <View style={[nav.bar, Platform.OS === 'web' && ({ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 } as any)]}>
      <View style={[nav.inner, { maxWidth: 1080, paddingTop: navTopPad, paddingBottom: navBottomPad }]}>
        <Image source={require('../../assets/logo.png')} style={nav.logo} resizeMode="contain" accessibilityLabel="GoArrive" />
        {isMobile ? (
          <Pressable onPress={() => setMenuOpen(!menuOpen)} hitSlop={12}>
            <Text style={nav.burger}>{menuOpen ? '✕' : '☰'}</Text>
          </Pressable>
        ) : (
          <View style={nav.links}>
            <Pressable onPress={() => scrollTo('how')}><Text style={nav.link}>How It Works</Text></Pressable>
            <Pressable onPress={() => scrollTo('why')}><Text style={nav.link}>Why GoArrive</Text></Pressable>
            <Pressable onPress={() => scrollTo('faq')}><Text style={nav.link}>FAQ</Text></Pressable>
            <View style={nav.divider} />
            <Pressable onPress={() => scrollTo('coaches')}><Text style={[nav.link, { color: C.green }]}>For Coaches</Text></Pressable>
            <Pressable onPress={goLogin}><Text style={nav.signIn}>Sign In</Text></Pressable>
          </View>
        )}
      </View>
      {menuOpen && isMobile && (
        <View style={nav.mobile}>
          <Pressable onPress={() => { scrollTo('how'); setMenuOpen(false); }}><Text style={nav.mLink}>How It Works</Text></Pressable>
          <Pressable onPress={() => { scrollTo('why'); setMenuOpen(false); }}><Text style={nav.mLink}>Why GoArrive</Text></Pressable>
          <Pressable onPress={() => { scrollTo('faq'); setMenuOpen(false); }}><Text style={nav.mLink}>FAQ</Text></Pressable>
          <Pressable onPress={() => { scrollTo('coaches'); setMenuOpen(false); }}><Text style={[nav.mLink, { color: C.green }]}>For Coaches</Text></Pressable>
          <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
          <Pressable onPress={() => { goLogin(); setMenuOpen(false); }}><Text style={[nav.mLink, { color: C.gold }]}>Sign In</Text></Pressable>
        </View>
      )}
    </View>
  );

  /* ─── HERO ─── */
  const Hero = (
    <View style={[hero.wrap, { paddingTop: heroTopPad, paddingBottom: isMobile ? 70 : 100 }]}>
      <View style={hero.glow} />
      <View style={hero.inner}>
        <Text style={[hero.headline, isMobile && { fontSize: 36, lineHeight: 43 }]}>
          A Coach in Your Pocket
        </Text>
        <Text style={[hero.sub, isMobile && { fontSize: 17 }]}>
          Personal training — designed by a real coach,{'\n'}
          delivered through your phone, built around your life.
        </Text>
        <CtaButton label="Find Your Coach" onPress={goStart} />
        <Text style={hero.trust}>Takes 2 minutes. No commitment required.</Text>
      </View>
    </View>
  );

  /* ─── WHAT YOU GET ─── */
  const valueProps = [
    {
      title: 'Your Plan, Built for You',
      body: 'Your coach designs a program around your goals, your schedule, and your experience level. Every workout has a purpose. Nothing is generic.',
    },
    {
      title: 'A Coach in Your Corner',
      body: 'You are paired with a real coach who reviews your progress, adjusts your program, and keeps you moving forward. This is not an algorithm — it is a person who knows your name.',
    },
    {
      title: 'Accountability That Sticks',
      body: 'Check-ins, session reminders, and post-workout reflections keep you honest. Your coach sees how you are doing and follows up when it matters.',
    },
  ];

  const WhatYouGet = (
    <View style={wyg.wrap}>
      <View style={wyg.inner}>
        <Text style={[wyg.heading, isMobile && { fontSize: 28 }]}>
          What you get with GoArrive
        </Text>
        {valueProps.map((v, i) => (
          <View key={i} style={wyg.block}>
            <View style={[wyg.accent, { backgroundColor: i === 0 ? C.gold : i === 1 ? C.green : C.blue }]} />
            <Text style={wyg.blockTitle}>{v.title}</Text>
            <Text style={wyg.blockBody}>{v.body}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  /* ─── HOW IT WORKS ─── */
  const steps = [
    { num: '1', title: 'Tell us your goals', body: 'Complete a short intake about your fitness background, goals, and schedule. It takes about two minutes.' },
    { num: '2', title: 'Get matched with a coach', body: 'A GoArrive coach reviews your intake and builds a personalized program designed specifically for you.' },
    { num: '3', title: 'Start training', body: 'Follow your program with video-guided workouts, check in with your coach, and see real progress over time.' },
  ];

  const HowItWorks = (
    <View style={hiw.wrap} onLayout={mark('how')}>
      <View style={hiw.inner}>
        <Text style={[hiw.heading, isMobile && { fontSize: 28 }]}>How it works</Text>
        <View style={[hiw.steps, isMobile && { flexDirection: 'column', gap: 32 }]}>
          {steps.map((step, i) => (
            <View key={i} style={[hiw.step, !isMobile && { flex: 1 }]}>
              <Text style={hiw.num}>{step.num}</Text>
              <Text style={hiw.stepTitle}>{step.title}</Text>
              <Text style={hiw.stepBody}>{step.body}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── WHY GOARRIVE ─── */
  const reasons = [
    { title: 'Coached, not automated', body: 'Every program is designed by a real person. Your coach adapts your plan as you progress — not a template, not an algorithm.' },
    { title: 'Consistent accountability', body: 'Your coach checks in, follows up, and keeps you on track. The structure is built to help you stay consistent when motivation fades.' },
    { title: 'A premium experience', body: 'From video-guided workouts to seamless scheduling to post-session reflections — every detail is designed to feel personal and polished.' },
  ];

  const WhyGA = (
    <View style={why.wrap} onLayout={mark('why')}>
      <View style={why.inner}>
        <Text style={[why.heading, isMobile && { fontSize: 28 }]}>Why GoArrive</Text>
        <Text style={why.sub}>
          The difference between a workout plan and real coaching is a person who cares about your progress.
        </Text>
        {reasons.map((r, i) => (
          <View key={i} style={why.row}>
            <Text style={why.rowTitle}>{r.title}</Text>
            <Text style={why.rowBody}>{r.body}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  /* ─── TRUST / TESTIMONIAL ─── */
  const Trust = (
    <View style={tr.wrap}>
      <View style={tr.inner}>
        <View style={tr.card}>
          <Text style={tr.quote}>
            "I tried apps. I tried YouTube programs. Nothing stuck until I had a real coach who actually knew what I was working with. GoArrive changed how I show up."
          </Text>
          <Text style={tr.attr}>— GoArrive Member</Text>
        </View>
      </View>
    </View>
  );

  /* ─── MEMBER CTA ─── */
  const MemberCta = (
    <View style={mcta.wrap}>
      <View style={mcta.inner}>
        <Text style={[mcta.heading, isMobile && { fontSize: 28 }]}>
          Ready to train with a real coach?
        </Text>
        <Text style={mcta.sub}>
          It takes two minutes to get started. Tell us about your goals and we will match you with a coach who builds your plan from scratch.
        </Text>
        <CtaButton label="Find Your Coach" onPress={goStart} />
        <Text style={mcta.trust}>No spam. No commitment. Just a plan built for you.</Text>
      </View>
    </View>
  );

  /* ─── FOR COACHES (secondary) ─── */
  const CoachSection = (
    <View style={cch.wrap} onLayout={mark('coaches')}>
      <View style={cch.rule} />
      <View style={cch.inner}>
        <Text style={cch.label}>FOR COACHES</Text>
        <Text style={[cch.heading, isMobile && { fontSize: 26 }]}>
          Coach with GoArrive
        </Text>
        <Text style={cch.body}>
          GoArrive is building a team of dedicated coaches who take their craft seriously.
          We provide the infrastructure — programming tools, scheduling, payments,
          and a premium member experience — so you can focus entirely on coaching.
        </Text>
        <Text style={cch.body}>
          Coach positions are selective. If you are a qualified fitness coach
          looking for a professional home with real structure and growth potential,
          we would like to hear from you.
        </Text>
        <CoachCtaButton label="Apply to Coach" onPress={goCoachApply} />
      </View>
    </View>
  );

  /* ─── FAQ ─── */
  const faqs = [
    { q: 'What is GoArrive?', a: 'GoArrive is a premium online fitness coaching company. We pair you with a dedicated coach who builds a personalized workout program around your goals and keeps you accountable over time.' },
    { q: 'How is this different from a fitness app?', a: 'Fitness apps give you generic workouts. GoArrive gives you a real coach who designs your program, reviews your progress, and adjusts your plan as you grow. The technology makes the coaching experience seamless — but the coaching is human.' },
    { q: 'What does the coaching include?', a: 'A personalized workout program with video-guided movements, regular coach check-ins, live session scheduling, post-workout reflections, and ongoing program adjustments based on your progress.' },
    { q: 'How do I get started?', a: 'Complete a short intake form — it takes about two minutes. A GoArrive coach will review your information and reach out to get your coaching plan started.' },
    { q: 'How are payments handled?', a: 'Payments are processed securely through Stripe. You subscribe to a coaching plan and billing is handled automatically. No invoices, no awkward transactions.' },
    { q: 'Can I try it before committing long-term?', a: 'Yes. Start with the intake and connect with your coach. There is no long-term contract required to get started.' },
  ];

  const FaqSection = (
    <View style={fq.wrap} onLayout={mark('faq')}>
      <View style={fq.inner}>
        <Text style={[fq.heading, isMobile && { fontSize: 28 }]}>Frequently asked questions</Text>
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

  /* ─── FOOTER ─── */
  const Footer = (
    <View style={ft.wrap}>
      <View style={ft.inner}>
        <Image source={require('../../assets/logo.png')} style={ft.logo} resizeMode="contain" />
        <Text style={ft.tagline}>Premium online fitness coaching.</Text>
        <View style={[ft.links, isMobile && { flexDirection: 'column', gap: 8 }]}>
          <Pressable onPress={() => scrollTo('how')}><Text style={ft.link}>How It Works</Text></Pressable>
          <Pressable onPress={() => scrollTo('why')}><Text style={ft.link}>Why GoArrive</Text></Pressable>
          <Pressable onPress={() => scrollTo('faq')}><Text style={ft.link}>FAQ</Text></Pressable>
          <Pressable onPress={() => scrollTo('coaches')}><Text style={ft.link}>For Coaches</Text></Pressable>
          <Pressable onPress={goLogin}><Text style={ft.link}>Sign In</Text></Pressable>
          <Pressable onPress={() => Linking.openURL('mailto:support@goa.fit')}><Text style={ft.link}>Contact</Text></Pressable>
        </View>
      </View>
      <View style={ft.bottom}>
        <Text style={ft.legal}>© {new Date().getFullYear()} GoArrive. All rights reserved.</Text>
        <Text style={ft.desc}>GoArrive is a premium online fitness coaching company providing personalized coaching programs, dedicated coach guidance, and a technology-enabled member experience. Payments processed securely via Stripe.</Text>
      </View>
    </View>
  );

  /* ━━━ RENDER ━━━ */
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }} onLayout={onLayout}>
      {Nav}
      <ScrollView ref={scrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {Hero}
        {WhatYouGet}
        {HowItWorks}
        {WhyGA}
        {Trust}
        {MemberCta}
        {CoachSection}
        {FaqSection}
        {Footer}
      </ScrollView>
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STYLES
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ─ Shared ─ */
const s = StyleSheet.create({
  ctaBtn: {
    backgroundColor: C.gold,
    paddingHorizontal: 36,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'center',
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 24px ${C.goldGlow}, 0 4px 12px rgba(0,0,0,0.3)`,
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    } as any : {}),
  },
  ctaBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: C.dark,
    fontFamily: FONT_H,
    letterSpacing: 0.3,
  },
  coachCtaBtn: {
    backgroundColor: C.green,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'center',
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 20px ${C.greenGlow}, 0 4px 12px rgba(0,0,0,0.3)`,
    } as any : {}),
  },
  coachCtaBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: C.white,
    fontFamily: FONT_H,
  },
});

/* ─ Nav ─ */
const nav = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(15,17,23,0.94)',
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' } as any : {}),
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignSelf: 'center',
    width: '100%' as any,
  },
  logo: { width: 130, height: 30 },
  links: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  link: { fontSize: 14, fontWeight: '500', color: C.textSoft, fontFamily: FONT_B },
  divider: { width: 1, height: 16, backgroundColor: C.border, marginHorizontal: 4 },
  signIn: { fontSize: 14, fontWeight: '600', color: C.text, fontFamily: FONT_B },
  burger: { fontSize: 22, color: C.text },
  mobile: { paddingHorizontal: 24, paddingBottom: 20, gap: 14, borderBottomWidth: 1, borderBottomColor: C.borderSub },
  mLink: { fontSize: 16, fontWeight: '500', color: C.textSoft, fontFamily: FONT_B, paddingVertical: 2 },
});

/* ─ Hero ─ */
const hero = StyleSheet.create({
  wrap: {
    paddingHorizontal: 24,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: 20,
    width: 480,
    height: 480,
    borderRadius: 240,
    backgroundColor: 'rgba(245,166,35,0.04)',
    alignSelf: 'center',
  },
  inner: {
    alignItems: 'center',
    maxWidth: 640,
    zIndex: 1,
  },
  headline: {
    fontSize: 48,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 56,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  sub: {
    fontSize: 19,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 40,
  },
  trust: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    marginTop: 16,
  },
});

/* ─ What You Get ─ */
const wyg = StyleSheet.create({
  wrap: {
    paddingTop: 100,
    paddingBottom: 100,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%' as any,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 56,
  },
  block: {
    marginBottom: 48,
    paddingLeft: 20,
    borderLeftWidth: 0,
  },
  accent: {
    width: 32,
    height: 3,
    borderRadius: 2,
    marginBottom: 16,
  },
  blockTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 10,
  },
  blockBody: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 26,
  },
});

/* ─ How It Works ─ */
const hiw = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
  },
  inner: {
    maxWidth: 880,
    alignSelf: 'center',
    width: '100%' as any,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 56,
  },
  steps: {
    flexDirection: 'row',
    gap: 48,
  },
  step: {
    alignItems: 'center',
  },
  num: {
    fontSize: 40,
    fontWeight: '700',
    color: C.gold,
    fontFamily: FONT_H,
    marginBottom: 12,
    opacity: 0.6,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 10,
  },
  stepBody: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 24,
  },
});

/* ─ Why GoArrive ─ */
const why = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%' as any,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 16,
  },
  sub: {
    fontSize: 17,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 56,
  },
  row: {
    marginBottom: 40,
  },
  rowTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
  },
  rowBody: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 26,
  },
});

/* ─ Trust ─ */
const tr = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
  },
  inner: {
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%' as any,
  },
  card: {
    alignItems: 'center',
  },
  quote: {
    fontSize: 19,
    color: C.text,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 32,
    fontStyle: 'italic',
    marginBottom: 20,
  },
  attr: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
  },
});

/* ─ Member CTA ─ */
const mcta = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%' as any,
    alignItems: 'center',
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
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
  trust: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    marginTop: 16,
  },
});

/* ─ For Coaches ─ */
const cch = StyleSheet.create({
  wrap: {
    paddingTop: 60,
    paddingBottom: 80,
    paddingHorizontal: 24,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderColor: C.borderSub,
  },
  rule: {
    width: 40,
    height: 3,
    backgroundColor: C.green,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 40,
  },
  inner: {
    maxWidth: 540,
    alignSelf: 'center',
    width: '100%' as any,
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: C.green,
    fontFamily: FONT_H,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 20,
  },
  body: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 16,
  },
});

/* ─ FAQ ─ */
const fq = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 620,
    alignSelf: 'center',
    width: '100%' as any,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 40,
  },
  list: { gap: 10 },
  item: {
    backgroundColor: C.surface,
    borderRadius: 12,
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
    fontSize: 20,
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

/* ─ Footer ─ */
const ft = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: C.borderSub,
    paddingTop: 40,
    paddingHorizontal: 24,
    backgroundColor: C.bg,
  },
  inner: {
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%' as any,
    alignItems: 'center',
    paddingBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
  },
  logo: { width: 110, height: 26, marginBottom: 10 },
  tagline: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    marginBottom: 20,
  },
  links: {
    flexDirection: 'row',
    gap: 24,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  link: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
  },
  bottom: {
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%' as any,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  legal: {
    fontSize: 12,
    color: C.muted,
    fontFamily: FONT_B,
    opacity: 0.7,
  },
  desc: {
    fontSize: 11,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 500,
    opacity: 0.5,
  },
});
