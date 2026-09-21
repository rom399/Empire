import { BackendSnapshot } from "./BackendSnapshot";
import { RecentCall } from "./RecentCall";
import { RouteSnapshot } from "./RouteSnapshot";

/** Everything the drill-down needs to know about one backend. */
export interface BackendDetail {
    backend: BackendSnapshot;

    /** Busiest routes first. */
    routes: RouteSnapshot[];

    /** Newest first, capped at the monitor's recent-call buffer size. */
    recentCalls: RecentCall[];
}
