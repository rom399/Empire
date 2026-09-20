import { Backend } from "../Backend";
import { IInFlightSource } from "./IInFlightSource";
import { ILoadBalancingStrategy } from "./ILoadBalancingStrategy";

/**
 * Sends each request to the backend with the fewest requests in flight.
 * "Connections" here means requests in flight, not TCP connections: this is
 * a layer-7 proxy with a keep-alive pool per backend, so sockets and
 * requests are different things, and requests are what a backend is
 * actually busy with.
 *
 * Ties are broken by scanning from a rotating position rather than always
 * from the front, so with equal counts it hands out backends in order -
 * an idle balancer behaves exactly like round robin, and only diverges once
 * backends genuinely differ in how long they hold work.
 *
 * The counts must move for this to mean anything, which is why the
 * middleware insists the source is the monitor it reports to (see
 * ILoadBalancingStrategy.inFlightSource). Known limit: a backend that fails
 * fast settles its requests instantly, so it looks least loaded and attracts
 * traffic - fixing that needs an error-rate penalty, a later slice.
 */
export class LeastConnectionsStrategy implements ILoadBalancingStrategy {

    /** Shown on the dashboard's hub. */
    public readonly name = "least-connections";

    /** The source the counts are read from - the balancer's own monitor. */
    public readonly inFlightSource: IInFlightSource;

    private nextPosition = 0;

    /** `inFlightSource` must be the monitor the load balancer middleware reports to. */
    public constructor(inFlightSource: IInFlightSource) {
        this.inFlightSource = inFlightSource;
    }

    /**
     * Returns the backend with the fewest requests in flight, or undefined
     * when the list is empty. Counts are read fresh on every call - they
     * change with every request, and select() runs synchronously right before
     * the chosen backend's request is counted, so two requests arriving in the
     * same tick can never both see it as idle.
     */
    public select(backends: readonly Backend[]): Backend | undefined {
        if (backends.length === 0) {
            return undefined;
        }

        const start = this.nextPosition % backends.length;
        let chosenIndex = start;
        let fewest = this.inFlightSource.inFlight(backends[start].id);

        for (let offset = 1; offset < backends.length; offset++) {
            const index = (start + offset) % backends.length;
            const count = this.inFlightSource.inFlight(backends[index].id);

            if (count < fewest) {
                fewest = count;
                chosenIndex = index;
            }
        }

        this.nextPosition = chosenIndex + 1;

        return backends[chosenIndex];
    }
}
