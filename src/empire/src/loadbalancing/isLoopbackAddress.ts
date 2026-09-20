const IPV4_MAPPED_PREFIX = "::ffff:";
const IPV6_LOOPBACK = "::1";
const IPV4_LOOPBACK_PREFIX = "127.";

/**
 * True for a loopback socket address: anywhere in 127.0.0.0/8, ::1, or
 * either of those in IPv4-mapped IPv6 form. Callers must pass the raw
 * socket address, never a forwarded-for header - a header is chosen by the
 * client, so treating one as proof of loopback would let anyone bypass the
 * guard this exists for.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
    if (!address) {
        return false;
    }

    const unmapped = address.startsWith(IPV4_MAPPED_PREFIX)
        ? address.slice(IPV4_MAPPED_PREFIX.length)
        : address;

    return unmapped === IPV6_LOOPBACK || unmapped.startsWith(IPV4_LOOPBACK_PREFIX);
}
