"""Seed a running Agent Suite API with demo data for all three apps.

Usage:
    python scripts/seed_demo.py [--api http://127.0.0.1:8000] [--tenant demo]
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import httpx

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


def wait_for_job(client: httpx.Client, job_id: str, timeout: float = 120.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").raise_for_status().json()
        if job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.5)
    raise TimeoutError(f"Job {job_id} did not finish in {timeout}s")


def upload(client: httpx.Client, app: str, scope: str, path: Path) -> None:
    response = client.post(
        f"/api/v1/artifacts/upload?app={app}&scope={scope}",
        content=path.read_bytes(),
        headers={"X-Filename": path.name, "Content-Type": "text/markdown"},
    )
    if response.status_code == 409:
        print(f"  = {path.name} already uploaded")
        return
    response.raise_for_status()
    job = wait_for_job(client, response.json()["job"]["id"])
    print(f"  + {path.name}: {job['status']} {job.get('result') or job.get('error')}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--tenant", default="demo")
    args = parser.parse_args()

    with httpx.Client(base_url=args.api, headers={"X-Tenant-ID": args.tenant}, timeout=120.0) as client:
        print("Questionnaire Autopilot")
        upload(client, "questionnaire", "library", SAMPLES / "security-policy.md")
        imported = client.post(
            "/api/v1/questionnaire/questionnaires/import",
            content=(SAMPLES / "vendor-questionnaire.csv").read_bytes(),
            headers={"X-Filename": "vendor-questionnaire.csv", "X-Questionnaire-Name": "Contoso vendor review", "X-Customer": "Contoso"},
        ).raise_for_status().json()
        started = client.post(f"/api/v1/questionnaire/questionnaires/{imported['id']}/autofill", json={}).raise_for_status().json()
        job = wait_for_job(client, started["job"]["id"], timeout=300)
        print(f"  autofill: {job['status']} {job.get('result')}")

        print("Site Support Agent")
        widget = client.post("/api/v1/support/widgets", json={"name": "Northwind Help", "primary_color": "#10b981"}).raise_for_status().json()
        upload(client, "support", widget["id"], SAMPLES / "help-center.md")

        print("Study Copilot")
        course = client.post(
            "/api/v1/study/courses",
            json={"title": "Biology 101", "code": "BIO101", "topics": ["Cell Structure", "Photosynthesis", "Calvin Cycle", "Cellular Respiration"]},
        ).raise_for_status().json()
        upload(client, "study", course["id"], SAMPLES / "biology-notes.md")
        print("Done.")


if __name__ == "__main__":
    main()
