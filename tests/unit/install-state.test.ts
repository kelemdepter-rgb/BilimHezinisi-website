import { describe, expect, it } from "vitest";
import {
  decideInstallState,
  isAppleMobile,
  isInAppBrowser,
  type InstallInput,
  type InstallState,
} from "@/lib/pwa/install-state";

/**
 * What the menu's «ئەپ قىلىپ قاچىلاش» row offers (PROMPT-55), over the user
 * agents real browsers send. Each device is checked as a plain visit, with a
 * saved install offer, and as the installed app.
 */

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  iphoneSafari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // Safari 26 freezes the OS version it reports at 18_6; Version/ is the real one.
  iphoneSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  // iPadOS Safari asks for desktop sites by default and says it is a Mac.
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.109;FBBV/639484128;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/641757893]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.50.80;]",
  wechatAndroid:
    "Mozilla/5.0 (Linux; Android 13; V2148A Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MMWEBID/2247 MicroMessenger/8.0.47.2560(0x28002F35) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64",
  wechatIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 616047164)",
  lineAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Line/13.21.1/IAB",
  // The desktop WeChat's own browser: in-app, but on a computer.
  wechatWindows:
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x6309092b) XWEB/9129 Flue",
} as const;

type Device = { ua: string; maxTouchPoints: number; coarsePointer: boolean };

const DEVICES: Record<keyof typeof UA, Device> = {
  androidChrome: { ua: UA.androidChrome, maxTouchPoints: 5, coarsePointer: true },
  samsungInternet: { ua: UA.samsungInternet, maxTouchPoints: 5, coarsePointer: true },
  iphoneSafari17: { ua: UA.iphoneSafari17, maxTouchPoints: 5, coarsePointer: true },
  iphoneSafari26: { ua: UA.iphoneSafari26, maxTouchPoints: 5, coarsePointer: true },
  iphoneChrome: { ua: UA.iphoneChrome, maxTouchPoints: 5, coarsePointer: true },
  ipadAsMac: { ua: UA.ipadAsMac, maxTouchPoints: 5, coarsePointer: true },
  desktopChrome: { ua: UA.desktopChrome, maxTouchPoints: 0, coarsePointer: false },
  desktopFirefox: { ua: UA.desktopFirefox, maxTouchPoints: 0, coarsePointer: false },
  macSafari: { ua: UA.macSafari, maxTouchPoints: 0, coarsePointer: false },
  facebookIos: { ua: UA.facebookIos, maxTouchPoints: 5, coarsePointer: true },
  facebookAndroid: { ua: UA.facebookAndroid, maxTouchPoints: 5, coarsePointer: true },
  wechatAndroid: { ua: UA.wechatAndroid, maxTouchPoints: 5, coarsePointer: true },
  wechatIos: { ua: UA.wechatIos, maxTouchPoints: 5, coarsePointer: true },
  instagramIos: { ua: UA.instagramIos, maxTouchPoints: 5, coarsePointer: true },
  lineAndroid: { ua: UA.lineAndroid, maxTouchPoints: 5, coarsePointer: true },
  wechatWindows: { ua: UA.wechatWindows, maxTouchPoints: 0, coarsePointer: false },
};

function input(device: Device, extra: Partial<InstallInput> = {}): InstallInput {
  return {
    userAgent: device.ua,
    maxTouchPoints: device.maxTouchPoints,
    coarsePointer: device.coarsePointer,
    standalone: false,
    hasPrompt: false,
    installed: "no",
    ...extra,
  };
}

/** [device, plain visit, with a saved offer]. As the installed app, always hidden. */
const TABLE: Array<[keyof typeof UA, InstallState, InstallState]> = [
  // The row never teaches the browser's menu (owner, 2026-11-19): until the
  // offer arrives (after 30 s of engagement) there is no row at all.
  ["androidChrome", "hidden", "prompt"],
  ["samsungInternet", "hidden", "prompt"],
  ["iphoneSafari17", "ios", "prompt"],
  ["iphoneSafari26", "ios", "prompt"],
  ["iphoneChrome", "ios", "prompt"],
  ["ipadAsMac", "ios", "prompt"],
  // A computer sees the row only with an offer.
  ["desktopChrome", "hidden", "prompt"],
  ["desktopFirefox", "hidden", "prompt"],
  ["macSafari", "hidden", "prompt"],
  ["facebookIos", "in-app", "prompt"],
  ["facebookAndroid", "in-app", "prompt"],
  ["wechatAndroid", "in-app", "prompt"],
  ["wechatIos", "in-app", "prompt"],
  ["instagramIos", "in-app", "prompt"],
  ["lineAndroid", "in-app", "prompt"],
  ["wechatWindows", "hidden", "prompt"],
];

describe("decideInstallState", () => {
  describe.each(TABLE)("%s", (name, plain, withOffer) => {
    const device = DEVICES[name];

    it(`a plain visit → ${plain}`, () => {
      expect(decideInstallState(input(device))).toBe(plain);
    });

    it(`with a saved offer → ${withOffer}`, () => {
      expect(decideInstallState(input(device, { hasPrompt: true }))).toBe(withOffer);
    });

    it("as the installed app → hidden, offer or not", () => {
      expect(decideInstallState(input(device, { standalone: true }))).toBe("hidden");
      expect(decideInstallState(input(device, { standalone: true, hasPrompt: true }))).toBe("hidden");
    });

    it("installed from the row → done; installed by the browser itself → hidden", () => {
      expect(decideInstallState(input(device, { installed: "from-row" }))).toBe("done");
      expect(decideInstallState(input(device, { installed: "elsewhere", hasPrompt: true }))).toBe("hidden");
    });
  });

  it("a touch laptop's mouse is not a phone", () => {
    const laptop = { ua: UA.desktopChrome, maxTouchPoints: 10, coarsePointer: false };
    expect(decideInstallState(input(laptop))).toBe("hidden");
  });

  it("an Android tablet without an offer gets no row, never the menu's steps", () => {
    const tablet = {
      ua: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      maxTouchPoints: 10,
      coarsePointer: true,
    };
    expect(decideInstallState(input(tablet))).toBe("hidden");
    expect(decideInstallState(input(tablet, { hasPrompt: true }))).toBe("prompt");
  });
});

describe("isAppleMobile", () => {
  it("knows iPhone, iPad and iPod by name", () => {
    expect(isAppleMobile(UA.iphoneSafari17, 5)).toBe(true);
    expect(isAppleMobile(UA.iphoneSafari26, 5)).toBe(true);
    expect(isAppleMobile(UA.iphoneChrome, 5)).toBe(true);
    expect(
      isAppleMobile("Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1", 5),
    ).toBe(true);
  });

  it("tells an iPad that says Macintosh from a Mac by its touch screen", () => {
    expect(isAppleMobile(UA.ipadAsMac, 5)).toBe(true);
    expect(isAppleMobile(UA.macSafari, 0)).toBe(false);
  });

  it("is not fooled by Android or Windows", () => {
    expect(isAppleMobile(UA.androidChrome, 5)).toBe(false);
    expect(isAppleMobile(UA.desktopChrome, 10)).toBe(false);
  });
});

describe("isInAppBrowser", () => {
  it.each([
    ["Facebook (iOS)", UA.facebookIos],
    ["Facebook (Android)", UA.facebookAndroid],
    ["WeChat (Android)", UA.wechatAndroid],
    ["WeChat (iOS)", UA.wechatIos],
    ["Instagram", UA.instagramIos],
    ["LINE", UA.lineAndroid],
    [
      "an Android app's WebView",
      "Mozilla/5.0 (Linux; Android 5.1.1; Nexus 5 Build/LMY48B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/43.0.2357.65 Mobile Safari/537.36",
    ],
  ])("recognises %s", (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it.each([
    ["Android Chrome", UA.androidChrome],
    ["Samsung Internet", UA.samsungInternet],
    ["iPhone Safari", UA.iphoneSafari26],
    ["iPhone Chrome", UA.iphoneChrome],
    ["desktop Chrome", UA.desktopChrome],
    ["desktop Firefox", UA.desktopFirefox],
  ])("leaves %s alone", (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(false);
  });
});
