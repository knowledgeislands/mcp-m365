// Folder utilities facade for mail-folder resolution and traversal.
// Delegates to main/email/folder-utils for the implementation.

export {
  fetchFoldersRecursive,
  getAllFolders,
  getFolderIdByName,
  resolveFolderPath,
  WELL_KNOWN_FOLDERS
} from '../email/folder-utils.js'
