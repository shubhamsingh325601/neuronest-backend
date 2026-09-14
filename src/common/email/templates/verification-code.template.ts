export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function verificationCodeEmail(code: string, ttlMinutes: number): RenderedEmail {
  return {
    subject: 'Your NeuroNest verification code',
    text: `Your NeuroNest verification code is ${code}. It expires in ${ttlMinutes} minutes. If you did not create an account, you can ignore this email.`,
    html: `
      <div style="font-family: system-ui, sans-serif; font-size: 15px; color: #1a1a1a;">
        <p>Welcome to NeuroNest. Use this code to verify your email address:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
        <p>The code expires in ${ttlMinutes} minutes.</p>
        <p style="color: #666;">If you did not create an account, you can safely ignore this email.</p>
      </div>`,
  };
}
