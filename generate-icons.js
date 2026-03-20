#!/usr/bin/env node
/* ============================================================
   generate-icons.js
   Run: node generate-icons.js
   Requires: npm install sharp
   Generates all PWA icon sizes from the inline SVG
   ============================================================ */

const fs   = require('fs');
const path = require('path');

// Try to use sharp, fallback to instructions
let sharp;
try { sharp = require('sharp'); } catch {
  console.log('\n⚠️  sharp not installed. Run: npm install sharp\n');
  console.log('OR use this free online tool instead:');
  console.log('👉  https://maskable.app/editor');
  console.log('    Upload the icon.svg file and export all sizes\n');
  process.exit(0);
}

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT   = path.join(__dirname, 'icons');

// Nestfy icon SVG
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background -->
  <rect width="512" height="512" rx="112" fill="#0a0a0f"/>
  <!-- Gradient circle -->
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00d4aa"/>
      <stop offset="100%" stop-color="#7c6aff"/>
    </linearGradient>
  </defs>
  <circle cx="256" cy="256" r="180" fill="none" stroke="url(#g)" stroke-width="28"/>
  <!-- S letter -->
  <text x="256" y="340" font-family="Arial Black, sans-serif" font-size="240"
        font-weight="900" text-anchor="middle" fill="url(#g)">₹</text>
</svg>`;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

// Save the source SVG
fs.writeFileSync(path.join(OUT, 'icon.svg'), SVG);
console.log('✅ Saved icon.svg');

// Generate all sizes
Promise.all(
  SIZES.map(size =>
    sharp(Buffer.from(SVG))
      .resize(size, size)
      .png()
      .toFile(path.join(OUT, `icon-${size}.png`))
      .then(() => console.log(`✅ icon-${size}.png`))
  )
).then(() => {
  console.log('\n🎉 All icons generated in /icons folder!\n');

  // Create placeholder screenshots
  const screenshotSVG = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#0a0a0f"/>
    <text x="${w/2}" y="${h/2}" font-family="Arial" font-size="48" text-anchor="middle" fill="#00d4aa">Nestfy</text>
  </svg>`;

  return Promise.all([
    sharp(Buffer.from(screenshotSVG(390, 844)))
      .png().toFile(path.join(OUT, 'screenshot-mobile.png'))
      .then(() => console.log('✅ screenshot-mobile.png')),
    sharp(Buffer.from(screenshotSVG(1280, 800)))
      .png().toFile(path.join(OUT, 'screenshot-desktop.png'))
      .then(() => console.log('✅ screenshot-desktop.png')),
  ]);
}).then(() => {
  console.log('\n✅ Done! You can now run: npx serve .\n');
}).catch(console.error);