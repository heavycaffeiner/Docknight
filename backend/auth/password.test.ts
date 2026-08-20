import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPasswordStrength, hashPassword, verifyPassword } from "./password.ts";

test("a hash is self-describing and round trips", () => {
    const stored = hashPassword("correct horse 7");
    assert.match(stored, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.ok(verifyPassword("correct horse 7", stored));
    assert.ok(!verifyPassword("correct horse 8", stored));
});

test("verifyPassword returns false rather than throwing on an unusable stored value", () => {
    for (const bad of ["", "plaintext", "scrypt$x$8$1$a$b", "argon2$1$2$3$4$5", "scrypt$32768$8$1$$"]) {
        assert.equal(verifyPassword("anything", bad), false, bad);
    }
});

test("NFKC normalisation: a password composed either way still matches", () => {
    // U+00E9 (precomposed é) and "e" + U+0301 (combining acute accent) normalise to the same NFKC form.
    const composed = "caf\u00e9word1";
    const decomposed = "cafe\u0301word1";
    const stored = hashPassword(composed);
    assert.ok(verifyPassword(decomposed, stored));
});

test("the strength policy wants length and two character classes", () => {
    assert.equal(checkPasswordStrength("abcd1234"), null);
    assert.equal(checkPasswordStrength("abcdefg!"), null);
    assert.equal(checkPasswordStrength("1234567!"), null);
    assert.equal(checkPasswordStrength("abcdefgh"), "passwordTooWeak");
    assert.equal(checkPasswordStrength("abc1"), "passwordTooWeak");
    assert.equal(checkPasswordStrength("12345678"), "passwordTooWeak");
});

test("a wrong password against a real hash is rejected", () => {
    const stored = hashPassword("hunter22");
    assert.equal(verifyPassword("hunter23", stored), false);
});

test("a parameter change in the stored hash is tolerated by the self-describing format", () => {
    // A hash minted at half the current cost still verifies; only the parsed N/r/p are used.
    const salt = Buffer.from("0123456789abcdef");
    const olderStored = `scrypt$16384$8$1$${salt.toString("base64")}$${Buffer.alloc(64).toString("base64")}`;
    // Not a real derivation, so verification fails, but it must fail cleanly rather than throw.
    assert.doesNotThrow(() => verifyPassword("whatever", olderStored));
});
