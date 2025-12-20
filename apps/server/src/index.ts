import { createServer } from 'node:http'

import { app } from './app'

const host = process.env.CHERRY_WEB_HOST || '0.0.0.0'
const port = Number(process.env.CHERRY_WEB_PORT || 3001)

const server = createServer(app)

server.listen(port, host, () => {
  process.stdout.write(`Cherry web server listening on http://${host}:${port}\n`)
})
