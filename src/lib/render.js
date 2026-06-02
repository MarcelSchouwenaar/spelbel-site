const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function render(templateName, vars = {}) {
    const file = path.join(TEMPLATES_DIR, templateName);
    let html = fs.readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(vars)) {
        html = html.replaceAll(`{{${key}}}`, value ?? '');
    }
    return html;
}

module.exports = { render };
