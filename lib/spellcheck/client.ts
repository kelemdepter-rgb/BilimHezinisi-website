import {
  CORRECTIONS_URL,
  DICT_URL,
  type FromWorker,
  type ToWorker,
} from "@/lib/spellcheck/protocol";

export type SpellStatus = "off" | "loading" | "ready" | "failed";

/**
 * Main-thread handle on the spellcheck worker.
 *
 * Created only when someone switches spellcheck on inside the notebook, so a
 * visitor who never opens it never downloads the dictionary — the library and
 * the reader stay untouched by it.
 */
export class SpellChecker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (value: never) => void>();

  status: SpellStatus = "off";
  words = 0;
  loadMs = 0;
  fromCache = false;

  constructor(private readonly onStatusChange: (status: SpellStatus) => void) {}

  /** Idempotent: repeated calls while loading do not start a second worker. */
  start(): void {
    if (this.worker) return;
    this.setStatus("loading");

    try {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url));
    } catch {
      this.setStatus("failed");
      return;
    }

    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    this.worker.onerror = () => this.setStatus("failed");
    this.send({ type: "init", dictUrl: DICT_URL, correctionsUrl: CORRECTIONS_URL });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.setStatus("off");
  }

  setPersonal(words: string[]): void {
    if (this.worker) this.send({ type: "personal", words });
  }

  /** Which of these words are misspelled. Empty while the dictionary loads. */
  check(words: string[]): Promise<string[]> {
    return this.ask<string[]>((id) => ({ type: "check", id, words }));
  }

  /** Ranked corrections for one word. */
  suggest(word: string): Promise<string[]> {
    return this.ask<string[]>((id) => ({ type: "suggest", id, word }));
  }

  private ask<T>(build: (id: number) => ToWorker): Promise<T> {
    if (!this.worker || this.status === "failed") return Promise.resolve([] as T);
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve as (value: never) => void);
      this.send(build(id));
    });
  }

  private send(message: ToWorker) {
    this.worker?.postMessage(message);
  }

  private receive(message: FromWorker) {
    if (message.type === "ready") {
      this.words = message.words;
      this.loadMs = message.loadMs;
      this.fromCache = message.fromCache;
      this.setStatus("ready");
      return;
    }
    if (message.type === "failed") {
      this.setStatus("failed");
      return;
    }

    const resolve = this.pending.get(message.id);
    if (!resolve) return;
    this.pending.delete(message.id);
    (resolve as unknown as (value: string[]) => void)(
      message.type === "checked" ? message.wrong : message.list,
    );
  }

  private setStatus(status: SpellStatus) {
    this.status = status;
    this.onStatusChange(status);
  }
}
