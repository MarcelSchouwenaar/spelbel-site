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

async function sendNewsletterVerificationEmail({ email, verifyUrl }) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.SENDER_EMAIL;
    if (!apiKey || !sender) return;

    await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            sender: { email: sender, name: 'SpelBel' },
            to: [{ email }],
            subject: '🔔 Bevestig je nieuwsbrief-aanmelding',
            htmlContent: `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #E2E6E5;">
        <tr><td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #E2E6E5;">
          <img src="https://www.spelbel.nl/images/logo.svg" alt="SpelBel" style="height:48px;">
        </td></tr>
        <tr><td style="padding:36px 32px 8px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">Hoi!</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1A1A1A;">Klik op de knop om je aanmelding voor de SpelBel nieuwsbrief te bevestigen.</p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 32px;">
          <a href="${verifyUrl}" style="display:inline-block;background:#DD4A93;color:#ffffff;text-decoration:none;font-size:18px;font-weight:bold;padding:14px 36px;border-radius:99px;">Bevestig aanmelding</a>
        </td></tr>
        <tr><td style="background:#F4F6F5;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#5A6360;">Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
        }),
    }).catch(err => console.error('[Email] sendNewsletterVerificationEmail failed:', err.message));
}

async function sendOwnerNotificationEmail({ naam, email, plekNaam, plaats, mapsUrl, mapUrl, aanmeldingen }) {
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
          <p style="margin:0 0 8px;font-size:20px;font-weight:bold;color:#DD4A93;">📍 ${plekNaam}</p>
          ${plaats ? `<p style="margin:0 0 8px;font-size:14px;color:#5A6360;">${plaats}</p>` : ''}
          <p style="margin:0 0 24px;font-size:15px;color:#1A1A1A;">Totaal aanmeldingen op deze plek: <strong>${aanmeldingen}</strong></p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 16px;">
          ${mapsUrl ? `<a href="${mapsUrl}" style="display:inline-block;background:#1A1A1A;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:12px 28px;border-radius:99px;margin-bottom:10px;">📍 Open in Google Maps</a><br>` : ''}
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

async function addToMailingList({ email, naam, bron = 'kaart_geverifieerd' }) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return;

    await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            email,
            attributes: { FIRSTNAME: naam, BRON: bron },
            listIds: [5],
            updateEnabled: true,
        }),
    }).catch(err => console.error('[Email] addToMailingList failed:', err.message));
}

async function sendBelbaasEmail({ naam, email, code, link, datum, tijd, bijlage }) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.SENDER_EMAIL;
    if (!apiKey || !sender) {
        console.error('[Email] BREVO_API_KEY or SENDER_EMAIL missing — skipping belbaas send');
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
            to: [{ email, name: naam }],
            subject: '🔔 Welkom, Belbaas!',
            htmlContent: buildBelbaasEmailHtml({ naam, code, link, datum, tijd }),
            ...(bijlage ? { attachment: [{ content: bijlage.content, name: bijlage.name }] } : {}),
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Brevo API error ${res.status}: ${text}`);
    }
}

function buildBelbaasEmailHtml({ naam, code, link, datum, tijd }) {
    const heeftDatum = datum && datum.trim();
    const tijdStr = tijd && tijd.trim();

    const openingBlok = heeftDatum ? `
<tr><td style="padding:0 32px 8px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E6F7F0;border-radius:12px;">
<tr><td style="padding:20px 24px;font-size:16px;line-height:1.6;color:#1f2933;">
<p style="margin:0 0 8px 0;font-weight:bold;color:#1a7a4a;font-size:17px;">SpelBel openingsfeest ${datum}</p>
<p style="margin:0;">Op ${datum}${tijdStr ? ` om ${tijdStr}` : ''} vieren we de opening van de SpelBel, en we hopen dat de hele buurt er is. In de bijlage zit de flyer. Stuur hem gerust rond naar je buurtgenoten, bijvoorbeeld via de buurtapp of WhatsApp. Verder sturen we je een pakketje met 5 posters. Hang er één voor je raam en de andere op plekken waar veel buurtgenoten langskomen.</p>
</td></tr>
</table>
</td></tr>` : '';

    return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px 12px;background:#A8E2FF;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">

<tr><td style="background:#F07835;padding:20px 32px;font-size:24px;font-weight:bold;color:#ffffff;">🔔 SpelBel</td></tr>

<tr><td style="padding:0;"><img src="https://www.spelbel.nl/images/belbaas-welkom.jpg" alt="SpelBel op de speelplaats" width="600" style="display:block;width:100%;max-width:600px;height:auto;"></td></tr>

<tr><td style="padding:32px 32px 8px 32px;font-size:16px;line-height:1.6;color:#1f2933;">
<p style="margin:0 0 16px 0;font-size:22px;font-weight:bold;">Welkom, Belbaas!</p>
<p style="margin:0 0 16px 0;">Hoi ${naam},</p>
<p style="margin:0 0 16px 0;">Wat leuk dat er binnenkort een SpelBel in jouw buurt komt te hangen! En jij gaat er iets heel moois van maken, want jij bent vanaf nu de Belbaas. Als Belbaas ben jij het hart van de SpelBel in de wijk.</p>
<p style="margin:0 0 8px 0;font-weight:bold;">Wat doet een Belbaas?</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
  <tr><td style="padding:6px 0;vertical-align:top;width:24px;font-size:16px;">🔔</td><td style="padding:6px 0;font-size:16px;line-height:1.5;color:#1f2933;"><strong>De bel in de gaten houden.</strong> Zie je dat er iets met de bel is, of heb je vragen? Mail naar <a href="mailto:info@spelbel.nl" style="color:#D9601A;">info@spelbel.nl</a>. In de app zie je of de SpelBel online is, hoeveel batterij er nog is en wanneer er voor het laatst aangebeld is. <em>Tip: let op dat niemand een sticker over de QR-code plakt. Er zijn mensen die zo anderen proberen op te lichten.</em></td></tr>
  <tr><td style="padding:6px 0;vertical-align:top;width:24px;font-size:16px;">⏰</td><td style="padding:6px 0;font-size:16px;line-height:1.5;color:#1f2933;"><strong>De tijden van de bel instellen.</strong> Jij stelt in de app in op welke tijden de bel kan afgaan. Aangemelde ouders willen natuurlijk niet tijdens schooltijden gestoord worden!</td></tr>
  <tr><td style="padding:6px 0;vertical-align:top;width:24px;font-size:16px;">🔬</td><td style="padding:6px 0;font-size:16px;line-height:1.5;color:#1f2933;"><strong>Meedoen aan het onderzoek van Jantje Beton.</strong> Dit is een van de 5 eerste SpelBellen in Nederland, en Jantje Beton doet er onderzoek naar. Daarom nemen we na de opening nog 2 keer contact met je op om te kijken hoe het gaat met de SpelBel.</td></tr>
  <tr><td style="padding:6px 0;vertical-align:top;width:24px;font-size:16px;">🎉</td><td style="padding:6px 0;font-size:16px;line-height:1.5;color:#1f2933;"><strong>Aanwezig zijn bij de opening.</strong> Wij stellen je voor als de Belbaas, zodat mensen met vragen bij jou terechtkunnen.</td></tr>
</table>
</td></tr>

<tr><td style="padding:0 32px 24px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FDF1E8;border-radius:12px;">
<tr><td style="padding:20px 24px;font-size:16px;line-height:1.6;color:#1f2933;">
<p style="margin:0 0 8px 0;font-weight:bold;color:#D9601A;">Zo begin je in de app:</p>
<p style="margin:0 0 4px 0;">1. Maak een account aan via <a href="${link}" style="color:#D9601A;">${link}</a>.</p>
<p style="margin:0 0 4px 0;">2. Bevestig je e-mailadres via de mail die je daarna krijgt.</p>
<p style="margin:0;">3. Vul de code in: <strong>${code}</strong></p>
</td></tr>
</table>
</td></tr>

${openingBlok}

<tr><td style="padding:8px 32px 8px 32px;font-size:16px;line-height:1.6;color:#1f2933;">
<p style="margin:0 0 8px 0;font-weight:bold;">Wat is je adres?</p>
<p style="margin:0 0 16px 0;">Naar welk adres mogen we het pakketje sturen? Mail ons even je postadres, dan zorgen wij dat het snel bij je is.</p>
<p style="margin:0 0 16px 0;">Heel veel plezier, Belbaas! Samen zorgen we dat er nog meer buiten gespeeld wordt in de buurt.</p>
<p style="margin:0 0 32px 0;">Een speelse groet,<br><strong>Puck &amp; Marcel van Spel Bel</strong></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { sendVerificationEmail, sendNewsletterVerificationEmail, sendOwnerNotificationEmail, addToMailingList, sendWelcomeEmail, sendBelbaasEmail };
