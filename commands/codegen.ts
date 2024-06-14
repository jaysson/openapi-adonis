import { BaseCommand } from '@adonisjs/core/ace'
import fs from 'node:fs/promises'
import openapiTS from 'openapi-typescript'
import OpenAPIParser from '@readme/openapi-parser'
import { OpenAPIV3_1, OpenAPIV3 } from 'openapi-types'
import { stubsRoot } from '../stubs/main.js'

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
    const api = await OpenAPIParser.validate(inputPath)
    const definitions = await openapiTS(inputPath)
    const outputPath = this.app.makePath(
      this.app.config.get('openapi.outputPath', 'generated/openapi-server')
    )
    await fs.mkdir(outputPath, { recursive: true })
    await fs.writeFile(`${outputPath}/types.d.ts`, definitions)
    // Loop through the paths and create the handlers
    const operations = []
    for (const path in api.paths) {
      const pathItem = api.paths[path]!
      for (const method in pathItem) {
        const operation = pathItem[method as keyof typeof pathItem]!
        if (typeof operation === 'object' && 'operationId' in operation) {
          const operationId = operation.operationId
          const operationInfo = {
            id: operationId,
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
                  : null
              }
            }
          }
          if ('parameters' in operation) {
            operationInfo['parameters'] = `operations.${operationId}['parameters']`
            const parameters = (operation.parameters as OpenAPIV3.ParameterObject[]).filter(
              (parameter) => parameter.in === 'query'
            )
            if (parameters.length > 0) {
              operationInfo['parametersValidationSchema'] =
                this.getVineValidatorForParameters(parameters)
            }
          }
          if ('responses' in operation) {
            const responses = operation.responses as
              | OpenAPIV3_1.ResponsesObject
              | OpenAPIV3.ResponsesObject
            const responseItems = []
            for (const status in responses) {
              const response = responses[status]
              const headers =
                'headers' in response
                  ? `operations.${operationId}['responses']['${status}']['headers']`
                  : undefined
              if ('content' in response) {
                const content = response.content
                for (const mime in content) {
                  responseItems.push(`{
                    status: '${status}',
                    mime: '${mime}',
                    ${headers ? `headers: ${headers},` : ''}
                    body: operations.${operationId}['responses']['${status}']['${mime}'],
                  }`)
                }
              }
            }
            operationInfo['responses'] = responseItems.join('| ')
          }
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
  }

  private getVineValidatorForParameters(parameters: OpenAPIV3.ParameterObject[]) {
    let vineSchemaText = 'vine.object({\n'
    for (const parameter of parameters) {
      if (!parameter.schema) continue
      vineSchemaText += `${parameter.name}: ${this.getVineValidatorForSchema(parameter.schema as OpenAPIV3.SchemaObject)},\n`
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
}
