/**
 * Email concern — library-usable implementation behind the `m365_email_*`
 * message tools. The thin `tools/email` layer validates args and maps these
 * results/errors to MCP envelopes; nothing here prints or reads ambient state.
 */
export { handleDeleteEmail } from './delete.js'
export { handleDraftEmail } from './draft.js'
export { fetchFoldersRecursive, getAllFolders, getFolderIdByName, resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'
export { type EmailListResult, emailListResultSchema, handleListEmails } from './list.js'
export { handleMarkAsRead } from './mark-as-read.js'
export { handleReadEmail } from './read.js'
export { type EmailSearchResult, emailSearchResultSchema, handleSearchEmails } from './search.js'
export { handleSendEmail } from './send.js'
