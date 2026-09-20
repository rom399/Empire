import { describe, it, expect } from "vitest";
import { LatencyHistogram } from "../../../../src/loadbalancing/monitoring/LatencyHistogram";

describe("LatencyHistogram", () => {

    it("reports zeros when empty", () => {
        const histogram = new LatencyHistogram();

        expect(histogram.count).toBe(0);
        expect(histogram.average).toBe(0);
        expect(histogram.max).toBe(0);
        expect(histogram.percentile(95)).toBe(0);
    });

    it("tracks count, average and max exactly", () => {
        const histogram = new LatencyHistogram();

        [10, 20, 60].forEach((ms) => histogram.record(ms));

        expect(histogram.count).toBe(3);
        expect(histogram.average).toBe(30);
        expect(histogram.max).toBe(60);
    });

    it("caps a percentile at the slowest value seen rather than its bucket ceiling", () => {
        const histogram = new LatencyHistogram();

        histogram.record(5);

        expect(histogram.percentile(99)).toBe(5);
    });

    it("reads percentiles within one bucket of the true value", () => {
        const histogram = new LatencyHistogram();
        const samples = Array.from({ length: 1000 }, (_, index) => 1 + index * 0.9); // 1..900ms, evenly spread

        samples.forEach((ms) => histogram.record(ms));

        for (const percent of [50, 95, 99]) {
            const sorted = [...samples].sort((a, b) => a - b);
            const trueValue = sorted[Math.ceil((percent / 100) * sorted.length) - 1];
            const reported = histogram.percentile(percent);

            const bucketGap = Math.abs(
                LatencyHistogram.bucketIndex(reported) - LatencyHistogram.bucketIndex(trueValue)
            );

            expect(bucketGap).toBeLessThanOrEqual(1);
        }
    });

    it("orders percentiles p50 <= p95 <= p99", () => {
        const histogram = new LatencyHistogram();

        for (let ms = 1; ms <= 500; ms++) {
            histogram.record(ms);
        }

        expect(histogram.percentile(50)).toBeLessThanOrEqual(histogram.percentile(95));
        expect(histogram.percentile(95)).toBeLessThanOrEqual(histogram.percentile(99));
    });

    it("puts anything slower than the last bound in the overflow bucket", () => {
        const histogram = new LatencyHistogram();

        histogram.record(10_000_000);

        expect(histogram.percentile(99)).toBe(10_000_000);
    });

    it("treats a negative duration as zero", () => {
        const histogram = new LatencyHistogram();

        histogram.record(-5);

        expect(histogram.max).toBe(0);
        expect(histogram.average).toBe(0);
    });
});
