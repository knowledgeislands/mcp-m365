/**
 * Tool module aggregator. Each module exports a `registerXxxTools(server)`
 * helper that wires its tools onto an `McpServer`.
 */
import { registerAuthTools } from './auth/index.js'
import { registerCalendarTools } from './calendar/index.js'
import { registerEmailTools } from './email/index.js'
import { registerFolderTools } from './folder/index.js'
import { registerOnedriveTools } from './onedrive/index.js'
import { registerRulesTools } from './rules/index.js'

export { registerAuthTools, registerCalendarTools, registerEmailTools, registerFolderTools, registerOnedriveTools, registerRulesTools }
