import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode, checkCode, currentStep, generateCode } from "./totp.ts";

/** RFC 4648 test vectors. */
test("base32 round trips the RFC 4648 vectors", () => {
    assert.equal(base32Encode(Buffer.from("")), "");
    assert.equal(base32Encode(Buffer.from("f")), "MY");
    assert.equal(base32Encode(Buffer.from("fo")), "MZXQ");
    assert.equal(base32Encode(Buffer.from("foo")), "MZXW6");
    assert.equal(base32Encode(Buffer.from("foob")), "MZXW6YQ");
    assert.equal(base32Encode(Buffer.from("fooba")), "MZXW6YTB");
    assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
    assert.equal(base32Decode("MZXW6YTBOI").toString("utf8"), "foobar");
});

/**
 * RFC 6238 appendix B, the SHA-1 rows. The published codes are 8 digits; Docknight uses 6, so the
 * expected values are the last six of each.
 */
test("generateCode matches the RFC 6238 SHA-1 vectors", () => {
    const secret = Buffer.from("12345678901234567890", "utf8");
    const vectors: [number, string][] = [
        [59, "287082"],
        [1_111_111_109, "081804"],
        [1_111_111_111, "050471"],
        [1_234_567_890, "005924"],
        [2_000_000_000, "279037"],
        [20_000_000_000, "353130"],
    ];
    for (const [seconds, expected] of vectors) {
        assert.equal(generateCode(secret, Math.floor(seconds / 30)), expected, `t=${seconds}`);
    }
});

test("checkCode accepts the neighbouring steps and rejects a replay", () => {
    const secretBase32 = base32Encode(Buffer.from("12345678901234567890", "utf8"));
    const now = 59_000;
    const step = currentStep(now);
    const code = generateCode(Buffer.from("12345678901234567890", "utf8"), step);

    assert.equal(checkCode(secretBase32, code, null, now).step, step);
    // The same step is refused once recorded.
    assert.equal(checkCode(secretBase32, code, step, now).step, null);

    const previous = generateCode(Buffer.from("12345678901234567890", "utf8"), step - 1);
    assert.equal(checkCode(secretBase32, previous, null, now).step, step - 1);
});

test("checkCode rejects anything that is not six digits", () => {
    const secretBase32 = base32Encode(Buffer.from("12345678901234567890", "utf8"));
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345"]) {
        assert.equal(checkCode(secretBase32, bad, null).step, null, bad);
    }
});
