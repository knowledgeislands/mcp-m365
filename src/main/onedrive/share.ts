/**
 * OneDrive create sharing link functionality
 */

import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

export const handleShare = async (args: any): Promise<any> => {
  const itemId = args.itemId
  const path = args.path
  const type = args.type || 'view'
  const scope = args.scope || 'anonymous'

  if (!itemId && !path) {
    return errorText('Either itemId or path is required.')
  }

  try {
    const accessToken = await ensureAuthenticated()

    let resolvedItemId = itemId
    let itemName = ''

    if (!resolvedItemId && path) {
      const itemEndpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}`
      const itemResponse = await callGraphAPI(accessToken, 'GET', itemEndpoint)

      if (!itemResponse?.id) {
        return errorText(`File not found at path: ${path}`)
      }

      resolvedItemId = itemResponse.id
      itemName = itemResponse.name
    }

    const endpoint = `me/drive/items/${encodeURIComponent(resolvedItemId)}/createLink`
    const body = {
      type: type,
      scope: scope
    }

    const response = await callGraphAPI(accessToken, 'POST', endpoint, body)

    if (!response?.link) {
      return errorText('Failed to create sharing link.')
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
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error creating sharing link: ${error.message}`)
  }
}

export default handleShare
