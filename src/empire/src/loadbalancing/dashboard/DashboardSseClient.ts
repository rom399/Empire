import { LoadBalancerEvent } from "../monitoring/LoadBalancerEvent";
import { SseSink } from "./SseSink";
import { LoadBalancerSnapshot } from "../monitoring/LoadBalancerSnapshot";

/**
 * One connected dashboard tab's end of the event stream, and the policy
 * for a tab that reads slower than events arrive.
 *
 * The visualizer is allowed to be lossy, the topology is not:
 *
 * - While the connection is backed up, request events (dispatched /
 *   completed / failed / aborted) are dropped, and a fresh snapshot is sent
 *   once it drains so the tab resynchronises its counters. A dropped
 *   particle is invisible; a slow tab must never apply memory pressure to
 *   the balancer.
 * - backendAdded / backendRemoved are rare, and a missed one would leave a
 *   ghost or a missing node in the scene, so they are queued instead and
 *   delivered in order on drain. The queue is bounded; overflow falls back
 *   to a snapshot, which carries the same information.
 */
export class DashboardSseClient {

    /** Ceiling on topology events held for a backed-up tab before falling back to a snapshot. */
    public static readonly MAX_QUEUED_TOPOLOGY_EVENTS = 1000;

    private blocked = false;
    private needsSnapshot = false;
    private readonly queuedTopology: LoadBalancerEvent[] = [];

    /** `snapshot` produces the full state sent on connect and again whenever a backed-up tab has to resynchronise. */
    public constructor(
        private readonly sink: SseSink,
        private readonly snapshot: () => LoadBalancerSnapshot
    ) {}

    /** Sends the full current state as a named `snapshot` event. */
    public sendSnapshot(): void {
        this.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
    }

    /** Sends one monitor event as an unnamed message, or drops or queues it if the tab is backed up. */
    public send(event: LoadBalancerEvent): void {
        if (!this.blocked) {
            this.write(`data: ${JSON.stringify(event)}\n\n`);
            return;
        }

        if (!isTopologyEvent(event)) {
            this.needsSnapshot = true;
            return;
        }

        if (this.queuedTopology.length >= DashboardSseClient.MAX_QUEUED_TOPOLOGY_EVENTS) {
            this.queuedTopology.length = 0;
            this.needsSnapshot = true;
            return;
        }

        this.queuedTopology.push(event);
    }

    /**
     * Keeps proxies and browsers from timing an idle stream out. An SSE
     * comment line - clients ignore it. Skipped while backed up, where
     * bytes are already waiting to be sent.
     */
    public sendHeartbeat(): void {
        if (!this.blocked) {
            this.write(": heartbeat\n\n");
        }
    }

    private write(chunk: string): void {
        if (this.sink.write(chunk)) {
            return;
        }

        this.blocked = true;
        this.sink.once("drain", () => this.onDrain());
    }

    private onDrain(): void {
        this.blocked = false;

        while (this.queuedTopology.length > 0 && !this.blocked) {
            const event = this.queuedTopology.shift();

            if (event) {
                this.write(`data: ${JSON.stringify(event)}\n\n`);
            }
        }

        if (this.needsSnapshot && !this.blocked) {
            this.needsSnapshot = false;
            this.sendSnapshot();
        }
    }
}

function isTopologyEvent(event: LoadBalancerEvent): boolean {
    return event.type === "backendAdded" || event.type === "backendRemoved";
}
