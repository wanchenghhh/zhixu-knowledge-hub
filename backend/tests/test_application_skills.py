import io
import zipfile
from types import SimpleNamespace
from langchain_core.messages import AIMessage
from app.agent_tools import agent_complete
from app.db import Model, session_factory

SKILL = b"---\nname: report-helper\ndescription: Helps write reports\n---\nUse references/guide.md for the preferred style.\n"


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buffer.getvalue()


def upload(client):
    payload = archive(
        {"report-helper/SKILL.md": SKILL, "report-helper/references/guide.md": "Use concise headings."}
    )
    response = client.post(
        "/api/v1/skills", files={"file": ("report-helper.zip", payload, "application/zip")}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_skill_package_validation_and_access(client):
    item = upload(client)
    assert item["name"] == "report-helper" and item["files"] == ["SKILL.md", "references/guide.md"]
    assert client.get("/api/v1/skills", headers={"X-Role": "user"}).status_code == 403
    payload = archive({"report-helper/SKILL.md": SKILL, "../escape.txt": "bad"})
    assert client.post("/api/v1/skills", files={"file": ("bad.zip", payload)}).status_code == 400
    assert client.post("/api/v1/skills", files={"file": ("SKILL.md", b"no metadata")}).status_code == 400


def test_skill_and_tool_invocations_use_only_bound_resources(client, models, monkeypatch):
    skill = upload(client)
    events = []

    class Adapter:
        root_client = SimpleNamespace(close=lambda: None)

        def bind_tools(self, tools):
            assert {tool.name for tool in tools} == {"activate_skill", "read_skill_resource", "calculator"}
            return self

        def invoke(self, messages):
            count = len([m for m in messages if isinstance(m, AIMessage)])
            usage = {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}
            calls = [
                {"name": "activate_skill", "args": {"name": "report-helper"}, "id": "1"},
                {
                    "name": "read_skill_resource",
                    "args": {"name": "report-helper", "path": "references/guide.md"},
                    "id": "2",
                },
                {"name": "calculator", "args": {"expression": "7 * 6"}, "id": "3"},
            ]
            if count < len(calls):
                return AIMessage(content="", tool_calls=[calls[count]], usage_metadata=usage)
            assert "42" in messages[-1].content
            return AIMessage(content="Result: 42", usage_metadata=usage)

    monkeypatch.setattr("app.agent_tools.llm", lambda model: Adapter())
    with session_factory()() as db:
        model = db.get(Model, models["LLM"]["id"])
        answer, usage = agent_complete(
            model,
            "rules",
            "compute",
            {"skillIds": [skill["id"]], "tools": ["calculator"]},
            purpose="test",
            record=events.append,
        )
    assert answer == "Result: 42" and usage["total_tokens"] == 20
    assert [e["name"] for e in events if e["type"] in ("Skill", "Tool")] == [
        "activate_skill",
        "read_skill_resource",
        "calculator",
    ]
    assert "concise headings" in next(e["output"] for e in events if e.get("name") == "read_skill_resource")
    rounds = [e for e in events if e["type"] == "LLM"]
    assert rounds[0]["input"][0]["role"] == "system"
    assert rounds[0]["output"]["tool_calls"][0]["name"] == "activate_skill"
    assert rounds[-1]["output"]["content"] == "Result: 42"
    assert any(message.get("tool_call_id") == "2" for message in rounds[-1]["input"])


def test_published_chat_executes_enabled_tool_and_logs_usage(client, models, knowledge, monkeypatch):
    class Adapter:
        root_client = SimpleNamespace(close=lambda: None)

        def bind_tools(self, tools):
            assert [tool.name for tool in tools] == ["calculator"]
            return self

        def invoke(self, messages):
            usage = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            if not any(isinstance(m, AIMessage) for m in messages):
                return AIMessage(
                    content="",
                    tool_calls=[{"name": "calculator", "args": {"expression": "6*7"}, "id": "calc-1"}],
                    usage_metadata=usage,
                )
            assert messages[-1].content == "42"
            return AIMessage(content="计算结果是 42。", usage_metadata=usage)

    monkeypatch.setattr("app.agent_tools.llm", lambda model: Adapter())
    config = {
        "name": "工具助手",
        "description": "",
        "kind": "service",
        "model": models["LLM"]["id"],
        "kbIds": [knowledge["id"]],
        "prompt": "请在需要时使用计算器。",
        "tools": ["calculator"],
    }
    create = client.post("/api/v1/applications", json=config)
    assert create.status_code == 200, create.text
    app_id = create.json()["id"]
    assert client.post(f"/api/v1/applications/{app_id}/publish").status_code == 200
    answer = client.post(f"/api/v1/applications/{app_id}/chat", json={"question": "6乘7等于多少？"})
    assert answer.status_code == 200 and "42" in answer.text
    logs = client.get("/api/v1/state").json()["logs"]
    assert logs[0]["tokens"] == 30
    assert any(
        call.get("name") == "calculator" and call["status"] == "success"
        for call in logs[0]["details"]["calls"]
    )


def test_report_outline_uses_tool_agent(client, models, knowledge, monkeypatch):
    from app.application_jobs import process_run

    class Adapter:
        root_client = SimpleNamespace(close=lambda: None)

        def bind_tools(self, tools):
            return self

        def invoke(self, messages):
            usage = {"input_tokens": 4, "output_tokens": 2, "total_tokens": 6}
            if not any(isinstance(m, AIMessage) for m in messages):
                return AIMessage(
                    content="",
                    tool_calls=[{"name": "calculator", "args": {"expression": "1+1"}, "id": "calc-1"}],
                    usage_metadata=usage,
                )
            return AIMessage(content='{"outline":["总结"]}', usage_metadata=usage)

    monkeypatch.setattr("app.agent_tools.llm", lambda model: Adapter())
    config = {
        "name": "报告工具助手",
        "kind": "report",
        "model": models["LLM"]["id"],
        "kbIds": [knowledge["id"]],
        "prompt": "报告需要时调用工具。",
        "tools": ["calculator"],
    }
    created = client.post("/api/v1/applications", json=config)
    assert created.status_code == 200, created.text
    app_id = created.json()["id"]
    assert client.post(f"/api/v1/applications/{app_id}/publish").status_code == 200
    started = client.post(f"/api/v1/applications/{app_id}/runs", json={"question": "编写报告"})
    assert started.status_code == 200, started.text
    run_id = started.json()["id"]
    process_run(run_id)
    result = client.get(f"/api/v1/application-runs/{run_id}").json()
    assert result["status"] == "awaiting_outline", result
    assert result["outline"] == ["总结"]
    assert any(c.get("name") == "calculator" and c["status"] == "success" for c in result["usage"]["calls"])


def test_trace_masks_keys_and_marks_truncation():
    from app.agent_tools import trace_value

    value = trace_value(
        {"authorization": "Bearer abc", "message": "api_key=hello super-secret " + "x" * 40},
        "super-secret",
        limit=25,
    )
    assert value["authorization"] == "[已隐藏]"
    assert "super-secret" not in value["message"] and "api_key=hello" not in value["message"]
    assert "[内容已截断]" in value["message"]
