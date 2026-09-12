import test from "node:test";
import assert from "node:assert/strict";
import { hasCompleteCoverage, planPitchCaptures, sortEvidencePlays } from "./evidence-core.mjs";

test("sorts by game time instead of click order", () => {
    const sorted = sortEvidencePlays([{ atBatIndex: 60, eventIndex: 4 }, { atBatIndex: 2, eventIndex: 3 }, { atBatIndex: 38, eventIndex: 5 }]);
    assert.deepEqual(sorted.map((item) => item.atBatIndex), [2, 38, 60]);
});

test("plans long at-bats with one-pitch overlap", () => {
    assert.deepEqual(planPitchCaptures(4), [[1, 2, 3, 4]]);
    assert.deepEqual(planPitchCaptures(8), [[1, 2, 3, 4, 5], [5, 6, 7, 8]]);
    assert.deepEqual(planPitchCaptures(12), [[1, 2, 3, 4, 5], [5, 6, 7, 8, 9], [9, 10, 11, 12]]);
});

test("requires complete pitch coverage and permits overlap", () => {
    assert.equal(hasCompleteCoverage([1, 2, 3, 4, 5, 6], [{ coveredPitchNumbers: [1, 2, 3, 4] }, { coveredPitchNumbers: [4, 5, 6] }]), true);
    assert.equal(hasCompleteCoverage([1, 2, 3, 4, 5, 6], [{ coveredPitchNumbers: [1, 2, 3] }, { coveredPitchNumbers: [5, 6] }]), false);
});
