/**
 * A bounded scrollback. Pushing past either the chunk count or the byte cap drops from the
 * front, so a pty emitting a megabyte per second costs a fixed amount of memory per terminal.
 */
export class RingBuffer {
    readonly maxChunks: number;
    readonly maxBytes: number;
    #chunks: string[] = [];
    #bytes = 0;

    constructor(maxChunks: number, maxBytes: number) {
        this.maxChunks = maxChunks;
        this.maxBytes = maxBytes;
    }

    push(chunk: string): void {
        if (chunk === "") return;
        this.#chunks.push(chunk);
        this.#bytes += Buffer.byteLength(chunk, "utf8");
        // The last chunk is never dropped: a pty can emit more than the cap in one write, and
        // discarding it would blank the pane instead of trimming it.
        while (
            this.#chunks.length > 1 &&
            (this.#chunks.length > this.maxChunks || this.#bytes > this.maxBytes)
        ) {
            const dropped = this.#chunks.shift();
            if (dropped === undefined) break;
            this.#bytes -= Buffer.byteLength(dropped, "utf8");
        }
    }

    join(): string {
        return this.#chunks.join("");
    }

    get byteLength(): number {
        return this.#bytes;
    }

    get chunkCount(): number {
        return this.#chunks.length;
    }

    clear(): void {
        this.#chunks = [];
        this.#bytes = 0;
    }
}
