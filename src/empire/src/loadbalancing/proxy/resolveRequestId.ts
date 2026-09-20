import { Context } from "../../http/Context";
import { BACKEND_ID_PATTERN } from "../backends/backendIdentity";

const REQUEST_ID_STATE_KEY = "requestId";

/**
 * The id that ties a dashboard event to the request it describes and, sent
 * upstream as X-Request-Id, to the backend's own logs. If an earlier
 * middleware stored one in ctx.state.requestId it is reused, so the id on
 * the dashboard matches the one everywhere else; otherwise `generate`
 * supplies one. A stored id is only trusted if it uses the same safe
 * character set as backend ids, since it ends up in headers, logs and a web page.
 */
export function resolveRequestId(ctx: Context, generate: () => string): string {
    const existing = ctx.state[REQUEST_ID_STATE_KEY];

    if (typeof existing === "string" && BACKEND_ID_PATTERN.test(existing)) {
        return existing;
    }

    return generate();
}
