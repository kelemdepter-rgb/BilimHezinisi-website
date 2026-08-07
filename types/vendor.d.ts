/** Browser build of mammoth — same API surface as the Node entry point. */
declare module "mammoth/mammoth.browser" {
  type MammothResult = { value: string; messages: unknown[] };
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
  /** Keeps headings, bold, lists and tables, which turndown maps to Markdown. */
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
}

declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
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
