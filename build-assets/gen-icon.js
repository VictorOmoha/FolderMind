const pngToIco = require('png-to-ico').default
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const outDir = __dirname

// Brand mark from src/renderer/src/components/Icons.tsx (FolderMark), scaled up:
// copper folder + dark "mind" dot on the app's near-black surface.
const svg = `<svg width="512" height="512" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="56" fill="#111218"/>
  <rect x="0.75" y="0.75" width="254.5" height="254.5" rx="55.25" fill="none" stroke="#2a2d38" stroke-width="1.5"/>
  <g transform="translate(39.3, 39.4) scale(7.4)">
    <path d="M3 6.5C3 5.12 4.12 4 5.5 4h4.05c.73 0 1.42.32 1.9.87l.9 1.06c.28.34.71.53 1.15.53h5A2.5 2.5 0 0 1 21 8.96v8.54A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Z" fill="#d08954"/>
    <circle cx="12" cy="13.5" r="2.4" fill="#1c1208" opacity="0.9"/>
  </g>
</svg>`

async function run() {
  // ICO tops out at 256px; electron-builder/macOS require the master PNG to be >= 512px.
  const icoSizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers = []
  for (const size of icoSizes) {
    const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
    pngBuffers.push(buf)
  }
  // Save a 512px master PNG for app packaging
  const masterPng = await sharp(Buffer.from(svg)).resize(512, 512).png().toBuffer()
  fs.writeFileSync(path.join(outDir, 'icon.png'), masterPng)
  // Convert the multi-size set to a real ICO
  const ico = await pngToIco(pngBuffers)
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
  console.log('✅ Generated proper icon.ico (multi-size) and 512px icon.png')
}
run().catch(console.error)
