import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPasswordStrength, hashPassword, needsRehash, verifyPassword } from "./password.ts";

test("a hash is self-describing and verifies", () => {
    const stored = hashPassword("correct horse 7");
    assert.match(stored, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.ok(verifyPassword("correct horse 7", stored));
    assert.ok(!verifyPassword("correct horse 8", stored));
    assert.ok(!needsRehash(stored));
});

test("verifyPassword returns false rather than throwing on an unusable stored value", () => {
    for (const bad of ["", "plaintext", "scrypt$x$8$1$a$b", "argon2$1$2$3$4$5", "scrypt$32768$8$1$$"]) {
        assert.equal(verifyPassword("anything", bad), false, bad);
    }
});

test("NFKC normalisation means an equivalent password still matches", () => {
    // U+FF41 fullwidth 'a' normalises to 'a'.
    const stored = hashPassword("a1234567");
    assert.ok(verifyPassword("ａ1234567", stored));
});

test("the strength policy wants length and two character classes", () => {
    assert.equal(checkPasswordStrength("abcd1234"), null);
    assert.equal(checkPasswordStrength("abcdefg!"), null);
    assert.equal(checkPasswordStrength("1234567!"), null);
    assert.equal(checkPasswordStrength("abcdefgh"), "passwordTooWeak");
    assert.equal(checkPasswordStrength("abc1"), "passwordTooWeak");
    assert.equal(checkPasswordStrength("12345678"), "passwordTooWeak");
});

test("an older parameter set is flagged for rehash", () => {
    assert.ok(needsRehash("scrypt$16384$8$1$c2FsdA==$a2V5"));
});
