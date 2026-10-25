const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const read = (name) => fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');

/**
 * A template with its {{VARS}} filled in. {{SITE_HEADER}} and {{SITE_FOOTER}} become the shared
 * header and footer first, so every page has the same navigation and their {{VARS}} are filled
 * too. APP_URL and the contact address (split, so scrapers find no address) are always there.
 */
function render(templateName, vars = {}) {
    const [user, domain] = (process.env.CONTACT_EMAIL || '@').split('@');
    vars = {
        APP_URL: (process.env.APP_URL || '').replace(/\/$/, ''),
        CONTACT_EMAIL_USER: user, CONTACT_EMAIL_DOMAIN: domain,
        ...vars,
    };
    let html = read(templateName)
        .replaceAll('{{SITE_HEADER}}', read('partials/header.html'))
        .replaceAll('{{SITE_FOOTER}}', read('partials/footer.html'));
    for (const [key, value] of Object.entries(vars)) {
        html = html.replaceAll(`{{${key}}}`, value ?? '');
    }
    return html;
}

module.exports = { render };
