import { loggerService } from '@logger'
import ApplicationLogo from '@renderer/assets/images/apps/application.png?url'
import GeminiAppLogo from '@renderer/assets/images/apps/gemini.png?url'
import GrokAppLogo from '@renderer/assets/images/apps/grok.png?url'
import PerplexityAppLogo from '@renderer/assets/images/apps/perplexity.webp?url'
import YouLogo from '@renderer/assets/images/apps/you.jpg?url'
import ClaudeAppLogo from '@renderer/assets/images/models/claude.png?url'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png?url'
import type { MinAppType } from '@renderer/types'

const logger = loggerService.withContext('Config:minapps')

// 加载自定义小应用
const loadCustomMiniApp = async (): Promise<MinAppType[]> => {
  try {
    let content: string
    try {
      content = await window.api.file.read('custom-minapps.json')
    } catch (error) {
      // 如果文件不存在，创建一个空的 JSON 数组
      content = '[]'
      await window.api.file.writeWithId('custom-minapps.json', content)
    }

    const customApps = JSON.parse(content)
    const now = new Date().toISOString()

    return customApps.map((app: any) => ({
      ...app,
      type: 'Custom',
      logo: app.logo && app.logo !== '' ? app.logo : ApplicationLogo,
      addTime: app.addTime || now
    }))
  } catch (error) {
    logger.error('Failed to load custom mini apps:', error as Error)
    return []
  }
}

// 初始化默认小应用
const ORIGIN_DEFAULT_MIN_APPS: MinAppType[] = [
  {
    id: 'openai',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    logo: OpenAiProviderLogo,
    bodered: true
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    logo: GeminiAppLogo,
    bodered: true
  },
  {
    id: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    logo: ClaudeAppLogo
  },
  {
    id: 'you',
    name: 'You',
    url: 'https://you.com/',
    logo: YouLogo
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    logo: PerplexityAppLogo
  },
  {
    id: 'grok',
    name: 'Grok',
    url: 'https://grok.com',
    logo: GrokAppLogo,
    bodered: true
  }
]

// 加载自定义小应用并合并到默认应用中
let DEFAULT_MIN_APPS = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]

function updateDefaultMinApps(param) {
  DEFAULT_MIN_APPS = param
}

export { DEFAULT_MIN_APPS, loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateDefaultMinApps }
