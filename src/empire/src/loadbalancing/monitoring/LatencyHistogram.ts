/**
 * A fixed-size latency histogram with log-spaced buckets. Percentiles are
 * read from bucket counts rather than stored samples, so memory stays
 * constant however much traffic flows - at the price of reporting a bucket
 * boundary instead of an exact value (accurate to within one bucket).
 */
export class LatencyHistogram {

    private static readonly BUCKET_COUNT = 20;
    private static readonly FIRST_BOUND_MS = 1;
    private static readonly GROWTH_FACTOR = 1.8;

    /**
     * Upper bound of every bucket but the last, which catches everything
     * slower than the final bound.
     */
    public static readonly BOUNDS_MS: readonly number[] = Array.from(
        { length: LatencyHistogram.BUCKET_COUNT - 1 },
        (_, index) => LatencyHistogram.FIRST_BOUND_MS * LatencyHistogram.GROWTH_FACTOR ** index
    );

    private readonly buckets: number[] = Array.from({ length: LatencyHistogram.BUCKET_COUNT }, () => 0);
    private observed = 0;
    private totalMs = 0;
    private slowestMs = 0;

    /** Index of the bucket a duration falls into. */
    public static bucketIndex(durationMs: number): number {
        const index = LatencyHistogram.BOUNDS_MS.findIndex((bound) => durationMs <= bound);

        return index === -1 ? LatencyHistogram.BUCKET_COUNT - 1 : index;
    }

    /** Files one duration under its bucket. A negative value is treated as zero. */
    public record(durationMs: number): void {
        const clamped = Math.max(0, durationMs);

        this.buckets[LatencyHistogram.bucketIndex(clamped)] += 1;
        this.observed += 1;
        this.totalMs += clamped;
        this.slowestMs = Math.max(this.slowestMs, clamped);
    }

    /** How many durations have been recorded. */
    public get count(): number {
        return this.observed;
    }

    /** The slowest duration recorded, exactly. */
    public get max(): number {
        return this.slowestMs;
    }

    /** The mean duration, exactly - kept as a running sum rather than read from the buckets. */
    public get average(): number {
        return this.observed === 0 ? 0 : this.totalMs / this.observed;
    }

    /**
     * The upper bound of the bucket holding the requested percentile
     * (0-100), capped at the slowest value actually seen so a lone fast
     * request does not report its bucket's ceiling. 0 when nothing has been
     * recorded.
     */
    public percentile(percent: number): number {
        if (this.observed === 0) {
            return 0;
        }

        const rank = Math.max(1, Math.ceil((percent / 100) * this.observed));
        let seen = 0;

        for (let index = 0; index < this.buckets.length; index++) {
            seen += this.buckets[index];

            if (seen >= rank) {
                const bound = LatencyHistogram.BOUNDS_MS[index] ?? this.slowestMs;

                return Math.min(bound, this.slowestMs);
            }
        }

        return this.slowestMs;
    }
}
