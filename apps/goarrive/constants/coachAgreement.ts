/**
 * GoArrive Program Terms & Contractual Agreements — versioned in-repo source.
 *
 * Source of truth for content: JotForm 241435478238159
 * (https://form.jotform.com/241435478238159)
 *
 * IMPORTANT — LEGAL WORDING REVIEW STATUS
 *
 * The initial content in this file was extracted from the source JotForm on
 * 2026-07-03 via web fetch + summarization. Percentages, dollar amounts, tier
 * ranges, timelines, refund logic, and specific program rules were captured
 * verbatim where feasible. Some connective/structural sentences were
 * consolidated for mobile readability. Any place a source used older
 * client/trainer/virtual wording that could carry legal weight has been
 * preserved with a clear marker so it can be reviewed against the JotForm
 * text before this becomes the effective coach agreement of record.
 *
 * When you make edits:
 * - Never change percentages, dollar amounts, or program rules without a
 *   corresponding update to the source JotForm and a version bump.
 * - Never invent new contractual terms.
 * - Never rename money structures.
 * - Format-only changes (line breaks, headings, list separators) do not
 *   require a version bump.
 * - Any substantive legal edit MUST bump COACH_AGREEMENT_VERSION.
 */

export const COACH_AGREEMENT_VERSION = '2026-07-coach-program-terms-v1';
export const COACH_AGREEMENT_TITLE =
  'GoArrive Program Terms & Contractual Agreements';
export const COACH_AGREEMENT_SOURCE_URL =
  'https://form.jotform.com/241435478238159';

export interface CoachAgreementSection {
  id: string;
  number: number;
  title: string;
  summary: string;
  body: string[];
}

export const COACH_AGREEMENT_SECTIONS: CoachAgreementSection[] = [
  {
    id: 'apprenticeship',
    number: 1,
    title: 'Coach Apprenticeship Guideline',
    summary:
      'Your ramp-up to coaching excellence inside G\u27B2A — clear progression and real mentorship.',
    body: [
      'This apprenticeship is your ramp-up to coaching excellence inside G\u27B2A. It is built to help new coaches get confident, competent, and ready to launch with a clear progression and real mentorship. It runs for three months or 60 hours of apprenticeship activity, whichever comes first, unless adjusted by GoArrive in writing.',
      'Duration: three months or 60 hours, whichever comes first. Mentorship involves pairing with a Coach Mentor who models, assists, observes, and launches the apprentice.',
      'Learning pace varies. Launch depends on readiness and demonstrated skill.',
      'Mentorship phases:',
      '\u2022 Modeling — the mentor demonstrates coaching.',
      '\u2022 Assisting — the apprentice supports sessions.',
      '\u2022 Watching — the apprentice runs sessions with observation.',
      '\u2022 Launching — independent coaching.',
      'New coaches may acquire members during apprenticeship with guidance from their Coach Mentor and GoArrive.',
      'Completion does not guarantee income, a specific number of members, or continued engagement with GoArrive.',
    ],
  },
  {
    id: 'codeOfConduct',
    number: 2,
    title: 'G\u27B2A Code of Conduct',
    summary:
      'Professionalism, safety, and integrity. Violation may result in corrective action, suspension, or termination of engagement.',
    body: [
      'This Code of Conduct sets the tone for how we do what we do. We protect members, coaches, and the GoArrive brand by holding a high bar for professionalism, safety, and integrity. Violation may result in corrective action, suspension, or termination of engagement.',
      'Professional Conduct — integrity and honesty (no misrepresentation of qualifications, services, pricing, or outcomes); respect and care (dignified treatment; no discrimination or harassment); professionalism (punctuality, preparedness, ongoing development).',
      'Confidentiality — maintain member information confidentiality per the G\u27B2A Confidentiality Agreement. Unauthorized disclosure is prohibited.',
      'Engagement and Communication — prompt, professional communication; maintain professionalism across email, video, Loom, social media, and online coaching interactions.',
      'Session Conduct — prioritize safe movement, appropriate progressions, risk reduction, preparedness with session plans and coaching cues, and personalized training and nutrition guidance within scope.',
      'Community Contribution — support peer learning and referrals; ensure representation aligns with company values.',
      'Coaches are accountable for actions and decisions. Violations may result in disciplinary action up to and including termination of engagement.',
      'GoArrive provides resources, training, and feedback to help coaches meet expectations.',
    ],
  },
  {
    id: 'coachExpectations',
    number: 3,
    title: 'G\u27B2A Coach Expectations Agreement',
    summary:
      'What "great" looks like inside G\u27B2A. Protect member outcomes, strengthen coaching craft, keep the community trustworthy.',
    body: [
      'This agreement spells out what "great" looks like inside G\u27B2A. It is designed to protect member outcomes, strengthen your coaching craft, and keep our community consistent and trustworthy.',
      'Professional Standards — maintain and expand fitness coaching and nutrition knowledge; keep required credentials current; pursue growth opportunities.',
      'Engagement and Communication — clear, effective communication through GoArrive-approved platforms; be approachable, responsive, and proactive with member needs and feedback.',
      'Technical and Operational Proficiency — platform mastery, preparation, punctuality, and smooth on-time sessions.',
      'Personalization and Progress — individualized planning tailored and adjusted based on progress and feedback; monitor and adapt programming for safety and results.',
      'Community and Collaboration — share best practices; contribute to the coaching community; engage in mutual referrals and collaboration.',
      'By participating, the coach agrees to uphold these standards and actively pursue growth. GoArrive agrees to support coaches with training, resources, and leadership opportunities.',
    ],
  },
  {
    id: 'scopeOfServices',
    number: 4,
    title: 'G\u27B2A Scope of Services Agreement',
    summary:
      'What GoArrive provides through technology-enabled online fitness coaching, and how services are delivered.',
    body: [
      'This section defines what GoArrive provides through technology-enabled online fitness coaching and how services are delivered. It exists to protect clarity, consistency, and quality for both coaches and members.',
      'Services include online fitness coaching and group sessions via Zoom (or approved alternative), optional nutrition planning calls from qualified coaches, regular check-ins with progress reviews and plan adjustments, specialized training videos (up to 45 seconds) with coach voiceovers, and comprehensive session recording for review and quality assurance.',
      'Technology-enabled delivery uses Zoom for sessions and Loom for videos, plus GoArrive dashboards and portal tools. Coaches require stable internet, an appropriate device, and a safe exercise space. GoArrive ensures coach platform training.',
      'Session recording — sessions are recorded for quality, review, and feedback where applicable, with secure, controlled-access hosting.',
      'Coach Portal provides scheduling, communication, progress tracking, and operations tools. Member Dashboard provides schedules, recordings, and resources.',
      'Members and coaches are encouraged to share feedback for improvement. GoArrive conducts periodic reviews and adjusts as needed.',
      'Technology failure contingencies include alternate platforms or rescheduling, with possible technical support to reduce disruption.',
    ],
  },
  {
    id: 'newCoachCompensation',
    number: 5,
    title: 'G\u27B2A New Coach Compensation Program Agreement',
    summary:
      'Progressive, growth-based earnings. As active member count grows, revenue share increases.',
    body: [
      'This program rewards growth-based earnings and member engagement with progressive compensation. It is simple: as your active member count grows, your revenue share increases.',
      'Program Overview — progressive tiers where percentage increases with higher active member ranges; transparent earnings tracking in the dashboard; adherence to GoArrive standards.',
      'Compensation Tiers:',
      '\u2022 Tier 1 (1\u20133 active members): 60% to Coach, 40% to GoArrive.',
      '\u2022 Tier 2 (4\u20136 active members): 65% to Coach, 35% to GoArrive.',
      '\u2022 Tier 3 (7+ active members): 70% to Coach, 30% to GoArrive.',
      'Tier movement adjusts automatically based on active member count in GoArrive records. Tiers increase with member count increases or decrease with decreases. Tier changes apply to subsequent payouts after eligibility is reflected.',
      'Monthly payments process on the 5th weekday of each month via direct deposit to the designated bank account.',
      'GoArrive may evaluate program competitiveness annually with at least 30 days\u2019 notice for changes.',
      'By participating, the Coach agrees to uphold GoArrive standards and accurately represent services, pricing, and outcomes.',
    ],
  },
  {
    id: 'earningsCap',
    number: 6,
    title: 'G\u27B2A Coach\u2019s Earnings Cap Agreement',
    summary:
      'A clear threshold that, once reached, lets the Coach keep 100% of certain first-year revenue.',
    body: [
      'This cap is designed to reward momentum. It is a clear threshold that, once reached, lets the Coach keep 100% of certain revenue from first-year members, subject to the terms below.',
      'New Business is revenue from a member during that member\u2019s first year with GoArrive.',
      'The annual cap is set each calendar year and prorated for mid-year starts. Revenue from New Business counts toward the cap.',
      'After the cap is reached, the Coach retains 100% of additional New Business revenue for the remainder of that calendar year and through the remainder of each affected member\u2019s first year, minus the monthly admin technology fee.',
      'A monthly admin technology fee may be deducted. The fee amount may change. GoArrive will provide notice consistent with the Modification of Terms section.',
      'Inter-coach referral and member referral reward obligations still apply after the cap is reached.',
      'GoArrive provides dashboard tracking with monthly updates.',
      'Cap resets each year on January 1.',
      'By signing/participating, the Coach acknowledges and agrees to the earnings cap model and understands terms may be reviewed and adjusted annually with notice.',
    ],
  },
  {
    id: 'memberReferralReward',
    number: 7,
    title: 'G\u27B2A Member Referral Reward Program Agreement',
    summary:
      'Members who help grow the community earn a refund. Coaches earn through growth-based earnings.',
    body: [
      'This program rewards members who help grow the community and rewards Coaches through growth-based earnings. It also keeps the refund structure fair and clear.',
      'Member incentive — a member who refers 3 new members who join on a 1-year contract may receive a full refund of their annual base membership fee, subject to the requirements below.',
      'Refund applies only to base service fees, excluding upgraded support fees.',
      'Referred members must be new to GoArrive, join on a 1-year contract, and fulfill the required payment milestone. Eligibility is determined in good faith based on GoArrive records.',
      'GoArrive contributes 33% toward the member\u2019s referral refund. The remaining portion is allocated across the benefiting Coach(es) based on the referrals received.',
      'Refund is issued after the final required payment of the third referral, provided conditions are met.',
      'Referrals must sign up at the minimum support level of the referring member to qualify for the full base fee refund. If not met, the refund may be limited to the minimum qualifying base support amount.',
      'GoArrive may award a year-end bonus to the Coach with the most member referrals and promote top referrers.',
      'Participation indicates agreement to administer the program per GoArrive rules.',
    ],
  },
  {
    id: 'interCoachReferral',
    number: 8,
    title: 'G\u27B2A Inter-Coach Member Referral Program Agreement',
    summary:
      'Match members with the right Coach. Reward the Coach who makes the connection.',
    body: [
      'This program keeps members matched with the right Coach and rewards the Coach who makes the connection.',
      'Objective — encourage referring members internally when it benefits member goals and experience. Strengthen collaborative coaching culture.',
      'The referring Coach earns 7% of the receiving Coach\u2019s net revenue from the referred member for the first year of the referred member\u2019s engagement.',
      'Net revenue is defined as the receiving Coach\u2019s revenue from the referred member after direct service delivery costs.',
      'A referred member must be new to GoArrive. The referral must be recorded in GoArrive systems prior to member engagement with the receiving Coach.',
      'The referral program does not apply to Coaches from whom you are already receiving profit share unless GoArrive approves in writing.',
      'Referral shares are calculated monthly and paid quarterly to the referring Coach unless GoArrive specifies otherwise.',
      'GoArrive reviews disputes using available records with final decision authority.',
      'Participation indicates agreement to follow program rules and accept that terms may be updated with notice.',
    ],
  },
  {
    id: 'profitSharing',
    number: 9,
    title: 'G\u27B2A Coach Profit Sharing Agreement',
    summary:
      'Recruit and mentor great coaches. Participate in the success you helped create.',
    body: [
      'Profit sharing is how stakeholders build together. Recruit and mentor great coaches, and you participate in the success you helped create, subject to the terms below.',
      'Coaches may recruit and mentor new coaches to earn profit share from recruited coaches\u2019 members, subject to caps and eligibility.',
      'Profit Sharing Tiers:',
      '\u2022 Direct Recruits — 5% of net profits from the direct recruit\u2019s members, up to the recruit\u2019s earnings cap.',
      '\u2022 Secondary Recruits — 3% of net profits from secondary recruits\u2019 members, up to the recruit\u2019s earnings cap.',
      '\u2022 Annual Reset — profit sharing applies up to the recruited Coach\u2019s earnings cap each year and resets annually.',
      'Profit is calculated monthly as total revenue minus operational expenses directly associated with service delivery, and distributed quarterly.',
      'Once a recruited Coach reaches their earnings cap, profit sharing on newly generated revenue by that Coach stops for the rest of that year. Profit sharing on prior revenue remains applicable.',
      'A Coach must have at least one active recruit generating revenue. Profit sharing continues while both are active and members generate revenue.',
      'Profit sharing stops if the recruit leaves GoArrive, generates no revenue for six consecutive months, or if the receiving Coach leaves or fails to meet performance standards.',
      'Participation indicates agreement to tiers, calculations, cap interaction, and termination triggers.',
    ],
  },
  {
    id: 'intellectualProperty',
    number: 10,
    title: 'G\u27B2A Intellectual Property Agreement',
    summary:
      'Ownership and use of GoArrive intellectual property. We build together, and we protect what we build.',
    body: [
      'We build together, and we protect what we build. This section defines ownership and use of GoArrive intellectual property.',
      'Intellectual Property includes all materials, programs, methods, templates, plans, digital content, training videos, manuals, scripts, articles, and other content created, adapted, or used by Coaches in connection with GoArrive services.',
      'All IP created by Coaches during their contract period that relates to GoArrive services or operations is owned by GoArrive unless otherwise specified in a separate written agreement.',
      'Company Rights — GoArrive may use, modify, distribute, and sell such IP without limitation.',
      'Coaches may use IP only to fulfill GoArrive duties. Any external use requires prior written consent from GoArrive.',
      'GoArrive may credit coaches as creators without granting ownership.',
      'Coaches may not share GoArrive IP with third parties without written consent and must use reasonable safeguards.',
      'IP disputes may be handled through mediation or binding arbitration.',
      'Upon termination, the Coach must cease use of GoArrive IP and return or destroy IP materials upon request unless GoArrive grants written permission. Ownership and confidentiality obligations related to IP survive termination.',
    ],
  },
  {
    id: 'confidentiality',
    number: 11,
    title: 'G\u27B2A Confidentiality Agreement',
    summary:
      'Protect members, coaches, and the company. Applies during engagement and continues after.',
    body: [
      'Confidentiality protects members, coaches, and the company. This agreement applies during engagement and continues after.',
      'Confidential information includes member data, workout plans, personal health information, business strategies, pricing, operational systems, technological data, internal documents, and any non-public information accessed through GoArrive.',
      'Coaches must use confidential information only to fulfill GoArrive duties, use reasonable precautions to prevent unauthorized disclosure, and not disclose without GoArrive\u2019s written consent.',
      'If legally required to disclose, Coaches notify GoArrive promptly and cooperate to minimize disclosure unless prohibited by law. If unauthorized disclosure occurs, notify GoArrive immediately.',
      'The agreement applies throughout engagement and continues indefinitely unless GoArrive releases the Coach in writing.',
      'Breach may result in disciplinary action up to termination and potential legal action for damages.',
    ],
  },
  {
    id: 'modificationOfTerms',
    number: 12,
    title: 'Modification of Terms',
    summary:
      'GoArrive may modify these terms with at least 30 days\u2019 written notice.',
    body: [
      'GoArrive may modify these terms. Coaches will be notified in writing at least 30 days before changes take effect.',
      'Continued participation after notice constitutes acceptance.',
    ],
  },
  {
    id: 'termination',
    number: 13,
    title: 'Termination Clause',
    summary:
      'GoArrive may terminate any of these agreements at any time with written notice.',
    body: [
      'GoArrive may terminate any of these agreements at any time, with or without cause, by providing written notice.',
      'Upon termination, the Coach will cease participation in the applicable program(s), and any obligations intended to survive (including confidentiality and intellectual property) will survive.',
    ],
  },
];
