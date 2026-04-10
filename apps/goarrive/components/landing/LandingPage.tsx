/**
 * LandingPage — GoArrive public homepage
 *
 * Full marketing landing page shown to unauthenticated visitors at the root URL.
 * Designed to satisfy Stripe's business verification requirements and serve as
 * the primary public face of GoArrive.
 *
 * Sections:
 *   1. Navigation bar
 *   2. Hero
 *   3. Trust / stats bar
 *   4. Problem statement
 *   5. Feature showcase (coach-focused)
 *   6. How it works
 *   7. Member experience
 *   8. Testimonials / social proof
 *   9. Pricing overview
 *  10. FAQ
 *  11. Final CTA
 *  12. Footer
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

function Divider() {
  return <View style={a.divider} />;
}

/* ─── Icon components (simple SVG-free shapes) ─── */
function FeatureIcon({ emoji }: { emoji: string }) {
  return (
    <View style={a.featureIcon}>
      <Text style={a.featureIconText}>{emoji}</Text>
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN COMPONENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function LandingPage() {
  const { w, onLayout } = useWidth();
  const isMobile = w < 768;
  const isTablet = w >= 768 && w < 1024;
  const scrollRef = useRef<ScrollView>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const goLogin = () => router.push('/(auth)/login');
  const goSignup = () => router.push('/coach-signup');
  const goIntake = () => router.push('/intake');

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
            <Pressable onPress={() => scrollToSection('features')}><Text style={n.link}>Features</Text></Pressable>
            <Pressable onPress={() => scrollToSection('how-it-works')}><Text style={n.link}>How It Works</Text></Pressable>
            <Pressable onPress={() => scrollToSection('pricing')}><Text style={n.link}>Pricing</Text></Pressable>
            <Pressable onPress={() => scrollToSection('faq')}><Text style={n.link}>FAQ</Text></Pressable>
            <Pressable onPress={goLogin} style={n.signInBtn}><Text style={n.signInText}>Sign In</Text></Pressable>
            <PrimaryButton label="Get Started" onPress={goLogin} />
          </View>
        )}
      </View>
      {mobileMenuOpen && isMobile && (
        <View style={n.mobileMenu}>
          <Pressable onPress={() => { scrollToSection('features'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>Features</Text></Pressable>
          <Pressable onPress={() => { scrollToSection('how-it-works'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>How It Works</Text></Pressable>
          <Pressable onPress={() => { scrollToSection('pricing'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>Pricing</Text></Pressable>
          <Pressable onPress={() => { scrollToSection('faq'); setMobileMenuOpen(false); }}><Text style={n.mobileLink}>FAQ</Text></Pressable>
          <Divider />
          <Pressable onPress={() => { goLogin(); setMobileMenuOpen(false); }}><Text style={[n.mobileLink, { color: C.gold }]}>Sign In</Text></Pressable>
          <PrimaryButton label="Get Started" onPress={() => { goLogin(); setMobileMenuOpen(false); }} />
        </View>
      )}
    </View>
  );

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

  /* ─── 2. HERO ─── */
  const Hero = (
    <View style={[h.wrap, { paddingTop: isMobile ? 100 : 120, paddingBottom: isMobile ? 60 : 80 }]}>
      {/* Decorative gradient accent */}
      <View style={h.gradientOrb} />
      <View style={h.gradientOrb2} />

      <View style={[h.inner, { maxWidth: 800 }]}>
        <View style={h.badge}>
          <Text style={h.badgeText}>Online Fitness Coaching Platform</Text>
        </View>
        <Text style={[h.headline, isMobile && { fontSize: 36, lineHeight: 42 }]}>
          Your Coaching Business,{'\n'}All in One Place
        </Text>
        <Text style={[h.sub, isMobile && { fontSize: 16 }]}>
          Build workouts, manage members, handle payments, and deliver a premium
          experience — all from one platform designed for independent fitness coaches.
        </Text>
        <View style={[h.ctas, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
          <PrimaryButton label="Launch Your Coaching Business" onPress={goLogin} large />
          <SecondaryButton label="See How It Works" onPress={() => scrollToSection('how-it-works')} />
        </View>
        <Text style={h.trust}>No credit card required  ·  Free to get started  ·  Cancel anytime</Text>
      </View>
    </View>
  );

  /* ─── 3. STATS BAR ─── */
  const stats = [
    { value: 'All-in-One', label: 'Coaching Platform' },
    { value: 'Zero', label: 'Tech Headaches' },
    { value: 'Premium', label: 'Member Experience' },
    { value: '100%', label: 'Your Brand' },
  ];
  const StatsBar = (
    <View style={sb.wrap}>
      <View style={[sb.inner, isMobile && { flexDirection: 'column', gap: 20 }]}>
        {stats.map((s, i) => (
          <View key={i} style={[sb.stat, isMobile && { flexDirection: 'row', gap: 12 }]}>
            <Text style={sb.val}>{s.value}</Text>
            <Text style={sb.label}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  /* ─── 4. PROBLEM STATEMENT ─── */
  const ProblemSection = (
    <View style={p.wrap}>
      <View style={p.inner}>
        <SectionLabel text="THE PROBLEM" color={C.error} />
        <SectionTitle text="Coaches Deserve Better Tools" />
        <SectionSub text="Right now, most independent fitness coaches are duct-taping together 5+ tools just to run their business. One app for workouts, another for payments, a spreadsheet for member tracking, a calendar app for scheduling, and DMs for communication. It's fragmented, frustrating, and it's holding you back." />

        <View style={[p.painGrid, isMobile && { flexDirection: 'column' }]}>
          {[
            { icon: '😤', title: 'Tool Overload', desc: 'Juggling between apps wastes hours every week that should be spent coaching.' },
            { icon: '💸', title: 'Revenue Leakage', desc: 'Manual invoicing and disconnected payments mean missed revenue and awkward follow-ups.' },
            { icon: '😞', title: 'Generic Experience', desc: 'Your members get a cookie-cutter experience instead of the premium, branded coaching they deserve.' },
          ].map((item, i) => (
            <View key={i} style={[p.painCard, isMobile && { width: '100%' as any }]}>
              <Text style={p.painIcon}>{item.icon}</Text>
              <Text style={p.painTitle}>{item.title}</Text>
              <Text style={p.painDesc}>{item.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 5. FEATURES ─── */
  const features = [
    {
      icon: '🏋️',
      title: 'Workout Builder',
      desc: 'Build professional workout programs with a drag-and-drop block canvas. Organize movements into sets, supersets, and circuits. Your movement library grows with every upload — AI auto-analyzes each one.',
      color: C.green,
      bg: C.greenDim,
    },
    {
      icon: '👥',
      title: 'Member Management',
      desc: 'Onboard new members with beautiful intake forms. Manage plans, track progress, and keep every detail organized in one place. Members see a premium, coach-branded experience.',
      color: C.blue,
      bg: C.blueDim,
    },
    {
      icon: '📅',
      title: 'Scheduling & Sessions',
      desc: 'Set your availability, let members book sessions, and sync everything to Google Calendar. Zoom rooms are auto-assigned. Automated reminders keep no-shows near zero.',
      color: C.gold,
      bg: C.goldDim,
    },
    {
      icon: '💳',
      title: 'Payments & Billing',
      desc: 'Get paid seamlessly with Stripe Connect. Members subscribe to plans, payments process automatically, and you see every dollar on your earnings dashboard. No chasing invoices.',
      color: C.green,
      bg: C.greenDim,
    },
    {
      icon: '📊',
      title: 'Command Center',
      desc: 'Your dashboard tells you what needs attention today — new sign-ups, upcoming sessions, members who need a check-in, and recent workout completions. Coach smarter, not harder.',
      color: C.blue,
      bg: C.blueDim,
    },
    {
      icon: '🎯',
      title: 'Plans & Programs',
      desc: 'Create tiered coaching plans with custom pricing. The built-in pricing engine handles plan selection, checkout, and subscription management so you can focus on delivering results.',
      color: C.gold,
      bg: C.goldDim,
    },
  ];

  const FeaturesSection = (
    <View style={f.wrap} onLayout={onSectionLayout('features')}>
      <View style={f.inner}>
        <SectionLabel text="FEATURES" color={C.green} />
        <SectionTitle text="Everything You Need to Coach Online" />
        <SectionSub text="GoArrive replaces your scattered toolkit with one integrated platform. Every feature is designed to help you spend more time coaching and less time on admin." />

        <View style={[f.grid, isMobile && { flexDirection: 'column' }]}>
          {features.map((ft, i) => (
            <View key={i} style={[f.card, isMobile ? { width: '100%' as any } : { width: '30%' as any, minWidth: 280 }]}>
              <View style={[f.iconWrap, { backgroundColor: ft.bg }]}>
                <Text style={f.iconText}>{ft.icon}</Text>
              </View>
              <Text style={f.cardTitle}>{ft.title}</Text>
              <Text style={f.cardDesc}>{ft.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 6. HOW IT WORKS ─── */
  const steps = [
    {
      num: '01',
      title: 'Set Up Your Profile',
      desc: 'Create your coach account, connect Stripe for payments, set your availability, and upload your movement library. Your branded coaching business is ready in minutes.',
      color: C.green,
    },
    {
      num: '02',
      title: 'Build Your Program',
      desc: 'Design workout programs using the visual builder. Create coaching plans with custom pricing. Set up intake forms for new member onboarding. Everything your members need — built by you.',
      color: C.blue,
    },
    {
      num: '03',
      title: 'Grow Your Business',
      desc: 'Share your intake link, onboard members, deliver incredible coaching, and get paid automatically. GoArrive handles the operations so you can focus on what you do best — coaching.',
      color: C.gold,
    },
  ];

  const HowItWorks = (
    <View style={hi.wrap} onLayout={onSectionLayout('how-it-works')}>
      <View style={hi.inner}>
        <SectionLabel text="HOW IT WORKS" color={C.blue} />
        <SectionTitle text="Up and Running in Three Steps" />
        <SectionSub text="GoArrive is designed to get you from sign-up to your first paying member as fast as possible." />

        <View style={[hi.steps, isMobile && { flexDirection: 'column' }]}>
          {steps.map((step, i) => (
            <View key={i} style={[hi.step, isMobile && { width: '100%' as any, flexDirection: 'row', gap: 16 }]}>
              <View style={[hi.numCircle, { borderColor: step.color }]}>
                <Text style={[hi.num, { color: step.color }]}>{step.num}</Text>
              </View>
              <View style={isMobile ? { flex: 1 } : {}}>
                <Text style={hi.stepTitle}>{step.title}</Text>
                <Text style={hi.stepDesc}>{step.desc}</Text>
              </View>
              {!isMobile && i < steps.length - 1 && (
                <View style={hi.connector}>
                  <Text style={hi.connectorArrow}>→</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 7. MEMBER EXPERIENCE ─── */
  const memberFeatures = [
    { icon: '📱', title: 'Personalized Workout Plans', desc: 'Members see their custom program — built by you — with clear daily instructions and progress tracking.' },
    { icon: '🎥', title: 'Video-Guided Movements', desc: 'Every movement comes with video demonstrations so members always know proper form, even without you in the room.' },
    { icon: '📝', title: 'Post-Workout Journaling', desc: 'After every workout, members reflect with the Glow/Grow journal — what went well and where to improve. You see every entry.' },
    { icon: '🔔', title: 'Smart Reminders', desc: 'Automated session reminders and workout nudges keep your members accountable without you lifting a finger.' },
  ];

  const MemberSection = (
    <View style={m.wrap}>
      <View style={m.inner}>
        <SectionLabel text="FOR YOUR MEMBERS" color={C.gold} />
        <SectionTitle text="A Premium Experience That Keeps Members Coming Back" />
        <SectionSub text="When you coach on GoArrive, your members get a world-class experience that makes them feel supported, motivated, and connected to you — their coach." />

        <View style={[m.grid, isMobile && { flexDirection: 'column' }]}>
          {memberFeatures.map((mf, i) => (
            <View key={i} style={[m.card, isMobile && { width: '100%' as any }]}>
              <Text style={m.cardIcon}>{mf.icon}</Text>
              <Text style={m.cardTitle}>{mf.title}</Text>
              <Text style={m.cardDesc}>{mf.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  /* ─── 8. SOCIAL PROOF ─── */
  const SocialProof = (
    <View style={sp.wrap}>
      <View style={sp.inner}>
        <View style={sp.quoteCard}>
          <Text style={sp.quoteMarks}>"</Text>
          <Text style={sp.quoteText}>
            GoArrive gives independent coaches the same operational power that big box gyms have — scheduling, payments, workout delivery, member management — but in a platform built specifically for the way we work. One coach, one member at a time.
          </Text>
          <View style={sp.quoteAuthor}>
            <View style={sp.authorDot} />
            <View>
              <Text style={sp.authorName}>Built for Coaches, by a Coach</Text>
              <Text style={sp.authorRole}>The GoArrive Team</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  /* ─── 9. PRICING ─── */
  const PricingSection = (
    <View style={pr.wrap} onLayout={onSectionLayout('pricing')}>
      <View style={pr.inner}>
        <SectionLabel text="PRICING" color={C.green} />
        <SectionTitle text="Simple, Coach-First Pricing" />
        <SectionSub text="GoArrive operates on a franchise model inspired by Keller Williams. You run your business, we provide the platform. Pricing is based on your active member volume — start free and scale as you grow." />

        <View style={[pr.cards, isMobile && { flexDirection: 'column' }]}>
          {/* Starter */}
          <View style={[pr.card, isMobile && { width: '100%' as any }]}>
            <Text style={pr.planName}>Starter</Text>
            <Text style={pr.price}>Free</Text>
            <Text style={pr.priceNote}>to get started</Text>
            <View style={pr.featureList}>
              {['Full workout builder', 'Up to 5 members', 'Movement library', 'Intake forms', 'Basic scheduling'].map((f, i) => (
                <View key={i} style={pr.featureRow}>
                  <Text style={pr.checkmark}>✓</Text>
                  <Text style={pr.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            <PrimaryButton label="Get Started Free" onPress={goLogin} />
          </View>

          {/* Growth */}
          <View style={[pr.card, pr.cardFeatured, isMobile && { width: '100%' as any }]}>
            <View style={pr.popularBadge}><Text style={pr.popularText}>Most Popular</Text></View>
            <Text style={pr.planName}>Growth</Text>
            <Text style={pr.price}>Tiered</Text>
            <Text style={pr.priceNote}>based on active members</Text>
            <View style={pr.featureList}>
              {['Everything in Starter', 'Unlimited members', 'Stripe payments', 'Zoom integration', 'Google Calendar sync', 'Automated reminders', 'Earnings dashboard'].map((f, i) => (
                <View key={i} style={pr.featureRow}>
                  <Text style={[pr.checkmark, { color: C.gold }]}>✓</Text>
                  <Text style={pr.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            <PrimaryButton label="Start Growing" onPress={goLogin} large />
          </View>

          {/* Enterprise */}
          <View style={[pr.card, isMobile && { width: '100%' as any }]}>
            <Text style={pr.planName}>Enterprise</Text>
            <Text style={pr.price}>Custom</Text>
            <Text style={pr.priceNote}>for coaching teams</Text>
            <View style={pr.featureList}>
              {['Everything in Growth', 'Multi-coach support', 'Profit share & distributions', 'Priority support', 'Custom integrations'].map((f, i) => (
                <View key={i} style={pr.featureRow}>
                  <Text style={pr.checkmark}>✓</Text>
                  <Text style={pr.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            <SecondaryButton label="Contact Us" onPress={() => Linking.openURL('mailto:support@goa.fit')} />
          </View>
        </View>
      </View>
    </View>
  );

  /* ─── 10. FAQ ─── */
  const faqs = [
    {
      q: 'What is GoArrive?',
      a: 'GoArrive is an all-in-one online fitness coaching platform. It gives independent coaches everything they need to run their coaching business — workout programming, member management, scheduling, payments, and a premium member experience — all in one place.',
    },
    {
      q: 'Who is GoArrive for?',
      a: 'GoArrive is built for independent fitness coaches who want to deliver online coaching at scale. Whether you train 5 members or 500, GoArrive provides the tools and infrastructure to run your business professionally.',
    },
    {
      q: 'How does pricing work?',
      a: 'GoArrive uses a tiered pricing model based on your active member count. You can start free with up to 5 members. As your business grows, your platform fee scales with your revenue — so you only pay more when you\'re earning more.',
    },
    {
      q: 'Can my members pay me through GoArrive?',
      a: 'Yes. GoArrive integrates with Stripe Connect, so your members can subscribe to your coaching plans and pay directly through the platform. Payments are processed automatically and deposited to your bank account.',
    },
    {
      q: 'Do I need to be technical to use GoArrive?',
      a: 'Not at all. GoArrive is designed to be intuitive for coaches, not developers. The workout builder is visual and drag-and-drop. Member onboarding uses simple intake forms. Payments are handled by Stripe. You focus on coaching — we handle the tech.',
    },
    {
      q: 'What do my members see?',
      a: 'Your members get a clean, branded experience. They see their personalized workout plans, video-guided movements, scheduling tools, and a post-workout journal. Everything is designed to feel premium and personal.',
    },
    {
      q: 'Does GoArrive support video sessions?',
      a: 'Yes. GoArrive integrates with Zoom for live coaching sessions. Rooms are automatically assigned, calendar events are created, and reminders are sent to both you and your member.',
    },
    {
      q: 'Can I try GoArrive before committing?',
      a: 'Absolutely. You can sign up and start building your coaching business for free. No credit card required. Explore the workout builder, set up your profile, and see the platform in action before you bring on paying members.',
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

  /* ─── 11. FINAL CTA ─── */
  const FinalCta = (
    <View style={fc.wrap}>
      <View style={fc.gradientOrb} />
      <View style={fc.inner}>
        <Text style={[fc.headline, isMobile && { fontSize: 30 }]}>
          Ready to Elevate Your Coaching?
        </Text>
        <Text style={fc.sub}>
          Join GoArrive and give your members the premium experience they deserve — while building the coaching business you've always wanted.
        </Text>
        <View style={[fc.ctas, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
          <PrimaryButton label="Get Started Free" onPress={goLogin} large />
          <SecondaryButton label="Contact Us" onPress={() => Linking.openURL('mailto:support@goa.fit')} />
        </View>
      </View>
    </View>
  );

  /* ─── 12. FOOTER ─── */
  const Footer = (
    <View style={ft.wrap}>
      <View style={[ft.inner, isMobile && { flexDirection: 'column', gap: 32 }]}>
        {/* Brand column */}
        <View style={ft.brandCol}>
          <Image
            source={require('../../assets/logo.png')}
            style={ft.footerLogo}
            resizeMode="contain"
          />
          <Text style={ft.brandDesc}>
            The all-in-one platform for independent fitness coaches. Build workouts, manage members, get paid — all in one place.
          </Text>
        </View>

        {/* Links columns */}
        <View style={ft.linksCol}>
          <Text style={ft.colTitle}>Platform</Text>
          <Pressable onPress={() => scrollToSection('features')}><Text style={ft.footerLink}>Features</Text></Pressable>
          <Pressable onPress={() => scrollToSection('pricing')}><Text style={ft.footerLink}>Pricing</Text></Pressable>
          <Pressable onPress={() => scrollToSection('how-it-works')}><Text style={ft.footerLink}>How It Works</Text></Pressable>
          <Pressable onPress={() => scrollToSection('faq')}><Text style={ft.footerLink}>FAQ</Text></Pressable>
        </View>

        <View style={ft.linksCol}>
          <Text style={ft.colTitle}>Company</Text>
          <Pressable onPress={() => Linking.openURL('mailto:support@goa.fit')}><Text style={ft.footerLink}>Contact</Text></Pressable>
          <Pressable onPress={() => Linking.openURL('mailto:support@goa.fit')}><Text style={ft.footerLink}>Support</Text></Pressable>
        </View>

        <View style={ft.linksCol}>
          <Text style={ft.colTitle}>Get Started</Text>
          <Pressable onPress={goLogin}><Text style={ft.footerLink}>Sign In</Text></Pressable>
          <Pressable onPress={goLogin}><Text style={ft.footerLink}>Create Account</Text></Pressable>
        </View>
      </View>

      <View style={ft.bottom}>
        <Text style={ft.copyright}>© {new Date().getFullYear()} GoArrive. All rights reserved.</Text>
        <Text style={ft.legal}>GoArrive is an online fitness coaching platform providing tools for independent coaches to manage their businesses and deliver personalized member experiences.</Text>
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
        {StatsBar}
        {ProblemSection}
        {FeaturesSection}
        {HowItWorks}
        {MemberSection}
        {SocialProof}
        {PricingSection}
        {FaqSection}
        {FinalCta}
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
  divider: {
    height: 1,
    backgroundColor: C.border,
    width: '100%' as any,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIconText: {
    fontSize: 24,
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
    backgroundColor: 'rgba(123,160,91,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(123,160,91,0.2)',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.green,
    fontFamily: FONT_B,
  },
  headline: {
    fontSize: 52,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 60,
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
  trust: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
    textAlign: 'center',
  },
});

/* Stats Bar */
const sb = StyleSheet.create({
  wrap: {
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderSub,
    paddingVertical: 32,
    paddingHorizontal: 24,
    marginTop: 40,
  },
  inner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    maxWidth: 900,
    alignSelf: 'center',
    width: '100%' as any,
  },
  stat: { alignItems: 'center', gap: 4 },
  val: {
    fontSize: 22,
    fontWeight: '700',
    color: C.gold,
    fontFamily: FONT_H,
  },
  label: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
  },
});

/* Problem */
const p = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%' as any,
  },
  painGrid: {
    flexDirection: 'row',
    gap: 20,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  painCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 28,
    width: '30%' as any,
    minWidth: 260,
    borderWidth: 1,
    borderColor: C.border,
  },
  painIcon: { fontSize: 32, marginBottom: 16 },
  painTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
  },
  painDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
  },
});

/* Features */
const f = StyleSheet.create({
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
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: { fontSize: 26 },
  cardTitle: {
    fontSize: 18,
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
});

/* How It Works */
const hi = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
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
});

/* Member Experience */
const m = StyleSheet.create({
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    justifyContent: 'center',
  },
  card: {
    width: '46%' as any,
    minWidth: 260,
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
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 23,
  },
});

/* Social Proof */
const sp = StyleSheet.create({
  wrap: {
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  inner: {
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%' as any,
  },
  quoteCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 40,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    borderLeftColor: C.gold,
  },
  quoteMarks: {
    fontSize: 48,
    color: C.gold,
    fontFamily: FONT_H,
    lineHeight: 48,
    marginBottom: 8,
  },
  quoteText: {
    fontSize: 18,
    color: C.text,
    fontFamily: FONT_B,
    lineHeight: 30,
    fontStyle: 'italic',
    marginBottom: 24,
  },
  quoteAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  authorDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.goldDim,
    borderWidth: 2,
    borderColor: C.gold,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
  },
  authorRole: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
  },
});

/* Pricing */
const pr = StyleSheet.create({
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
  cards: {
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  card: {
    width: '30%' as any,
    minWidth: 280,
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 32,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  cardFeatured: {
    borderColor: C.gold,
    borderWidth: 2,
    position: 'relative',
    ...(Platform.OS === 'web' ? { transform: [{ scale: 1.04 }] } : {}),
  },
  popularBadge: {
    position: 'absolute',
    top: -14,
    backgroundColor: C.gold,
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 12,
  },
  popularText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.dark,
    fontFamily: FONT_H,
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 8,
    marginTop: 8,
  },
  price: {
    fontSize: 38,
    fontWeight: '700',
    color: C.gold,
    fontFamily: FONT_H,
  },
  priceNote: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    marginBottom: 24,
  },
  featureList: {
    width: '100%' as any,
    gap: 12,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkmark: {
    fontSize: 16,
    color: C.green,
    fontWeight: '700',
    marginTop: 1,
  },
  featureText: {
    fontSize: 14,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 20,
    flex: 1,
  },
});

/* FAQ */
const fq = StyleSheet.create({
  wrap: {
    paddingVertical: 80,
    paddingHorizontal: 24,
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

/* Final CTA */
const fc = StyleSheet.create({
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
    backgroundColor: 'rgba(245,166,35,0.04)',
  },
  inner: {
    alignItems: 'center',
    maxWidth: 600,
    zIndex: 1,
  },
  headline: {
    fontSize: 38,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    lineHeight: 46,
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
  },
});

/* Footer */
const ft = StyleSheet.create({
  wrap: {
    backgroundColor: C.surfaceAlt,
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
