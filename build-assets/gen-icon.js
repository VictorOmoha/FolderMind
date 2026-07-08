const pngToIco = require('png-to-ico').default
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const outDir = __dirname

const svg = `<svg width="512" height="512" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="56" fill="#6366f1"/>
  <rect x="40" y="100" width="176" height="116" rx="12" fill="white" opacity="0.95"/>
  <rect x="40" y="84" width="80" height="28" rx="10" fill="white" opacity="0.95"/>
  <line x1="72" y1="136" x2="184" y2="136" stroke="#6366f1" stroke-width="8" stroke-linecap="round"/>
  <line x1="72" y1="158" x2="160" y2="158" stroke="#6366f1" stroke-width="8" stroke-linecap="round" opacity="0.6"/>
  <line x1="72" y1="180" x2="140" y2="180" stroke="#6366f1" stroke-width="8" stroke-linecap="round" opacity="0.35"/>
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
