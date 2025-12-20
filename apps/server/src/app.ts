import cors from 'cors'
import express from 'express'

import filesRouter from './routes/files'
import healthRouter from './routes/health'
import knowledgeRouter from './routes/knowledge'
import mcpRouter from './routes/mcp'
import proxyRouter from './routes/proxy'

const app = express()

app.use(
  cors({
    origin: true,
    credentials: true
  })
)

app.use(express.json({ limit: '50mb' }))

app.use('/api', healthRouter)
app.use('/api', proxyRouter)
app.use('/api/files', filesRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/mcp', mcpRouter)

export { app }
