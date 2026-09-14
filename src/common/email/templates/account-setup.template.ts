import type { RenderedEmail } from './verification-code.template';

export function accountSetupEmail(setupUrl: string, ttlMinutes: number): RenderedEmail {
  return {
    subject: 'Set up your NeuroNest clinician account',
    text: `Your NeuroNest clinician application has been approved. Open this link to set a password and activate your account (expires in ${ttlMinutes} minutes): ${setupUrl}. If you were not expecting this, you can ignore this email.`,
    html: `
      <div style="font-family: system-ui, sans-serif; font-size: 15px; color: #1a1a1a;">
        <p>Your NeuroNest clinician application has been approved.</p>
        <p><a href="${setupUrl}" style="display: inline-block; padding: 10px 18px; background: #2f6feb; color: #fff; border-radius: 6px; text-decoration: none;">Set your password</a></p>
        <p>This link expires in ${ttlMinutes} minutes.</p>
        <p style="color: #666;">If you were not expecting this, you can safely ignore this email.</p>
      </div>`,
  };
}
