/**
 * Tool module aggregator.
 * Keeps root index.ts focused on server wiring.
 */
import { authTools } from './auth/index.js'
import { calendarTools } from './calendar/index.js'
import { emailTools } from './email/index.js'
import { folderTools } from './folder/index.js'
import { onedriveTools } from './onedrive/index.js'
import { rulesTools } from './rules/index.js'

export { authTools, calendarTools, emailTools, folderTools, onedriveTools, rulesTools }
