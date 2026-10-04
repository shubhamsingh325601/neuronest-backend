import type { RenderedEmail } from './verification-code.template';

export function accountSetupEmail(setupUrl: string, ttlHours: number): RenderedEmail {
  return {
    subject: 'You have been invited to NeuroNest',
    text: `An administrator has invited you to join NeuroNest as a clinician. Open this link to set a password and activate your account (expires in ${ttlHours} hours): ${setupUrl}. If you were not expecting this, you can ignore this email.`,
    html: `
      <div style="font-family: system-ui, sans-serif; font-size: 15px; color: #1a1a1a;">
        <p>An administrator has invited you to join NeuroNest as a clinician.</p>
        <p><a href="${setupUrl}" style="display: inline-block; padding: 10px 18px; background: #2f6feb; color: #fff; border-radius: 6px; text-decoration: none;">Set your password</a></p>
        <p>This link expires in ${ttlHours} hours.</p>
        <p style="color: #666;">If you were not expecting this, you can safely ignore this email.</p>
      </div>`,
  };
}
