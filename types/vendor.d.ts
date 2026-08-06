/** Browser build of mammoth — same API surface as the Node entry point. */
declare module "mammoth/mammoth.browser" {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}

declare module "word-extractor" {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<Document>;
  }
}
