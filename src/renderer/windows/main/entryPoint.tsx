import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { BoundedSwrCacheProvider } from '@renderer/components/BoundedSwrCacheProvider'
import { prepareWindow } from '@renderer/windows/prepareWindow'

import MainApp from './MainApp'

await prepareWindow({ preference: 'all' })

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <BoundedSwrCacheProvider>
    <MainApp />
  </BoundedSwrCacheProvider>
)
