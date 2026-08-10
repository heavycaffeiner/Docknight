import { one, run } from "../db/index.ts";

export interface UserRow {
    id: number;
    username: string;
    password_hash: string;
    active: number;
    totp_secret: string | null;
    totp_enabled: number;
    totp_last_step: number | null;
}

export function userCount(): number {
    const row = one<{ count: number }>("SELECT count(*) AS count FROM user");
    return row?.count ?? 0;
}

export function findByUsername(username: string): UserRow | undefined {
    return one<UserRow>("SELECT * FROM user WHERE username = :username AND active = 1", {
        username,
    });
}

export function findById(id: number): UserRow | undefined {
    return one<UserRow>("SELECT * FROM user WHERE id = :id", { id });
}

/** The single administrator, used when authentication is disabled. */
export function firstActiveUser(): UserRow | undefined {
    return one<UserRow>("SELECT * FROM user WHERE active = 1 ORDER BY id LIMIT 1");
}

export function createUser(username: string, passwordHash: string): number {
    const result = run(
        "INSERT INTO user(username, password_hash, active, totp_enabled) VALUES (:username, :hash, 1, 0)",
        { username, hash: passwordHash },
    );
    return result.lastInsertRowid;
}

export function updatePasswordHash(id: number, passwordHash: string): void {
    run("UPDATE user SET password_hash = :hash WHERE id = :id", { hash: passwordHash, id });
}

export function setTotpSecret(id: number, secret: string): void {
    run(
        "UPDATE user SET totp_secret = :secret, totp_enabled = 0, totp_last_step = NULL WHERE id = :id",
        { secret, id },
    );
}

export function enableTotp(id: number, acceptedStep: number): void {
    run("UPDATE user SET totp_enabled = 1, totp_last_step = :step WHERE id = :id", {
        step: acceptedStep,
        id,
    });
}

export function clearTotp(id: number): void {
    run(
        "UPDATE user SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = :id",
        { id },
    );
}

export function recordTotpStep(id: number, step: number): void {
    run("UPDATE user SET totp_last_step = :step WHERE id = :id", { step, id });
}
