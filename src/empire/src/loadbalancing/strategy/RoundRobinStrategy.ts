import { Backend } from "../Backend";
import { ILoadBalancingStrategy } from "./ILoadBalancingStrategy";

/**
 * Hands out backends in list order, wrapping at the end. The position is
 * taken modulo the *current* list length on every call rather than being
 * an index into a remembered array, so a backend joining or leaving
 * between requests can never push it out of bounds - it only shifts where
 * the sweep lands next. Over any window of N requests against a stable
 * list, every backend receives the same count to within one.
 */
export class RoundRobinStrategy implements ILoadBalancingStrategy {

    /** Shown on the dashboard's hub. */
    public readonly name = "round-robin";

    private nextPosition = 0;

    /** Returns the next backend in rotation, or undefined when the list is empty. */
    public select(backends: readonly Backend[]): Backend | undefined {
        if (backends.length === 0) {
            return undefined;
        }

        const index = this.nextPosition % backends.length;
        this.nextPosition = index + 1;

        return backends[index];
    }
}
