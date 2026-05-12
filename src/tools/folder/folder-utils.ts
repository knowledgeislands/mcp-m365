// Folder utilities facade for mail-folder resolution and traversal
// Delegates to tools/email/folder-utils for implementation

export {
  fetchFoldersRecursive,
  getAllFolders,
  getFolderIdByName,
  resolveFolderPath,
  WELL_KNOWN_FOLDERS
} from '../email/folder-utils.js'
