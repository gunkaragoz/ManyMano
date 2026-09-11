export interface SendEmailParams {
  apiKey?: string;
  from?: string;
  to: string;
  subject: string;
  html: string;
}

export const DEFAULT_FROM = "ManyMano <no-reply@mail.manymano.com>";

export async function sendEmail({
  apiKey,
  from = DEFAULT_FROM,
  to,
  subject,
  html,
}: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  if (!apiKey) {
    // Intentionally omit recipient/subject: server logs are not the place for PII.
    console.log(`[Email disabled] Skipped outbound email (no RESEND_API_KEY).`);
    return { success: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      // Do not log recipient PII or full provider body; keep a status-only line.
      console.error(`Resend API error: status ${res.status}`);
      return { success: false, error: `Email provider error (${res.status})` };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Failed to send email.");
    return { success: false, error: "Email send failed" };
  }
}
