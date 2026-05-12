export interface ToolTextContent {
  type: 'text'
  text: string
}

export interface ToolResult {
  content: ToolTextContent[]
  isError?: boolean
}

export type ToolArgs = Record<string, unknown>

export type GraphValue = Record<string, any>

export interface GraphResponse<T = GraphValue> {
  value?: T[]
  '@odata.count'?: number
  '@odata.nextLink'?: string
  [key: string]: any
}
