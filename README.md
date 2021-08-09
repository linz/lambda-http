# Lambda HTTP wrapper @linzjs/lambda
### _A minimal lambda wrapper for LINZ Javascript development_

* Automatically chooses the correct output event format based on input event (API Gateway, ALB or Cloudfront)
* Generates a request id for every request using a [ULID](https://github.com/ulid/spec) (LINZ standard)
* Automatically Logs the correlationId if one is provided to the function.
* Logs a metadata log of context at the end of the request
* Tracks performance and logs a `duration`  using [@linzjs/metrics](https://www.npmjs.com/package/@linzjs/metrics)

## Why?

This repository wraps the default lambda handler so it can be invoked by ALB, API Gateway or Cloudfront without requiring code changes, 
while also apply the LINZ lambda defaults


```typescript
import {LambdaFunction, LambdaHttpResponse} from '@linzjs/lambda';

export const handler = LambdaFunction.wrap(async (req) => {
    if (req.method !== 'POST') throw new LambdaHttpResponse(400, 'Invalid method');
    return LambdaHttpResponse(200, 'Ok)
});
```

### Request ID generation

A [ULID](https://github.com/ulid/spec) is generated for every request and can be accessed at `req.id` 

every log message generated by `req.log` will by default include the request id.


### Metrics

Simple timing events can be tracked with `timer` see [@linzjs/metrics](https://www.npmjs.com/package/@linzjs/metrics)

```typescript
req.timer.start('some:event');
// Do Work
const duration = req.timer.end('some:event');
```


### Metalog

At the end of every request a metalog is loged with use information for tracking in something like elasticsearch, to add additional keys to the metatalog use `req.set()`

```typescript
req.set('xyz', { x, y, z });
req.set('location', { lat, lon });
```

### Pino logging

Automatically includes a configured [pino](https://github.com/pinojs/pino) logger

```typescript
function doRequest(req) {
    req.log.info('Some Log line'); // Includes useful information like requestId
}
```

This can be overwridden at either the wrapper
```typescript
export const handler = LambdaFunction.wrap(doRequest, myOwnLogger)
```

of set a differnt default
```typescript
LambdaFunction.logger = myOwnLogger;
export const handler = LambdaFunction.wrap(doRequest)
```
