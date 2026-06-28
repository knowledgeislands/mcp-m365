export type GraphValue = Record<string, any>

export interface GraphResponse<T = GraphValue> {
  value?: T[]
  '@odata.count'?: number
  '@odata.nextLink'?: string
  [key: string]: any
}
