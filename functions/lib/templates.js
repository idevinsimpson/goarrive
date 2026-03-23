"use strict";
/**
 * templates.ts — GoArrive Message Templates
 *
 * Aligned to GoArrive tone: warm, direct, encouraging, never robotic.
 * Four core templates + recording ready.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = renderTemplate;
// ─── Template Renderer ───────────────────────────────────────────────────────
function renderTemplate(templateKey, data) {
    switch (templateKey) {
        case 'member_24h':
            return memberSessionReminder24h(data);
        case 'member_1h':
            return memberSessionStartingSoon(data);
        case 'coach_24h':
            return coachSessionReminder24h(data);
        case 'coach_1h':
            return coachSessionStartingSoon(data);
        case 'missed_session_followup':
            return missedSessionFollowup(data);
        case 'recording_ready':
            return recordingReady(data);
        default:
            return memberSessionReminder24h(data);
    }
}
// ─── Member: 24h Session Reminder ────────────────────────────────────────────
function memberSessionReminder24h(data) {
    const firstName = data.memberName.split(' ')[0] || 'there';
    const sessionLabel = formatSessionType(data.sessionType);
    const dateLabel = formatDateFriendly(data.sessionDate);
    const phaseNote = data.guidancePhase ? ` (${formatPhase(data.guidancePhase)})` : '';
    const subject = `Tomorrow's ${sessionLabel} session`;
    const body = `Hey ${firstName}, just a heads up — you've got a ${sessionLabel} session${phaseNote} tomorrow (${dateLabel}) at ${data.sessionTime}. ${data.joinUrl ? `Here's your link: ${data.joinUrl}` : 'Your session link will be ready when it\'s time.'} Show up and keep the momentum going. — ${data.coachName || 'Your GoArrive Coach'}`;
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #FFC000; margin: 0 0 16px 0; font-size: 20px;">Tomorrow's ${sessionLabel} Session</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">Hey ${firstName}, just a heads up — you've got a <strong>${sessionLabel}</strong> session${phaseNote} tomorrow.</p>
    <div style="background: #252830; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #9CA3AF;"><strong style="color: #E8E6E3;">${dateLabel}</strong> at <strong style="color: #E8E6E3;">${data.sessionTime}</strong></p>
    </div>
    ${data.joinUrl ? `<a href="${data.joinUrl}" style="display: inline-block; background: #FFC000; color: #1A1D23; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0;">Join Session</a>` : '<p style="color: #9CA3AF; margin: 12px 0;">Your session link will be ready when it\'s time.</p>'}
    <p style="margin: 16px 0 0 0; color: #9CA3AF;">Show up and keep the momentum going.</p>
    <p style="margin: 12px 0 0 0; color: #9CA3AF;">— ${data.coachName || 'Your GoArrive Coach'}</p>
  </div>
</div>`;
    return { subject, body, htmlBody };
}
// ─── Member: 1h Starting Soon ────────────────────────────────────────────────
function memberSessionStartingSoon(data) {
    const firstName = data.memberName.split(' ')[0] || 'there';
    const sessionLabel = formatSessionType(data.sessionType);
    const subject = `Your ${sessionLabel} session starts in 1 hour`;
    const body = `${firstName}, your ${sessionLabel} session starts in about an hour at ${data.sessionTime}. ${data.joinUrl ? `Jump in here: ${data.joinUrl}` : 'Your link will be ready shortly.'} Let's go. — ${data.coachName || 'Your GoArrive Coach'}`;
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #FFC000; margin: 0 0 16px 0; font-size: 20px;">Starting Soon</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">${firstName}, your <strong>${sessionLabel}</strong> session starts in about an hour at <strong>${data.sessionTime}</strong>.</p>
    ${data.joinUrl ? `<a href="${data.joinUrl}" style="display: inline-block; background: #FFC000; color: #1A1D23; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0;">Join Now</a>` : '<p style="color: #9CA3AF;">Your link will be ready shortly.</p>'}
    <p style="margin: 16px 0 0 0; color: #FFC000; font-weight: 600;">Let's go.</p>
    <p style="margin: 8px 0 0 0; color: #9CA3AF;">— ${data.coachName || 'Your GoArrive Coach'}</p>
  </div>
</div>`;
    return { subject, body, htmlBody };
}
// ─── Coach: 24h Session Reminder ─────────────────────────────────────────────
function coachSessionReminder24h(data) {
    const coachFirst = data.coachName.split(' ')[0] || 'Coach';
    const sessionLabel = formatSessionType(data.sessionType);
    const dateLabel = formatDateFriendly(data.sessionDate);
    const subject = `Tomorrow: ${sessionLabel} with ${data.memberName}`;
    const body = `${coachFirst}, heads up — you have a ${sessionLabel} session with ${data.memberName} tomorrow (${dateLabel}) at ${data.sessionTime}. ${data.joinUrl ? `Session link: ${data.joinUrl}` : ''} — GoArrive`;
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #4ADE80; margin: 0 0 16px 0; font-size: 20px;">Tomorrow's Session</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">${coachFirst}, you have a <strong>${sessionLabel}</strong> session with <strong>${data.memberName}</strong> tomorrow.</p>
    <div style="background: #252830; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #9CA3AF;"><strong style="color: #E8E6E3;">${dateLabel}</strong> at <strong style="color: #E8E6E3;">${data.sessionTime}</strong></p>
    </div>
    ${data.joinUrl ? `<a href="${data.joinUrl}" style="display: inline-block; background: #4ADE80; color: #1A1D23; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0;">Session Link</a>` : ''}
    <p style="margin: 12px 0 0 0; color: #9CA3AF;">— GoArrive</p>
  </div>
</div>`;
    return { subject, body, htmlBody };
}
// ─── Coach: 1h Starting Soon ─────────────────────────────────────────────────
function coachSessionStartingSoon(data) {
    const coachFirst = data.coachName.split(' ')[0] || 'Coach';
    const sessionLabel = formatSessionType(data.sessionType);
    const subject = `Starting soon: ${sessionLabel} with ${data.memberName}`;
    const body = `${coachFirst}, your ${sessionLabel} session with ${data.memberName} starts in about an hour at ${data.sessionTime}. ${data.joinUrl ? `Join: ${data.joinUrl}` : ''} — GoArrive`;
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #4ADE80; margin: 0 0 16px 0; font-size: 20px;">Starting Soon</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">${coachFirst}, your <strong>${sessionLabel}</strong> session with <strong>${data.memberName}</strong> starts in about an hour.</p>
    ${data.joinUrl ? `<a href="${data.joinUrl}" style="display: inline-block; background: #4ADE80; color: #1A1D23; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0;">Join Session</a>` : ''}
    <p style="margin: 12px 0 0 0; color: #9CA3AF;">— GoArrive</p>
  </div>
</div>`;
    return { subject, body, htmlBody };
}
// ─── Missed Session Follow-up ────────────────────────────────────────────────
function missedSessionFollowup(data) {
    const firstName = data.memberName.split(' ')[0] || 'there';
    const sessionLabel = formatSessionType(data.sessionType);
    const dateLabel = formatDateFriendly(data.missedDate || data.sessionDate);
    const subject = `We missed you today`;
    const body = `Hey ${firstName}, looks like you missed your ${sessionLabel} session on ${dateLabel}. No stress — just don't let it become a pattern. Your rhythm matters. If something came up, reach out to ${data.coachName || 'your coach'} and get back on track. — GoArrive`;
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #FFC000; margin: 0 0 16px 0; font-size: 20px;">We Missed You</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">Hey ${firstName}, looks like you missed your <strong>${sessionLabel}</strong> session on ${dateLabel}.</p>
    <p style="margin: 0 0 12px 0; line-height: 1.5; color: #9CA3AF;">No stress — just don't let it become a pattern. Your rhythm matters.</p>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">If something came up, reach out to <strong>${data.coachName || 'your coach'}</strong> and get back on track.</p>
    <p style="margin: 16px 0 0 0; color: #9CA3AF;">— GoArrive</p>
  </div>
</div>`;
    return { subject, body, htmlBody };
}
// ─── Recording Ready ─────────────────────────────────────────────────────────
function recordingReady(data) {
    const firstName = data.memberName.split(' ')[0] || 'there';
    const sessionLabel = formatSessionType(data.sessionType);
    const subject = `Your ${sessionLabel} recording is ready`;
    const body = `${firstName}, the recording from your ${sessionLabel} session on ${formatDateFriendly(data.sessionDate)} is ready. ${data.recordingUrl ? `Watch it here: ${data.recordingUrl}` : 'Check your GoArrive dashboard to view it.'} Use it to review your form and track your progress. — ${data.coachName || 'GoArrive'}`;
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #FFC000; margin: 0 0 16px 0; font-size: 20px;">Recording Ready</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">${firstName}, the recording from your <strong>${sessionLabel}</strong> session on ${formatDateFriendly(data.sessionDate)} is ready.</p>
    ${data.recordingUrl ? `<a href="${data.recordingUrl}" style="display: inline-block; background: #FFC000; color: #1A1D23; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0;">Watch Recording</a>` : '<p style="color: #9CA3AF;">Check your GoArrive dashboard to view it.</p>'}
    <p style="margin: 12px 0 0 0; color: #9CA3AF;">Use it to review your form and track your progress.</p>
    <p style="margin: 8px 0 0 0; color: #9CA3AF;">— ${data.coachName || 'GoArrive'}</p>
  </div>
</div>`;
    return { subject, body, htmlBody };
}
// ─── Formatting Helpers ──────────────────────────────────────────────────────
function formatSessionType(type) {
    if (!type)
        return 'Session';
    return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
}
function formatPhase(phase) {
    const map = {
        'coach_guided': 'Fully Guided',
        'shared_guidance': 'Shared Guidance',
        'self_guided': 'Self-Reliant',
    };
    return map[phase] || phase;
}
function formatDateFriendly(dateStr) {
    if (!dateStr)
        return '';
    try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${d}`;
    }
    catch (_a) {
        return dateStr;
    }
}
//# sourceMappingURL=templates.js.map