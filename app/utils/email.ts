export interface SendEmailParams {
  apiKey?: string;
  from?: string;
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({
  apiKey,
  from = "ManyMano <notifications@resend.dev>",
  to,
  subject,
  html,
}: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  if (!apiKey) {
    console.log(`[Email Mock (No RESEND_API_KEY configured)] To: ${to}, Subject: "${subject}"`);
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
      const errBody = await res.text();
      console.error("Resend API error:", errBody);
      return { success: false, error: errBody };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Failed to send email:", err);
    return { success: false, error: err?.message || String(err) };
  }
}
