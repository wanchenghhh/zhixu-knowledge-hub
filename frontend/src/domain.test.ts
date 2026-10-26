import { describe, expect, it } from "vitest";
import { initialState } from "./data";
import {
  accessibleLogs,
  answerDemo,
  retrieveDemo,
  validateFile,
  visibleKnowledge,
} from "./domain";
describe("角色范围与问答边界", () => {
  it("使用者看不到财务和经营资料，管理员可见全部", () => {
    const s = initialState();
    expect(visibleKnowledge(s.knowledge, "user").map((k) => k.id)).toEqual([
      "hr",
      "product",
      "service",
    ]);
    expect(visibleKnowledge(s.knowledge, "admin")).toHaveLength(
      s.knowledge.length,
    );
  });
  it("管理人员看不到跨越不可见知识库的日志", () => {
    const s = initialState();
    const mixed = { ...s.logs[0], id: "mixed", kbIds: ["hr", "strategy"] };
    expect(accessibleLogs([mixed], s.knowledge, "manager")).toHaveLength(0);
    expect(accessibleLogs([mixed], s.knowledge, "admin")).toHaveLength(1);
    expect(accessibleLogs(s.logs, s.knowledge, "user")).toHaveLength(0);
  });
  it("召回只使用所选知识库，排除失败与停用文件", () => {
    const s = initialState();
    const files = s.files.map((f) =>
      f.id === "f-hr2" ? { ...f, status: "disabled" as const } : f,
    );
    expect(retrieveDemo("差旅报销费用", files, ["hr"])).toHaveLength(0);
    expect(retrieveDemo("年假怎么申请", files, ["product"])).toHaveLength(0);
    expect(retrieveDemo("考勤补卡", files, ["hr"])).toHaveLength(0);
  });
  it("未知问题不返回无关依据，也不编造引用", () => {
    const s = initialState();
    const sources = retrieveDemo("明天木星的天气", s.files, ["hr"]);
    expect(sources).toEqual([]);
    expect(answerDemo("明天木星的天气", sources)).toContain("未找到足够依据");
    expect(answerDemo("明天木星的天气", sources)).not.toContain("[1]");
  });
  it("已知问题保留真实演示文件和位置", () => {
    const s = initialState();
    const sources = retrieveDemo("差旅报销需要什么材料", s.files, ["hr"]);
    expect(sources[0].fileId).toBe("f-hr2");
    expect(sources[0].location).toContain("第二章");
    expect(answerDemo("报销", sources)).toContain("[1]");
  });
});
describe("文件导入边界", () => {
  it("支持声明格式，拒绝未知、空文件与超限文件", () => {
    expect(validateFile("制度.PDF", 1024)).toBeNull();
    expect(validateFile("旧版.doc", 1024)).toBeNull();
    expect(validateFile("表格.xls", 1024)).toBeNull();
    expect(validateFile("script.exe", 1024)).toContain("不支持");
    expect(validateFile("空.md", 0)).toContain("为空");
    expect(validateFile("大.pdf", 20 * 1024 * 1024 + 1)).toContain("20 MB");
  });
});
