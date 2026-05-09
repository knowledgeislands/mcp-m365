#!/usr/bin/env node
/**
 * MCP M365 Server - Main entry point
 *
 * A Model Context Protocol server that provides access to
 * Microsoft 365 services (Outlook, OneDrive)
 * through the Microsoft Graph API.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import config from '../config.js'

import { authTools, calendarTools, emailTools, folderTools, onedriveTools, rulesTools } from '../tools/index.js'

console.error(`${config.SERVER_NAME} starting...`)
console.error(`  SERVER_NAME=${config.SERVER_NAME}`)

const TOOLS = [...authTools, ...calendarTools, ...emailTools, ...folderTools, ...rulesTools, ...onedriveTools]

const withCommonResponseFormat = (inputSchema: any = {}): any => {
  const schema: any = {
    ...inputSchema,
    type: inputSchema.type || 'object',
    properties: {
      ...(inputSchema.properties || {})
    },
    required: Array.isArray(inputSchema.required) ? [...inputSchema.required] : []
  }

  schema.properties.responseFormat = {
    type: 'string',
    enum: ['json'],
    description: 'Response format. JSON is the only supported format.'
  }

  return schema
}

const extractTextFromContent = (content: any[] = []): string => {
  return content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n\n')
}

const ensureStructuredContent = (toolName: string, result: any, args: any): any => {
  if (result.structuredContent) {
    return result.structuredContent
  }

  return {
    type: `${toolName}-response`,
    success: true,
    request: {
      ...args,
      responseFormat: undefined
    },
    text: extractTextFromContent(result.content || [])
  }
}

const applyResponseFormat = (toolName: string, result: any, args: any): any => {
  if (!result || !Array.isArray(result.content)) {
    return result
  }

  const structuredContent = ensureStructuredContent(toolName, result, args)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  }
}

const server = new Server(
  { name: config.SERVER_NAME, version: config.SERVER_VERSION },
  {
    capabilities: {
      tools: {}
    }
  }
)

server.fallbackRequestHandler = async (request: any) => {
  try {
    const { method, params, id } = request
    console.error(`REQUEST: ${method} [${id}]`)

    if (method === 'initialize') {
      console.error(`INITIALIZE REQUEST: ID [${id}]`)
      return {
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: {}
        },
        serverInfo: { name: config.SERVER_NAME, version: config.SERVER_VERSION }
      }
    }

    if (method === 'tools/list') {
      console.error(`TOOLS LIST REQUEST: ID [${id}]`)
      console.error(`TOOLS COUNT: ${TOOLS.length}`)
      console.error(`TOOLS NAMES: ${TOOLS.map((t) => t.name).join(', ')}`)

      return {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: withCommonResponseFormat(tool.inputSchema)
        }))
      }
    }

    if (method === 'resources/list') return { resources: [] }
    if (method === 'prompts/list') return { prompts: [] }

    if (method === 'tools/call') {
      try {
        const { name, arguments: args = {} } = params || {}

        console.error(`TOOL CALL: ${name}`)

        const tool = TOOLS.find((t) => t.name === name)

        if (tool?.handler) {
          const toolResult = await tool.handler(args)
          return applyResponseFormat(name, toolResult, args)
        }

        return {
          error: {
            code: -32601,
            message: `Tool not found: ${name}`
          }
        }
      } catch (error: any) {
        console.error('Error in tools/call:', error)
        return {
          error: {
            code: -32603,
            message: `Error processing tool call: ${error.message}`
          }
        }
      }
    }

    return {
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    }
  } catch (error: any) {
    console.error('Error in fallbackRequestHandler:', error)
    return {
      error: {
        code: -32603,
        message: `Error processing request: ${error.message}`
      }
    }
  }
}

process.on('SIGTERM', () => {
  console.error('SIGTERM received but staying alive')
})

const transport = new StdioServerTransport()
server
  .connect(transport)
  .then(() => console.error(`${config.SERVER_NAME} ready`))
  .catch((error: Error) => {
    console.error(`Connection error: ${error.message}`)
    process.exit(1)
  })
