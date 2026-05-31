/**
 * Mail-folder concern — library-usable implementation behind the
 * `m365_email_folder*` / `m365_email_messages_move` tools.
 */
export { handleCreateFolder } from './create.js'
export { handleDeleteFolder } from './delete.js'
export { fetchFoldersRecursive, getAllFolders, getFolderIdByName, resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'
export { type FolderListResult, folderListResultSchema, handleListFolders } from './list.js'
export { handleMoveEmails } from './move.js'
export { handleRenameFolder } from './rename.js'
