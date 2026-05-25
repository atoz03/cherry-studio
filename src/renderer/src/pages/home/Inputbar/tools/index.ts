// Tool registry loader
// Import all tool definitions to register them

import './attachmentTool'
import './mentionModelsTool'
import './newTopicTool'
import './quickPhrasesTool'
import './skillsTool'
import './thinkingTool'
import './webSearchTool'
import './urlContextTool'
import './knowledgeBaseTool'
import './mcpToolsTool'
import './generateImageTool'
import './clearTopicTool'
import './toggleExpandTool'
import './newContextTool'
// Export registry functions
export { getAllTools, getTool, getToolsForScope, registerTool } from '../types'
