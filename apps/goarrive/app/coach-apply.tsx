/**
 * Coach Application page — /coach-apply
 *
 * Full coach-facing landing page (mirrors the goarrive.fit coach landing)
 * with all CTAs leading to the application form at the bottom.
 * Public page — no auth required.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Image,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { router } from 'expo-router';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

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
  red:       '#E05252',
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

/* ─── CTA Button ─── */
function CtaButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [btn.cta, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
      onPress={onPress}
    >
      <Text style={btn.ctaText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [btn.secondary, pressed && { opacity: 0.88 }]}
      onPress={onPress}
    >
      <Text style={btn.secondaryText}>{label}</Text>
    </Pressable>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function CoachApplyScreen() {
  const { w, onLayout } = useWidth();
  const isMobile = w < 768;
  const scrollRef = useRef<ScrollView>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /* ─── Form State ─── */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [experience, setExperience] = useState('');
  const [certifications, setCertifications] = useState('');
  const [why, setWhy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  /* ─── Section offsets ─── */
  const offsets = useRef<Record<string, number>>({});
  const scrollTo = (key: string) => {
    const y = offsets.current[key];
    if (y != null && scrollRef.current) scrollRef.current.scrollTo({ y: y - 70, animated: true });
  };
  const mark = (key: string) => (e: LayoutChangeEvent) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };

  const goApply = () => scrollTo('apply');
  const goHome = () => router.replace('/');
  const goLogin = () => router.push('/(auth)/login');

  /* ─── Submit ─── */
  async function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      setError('Please fill in at least your name and email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'coachApplications'), {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        experience: experience.trim(),
        certifications: certifications.trim(),
        why: why.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setSuccess(true);
    } catch (err: any) {
      setError('Something went wrong. Please try again or email coaches@goa.fit directly.');
    } finally {
      setLoading(false);
    }
  }

  /* ━━━ NAV ━━━ */
  const Nav = (
    <View style={[nav.bar, Platform.OS === 'web' && ({ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 } as any)]}>
      <View style={[nav.inner, { maxWidth: 1080 }]}>
        <Pressable onPress={goHome}>
          <Image source={require('../assets/logo.png')} style={nav.logo} resizeMode="contain" accessibilityLabel="GoArrive" />
        </Pressable>
        {isMobile ? (
          <Pressable onPress={() => setMenuOpen(!menuOpen)} hitSlop={12}>
            <Text style={nav.burger}>{menuOpen ? '\u2715' : '\u2630'}</Text>
          </Pressable>
        ) : (
          <View style={nav.links}>
            <Pressable onPress={() => scrollTo('features')}><Text style={nav.link}>Features</Text></Pressable>
            <Pressable onPress={() => scrollTo('how')}><Text style={nav.link}>How It Works</Text></Pressable>
            <Pressable onPress={() => scrollTo('pricing')}><Text style={nav.link}>Pricing</Text></Pressable>
            <Pressable onPress={() => scrollTo('faq')}><Text style={nav.link}>FAQ</Text></Pressable>
            <View style={nav.divider} />
            <Pressable onPress={goApply}><Text style={[nav.link, { color: C.green }]}>Apply Now</Text></Pressable>
            <Pressable onPress={goLogin}><Text style={nav.signIn}>Sign In</Text></Pressable>
          </View>
        )}
      </View>
      {menuOpen && isMobile && (
        <View style={nav.mobile}>
          <Pressable onPress={() => { scrollTo('features'); setMenuOpen(false); }}><Text style={nav.mLink}>Features</Text></Pressable>
          <Pressable onPress={() => { scrollTo('how'); setMenuOpen(false); }}><Text style={nav.mLink}>How It Works</Text></Pressable>
          <Pressable onPress={() => { scrollTo('pricing'); setMenuOpen(false); }}><Text style={nav.mLink}>Pricing</Text></Pressable>
          <Pressable onPress={() => { scrollTo('faq'); setMenuOpen(false); }}><Text style={nav.mLink}>FAQ</Text></Pressable>
          <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
          <Pressable onPress={() => { goApply(); setMenuOpen(false); }}><Text style={[nav.mLink, { color: C.green }]}>Apply Now</Text></Pressable>
          <Pressable onPress={() => { goLogin(); setMenuOpen(false); }}><Text style={[nav.mLink, { color: C.gold }]}>Sign In</Text></Pressable>
        </View>
      )}
    </View>
  );

  /* ━━━ HERO ━━━ */
  const Hero = (
    <View style={[hero.wrap, { paddingTop: isMobile ? 110 : 150, paddingBottom: isMobile ? 70 : 100 }]}>
      <View style={hero.glow} />
      <View style={hero.inner}>
        <Text style={hero.tag}>Online Fitness Coaching Platform</Text>
        <Text style={[hero.headline, isMobile && { fontSize: 34, lineHeight: 41 }]}>
          Your Coaching Business,{'\n'}All in One Place
        </Text>
        <Text style={[hero.sub, isMobile && { fontSize: 16 }]}>
          Build workouts, manage members, handle payments, and deliver a premium experience — all from one platform designed for independent fitness coaches.
        </Text>
        <CtaButton label="Launch Your Coaching Business" onPress={goApply} />
        <SecondaryButton label="See How It Works" onPress={() => scrollTo('how')} />
        <Text style={hero.trust}>No credit card required  ·  Free to get started  ·  Cancel anytime</Text>
      </View>
    </View>
  );

  /* ━━━ VALUE PROPS BAR ━━━ */
  const valueProps = [
    { bold: 'All-in-One', rest: 'Coaching Platform' },
    { bold: 'Zero', rest: 'Tech Headaches' },
    { bold: 'Premium', rest: 'Member Experience' },
    { bold: '100%', rest: 'Your Brand' },
  ];

  const ValueBar = (
    <View style={vb.wrap}>
      <View style={[vb.inner, isMobile && { flexDirection: 'column', gap: 12 }]}>
        {valueProps.map((v, i) => (
          <View key={i} style={vb.item}>
            <Text style={[vb.bold, { color: i === 0 ? C.gold : i === 1 ? C.green : i === 2 ? C.blue : C.gold }]}>{v.bold}</Text>
            <Text style={vb.rest}>{v.rest}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  /* ━━━ THE PROBLEM ━━━ */
  const problems = [
    { title: 'Tool Overload', body: 'Juggling between apps wastes hours every week that should be spent coaching.' },
    { title: 'Revenue Leakage', body: 'Manual invoicing and disconnected payments mean missed revenue and awkward follow-ups.' },
    { title: 'Generic Experience', body: 'Your members get a cookie-cutter experience instead of the premium, branded coaching they deserve.' },
  ];

  const Problem = (
    <View style={prob.wrap}>
      <View style={prob.inner}>
        <Text style={prob.label}>THE PROBLEM</Text>
        <Text style={[prob.heading, isMobile && { fontSize: 28 }]}>Coaches Deserve{'\n'}Better Tools</Text>
        <Text style={prob.body}>
          Right now, most independent fitness coaches are duct-taping together 5+ tools just to run their business. One app for workouts, another for payments, a spreadsheet for member tracking, a calendar app for scheduling, and DMs for communication. It is fragmented, frustrating, and it is holding you back.
        </Text>
        <View style={[prob.cards, isMobile && { flexDirection: 'column' }]}>
          {problems.map((p, i) => (
            <View key={i} style={[prob.card, !isMobile && { flex: 1 }]}>
              <Text style={prob.cardTitle}>{p.title}</Text>
              <Text style={prob.cardBody}>{p.body}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ━━━ FEATURES ━━━ */
  const features = [
    { title: 'Workout Builder', body: 'Build professional workout programs with a drag-and-drop block canvas. Organize movements into sets, supersets, and circuits. Your movement library grows with every upload — AI auto-analyzes each one.' },
    { title: 'Member Management', body: 'Onboard new members with beautiful intake forms. Manage plans, track progress, and keep every detail organized in one place. Members see a premium, coach-branded experience.' },
    { title: 'Scheduling & Sessions', body: 'Set your availability, let members book sessions, and sync everything to Google Calendar. Zoom rooms are auto-assigned. Automated reminders keep no-shows near zero.' },
    { title: 'Payments & Billing', body: 'Get paid seamlessly with Stripe Connect. Members subscribe to plans, payments process automatically, and you see every dollar on your earnings dashboard. No chasing invoices.' },
    { title: 'Command Center', body: 'Your dashboard tells you what needs attention today — new sign-ups, upcoming sessions, members who need a check-in, and recent workout completions. Coach smarter, not harder.' },
    { title: 'Plans & Programs', body: 'Create tiered coaching plans with custom pricing. The built-in pricing engine handles plan selection, checkout, and subscription management so you can focus on delivering results.' },
  ];

  const Features = (
    <View style={feat.wrap} onLayout={mark('features')}>
      <View style={feat.inner}>
        <Text style={feat.label}>FEATURES</Text>
        <Text style={[feat.heading, isMobile && { fontSize: 28 }]}>Everything You Need{'\n'}to Coach Online</Text>
        <Text style={feat.sub}>
          GoArrive replaces your scattered toolkit with one integrated platform. Every feature is designed to help you spend more time coaching and less time on admin.
        </Text>
        <View style={[feat.grid, isMobile && { flexDirection: 'column' }]}>
          {features.map((f, i) => (
            <View key={i} style={[feat.card, !isMobile && { width: '48%' as any }]}>
              <Text style={feat.cardTitle}>{f.title}</Text>
              <Text style={feat.cardBody}>{f.body}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ━━━ HOW IT WORKS ━━━ */
  const steps = [
    { num: '01', title: 'Set Up Your Profile', body: 'Create your coach account, connect Stripe for payments, set your availability, and upload your movement library. Your branded coaching business is ready in minutes.' },
    { num: '02', title: 'Build Your Program', body: 'Design workout programs using the visual builder. Create coaching plans with custom pricing. Set up intake forms for new member onboarding. Everything your members need — built by you.' },
    { num: '03', title: 'Grow Your Business', body: 'Share your intake link, onboard members, deliver incredible coaching, and get paid automatically. GoArrive handles the operations so you can focus on what you do best — coaching.' },
  ];

  const HowItWorks = (
    <View style={hiw.wrap} onLayout={mark('how')}>
      <View style={hiw.inner}>
        <Text style={hiw.label}>HOW IT WORKS</Text>
        <Text style={[hiw.heading, isMobile && { fontSize: 28 }]}>Up and Running in{'\n'}Three Steps</Text>
        <Text style={hiw.sub}>
          GoArrive is designed to get you from sign-up to your first paying member as fast as possible.
        </Text>
        <View style={hiw.steps}>
          {steps.map((step, i) => (
            <View key={i} style={hiw.step}>
              <Text style={[hiw.num, { color: i === 0 ? C.green : i === 1 ? C.gold : C.green }]}>{step.num}</Text>
              <Text style={hiw.stepTitle}>{step.title}</Text>
              <Text style={hiw.stepBody}>{step.body}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ━━━ MEMBER EXPERIENCE ━━━ */
  const memberFeatures = [
    { title: 'Personalized Workout Plans', body: 'Members see their custom program — built by you — with clear daily instructions and progress tracking.' },
    { title: 'Video-Guided Movements', body: 'Every movement comes with video demonstrations so members always know proper form, even without you in the room.' },
    { title: 'Post-Workout Journaling', body: 'After every workout, members reflect with the Glow/Grow journal — what went well and where to improve. You see every entry.' },
    { title: 'Smart Reminders', body: 'Automated session reminders and workout nudges keep your members accountable without you lifting a finger.' },
  ];

  const MemberExp = (
    <View style={mex.wrap} onLayout={mark('experience')}>
      <View style={mex.inner}>
        <Text style={[mex.heading, isMobile && { fontSize: 26 }]}>
          A Premium Experience{'\n'}That Keeps Members Coming Back
        </Text>
        <Text style={mex.sub}>
          When you coach on GoArrive, your members get a world-class experience that makes them feel supported, motivated, and connected to you — their coach.
        </Text>
        <View style={[mex.cards, isMobile && { flexDirection: 'column' }]}>
          {memberFeatures.map((f, i) => (
            <View key={i} style={[mex.card, !isMobile && { width: '48%' as any }]}>
              <Text style={mex.cardTitle}>{f.title}</Text>
              <Text style={mex.cardBody}>{f.body}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ━━━ TESTIMONIAL ━━━ */
  const Testimonial = (
    <View style={tst.wrap}>
      <View style={tst.inner}>
        <View style={tst.card}>
          <Text style={tst.quoteIcon}>{'\u201C'}</Text>
          <Text style={tst.quote}>
            GoArrive gives independent coaches the same operational power that big box gyms have — scheduling, payments, workout delivery, member management — but in a platform built specifically for the way we work. One coach, one member at a time.
          </Text>
          <View style={tst.attrRow}>
            <View style={tst.avatar} />
            <View>
              <Text style={tst.attrName}>Built for Coaches, by a Coach</Text>
              <Text style={tst.attrRole}>The GoArrive Team</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  /* ━━━ PRICING ━━━ */
  const Pricing = (
    <View style={pr.wrap} onLayout={mark('pricing')}>
      <View style={pr.inner}>
        <Text style={pr.label}>PRICING</Text>
        <Text style={[pr.heading, isMobile && { fontSize: 28 }]}>Simple, Coach-First{'\n'}Pricing</Text>
        <Text style={pr.sub}>
          GoArrive operates on a franchise model inspired by Keller Williams. You run your business, we provide the platform. Pricing is based on your active member volume — start free and scale as you grow.
        </Text>

        <View style={[pr.tiers, isMobile && { flexDirection: 'column' }]}>
          {/* Starter */}
          <View style={[pr.tierCard, !isMobile && { flex: 1 }]}>
            <Text style={pr.tierName}>Starter</Text>
            <Text style={[pr.tierPrice, { color: C.gold }]}>Free</Text>
            <Text style={pr.tierSub}>to get started</Text>
            <View style={pr.tierFeatures}>
              {['Full workout builder', 'Up to 5 members', 'Movement library', 'Intake forms', 'Basic scheduling'].map((f, i) => (
                <View key={i} style={pr.tierFeatureRow}>
                  <Text style={[pr.check, { color: C.green }]}>{'\u2713'}</Text>
                  <Text style={pr.tierFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
            <Pressable style={btn.cta} onPress={goApply}>
              <Text style={btn.ctaText}>Get Started Free</Text>
            </Pressable>
          </View>

          {/* Growth */}
          <View style={[pr.tierCard, pr.tierCardHighlight, !isMobile && { flex: 1 }]}>
            <View style={pr.popularBadge}>
              <Text style={pr.popularText}>Most Popular</Text>
            </View>
            <Text style={pr.tierName}>Growth</Text>
            <Text style={[pr.tierPrice, { color: C.gold }]}>Tiered</Text>
            <Text style={pr.tierSub}>based on active members</Text>
            <View style={pr.tierFeatures}>
              {['Everything in Starter', 'Unlimited members', 'Stripe payments', 'Zoom integration', 'Google Calendar sync', 'Automated reminders', 'Earnings dashboard'].map((f, i) => (
                <View key={i} style={pr.tierFeatureRow}>
                  <Text style={[pr.check, { color: C.green }]}>{'\u2713'}</Text>
                  <Text style={pr.tierFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
            <Pressable style={btn.cta} onPress={goApply}>
              <Text style={btn.ctaText}>Apply Now</Text>
            </Pressable>
          </View>

          {/* Enterprise */}
          <View style={[pr.tierCard, !isMobile && { flex: 1 }]}>
            <Text style={pr.tierName}>Enterprise</Text>
            <Text style={[pr.tierPrice, { color: C.green }]}>Custom</Text>
            <Text style={pr.tierSub}>for coaching teams</Text>
            <View style={pr.tierFeatures}>
              {['Everything in Growth', 'Multi-coach support', 'Profit share & distributions', 'Priority support', 'Custom integrations'].map((f, i) => (
                <View key={i} style={pr.tierFeatureRow}>
                  <Text style={[pr.check, { color: C.green }]}>{'\u2713'}</Text>
                  <Text style={pr.tierFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
            <SecondaryButton label="Contact Us" onPress={goApply} />
          </View>
        </View>
      </View>
    </View>
  );

  /* ━━━ FAQ ━━━ */
  const faqs = [
    { q: 'What is GoArrive?', a: 'GoArrive is an all-in-one online fitness coaching platform. It gives independent coaches everything they need to run their business — workout programming, member management, scheduling, payments, and a premium branded experience for their members.' },
    { q: 'Who is GoArrive for?', a: 'GoArrive is built for independent fitness coaches who want a professional platform to run their coaching business. Whether you are just getting started or managing a full roster, GoArrive scales with you.' },
    { q: 'How does pricing work?', a: 'GoArrive uses a franchise-style pricing model. Start free with up to 5 members. As your business grows, pricing scales based on your active member count — so you only pay more as you earn more.' },
    { q: 'Can my members pay me through GoArrive?', a: 'Yes. GoArrive integrates with Stripe Connect so your members can subscribe to your coaching plans and payments process automatically. You see every dollar on your earnings dashboard — no chasing invoices.' },
    { q: 'Do I need to be technical to use GoArrive?', a: 'Not at all. GoArrive is designed to be intuitive. If you can send a text message, you can use GoArrive. The platform handles the technical complexity so you can focus on coaching.' },
    { q: 'What do my members see?', a: 'Your members get a premium, coach-branded experience. They see their personalized workout programs with video-guided movements, can book sessions, complete post-workout reflections, and receive automated reminders — all in one app.' },
    { q: 'Does GoArrive support video sessions?', a: 'Yes. GoArrive integrates with Zoom for live coaching sessions. Zoom rooms are auto-assigned, sessions sync to Google Calendar, and automated reminders keep no-shows near zero.' },
    { q: 'Can I try GoArrive before committing?', a: 'Yes. The Starter plan is completely free with up to 5 members. There is no credit card required and no long-term contract. Start building and see if GoArrive is the right fit for your coaching business.' },
  ];

  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const FaqSection = (
    <View style={fq.wrap} onLayout={mark('faq')}>
      <View style={fq.inner}>
        <Text style={fq.label}>FAQ</Text>
        <Text style={[fq.heading, isMobile && { fontSize: 28 }]}>Frequently Asked{'\n'}Questions</Text>
        <View style={fq.list}>
          {faqs.map((item, i) => (
            <Pressable key={i} style={fq.item} onPress={() => setOpenFaq(openFaq === i ? null : i)}>
              <View style={fq.qRow}>
                <Text style={fq.qText}>{item.q}</Text>
                <Text style={fq.chevron}>{openFaq === i ? '\u2212' : '+'}</Text>
              </View>
              {openFaq === i && <Text style={fq.aText}>{item.a}</Text>}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  /* ━━━ BOTTOM CTA ━━━ */
  const BottomCta = (
    <View style={mid.wrapAlt}>
      <View style={mid.inner}>
        <Text style={[mid.heading, isMobile && { fontSize: 28 }]}>
          Ready to Elevate{'\n'}Your Coaching?
        </Text>
        <Text style={mid.sub}>
          Join GoArrive and give your members the premium experience they deserve — while building the coaching business you have always wanted.
        </Text>
        <CtaButton label="Get Started Free" onPress={goApply} />
        <View style={{ marginTop: 12 }}>
          <SecondaryButton label="Contact Us" onPress={goApply} />
        </View>
      </View>
    </View>
  );

  /* ━━━ APPLICATION FORM ━━━ */
  const ApplicationForm = (
    <View style={form.wrap} onLayout={mark('apply')}>
      <View style={form.rule} />
      <View style={form.inner}>
        <Text style={form.label}>APPLY NOW</Text>
        <Text style={[form.heading, isMobile && { fontSize: 26 }]}>Apply to Coach with GoArrive</Text>
        <Text style={form.sub}>
          We are selectively growing our coaching team. Tell us about yourself and we will be in touch.
        </Text>

        {success ? (
          <View style={form.successWrap}>
            <Text style={form.successIcon}>&#x2713;</Text>
            <Text style={form.successTitle}>Application Received</Text>
            <Text style={form.successBody}>
              Thank you for your interest in coaching with GoArrive. We review every application personally and will be in touch soon.
            </Text>
            <Pressable style={btn.cta} onPress={goHome}>
              <Text style={btn.ctaText}>Back to Home</Text>
            </Pressable>
          </View>
        ) : (
          <View style={form.card}>
            <View style={form.fieldWrap}>
              <Text style={form.fieldLabel}>Full Name *</Text>
              <TextInput
                style={form.input}
                placeholder="Your full name"
                placeholderTextColor="#4A5568"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            <View style={form.fieldWrap}>
              <Text style={form.fieldLabel}>Email Address *</Text>
              <TextInput
                style={form.input}
                placeholder="your@email.com"
                placeholderTextColor="#4A5568"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            <View style={form.fieldWrap}>
              <Text style={form.fieldLabel}>Phone Number</Text>
              <TextInput
                style={form.input}
                placeholder="(optional)"
                placeholderTextColor="#4A5568"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                editable={!loading}
              />
            </View>

            <View style={form.fieldWrap}>
              <Text style={form.fieldLabel}>Coaching Experience</Text>
              <TextInput
                style={[form.input, form.textArea]}
                placeholder="How long have you been coaching? What kind of coaching do you do?"
                placeholderTextColor="#4A5568"
                value={experience}
                onChangeText={setExperience}
                multiline
                numberOfLines={3}
                editable={!loading}
              />
            </View>

            <View style={form.fieldWrap}>
              <Text style={form.fieldLabel}>Certifications</Text>
              <TextInput
                style={form.input}
                placeholder="e.g. NASM-CPT, CSCS, etc. (optional)"
                placeholderTextColor="#4A5568"
                value={certifications}
                onChangeText={setCertifications}
                editable={!loading}
              />
            </View>

            <View style={form.fieldWrap}>
              <Text style={form.fieldLabel}>Why GoArrive?</Text>
              <TextInput
                style={[form.input, form.textArea]}
                placeholder="What interests you about coaching with GoArrive?"
                placeholderTextColor="#4A5568"
                value={why}
                onChangeText={setWhy}
                multiline
                numberOfLines={3}
                editable={!loading}
              />
            </View>

            {error ? (
              <View style={form.errorBanner}>
                <Text style={form.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[btn.cta, loading && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={C.dark} size="small" />
              ) : (
                <Text style={btn.ctaText}>Submit Application</Text>
              )}
            </Pressable>

            <Text style={form.note}>
              We review every application personally. Coach positions are selective.
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  /* ━━━ FOOTER ━━━ */
  const Footer = (
    <View style={ft.wrap}>
      <View style={ft.inner}>
        <Image source={require('../assets/logo.png')} style={ft.logo} resizeMode="contain" />
        <Text style={ft.tagline}>The all-in-one platform for independent fitness coaches.{'\n'}Build workouts, manage members, get paid — all in one place.</Text>
        <View style={[ft.columns, isMobile && { flexDirection: 'column', gap: 24 }]}>
          <View style={ft.col}>
            <Text style={ft.colTitle}>Platform</Text>
            <Pressable onPress={() => scrollTo('features')}><Text style={ft.link}>Features</Text></Pressable>
            <Pressable onPress={() => scrollTo('pricing')}><Text style={ft.link}>Pricing</Text></Pressable>
            <Pressable onPress={() => scrollTo('how')}><Text style={ft.link}>How It Works</Text></Pressable>
            <Pressable onPress={() => scrollTo('faq')}><Text style={ft.link}>FAQ</Text></Pressable>
          </View>
          <View style={ft.col}>
            <Text style={ft.colTitle}>Company</Text>
            <Pressable onPress={goApply}><Text style={ft.link}>Apply to Coach</Text></Pressable>
            <Pressable onPress={goHome}><Text style={ft.link}>Home</Text></Pressable>
          </View>
          <View style={ft.col}>
            <Text style={ft.colTitle}>Get Started</Text>
            <Pressable onPress={goLogin}><Text style={ft.link}>Sign In</Text></Pressable>
            <Pressable onPress={goApply}><Text style={ft.link}>Create Account</Text></Pressable>
          </View>
        </View>
      </View>
      <View style={ft.bottom}>
        <Text style={ft.legal}>&copy; {new Date().getFullYear()} GoArrive. All rights reserved.</Text>
        <Text style={ft.desc}>GoArrive is an online fitness coaching platform providing workout programming tools, member management, scheduling, payments, and a premium branded member experience for independent fitness coaches.</Text>
      </View>
    </View>
  );

  /* ━━━ RENDER ━━━ */
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }} onLayout={onLayout}>
        {Nav}
        <ScrollView ref={scrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {Hero}
          {ValueBar}
          {Problem}
          {Features}
          {HowItWorks}
          {MemberExp}
          {Testimonial}
          {Pricing}
          {FaqSection}
          {BottomCta}
          {ApplicationForm}
          {Footer}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STYLES
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ─ Buttons ─ */
const btn = StyleSheet.create({
  cta: {
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
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: C.dark,
    fontFamily: FONT_H,
    letterSpacing: 0.3,
  },
  secondary: {
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 14,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
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
  tag: {
    fontSize: 13,
    fontWeight: '600',
    color: C.green,
    fontFamily: FONT_H,
    letterSpacing: 1,
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(123,160,91,0.3)',
    borderRadius: 20,
    overflow: 'hidden',
  },
  headline: {
    fontSize: 44,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 52,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  sub: {
    fontSize: 18,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 36,
  },
  trust: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    marginTop: 20,
  },
});

/* ─ Value Bar ─ */
const vb = StyleSheet.create({
  wrap: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
  },
  inner: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%' as any,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bold: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT_H,
  },
  rest: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
  },
});

/* ─ Problem ─ */
const prob = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%' as any,
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: C.blue,
    fontFamily: FONT_H,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  heading: {
    fontSize: 32,
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
    marginBottom: 48,
    maxWidth: 600,
  },
  cards: {
    flexDirection: 'row',
    gap: 16,
    width: '100%' as any,
  },
  card: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  cardBody: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 22,
  },
});

/* ─ Features ─ */
const feat = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
  },
  inner: {
    maxWidth: 780,
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
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 16,
  },
  sub: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 48,
    maxWidth: 600,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  cardBody: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 22,
  },
});

/* ─ How It Works ─ */
const hiw = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 600,
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
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 16,
  },
  sub: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 48,
  },
  steps: {
    gap: 40,
    width: '100%' as any,
  },
  step: {
    flexDirection: 'column',
    gap: 8,
  },
  num: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: FONT_H,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  stepBody: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 24,
  },
});

/* ─ Member Experience ─ */
const mex = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
  },
  inner: {
    maxWidth: 780,
    alignSelf: 'center',
    width: '100%' as any,
    alignItems: 'center',
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 16,
  },
  sub: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 48,
    maxWidth: 600,
  },
  cards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  cardBody: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 22,
  },
});

/* ─ Mid CTA ─ */
/* ─ Testimonial ─ */
const tst = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 620,
    alignSelf: 'center',
    width: '100%' as any,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 32,
    borderWidth: 2,
    borderColor: C.gold,
  },
  quoteIcon: {
    fontSize: 36,
    color: C.green,
    fontFamily: FONT_H,
    marginBottom: 16,
  },
  quote: {
    fontSize: 18,
    color: C.text,
    fontFamily: FONT_B,
    lineHeight: 30,
    fontStyle: 'italic',
    marginBottom: 24,
  },
  attrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: C.gold,
    backgroundColor: C.surface,
  },
  attrName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  attrRole: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
  },
});

/* ─ Pricing ─ */
const pr = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
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
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: C.blue,
    fontFamily: FONT_H,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
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
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 48,
    maxWidth: 600,
  },
  tiers: {
    flexDirection: 'row',
    gap: 20,
    width: '100%' as any,
  },
  tierCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    gap: 6,
  },
  tierCardHighlight: {
    borderColor: C.gold,
    borderWidth: 2,
  },
  popularBadge: {
    backgroundColor: C.gold,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  popularText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.dark,
    fontFamily: FONT_H,
  },
  tierName: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  tierPrice: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: FONT_H,
  },
  tierSub: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
    marginBottom: 16,
  },
  tierFeatures: {
    gap: 12,
    width: '100%' as any,
    marginBottom: 24,
  },
  tierFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
  tierFeatureText: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
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
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: C.blue,
    fontFamily: FONT_H,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 16,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 40,
  },
  list: { gap: 12 },
  item: {
    backgroundColor: C.card,
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

/* ─ Mid / Bottom CTA ─ */
const mid = StyleSheet.create({
  wrap: {
    paddingVertical: 100,
    paddingHorizontal: 24,
  },
  wrapAlt: {
    paddingVertical: 100,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
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
});

/* ─ Application Form ─ */
const form = StyleSheet.create({
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
    marginBottom: 12,
  },
  sub: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    maxWidth: 400,
  },
  card: {
    width: '100%' as any,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  fieldWrap: { gap: 6 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: C.textSoft,
    fontFamily: FONT_B,
  },
  input: {
    backgroundColor: C.dark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    fontFamily: FONT_B,
    borderWidth: 1,
    borderColor: C.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  errorBanner: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
  },
  errorText: {
    fontSize: 13,
    color: C.red,
    fontFamily: FONT_B,
    lineHeight: 18,
  },
  note: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  successWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 16,
  },
  successIcon: {
    fontSize: 48,
    color: '#6EBB7A',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
  },
  successBody: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
    marginBottom: 8,
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
    alignItems: 'flex-start',
    paddingBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
  },
  logo: { width: 110, height: 26, marginBottom: 10 },
  tagline: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    marginBottom: 28,
    textAlign: 'left',
    lineHeight: 22,
    maxWidth: 300,
  },
  columns: {
    flexDirection: 'row',
    gap: 48,
    width: '100%' as any,
    marginBottom: 8,
  },
  col: {
    gap: 8,
  },
  colTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 4,
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
