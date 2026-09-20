import http from "http";
import { Context } from "../../http/Context";
import { HttpError } from "../../errors/HttpError";
import { BackendRegistry } from "../backends/BackendRegistry";
import { forwardRequest } from "./forwardRequest";
import { ILoadBalancerMiddleware } from "./ILoadBalancerMiddleware";
import { ILoadBalancingStrategy } from "../strategy/ILoadBalancingStrategy";
import { LoadBalancerOptions } from "./LoadBalancerOptions";
import { resolveRequestId } from "./resolveRequestId";
import { RoundRobinStrategy } from "../strategy/RoundRobinStrategy";

const DEFAULT_TIMEOUT_MS = 30_000;
const SERVICE_UNAVAILABLE = 503;

/**
 * Builds the middleware that turns an Empire app into a small layer-7
 * reverse proxy, spreading requests across backends. A learning and
 * local-development tool, not a production edge: no TLS, no HTTP/2, no
 * WebSocket upgrades, no retries.
 *
 * It is terminal - it never calls next() - so the dashboard, the
 * registration endpoint and any health route must be registered before it,
 * and it must run before any middleware that reads the request body,
 * because the body is streamed through rather than buffered.
 *
 * With no backend eligible it answers 503. With auto-registration that is
 * a normal state, not a misconfiguration: a balancer started before its
 * first backend registers correctly refuses traffic until one arrives.
 *
 * Misconfiguration is rejected here, at construction, rather than
 * surfacing as odd behaviour on the first request.
 */
export function createLoadBalancerMiddleware(options: LoadBalancerOptions): ILoadBalancerMiddleware {

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Load balancer timeoutMs must be a positive number, received ${timeoutMs}`);
    }

    const { registry, ownsRegistry } = resolveRegistry(options);
    const strategy: ILoadBalancingStrategy = options.strategy ?? new RoundRobinStrategy();
    const monitor = options.monitor;
    const agent = new http.Agent({ keepAlive: true });
    let requestCounter = 0;

    monitor?.setStrategyName(strategy.name);

    const middleware = async (ctx: Context): Promise<void> => {
        const requestId = resolveRequestId(ctx, () => `lb-${++requestCounter}`);
        const backend = strategy.select(registry.eligible(), ctx);

        if (!backend) {
            monitor?.publish({ type: "failed", requestId, phase: "select", at: Date.now() });
            throw new HttpError(SERVICE_UNAVAILABLE, "No backend available");
        }

        await forwardRequest(ctx, backend, {
            agent, timeoutMs, requestId, monitor,
            includeQueryString: options.includeQueryString, logger: options.logger,
        });
    };

    return Object.assign(middleware, {
        dispose(): void {
            agent.destroy();

            if (ownsRegistry) {
                registry.dispose();
            }
        },
    });
}

/**
 * Exactly one source of backends is required. Supplying both would leave
 * it ambiguous which wins, and supplying neither would build a balancer
 * that can only ever answer 503.
 */
function resolveRegistry(options: LoadBalancerOptions): { registry: BackendRegistry; ownsRegistry: boolean } {
    if (options.registry && options.backends) {
        throw new Error("Load balancer takes either registry or backends, not both");
    }

    if (options.registry) {
        return { registry: options.registry, ownsRegistry: false };
    }

    if (!options.backends || options.backends.length === 0) {
        throw new Error("Load balancer needs a registry, or at least one entry in backends");
    }

    const registry = new BackendRegistry({ monitor: options.monitor });

    options.backends.forEach((backend) => registry.addStatic(backend));

    return { registry, ownsRegistry: true };
}
