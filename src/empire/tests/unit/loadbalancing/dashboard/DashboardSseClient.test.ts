import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { DashboardSseClient } from "../../../../src/loadbalancing/dashboard/DashboardSseClient";
import { SseSink } from "../../../../src/loadbalancing/dashboard/SseSink";
import { LoadBalancerEvent } from "../../../../src/loadbalancing/monitoring/LoadBalancerEvent";
import { LoadBalancerSnapshot } from "../../../../src/loadbalancing/monitoring/LoadBalancerSnapshot";

/** A connection that accepts writes until told it is full, the way a slow browser tab's socket behaves. */
class FakeSink extends EventEmitter implements SseSink {
    public readonly written: string[] = [];
    public full = false;
    private budget = Infinity;

    public write(chunk: string): boolean {
        this.written.push(chunk);
        this.budget -= 1;

        if (this.budget <= 0) {
            this.full = true;
        }

        return !this.full;
    }

    /** The socket empties and the tab can take more - optionally only this many writes before it fills again. */
    public drain(acceptBeforeFull = Infinity): void {
        this.full = false;
        this.budget = acceptBeforeFull;
        this.emit("drain");
    }

    /** Every data payload delivered so far, parsed. */
    public events(): LoadBalancerEvent[] {
        return this.written
            .filter((chunk) => chunk.startsWith("data: "))
            .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as LoadBalancerEvent);
    }

    public snapshots(): string[] {
        return this.written.filter((chunk) => chunk.startsWith("event: snapshot"));
    }
}

const dispatched = (requestId: string): LoadBalancerEvent =>
    ({ type: "dispatched", requestId, backendId: "alpha", method: "GET", path: "/", at: 1 });

const added = (id: string): LoadBalancerEvent =>
    ({ type: "backendAdded", backend: { id, url: `http://${id}:1`, source: "registered" }, at: 1 });

const removed = (id: string): LoadBalancerEvent =>
    ({ type: "backendRemoved", backendId: id, reason: "expired", at: 2 });

describe("DashboardSseClient", () => {

    let sink: FakeSink;
    let snapshotCalls: number;
    let client: DashboardSseClient;

    beforeEach(() => {
        sink = new FakeSink();
        snapshotCalls = 0;
        const snapshot = (): LoadBalancerSnapshot => {
            snapshotCalls += 1;
            return { strategy: "round-robin", at: 0, backends: [], unroutable: snapshotCalls };
        };
        client = new DashboardSseClient(sink, snapshot);
    });

    describe("when the connection keeps up", () => {

        it("sends the snapshot as a named event", () => {
            client.sendSnapshot();

            expect(sink.written[0]).toMatch(/^event: snapshot\ndata: \{.*"strategy":"round-robin".*\}\n\n$/);
        });

        it("sends each monitor event as an unnamed data message, in order", () => {
            client.send(dispatched("r1"));
            client.send(added("beta"));
            client.send(dispatched("r2"));

            expect(sink.events().map((event) => event.type)).toEqual(["dispatched", "backendAdded", "dispatched"]);
            expect(sink.written.every((chunk) => chunk.endsWith("\n\n"))).toBe(true);
        });

        it("sends a heartbeat as an SSE comment", () => {
            client.sendHeartbeat();

            expect(sink.written).toEqual([": heartbeat\n\n"]);
        });
    });

    describe("when the connection is backed up", () => {

        function backUp(): void {
            sink.full = true;
            client.send(dispatched("trigger")); // this write is accepted but reports the buffer full
            sink.written.length = 0;
        }

        it("drops request events instead of buffering them", () => {
            backUp();

            for (let index = 0; index < 5000; index++) {
                client.send(dispatched(`r${index}`));
            }

            expect(sink.written).toEqual([]);
        });

        it("sends nothing further, not even a heartbeat, until it drains", () => {
            backUp();

            client.sendHeartbeat();

            expect(sink.written).toEqual([]);
        });

        it("resyncs with a fresh snapshot once it drains, if request events were dropped", () => {
            backUp();
            client.send(dispatched("lost"));

            sink.drain();

            expect(sink.snapshots()).toHaveLength(1);
            expect(sink.events()).toEqual([]);
        });

        it("does not send a snapshot on drain when nothing was dropped", () => {
            backUp();

            sink.drain();

            expect(sink.written).toEqual([]);
        });

        it("never drops a topology event: backendAdded and backendRemoved are queued and delivered in order on drain", () => {
            backUp();

            client.send(dispatched("lost"));
            client.send(added("beta"));
            client.send(dispatched("lost-too"));
            client.send(removed("alpha"));
            client.send(added("gamma"));

            sink.drain();

            expect(sink.events().map((event) => event.type)).toEqual(["backendAdded", "backendRemoved", "backendAdded"]);
            expect(sink.events().map((event) => "backend" in event ? event.backend.id : (event as { backendId: string }).backendId))
                .toEqual(["beta", "alpha", "gamma"]);
        });

        it("delivers queued topology events before the resync snapshot", () => {
            backUp();
            client.send(added("beta"));
            client.send(dispatched("lost"));

            sink.drain();

            const firstEvent = sink.written.findIndex((chunk) => chunk.startsWith("data: "));
            const snapshot = sink.written.findIndex((chunk) => chunk.startsWith("event: snapshot"));

            expect(firstEvent).toBeGreaterThanOrEqual(0);
            expect(firstEvent).toBeLessThan(snapshot);
        });

        it("keeps memory bounded by falling back to a snapshot when the topology queue overflows", () => {
            backUp();

            for (let index = 0; index <= DashboardSseClient.MAX_QUEUED_TOPOLOGY_EVENTS; index++) {
                client.send(added(`b${index}`));
            }

            sink.drain();

            expect(sink.events()).toHaveLength(0);
            expect(sink.snapshots()).toHaveLength(1);
        });

        it("keeps delivering after a drain, treating the next write as normal again", () => {
            backUp();
            sink.drain();

            client.send(dispatched("after"));

            expect(sink.events()).toEqual([dispatched("after")]);
        });

        it("goes back to being backed up if the socket fills again mid-flush, keeping the rest queued", () => {
            backUp();
            client.send(added("one"));
            client.send(added("two"));
            client.send(added("three"));

            sink.drain(1); // room for one write, then full again

            const idsOf = (): string[] => sink.events().map((event) => "backend" in event ? event.backend.id : "");

            expect(idsOf()).toEqual(["one"]);

            sink.drain();

            expect(idsOf()).toEqual(["one", "two", "three"]);
        });
    });
});
