import { describe, expect, test } from "bun:test";
import { matchesTopicKeyword, normalizeTopicKeyword, normalizeTopicKeywords } from "../src/topics.ts";

describe("话题关键词", () => {
  test("去除井号、空白并按大小写去重", () => {
    expect(normalizeTopicKeyword("  ## 塔塔万圣捣蛋时刻 ")).toBe("塔塔万圣捣蛋时刻");
    expect(normalizeTopicKeywords(["#Alpha", "alpha", "＃养萌物来塔塔", " "])).toEqual([
      "Alpha",
      "养萌物来塔塔",
    ]);
  });

  test("按视频标题包含关系匹配关键词", () => {
    expect(matchesTopicKeyword("今天参加 #塔塔万圣捣蛋时刻", "#塔塔万圣捣蛋时刻")).toBe(true);
    expect(matchesTopicKeyword("养萌物来塔塔｜新手攻略", "塔塔万圣捣蛋时刻")).toBe(false);
    expect(matchesTopicKeyword(null, "塔塔")).toBe(false);
  });
});
