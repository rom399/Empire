/**
 * Public entry point for the empire-ts package. Re-exports the surface an
 * application is expected to build against - the framework class, request
 * context, built-in middleware, error types, the DI container, and
 * validation - while keeping internal implementation details (Router,
 * RouteMatcher, StaticFileHandler, MimeTypes, sendErrorResponse, and the
 * stream/body helpers under src/http/) out of the published API. See
 * CONTRIBUTING.md and doc/ARCHITECTURE.md for what's considered frozen vs.
 * internal.
 */

export { Empire, EmpireOptions } from "./Empire";
export { Middleware, RouteHandler } from "./types";

export { Context } from "./http/Context";
export { CookieOptions } from "./http/CookieOptions";

export { ILogger } from "./logging/ILogger";
export { ConsoleLogger } from "./logging/ConsoleLogger";

export { HttpError } from "./errors/HttpError";
export { HttpErrorOptions } from "./errors/HttpErrorOptions";
export { BadRequestError } from "./errors/BadRequestError";
export { ValidationError } from "./errors/ValidationError";
export { ValidationIssue } from "./errors/ValidationIssue";

export { createLoggerMiddleware } from "./middleware/LoggerMiddleware";
export { createCorsMiddleware } from "./middleware/CorsMiddleware";
export { CorsOptions } from "./middleware/CorsOptions";
export { CorsPolicy } from "./middleware/CorsPolicy";
export { CorsConfig } from "./middleware/CorsConfig";

export { StaticFileOptions } from "./static/StaticFileOptions";
export { UseStaticFilesOptions } from "./static/UseStaticFilesOptions";

export { validate } from "./validation/validate";
export { ValidationSchemas } from "./validation/ValidationSchemas";
export { Validated } from "./validation/Validated";

export { Resolver } from "./di/Resolver";
export { Factory } from "./di/Factory";
export { Lifetime } from "./di/Lifetime";
export { ServiceToken, createToken } from "./di/ServiceToken";
export { ServiceCollection } from "./di/ServiceCollection";
export { ServiceProvider } from "./di/ServiceProvider";
export { ServiceScope } from "./di/ServiceScope";
export { Disposable, isDisposable } from "./di/Disposable";
