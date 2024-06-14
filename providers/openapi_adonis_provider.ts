import type { ApplicationService } from '@adonisjs/core/types'
import { HttpContext, Route, Router } from '@adonisjs/core/http'
import { OpenAPIV3_1 } from 'openapi-types'
import { RouteFn } from '@adonisjs/core/types/http'
import vine from '@vinejs/vine'
import {} from '@readme/openapi-parser'
import type { SchemaTypes } from '@vinejs/vine/types'

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable }

type HandlerInput<P extends Record<string, Serializable>, B extends Serializable> = {
  params: P
  requestBody: B
}

type OperationHandlerFunction<
  P extends Record<string, Serializable>,
  B extends Serializable,
  R extends Serializable,
  T extends HandlerInput<P, B>,
> = (context: HttpContext, input: T) => Promise<R>

type OperationDescription<
  P extends Record<string, Serializable>,
  B extends Serializable,
  R extends Serializable,
  T extends HandlerInput<P, B>,
> = {
  path: string
  method: OpenAPIV3_1.HttpMethods
  operation: OpenAPIV3_1.OperationObject
  handler: OperationHandlerFunction<P, B, R, T>
}

declare module '@adonisjs/core/http' {
  interface Router {
    openapi<
      P extends Record<string, Serializable>,
      B extends Serializable,
      R extends Serializable,
      T extends HandlerInput<P, B>,
    >(
      info: OperationDescription<P, B, R, T>
    ): Route
  }
}

function makeRouteHandler<
  P extends Record<string, Serializable>,
  B extends Serializable,
  R extends Serializable,
  T extends HandlerInput<P, B>,
>(operation: OpenAPIV3_1.OperationObject, handler: OperationHandlerFunction<P, B, R, T>): RouteFn {
  return async (context: HttpContext) => {
    let schema = makeVineSchemaFromOpenAPISchema(
      (operation.requestBody as OpenAPIV3_1.RequestBodyObject).content['application/json']
        .schema as OpenAPIV3_1.SchemaObject
    )
    const body = await vine.validate({ schema, data: context.request.body() })
    schema = makeVineSchemaFromOpenAPIParams(operation.parameters as OpenAPIV3_1.ParameterObject[])
    const params = await vine.validate({ schema, data: context.params })
    const input = {
      body,
      params,
    } as unknown as T
    return handler(context, input)
  }
}

function makeVineSchemaFromOpenAPIParams(params: OpenAPIV3_1.ParameterObject[]): SchemaTypes {
  const fields = params.reduce((acc, param) => {
    const field = makeVineSchemaFromOpenAPISchema(param.schema as OpenAPIV3_1.SchemaObject)
    return { ...acc, [param.name]: field }
  }, {})
  return vine.object(fields)
}

function makeVineSchemaFromOpenAPISchema(schema: OpenAPIV3_1.SchemaObject): SchemaTypes {
  if (schema.type === 'object') {
    const properties = schema.properties!
    const keys = Object.keys(properties)
    const fields = keys.reduce((acc, key) => {
      const fieldSchema = properties[key] as OpenAPIV3_1.SchemaObject
      const field = makeVineSchemaFromOpenAPISchema(fieldSchema)
      return { ...acc, [key]: field }
    }, {})
    return vine.object(fields)
  } else if (schema.type === 'array') {
    return vine.array(makeVineSchemaFromOpenAPISchema(schema.items!))
  } else if (schema.type === 'string') {
    return vine.string()
  } else if (schema.type === 'number') {
    return vine.number()
  } else if (schema.type === 'integer') {
    return vine.number().withoutDecimals()
  } else if (schema.type === 'boolean') {
    return vine.boolean()
  } else {
    throw new Error(`Unsupported schema type: ${schema.type}`)
  }
}

export default class OpenApiAdonisProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    Router.macro('openapi', function (this: Router, info) {
      const { path, method, handler, operation } = info
      const operationId = operation.operationId!
      switch (method) {
        case 'get':
          return this.get(path, makeRouteHandler(operation, handler)).as(operationId)
        case 'post':
          return this.post(path, makeRouteHandler(operation, handler)).as(operationId)
        case 'put':
          return this.put(path, makeRouteHandler(operation, handler)).as(operationId)
        case 'patch':
          return this.patch(path, makeRouteHandler(operation, handler)).as(operationId)
        case 'delete':
          return this.delete(path, makeRouteHandler(operation, handler)).as(operationId)
        default:
          throw new Error(`Unsupported method: ${method}`)
      }
    })
  }
}
