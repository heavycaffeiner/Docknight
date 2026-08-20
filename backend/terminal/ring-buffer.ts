/**
 * A bounded scrollback buffer: at most `maxChunks` chunks and at most `maxBytes` total, oldest
 * dropped first. A single chunk larger than the byte cap is truncated from its front before
 * insertion, so the invariant holds after every push.
 */
export class RingBuffer {
    #chunks: string[] = [];
    #bytes = 0;
    readonly #maxChunks: number;
    readonly #maxBytes: number;

    constructor(maxChunks: number, maxBytes: number) {
        this.#maxChunks = maxChunks;
        this.#maxBytes = maxBytes;
    }

    push(chunk: string): void {
        let toInsert = chunk;
        const chunkBytes = Buffer.byteLength(toInsert, "utf8");
        if (chunkBytes > this.#maxBytes) {
            // Truncate from the front, keeping the tail, which is what a scrollback wants.
            toInsert = Buffer.from(toInsert, "utf8").subarray(chunkBytes - this.#maxBytes).toString("utf8");
        }

        this.#chunks.push(toInsert);
        this.#bytes += Buffer.byteLength(toInsert, "utf8");

        while (this.#chunks.length > this.#maxChunks || this.#bytes > this.#maxBytes) {
            const dropped = this.#chunks.shift();
            if (dropped === undefined) break;
            this.#bytes -= Buffer.byteLength(dropped, "utf8");
        }
    }

    join(): string {
        return this.#chunks.join("");
    }
}
