# OpenAPI AdonisJS

A spec first approach to building AdonisJS applications using OpenAPI.

Unlike other OpenAPI packages for AdonisJS, this package is designed to be used with a spec first approach. This means
that you define your API using OpenAPI and then generate the routes for your application.

## Installation

  ```bash
  npm i openapi-adonisjs
  ```

## Usage

Create a new OpenAPI spec file in the `resources/openapi` folder of your project. For
example, `resources/openapi/specs.yaml`.

Run `node ace openapi:codegen` to generate the routes for your application.

This will generate the routes in the `generated/openapi-server` folder of your project. Add these to the aliases
in `tsconfig.json` and `package.json`.

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "#generated": [
        "generated/*"
      ]
    }
  }
}
```

The operations with tags will generate an interface and a factory function. You should implement these interfaces in
your controllers and register the routes in your `start/routes.ts` file using the factory function.

The operations without tags will generate a factory function only. These functions accept a handler which you need to
implement.

The second argument to the class methods and handler functions will be a an object with validated request body and
parameters. You should return a serializable object of the corresponding response type.

```typescript
// app/controllers/pets_controller.ts
import type {PetsContract} from '#generated/openapi-server'

export default class PetsController implements PetsContract {
  async create(ctx, {body, params}) {
    // Implement the create method
  }
}

// start/routes.ts
import router from '@adonisjs/core/services/router'
import PetsController from '#app/controllers/pets_controller'

router.openapi(petsControllerFactory(PetsController))
router.openapi(createPetFactory((ctx, {body, params}) => {
  // Implement the createPet handler
}))

// Serve the OpenAPI spec
router.openapiDocs('/specs.yaml')

// Swagger UI, requires `router.openapiDocs` to be called first
router.openapiUi('/docs')
```

Please take a look at the `example` folder for a complete example implementing the petstore API.

## Configuration

You can configure the package by updating the `config/openapi.ts` file in your project.

## Roadmap
- [ ] Add support for OpenAPI security
- [ ] Add a command to check if all the routes are implemented
