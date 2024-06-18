import { BaseCommand } from '@adonisjs/core/ace'
import fs from 'node:fs/promises'
import openapiTS from 'openapi-typescript'
import OpenAPIParser from '@readme/openapi-parser'
import { OpenAPIV3_1, OpenAPIV3 } from 'openapi-types'
import { stubsRoot } from '../stubs/main.js'
import string from '@poppinss/utils/string'

type OperationTemplateData = {
  id: string
  path: string
  method: string
  requestBodyType?: string
  requestBodyValidationSchema?: string
  headerParamsValidationSchema?: string
  pathParamsValidationSchema?: string
  queryParamsValidationSchema?: string
  responseTypes?: string
}

export default class Codegen extends BaseCommand {
  static commandName = 'openapi:codegen'
  static description = 'Generate server code from the configured OpenAPI specs'
  static options = {
    startApp: true,
  }

  async run(): Promise<void> {
    const inputPath = this.app.makePath(
      this.app.config.get('openapi.specPath', 'resources/openapi/specs.yaml')
    )
    const outputPath = this.app.makePath(
      this.app.config.get('openapi.outputPath', 'generated/openapi-server')
    )

    // Generate the typescript types
    const api = await OpenAPIParser.validate(inputPath)
    const definitions = await openapiTS(inputPath)
    await fs.mkdir(outputPath, { recursive: true })
    await fs.writeFile(`${outputPath}/types.d.ts`, definitions)

    // Loop through the paths and create the handlers, while collecting tags
    const controllers = new Map<string, string[]>()
    const operations: OperationTemplateData[] = []
    for (const path in api.paths) {
      const pathItem = api.paths[path as keyof typeof api.paths]!
      for (const method in pathItem) {
        const operation = pathItem[method as keyof typeof pathItem]!
        if (typeof operation === 'object' && 'operationId' in operation) {
          const operationId = operation.operationId as string
          if ('tags' in operation && operation.tags) {
            const tags = (operation as unknown as OpenAPIV3.OperationObject).tags!
            const controllerTag = string.camelCase(tags[0])
            if (!controllers.has(controllerTag)) {
              controllers.set(controllerTag, [])
            }
            controllers.get(controllerTag)!.push(operationId)
          }
          const operationInfo: OperationTemplateData = {
            id: operationId,
            path: this.openapiPathToAdonisPath(path),
            method: method.toLowerCase(),
          }
          if ('requestBody' in operation) {
            const requestBody = operation.requestBody as
              | OpenAPIV3_1.RequestBodyObject
              | OpenAPIV3.ReferenceObject
            if ('content' in requestBody) {
              const content = requestBody.content
              for (const mime in content) {
                operationInfo['requestBodyType'] =
                  `operations.${operationId}['requestBody']['${mime}']`
                const schema = content[mime].schema
                operationInfo['requestBodyValidationSchema'] = schema
                  ? this.getVineValidatorForSchema(schema)
                  : undefined
              }
            }
          }
          if ('parameters' in operation) {
            const headerParameters = (operation.parameters as OpenAPIV3.ParameterObject[]).filter(
              (parameter) => parameter.in === 'header'
            )
            const pathParameters = (operation.parameters as OpenAPIV3.ParameterObject[]).filter(
              (parameter) => parameter.in === 'path'
            )
            const queryParameters = (operation.parameters as OpenAPIV3.ParameterObject[]).filter(
              (parameter) => parameter.in === 'query'
            )
            if (headerParameters.length > 0) {
              operationInfo['headerParamsValidationSchema'] =
                this.getVineValidatorForParameters(headerParameters)
            }
            if (pathParameters.length > 0) {
              operationInfo['pathParamsValidationSchema'] =
                this.getVineValidatorForParameters(pathParameters)
            }
            if (queryParameters.length > 0) {
              operationInfo['queryParamsValidationSchema'] =
                this.getVineValidatorForParameters(queryParameters)
            }
          }
          if ('responses' in operation) {
            const responses = operation.responses as
              | OpenAPIV3_1.ResponsesObject
              | OpenAPIV3.ResponsesObject
            const responseTypes: string[] = []
            for (const status in responses) {
              const response = responses[status]
              const headers =
                'headers' in response
                  ? `operations['${operationId}']['responses']['${status}']['headers']`
                  : undefined
              if ('content' in response) {
                const content = response.content!
                if (Object.keys(content).length === 0) {
                  responseTypes.push(`{
                    status: '${status}',
                  }`)
                }
                for (const contentType in content) {
                  responseTypes.push(`{
                    status: '${status}',
                    contentType: '${contentType}',
                    ${headers ? `headers: ${headers},` : ''}
                    body: ${
                      content[contentType]
                        ? `operations['${operationId}']['responses']['${status}']['content']['${contentType}']`
                        : ''
                    },
                  }`)
                }
              }
            }
            operationInfo['responseTypes'] = responseTypes.join(' | ')
          }
          // console.log(operationInfo)
          operations.push(operationInfo)
        }
      }
    }
    const codeMods = await this.createCodemods()
    await codeMods.makeUsingStub(stubsRoot, 'operations.stub', {
      outputPath: this.app.makePath(
        this.app.config.get('openapi.outputPath', 'generated/openapi-server')
      ),
      operations,
    })
    await codeMods.makeUsingStub(stubsRoot, 'controllers.stub', {
      outputPath: this.app.makePath(
        this.app.config.get('openapi.outputPath', 'generated/openapi-server')
      ),
      controllers: Array.from(controllers.entries()),
      operations,
    })
  }

  private getVineValidatorForParameters(parameters: OpenAPIV3.ParameterObject[]) {
    let vineSchemaText = 'vine.object({\n'
    for (const parameter of parameters) {
      if (!parameter.schema) {
        if (parameter.required) {
          vineSchemaText += `${parameter.name}: vine.string(),\n`
        } else {
          vineSchemaText += `${parameter.name}: vine.string().optional(),\n`
        }
        continue
      }
      vineSchemaText += `${parameter.name}: ${this.getVineValidatorForSchema(parameter.schema as OpenAPIV3.SchemaObject, parameter.required)},\n`
    }
    vineSchemaText += '})'
    return vineSchemaText
  }

  private getVineValidatorForSchema(
    schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
    required = false
  ): string {
    let vineSchemaText = ''
    if ('type' in schema) {
      if (schema.type === 'string') {
        vineSchemaText += 'vine.string()'
        if (schema.enum) {
          vineSchemaText += `.enum(${JSON.stringify(schema.enum)})`
        }
      } else if (schema.type === 'number') {
        vineSchemaText += 'vine.number()'
      } else if (schema.type === 'integer') {
        vineSchemaText += 'vine.number().withoutDecimals()'
      } else if (schema.type === 'boolean') {
        vineSchemaText += 'vine.boolean()'
      } else if (schema.type === 'object') {
        vineSchemaText += 'vine.object({\n'
        for (const prop in schema.properties) {
          vineSchemaText += `${prop}: ${this.getVineValidatorForSchema(schema.properties[prop] as any, schema.required?.includes(prop))},\n`
        }
        vineSchemaText += '})'
      } else if (schema.type === 'array') {
        vineSchemaText += 'vine.array().items('
        if ('items' in schema) {
          vineSchemaText += this.getVineValidatorForSchema(schema.items as any)
        }
        vineSchemaText += ')'
      }
    }
    if (!required) {
      vineSchemaText += '.optional()'
    }
    return vineSchemaText
  }

  private openapiPathToAdonisPath(path: string) {
    return path.replace(/{([^}]+)}/g, ':$1')
  }
}
