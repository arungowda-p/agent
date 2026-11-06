"""End-to-end smoke tests in offline mode (no LLM key): upload -> index -> answer for all three apps."""

from __future__ import annotations

import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="agent-suite-test-")
os.environ.pop("LLM_API_KEY", None)
os.environ.pop("DATABASE_URL", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

A = {"X-Tenant-ID": "acme"}
B = {"X-Tenant-ID": "globex"}

POLICY = b"""# Security Policy
Acme encrypts all customer data at rest using AES-256 and in transit using TLS 1.2 or higher.
Acme completed a SOC 2 Type II audit in 2025. Multi-factor authentication is enforced for all employees.

# Access Control
Access to production systems is reviewed quarterly and follows the principle of least privilege.
"""

NOTES = b"""# Photosynthesis
Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs mostly blue and red light.
The light-dependent reactions occur in the thylakoid membranes and produce ATP and NADPH.

# Calvin Cycle
The Calvin cycle takes place in the stroma and uses ATP and NADPH to fix carbon dioxide into sugars.
The enzyme rubisco catalyses the first major step of carbon fixation.
"""


def upload(client: TestClient, headers: dict, app_name: str, scope: str, name: str, data: bytes) -> dict:
    response = client.post(
        f"/api/v1/artifacts/upload?app={app_name}&scope={scope}",
        content=data,
        headers={**headers, "X-Filename": name, "Content-Type": "text/markdown"},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    job = client.get(f"/api/v1/jobs/{body['job']['id']}", headers=headers).json()
    assert job["status"] == "succeeded", job
    return body


def test_health_and_auth() -> None:
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/v1/artifacts?app=study").status_code == 401


def test_questionnaire_flow_and_tenant_isolation() -> None:
    with TestClient(app) as client:
        body = upload(client, A, "questionnaire", "library", "policy.md", POLICY)
        artifact = client.get(f"/api/v1/artifacts/{body['artifact']['id']}", headers=A).json()
        assert artifact["status"] == "indexed" and artifact["chunk_count"] >= 1

        # Tenant B must not see tenant A's artifact.
        assert client.get(f"/api/v1/artifacts/{artifact['id']}", headers=B).status_code == 404
        assert client.get("/api/v1/artifacts?app=questionnaire", headers=B).json() == []

        created = client.post(
            "/api/v1/questionnaire/questionnaires",
            json={
                "name": "Vendor review",
                "questions": [
                    {"ref": "1.1", "category": "Encryption", "question": "Is customer data encrypted at rest?"},
                    {"ref": "1.2", "category": "Audits", "question": "Do you have a SOC 2 Type II report?"},
                ],
            },
            headers=A,
        ).json()
        started = client.post(f"/api/v1/questionnaire/questionnaires/{created['id']}/autofill", json={}, headers=A)
        assert started.status_code == 202
        q = client.get(f"/api/v1/questionnaire/questionnaires/{created['id']}", headers=A).json()
        assert all(r["confidence"] != "pending" for r in q["rows"])
        assert q["rows"][0]["citations"], q["rows"][0]

        row = q["rows"][0]
        patched = client.patch(
            f"/api/v1/questionnaire/questionnaires/{created['id']}/rows/{row['id']}",
            json={"answer": "Yes. AES-256 at rest.", "approved": True},
            headers=A,
        ).json()
        assert patched["edited"] and patched["approved"]

        chunk_ids = ",".join(c["chunk_id"] for c in row["citations"])
        assert client.get(f"/api/v1/artifacts/chunks?ids={chunk_ids}", headers=A).json()
        assert client.get(f"/api/v1/artifacts/chunks?ids={chunk_ids}", headers=B).json() == []

        csv_text = client.get(f"/api/v1/questionnaire/questionnaires/{created['id']}/export.csv", headers=A).text
        assert "AES-256" in csv_text


def test_support_widget_flow() -> None:
    with TestClient(app) as client:
        widget = client.post("/api/v1/support/widgets", json={"name": "Acme Help"}, headers=A).json()
        upload(client, A, "support", widget["id"], "faq.md", POLICY)
        patched = client.patch(
            f"/api/v1/support/widgets/{widget['id']}",
            json={"primary_color": "#10b981", "whitelabel": {"enabled": True, "brand_name": "HelpDesk", "hide_powered_by": True}},
            headers=A,
        ).json()
        assert patched["primary_color"] == "#10b981"
        key = patched["public_key"]
        config = client.get(f"/api/v1/support/public/{key}/config").json()
        assert config["brand_name"] == "HelpDesk" and config["show_powered_by"] is False

        reply = client.post(
            f"/api/v1/support/public/{key}/chat",
            json={"session_id": "sess-1", "messages": [{"role": "user", "content": "How is data encrypted in transit?"}]},
        ).json()
        assert reply["citations"], reply

        ticket = client.post(
            f"/api/v1/support/public/{key}/escalate",
            json={"session_id": "sess-1", "email": "visitor@example.com", "messages": [{"role": "user", "content": "Need a human"}]},
        )
        assert ticket.status_code == 201
        assert len(client.get(f"/api/v1/support/widgets/{widget['id']}/tickets", headers=A).json()) == 1

        bad = client.post(
            f"/api/v1/support/widgets/{widget['id']}/sources/url", json={"url": "http://127.0.0.1/admin"}, headers=A
        ).json()
        job = client.get(f"/api/v1/jobs/{bad['job']['id']}", headers=A).json()
        assert job["status"] == "failed" and "non-public" in job["error"]


def test_study_flow() -> None:
    with TestClient(app) as client:
        course = client.post(
            "/api/v1/study/courses",
            json={"title": "Biology 101", "topics": ["Photosynthesis", "Calvin Cycle"]},
            headers=A,
        ).json()
        upload(client, A, "study", course["id"], "notes.md", NOTES)

        chat = client.post(
            f"/api/v1/study/courses/{course['id']}/chat",
            json={"messages": [{"role": "user", "content": "Where does the Calvin cycle happen?"}]},
            headers=A,
        ).json()
        assert chat["citations"]

        topic_id = course["topics"][0]["id"]
        cards = client.post(
            f"/api/v1/study/courses/{course['id']}/flashcards/generate", json={"topic_id": topic_id, "count": 3}, headers=A
        ).json()
        assert len(cards) >= 1
        reviewed = client.post(f"/api/v1/study/flashcards/{cards[0]['id']}/review", json={"grade": "easy"}, headers=A).json()
        assert reviewed["topics"][0]["mastery"] > 0

        quiz = client.post(
            f"/api/v1/study/courses/{course['id']}/quizzes/generate", json={"topic_id": topic_id, "count": 2}, headers=A
        ).json()
        question = quiz["questions"][0]
        assert question["correct_index"] is None
        result = client.post(
            f"/api/v1/study/quizzes/{quiz['id']}/answer", json={"question_id": question["id"], "selected_index": 0}, headers=A
        ).json()
        assert "correct" in result and result["course_mastery"] >= 0
