/**
 * Access-gate reachability of the auth tools. The auth-failure hint leads with
 * the browser route because `m365_auth_start` persists tokens and is therefore
 * a write tool, absent at the default read level. Registration only: no
 * handler runs, so no consent starts and no token store is touched.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import type { AccessLevel, Config } from '../../config/index.js'
import type TokenStorage from '../../main/auth/index.js'
import { makeAccessGatedRegister } from '../../utils/access-level.js'
import { WRITE_REMOTE } from '../../utils/annotations.js'
import { registerAuthTools } from './index.js'

interface Registration {
  name: string
  annotations?: object
}

const registeredAt = (level: AccessLevel): Registration[] => {
  const calls: Registration[] = []
  const server = {
    registerTool: (name: string, config: { annotations?: object }) => {
      calls.push({ name, annotations: config.annotations })
    }
  } as unknown as McpServer
  server.registerTool = makeAccessGatedRegister(server, level, {
    mode: 'off',
    path: '/nonexistent/audit.jsonl',
    maxBytes: 1,
    keep: 1
  })
  registerAuthTools(server, {} as Config, {} as TokenStorage)
  return calls
}

describe('auth tools through the access gate', () => {
  it('omit m365_auth_start at the default read level but keep m365_auth_status', () => {
    const names = registeredAt('read').map((c) => c.name)
    expect(names).not.toContain('m365_auth_start')
    expect(names).toContain('m365_auth_status')
  })

  it('register m365_auth_start at write with unchanged WRITE_REMOTE annotations', () => {
    const authStart = registeredAt('write').find((c) => c.name === 'm365_auth_start')
    expect(authStart?.annotations).toEqual(WRITE_REMOTE)
  })
})
