/**
 * OneDrive create sharing link functionality
 */
import { callGraphAPI } from '../../utils/graph-api.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleShare = async (args: any): Promise<any> => {
  const itemId = args.itemId
  const path = args.path
  const type = args.type || 'view'
  const scope = args.scope || 'anonymous'

  if (!itemId && !path) {
    return {
      content: [{ type: 'text', text: 'Either itemId or path is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    let resolvedItemId = itemId
    let itemName = ''

    if (!resolvedItemId && path) {
      const itemEndpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}`
      const itemResponse = await callGraphAPI(accessToken, 'GET', itemEndpoint)

      if (!itemResponse?.id) {
        return {
          content: [{ type: 'text', text: `File not found at path: ${path}` }]
        }
      }

      resolvedItemId = itemResponse.id
      itemName = itemResponse.name
    }

    const endpoint = `me/drive/items/${resolvedItemId}/createLink`
    const body = {
      type: type,
      scope: scope
    }

    const response = await callGraphAPI(accessToken, 'POST', endpoint, body)

    if (!response?.link) {
      return {
        content: [{ type: 'text', text: 'Failed to create sharing link.' }]
      }
    }

    const linkInfo = response.link
    const shareText = itemName ? `Sharing link created for "${itemName}":` : 'Sharing link created:'

    return {
      content: [
        {
          type: 'text',
          text: `${shareText}\n\nLink: ${linkInfo.webUrl}\nType: ${type}\nScope: ${scope}\n\nNote: ${scope === 'anonymous' ? 'Anyone with this link can access the file.' : 'Only people in your organization can access.'}`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error creating sharing link: ${error.message}` }]
    }
  }
}

export default handleShare
