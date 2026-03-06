const pngToIco = require('png-to-ico').default
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const outDir = __dirname

const svg = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="56" fill="#6366f1"/>
  <rect x="40" y="100" width="176" height="116" rx="12" fill="white" opacity="0.95"/>
  <rect x="40" y="84" width="80" height="28" rx="10" fill="white" opacity="0.95"/>
  <line x1="72" y1="136" x2="184" y2="136" stroke="#6366f1" stroke-width="8" stroke-linecap="round"/>
  <line x1="72" y1="158" x2="160" y2="158" stroke="#6366f1" stroke-width="8" stroke-linecap="round" opacity="0.6"/>
  <line x1="72" y1="180" x2="140" y2="180" stroke="#6366f1" stroke-width="8" stroke-linecap="round" opacity="0.35"/>
</svg>`

async function run() {
  // Generate multiple sizes for ICO
  const sizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers = []
  for (const size of sizes) {
    const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
    pngBuffers.push(buf)
  }
  // Save 256px PNG
  fs.writeFileSync(path.join(outDir, 'icon.png'), pngBuffers[pngBuffers.length - 1])
  // Convert to real ICO
  const ico = await pngToIco(pngBuffers)
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
  console.log('✅ Generated proper icon.ico and icon.png')
}
run().catch(console.error)
