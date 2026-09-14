import type { RenderedEmail } from './verification-code.template';

export function passwordResetEmail(resetUrl: string, ttlMinutes: number): RenderedEmail {
  return {
    subject: 'Reset your NeuroNest password',
    text: `We received a request to reset your NeuroNest password. Open this link to choose a new one (expires in ${ttlMinutes} minutes): ${resetUrl}. If you did not request this, ignore this email.`,
    html: `
      <div style="font-family: system-ui, sans-serif; font-size: 15px; color: #1a1a1a;">
        <p>We received a request to reset your NeuroNest password.</p>
        <p><a href="${resetUrl}" style="display: inline-block; padding: 10px 18px; background: #2f6feb; color: #fff; border-radius: 6px; text-decoration: none;">Choose a new password</a></p>
        <p>This link expires in ${ttlMinutes} minutes.</p>
        <p style="color: #666;">If you did not request a password reset, you can safely ignore this email.</p>
      </div>`,
  };
}
