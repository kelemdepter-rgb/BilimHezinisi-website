import { describe, expect, it } from "vitest";
import { mergeLoaded, withAnnotation } from "@/lib/reader/annotations";
import type { Annotation } from "@/lib/reader/pages";

/**
 * The reader's bookmark and note lists while the first load is on its way
 * (2026-10-17): the answer is merged with what is on screen, never written
 * over it. Every text is invented.
 */

function item(id: number, page_no: number, text = `خەتكۈچ ${id}`): Annotation {
  return { id, page_no, position: 0, created_at: "2026-10-17T10:00:00.000Z", text };
}

const ids = (list: readonly Annotation[]) => list.map((entry) => entry.id);
const none = new Set<number>();

describe("the first load, merged with what the reader did meanwhile", () => {
  it("keeps an addition the load was read before", () => {
    // The defect: the answer held 1 and 2; 3 was saved after it was read.
    expect(ids(mergeLoaded([item(1, 4), item(2, 9)], [item(3, 6)], none))).toEqual([1, 3, 2]);
  });

  it("lists an addition once when the load was read after it", () => {
    const added = item(3, 6);
    expect(ids(mergeLoaded([item(1, 4), added], [added], none))).toEqual([1, 3]);
  });

  it("does not bring back what was removed after the load was read", () => {
    expect(ids(mergeLoaded([item(1, 4), item(2, 9)], [], new Set([2])))).toEqual([1]);
  });

  it("is the load's answer when nothing happened meanwhile", () => {
    expect(ids(mergeLoaded([item(2, 9), item(1, 4)], [], none))).toEqual([1, 2]);
    expect(mergeLoaded([], [], none)).toEqual([]);
  });

  it("keeps what is on screen when the load brought nothing", () => {
    // A load that failed answers with empty lists (lib/reader/pages.ts).
    expect(ids(mergeLoaded([], [item(5, 1)], none))).toEqual([5]);
  });

  it("orders by page, then by the order they were made", () => {
    expect(ids(mergeLoaded([item(7, 3), item(2, 3)], [item(4, 1)], none))).toEqual([4, 2, 7]);
  });

  it("shows the reader's own copy of a row both sides hold", () => {
    const loaded = item(3, 6, "ئىلگىرى");
    const onScreen = item(3, 6, "ھازىر");
    expect(mergeLoaded([loaded], [onScreen], none)).toEqual([onScreen]);
  });
});

describe("adding a saved row", () => {
  it("puts it in page order", () => {
    expect(ids(withAnnotation([item(1, 4), item(2, 9)], item(3, 6)))).toEqual([1, 3, 2]);
  });

  it("never lists it twice when the load already brought it", () => {
    const added = item(3, 6);
    expect(ids(withAnnotation([item(1, 4), added], added))).toEqual([1, 3]);
  });

  it("does not change the list it was given", () => {
    const list = [item(1, 4)];
    withAnnotation(list, item(2, 1));
    expect(ids(list)).toEqual([1]);
  });
});
