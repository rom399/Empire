import { Context } from "../../http/Context";

/**
 * What createLoadBalancerDashboard() returns: a plain Middleware,
 * registrable with app.use(), that also owns open event streams.
 */
export interface ILoadBalancerDashboard {
    (ctx: Context, next: () => Promise<void>): Promise<void>;

    /**
     * Ends every open event stream and stops their keep-alive timers. Call
     * it from your shutdown handler before Empire.stop() - a stream is an
     * in-flight response that never finishes by itself, so without this a
     * browser tab left open holds shutdown until its timeout.
     */
    dispose(): void;
}
