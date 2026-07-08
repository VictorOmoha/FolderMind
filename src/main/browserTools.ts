import puppeteer, { Browser, Page } from 'puppeteer'

export async function runBrowserSession(
  url: string,
  script?: string,
  timeoutMs: number = 30000
): Promise<string> {
  let browser: Browser | null = null
  try {
    // Only allow http(s). Block file://, chrome://, and other schemes that would turn
    // this into a local-file-read / SSRF primitive driven by model-supplied URLs.
    let parsed: URL
    try { parsed = new URL(url) } catch { return `Browser session refused: invalid URL "${url}".` }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `Browser session refused: only http(s) URLs are allowed (got "${parsed.protocol}").`
    }
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const page: Page = await browser.newPage()
    page.setDefaultNavigationTimeout(timeoutMs)
    page.setDefaultTimeout(timeoutMs)

    await page.goto(url, { waitUntil: 'networkidle2' })

    if (!script || !script.trim()) {
      // Default to parsing the full text and HTML snapshot
      const content = await page.evaluate(() => {
        return {
          title: document.title,
          text: document.body.innerText,
          htmlPreview: document.documentElement.outerHTML.substring(0, 1000)
        }
      })
      return JSON.stringify(content, null, 2)
    } else {
      // Execute the custom inject script
      const result = await page.evaluate(script)
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    }
  } catch (err: any) {
    return `Browser session failed: ${err.message}`
  } finally {
    if (browser) await browser.close()
  }
}
