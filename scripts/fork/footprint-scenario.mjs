// A scripted "realistic session" for measure-footprint.mjs --scenario. It drives a fresh, onboarded
// profile: a local OpenAI-compatible mock provider streams long answers (code in several languages,
// Mermaid, KaTeX), then the session opens mini apps and a built-in browser page on a local heavy page,
// pins two tabs, opens Notes and Settings, runs a Python block, hides the main window and waits.
//
//   node scripts/fork/measure-footprint.mjs --scenario scripts/fork/footprint-scenario.mjs -- <electron> . --no-sandbox
//
// The hidden-page unload timeout is set to 1 minute when the build has that setting.

import { createServer } from 'node:http'

const HIDDEN_WAITS_MINUTES = [2, 6]

const ANSWER = `Here is a worked overview with code in several languages.

${'The quick brown fox jumps over the lazy dog while the answer keeps streaming in small chunks. '.repeat(12)}

\`\`\`python
import math

def primes(limit):
    sieve = [True] * (limit + 1)
    for n in range(2, int(math.sqrt(limit)) + 1):
        if sieve[n]:
            sieve[n * n :: n] = [False] * len(sieve[n * n :: n])
    return [n for n in range(2, limit + 1) if sieve[n]]

print(sum(primes(10000)))
\`\`\`

\`\`\`typescript
export async function fetchAll<T>(urls: string[], parse: (body: string) => T): Promise<T[]> {
  const responses = await Promise.all(urls.map((url) => fetch(url)))
  return Promise.all(responses.map(async (response) => parse(await response.text())))
}
\`\`\`

\`\`\`rust
fn fibonacci(n: u64) -> u64 {
    let (mut a, mut b) = (0, 1);
    for _ in 0..n {
        (a, b) = (b, a + b);
    }
    a
}
\`\`\`

\`\`\`go
func Reverse(s string) string {
	runes := []rune(s)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}
\`\`\`

\`\`\`sql
SELECT customer_id, SUM(total) AS spent
FROM orders
WHERE created_at >= DATE '2026-01-01'
GROUP BY customer_id
HAVING SUM(total) > 1000
ORDER BY spent DESC;
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Request] --> B{Cached?}
  B -- yes --> C[Return cached]
  B -- no --> D[Fetch upstream]
  D --> E[Store] --> C
\`\`\`

The Gaussian integral:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}
$$

And the matrix form of a rotation:

$$
R(\\theta) = \\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}
$$

${'In summary, each piece above is independent and can be reused in a larger program. '.repeat(10)}
`

// A page that holds real memory and keeps painting, standing in for a typical web app.
const HEAVY_PAGE = `<!doctype html><title>Heavy page</title>
<canvas id="c" width="800" height="400"></canvas><div id="list"></div>
<script>
  window.keep = Array.from({ length: 6 }, (_, i) => new Float64Array(1 << 20).fill(i))
  window.objects = Array.from({ length: 200000 }, (_, i) => ({ id: i, label: 'row ' + i }))
  const list = document.getElementById('list')
  for (let i = 0; i < 3000; i++) list.appendChild(document.createElement('div')).textContent = 'Item ' + i
  const ctx = document.getElementById('c').getContext('2d')
  let t = 0
  const draw = () => {
    ctx.fillStyle = 'hsl(' + (t++ % 360) + ',70%,60%)'
    ctx.fillRect(0, 0, 800, 400)
    requestAnimationFrame(draw)
  }
  draw()
</script>`

function startServer() {
  const server = createServer((req, res) => {
    const route = req.url?.split('?')[0]
    if (req.method === 'GET' && route === '/heavy') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(HEAVY_PAGE)
      return
    }
    if (req.method === 'GET' && route === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-chat', object: 'model', created: 0 }] }))
      return
    }
    if (req.method !== 'POST' || route !== '/v1/chat/completions') {
      res.writeHead(404).end()
      return
    }
    req.resume()
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const meta = {
        id: 'mock',
        model: 'mock-chat',
        created: Math.floor(Date.now() / 1000),
        object: 'chat.completion.chunk'
      }
      const send = (delta, finish = null) =>
        res.write(`data: ${JSON.stringify({ ...meta, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      send({ role: 'assistant', content: '' })
      for (let i = 0; i < ANSWER.length; i += 60) {
        send({ content: ANSWER.slice(i, i + 60) })
        await new Promise((resolve) => setTimeout(resolve, 8))
      }
      send({}, 'stop')
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const dataApi = (page, method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const result = await window.api.dataApi.request({ id: `${method}-${path}-${Date.now()}`, method, path, body })
      if (result.status >= 300) throw new Error(`${method} ${path} → ${result.status} ${JSON.stringify(result.error)}`)
      return result.data
    },
    { method, path, body }
  )

const setPreference = (page, key, value) =>
  page
    .evaluate(({ key, value }) => window.api.preference.set(key, value), { key, value })
    .then(() => true)
    .catch(() => false)

const openRoute = (page, path) =>
  page.evaluate(
    (path) => window.dispatchEvent(new CustomEvent('cherry:open-main-route', { detail: { path }, cancelable: true })),
    path
  )

const tabByTitle = (page, title) =>
  page.getByTestId('app-shell-tab-strip').locator('[data-tab-id]').filter({ hasText: title }).first()

async function pinTab(page, title) {
  await tabByTitle(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin Tab', exact: true }).click()
}

async function sendChat(page, assistantName, prompt) {
  const view = page.locator('[data-ui~="chat.view"]:visible')
  const header = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
  await header.hover()
  await header.getByRole('button', { name: 'New Chat', exact: true }).click()
  await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const answers = page.locator('[data-ui~="chat.message"]:visible').filter({ hasText: 'In summary, each piece' })
  await answers.last().waitFor({ timeout: 60_000 })
  await page.locator('[data-ui~="chat.composer.action.pause"]').waitFor({ state: 'hidden', timeout: 60_000 })
}

export default async function scenario({ page, mark, evaluateMain, sleep, log }) {
  const server = await startServer()
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    await setPreference(page, 'topic.naming.enabled', false)
    await setPreference(page, 'chat.code.execution.enabled', true)
    const hasUnloadSetting = await setPreference(page, 'app.memory.unload_hidden_pages_minutes', 1)
    log(`hidden-page unload setting ${hasUnloadSetting ? 'set to 1 minute' : 'not in this build'}`)

    const providerId = 'footprint-mock'
    await dataApi(page, 'POST', '/providers', {
      providerId,
      name: 'Footprint mock',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: `${baseUrl}/v1` } },
      apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
    })
    await dataApi(page, 'PATCH', `/providers/${providerId}`, { isEnabled: true })
    await dataApi(page, 'POST', '/models', [
      { providerId, modelId: 'mock-chat', endpointTypes: ['openai-chat-completions'] }
    ])
    const assistantName = 'Footprint assistant'
    await dataApi(page, 'POST', '/assistants', { name: assistantName, modelId: `${providerId}::mock-chat` })
    for (const appId of ['heavy-a', 'heavy-b']) {
      await dataApi(page, 'POST', '/mini-apps', { appId, name: `Heavy ${appId.slice(-1)}`, url: `${baseUrl}/heavy` })
    }
    await page.reload()
    await page.locator('[data-ui="app.content"]').waitFor()
    await sleep(20_000)
    mark('idle')

    await openRoute(page, '/app/chat')
    await page.locator('[data-ui~="chat.view"]:visible').waitFor()
    for (const topic of ['Explain sorting', 'Explain caching', 'Explain parsing']) {
      await sendChat(page, assistantName, topic)
    }
    mark('after 3 chats')

    // Run the Python block of the last answer (Pyodide loads from its CDN).
    const answer = page.locator('[data-ui~="chat.message"]:visible').last()
    const code = answer.getByText('import math').first()
    await code.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await code.hover()
    await answer.getByRole('button', { name: 'Run', exact: true }).first().click()
    await page
      .waitForFunction(() => document.body.innerText.includes('5736396'), null, { timeout: 120_000 })
      .catch(() => log('the Python block did not finish'))

    await openRoute(page, '/app/mini-app/heavy-a')
    await sleep(3000)
    await openRoute(page, '/app/mini-app/heavy-b')
    await sleep(3000)
    await openRoute(page, `/app/browser?url=${encodeURIComponent(`${baseUrl}/heavy`)}`)
    await sleep(3000)
    await openRoute(page, '/app/notes')
    await sleep(3000)
    await pinTab(page, 'Heavy a')
    await pinTab(page, 'Notes')
    await openRoute(page, '/settings/general')
    await sleep(3000)
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await tabByTitle(page, 'Explain parsing').click()
    await sleep(10_000)
    mark('session peak')

    await evaluateMain(
      "require('electron').BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/windows/main/')).hide()"
    )
    // An attached CDP client keeps the page's visibilityState visible and its timers running.
    await page.context().browser()?.close()
    await sleep(5000)
    mark('hidden')
    let waited = 0
    for (const minutes of HIDDEN_WAITS_MINUTES) {
      await sleep((minutes - waited) * 60_000)
      waited = minutes
      mark(`hidden ${minutes} min`)
    }
  } finally {
    server.close()
  }
}
