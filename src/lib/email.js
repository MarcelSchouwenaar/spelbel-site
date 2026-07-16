const fetch = require('node-fetch');

async function sendVerificationEmail({ to, naam, plekNaam, verifyUrl }) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.SENDER_EMAIL;
    if (!apiKey || !sender) {
        console.error('[Email] BREVO_API_KEY or SENDER_EMAIL missing — skipping send');
        return;
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            sender: { email: sender, name: 'SpelBel' },
            to: [{ email: to, name: naam }],
            subject: '🔔 Bevestig je aanmelding voor de SpelBel',
            htmlContent: buildVerificationEmailHtml({ naam, plekNaam, verifyUrl }),
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Brevo API error ${res.status}: ${text}`);
    }
}

function buildVerificationEmailHtml({ naam, plekNaam, verifyUrl }) {
    return `
<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ABE4FF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ABE4FF;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;">
          <tr>
            <td style="background:#DD4A93;padding:28px 32px;text-align:center;">
              <span style="font-size:24px;font-weight:bold;color:#ffffff;">🔔 SpelBel</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">Hoi ${naam},</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">
                Bedankt voor je aanmelding voor een SpelBel bij <strong>${plekNaam}</strong>! Bevestig je e-mailadres om mee te tellen op de kaart.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 32px 32px;">
              <a href="${verifyUrl}"
                 style="display:inline-block;background:#DD4A93;color:#ffffff;text-decoration:none;
                        font-size:18px;font-weight:bold;padding:14px 36px;border-radius:99px;">
                Bevestig mijn aanmelding
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#5A6360;">
                Werkt de knop niet? Plak deze link in je browser:<br>
                <a href="${verifyUrl}" style="color:#DD4A93;word-break:break-all;">${verifyUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F4F6F5;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#5A6360;">
                Heb je dit niet aangevraagd? Dan kun je deze e-mail gewoon negeren.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOwnerNotificationEmail({ naam, email, plekNaam, mapUrl }) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.SENDER_EMAIL;
    const notify = process.env.CONTACT_EMAIL;
    if (!apiKey || !sender || !notify) return;

    await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            sender: { email: sender, name: 'SpelBel' },
            to: [{ email: notify }],
            subject: `🔔 Nieuwe aanmelding: ${naam} bij ${plekNaam}`,
            htmlContent: `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ABE4FF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ABE4FF;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;">
        <tr><td style="background:#DD4A93;padding:28px 32px;text-align:center;">
          <span style="font-size:24px;font-weight:bold;color:#ffffff;">🔔 SpelBel — nieuwe aanmelding</span>
        </td></tr>
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0 0 12px;font-size:16px;color:#1A1A1A;"><strong>${naam}</strong> (${email}) heeft zich aangemeld bij:</p>
          <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#DD4A93;">📍 ${plekNaam}</p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 32px;">
          <a href="${mapUrl}" style="display:inline-block;background:#DD4A93;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:12px 28px;border-radius:99px;">Bekijk de kaart</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
        }),
    }).catch(err => console.error('[Email] owner notification failed:', err.message));
}

async function sendWelcomeEmail({ naam, email }) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.SENDER_EMAIL;
    if (!apiKey || !sender) return;

    await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            sender: { email: sender, name: 'SpelBel' },
            to: [{ email, name: naam }],
            subject: '🔔 Welkom bij SpelBel!',
            htmlContent: `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ABE4FF;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ABE4FF;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;">
        <tr><td style="background:#DD4A93;padding:28px 32px;text-align:center;">
          <span style="font-size:24px;font-weight:bold;color:#ffffff;">🔔 SpelBel</span>
        </td></tr>
        <tr><td style="padding:36px 32px 8px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">Hoi ${naam},</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">
            Je aanmelding is bevestigd — welkom bij SpelBel! We houden je op de hoogte van het laatste nieuws, nieuwe speelplekken en de voortgang van ons avontuur.
          </p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">
            Heb je vrienden of buren die ook een SpelBel willen in de buurt? Stuur ze naar <a href="https://www.spelbel.nl/wij-willen-een-spelbel" style="color:#DD4A93;font-weight:bold;">spelbel.nl</a> — hoe meer aanmeldingen, hoe groter de kans!
          </p>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 32px;">
          <a href="https://www.spelbel.nl/wij-willen-een-spelbel"
             style="display:inline-block;background:#DD4A93;color:#ffffff;text-decoration:none;font-size:18px;font-weight:bold;padding:14px 36px;border-radius:99px;">
            Bekijk de kaart
          </a>
        </td></tr>
        <tr><td style="background:#F4F6F5;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#5A6360;">
            Je ontvangt deze mail omdat je je hebt aangemeld via spelbel.nl.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
        }),
    }).catch(err => console.error('[Email] sendWelcomeEmail failed:', err.message));
}

async function addToMailingList({ email, naam }) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return;

    await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            email,
            attributes: { FIRSTNAME: naam, BRON: 'kaart_geverifieerd' },
            listIds: [5],
            updateEnabled: true,
        }),
    }).catch(err => console.error('[Email] addToMailingList failed:', err.message));
}

module.exports = { sendVerificationEmail, sendOwnerNotificationEmail, addToMailingList, sendWelcomeEmail };
