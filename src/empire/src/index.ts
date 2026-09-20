/**
 * Public entry point for the empire-ts package. Re-exports the surface an
 * application is expected to build against - the framework class, request
 * context, built-in middleware, error types, the DI container,
 * validation, and the load balancer - while keeping internal implementation
 * details (Router, RouteMatcher, StaticFileHandler, MimeTypes,
 * sendErrorResponse, the stream/body helpers under src/http/, and the
 * proxy and dashboard internals under src/loadbalancing/) out of the
 * published API. See
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
export { createRouteHeaderMiddleware, ROUTE_HEADER } from "./middleware/RouteHeaderMiddleware";

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

export { createLoadBalancerMiddleware } from "./loadbalancing/proxy/LoadBalancerMiddleware";
export { ILoadBalancerMiddleware } from "./loadbalancing/proxy/ILoadBalancerMiddleware";
export { LoadBalancerOptions } from "./loadbalancing/proxy/LoadBalancerOptions";
export { ILoadBalancingStrategy } from "./loadbalancing/strategy/ILoadBalancingStrategy";
export { RoundRobinStrategy } from "./loadbalancing/strategy/RoundRobinStrategy";
export { Backend } from "./loadbalancing/Backend";
export { BackendInfo } from "./loadbalancing/BackendInfo";

export { BackendRegistry } from "./loadbalancing/backends/BackendRegistry";
export { BackendRegistryOptions } from "./loadbalancing/backends/BackendRegistryOptions";
export { createBackendRegistrationEndpoint } from "./loadbalancing/registration/BackendRegistrationEndpoint";
export { BackendRegistrationEndpointOptions } from "./loadbalancing/registration/BackendRegistrationEndpointOptions";
export { LoadBalancerRegistration } from "./loadbalancing/registration/LoadBalancerRegistration";
export { LoadBalancerRegistrationOptions } from "./loadbalancing/registration/LoadBalancerRegistrationOptions";
export { LoadBalancerRegistrationError } from "./loadbalancing/registration/LoadBalancerRegistrationError";

export { LoadBalancerMonitor } from "./loadbalancing/monitoring/LoadBalancerMonitor";
export { LoadBalancerMonitorOptions } from "./loadbalancing/monitoring/LoadBalancerMonitorOptions";
export { LoadBalancerEvent, LoadBalancerFailurePhase } from "./loadbalancing/monitoring/LoadBalancerEvent";
export { LoadBalancerSnapshot } from "./loadbalancing/monitoring/LoadBalancerSnapshot";
export { BackendSnapshot } from "./loadbalancing/monitoring/BackendSnapshot";
export { BackendDetail } from "./loadbalancing/monitoring/BackendDetail";
export { RouteSnapshot } from "./loadbalancing/monitoring/RouteSnapshot";
export { RecentCall } from "./loadbalancing/monitoring/RecentCall";

export { createLoadBalancerDashboard } from "./loadbalancing/dashboard/LoadBalancerDashboard";
export { ILoadBalancerDashboard } from "./loadbalancing/dashboard/ILoadBalancerDashboard";
export { LoadBalancerDashboardOptions } from "./loadbalancing/dashboard/LoadBalancerDashboardOptions";
