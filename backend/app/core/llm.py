"""LLM + embedding access through the official AsyncOpenAI client.

Any OpenAI-compatible provider works. Defaults target Google Gemini's free tier
(https://generativelanguage.googleapis.com/v1beta/openai/) with Groq as a fallback.

When no API key is configured the suite still runs: embeddings fall back to a deterministic
feature-hashing vectorizer and ``complete_json`` raises ``LLMUnavailable`` so each service can
return an extractive (retrieval-only) answer instead.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import re
from typing import Any, TypeVar

from openai import APIError, AsyncOpenAI, BadRequestError
from pydantic import BaseModel, ValidationError

from .config import get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

HASH_DIMENSIONS = 384
_WORD_RE = re.compile(r"[a-z0-9]+")


class LLMUnavailable(RuntimeError):
    """Raised when no provider is configured or every provider failed."""


_clients: dict[tuple[str, str], AsyncOpenAI] = {}


def _client(api_key: str, base_url: str) -> AsyncOpenAI:
    key = (api_key, base_url)
    if key not in _clients:
        _clients[key] = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=2, timeout=60.0)
    return _clients[key]


def to_strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Convert a Pydantic model into a JSON schema accepted by strict structured-output modes.

    Inlines $refs, removes titles/defaults, marks every property required and forbids extras.
    """
    raw = model.model_json_schema()
    defs: dict[str, Any] = raw.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                return resolve(copy.deepcopy(defs[ref_name]))
            out: dict[str, Any] = {}
            for key, value in node.items():
                if key in {"title", "default", "examples"}:
                    continue
                out[key] = resolve(value)
            if out.get("type") == "object" and "properties" in out:
                out["required"] = list(out["properties"].keys())
                out["additionalProperties"] = False
            return out
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(raw)


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.DOTALL)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _providers() -> list[tuple[AsyncOpenAI, str]]:
    s = get_settings()
    providers: list[tuple[AsyncOpenAI, str]] = []
    if s.llm_api_key:
        providers.append((_client(s.llm_api_key, s.llm_base_url), s.llm_model))
    if s.llm_fallback_api_key:
        providers.append((_client(s.llm_fallback_api_key, s.llm_fallback_base_url), s.llm_fallback_model))
    return providers


async def complete_json(
    *,
    system: str,
    user: str,
    schema: type[T],
    temperature: float = 0.1,
    max_tokens: int = 2048,
) -> T:
    """Run a chat completion that must return JSON matching ``schema``.

    Tries strict ``json_schema`` structured output first, then ``json_object`` mode (for providers
    without schema support), and validates the result with Pydantic in both cases.
    """
    providers = _providers()
    if not providers:
        raise LLMUnavailable("No LLM provider configured (set LLM_API_KEY).")

    json_schema = to_strict_schema(schema)
    schema_hint = json.dumps(json_schema, separators=(",", ":"))
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    response_formats: list[dict[str, Any]] = [
        {
            "type": "json_schema",
            "json_schema": {"name": schema.__name__, "schema": json_schema, "strict": True},
        },
        {"type": "json_object"},
    ]

    last_error: Exception | None = None
    for client, model in providers:
        for response_format in response_formats:
            request_messages = messages
            if response_format["type"] == "json_object":
                request_messages = [
                    {
                        "role": "system",
                        "content": f"{system}\n\nRespond with ONLY a JSON object matching this JSON schema:\n{schema_hint}",
                    },
                    {"role": "user", "content": user},
                ]
            try:
                completion = await client.chat.completions.create(
                    model=model,
                    messages=request_messages,  # type: ignore[arg-type]
                    response_format=response_format,  # type: ignore[arg-type]
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                content = completion.choices[0].message.content or ""
                return schema.model_validate(_extract_json(content))
            except BadRequestError as exc:
                # Usually "response_format not supported" -> try the next, looser format.
                last_error = exc
                log.warning("Structured output rejected by %s (%s): %s", model, response_format["type"], exc)
                continue
            except (ValidationError, json.JSONDecodeError) as exc:
                last_error = exc
                log.warning("Model %s returned invalid JSON: %s", model, exc)
                continue
            except APIError as exc:
                # Rate limit / outage -> move to the next provider.
                last_error = exc
                log.warning("Provider error from %s: %s", model, exc)
                break
    raise LLMUnavailable(f"All LLM providers failed: {last_error}")


def hash_embedding(text: str, dimensions: int = HASH_DIMENSIONS) -> list[float]:
    """Deterministic offline embedding: signed feature hashing of unigrams and bigrams."""
    vector = [0.0] * dimensions
    words = _WORD_RE.findall(text.lower())
    features = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
    for feature in features:
        digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % dimensions
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


async def embed(texts: list[str]) -> list[list[float]]:
    """Embed texts in batches; falls back to hashing embeddings if no provider is available."""
    if not texts:
        return []
    s = get_settings()
    api_key = s.embed_api_key or s.llm_api_key
    if not api_key:
        return [hash_embedding(t) for t in texts]

    client = _client(api_key, s.embed_base_url or s.llm_base_url)
    vectors: list[list[float]] = []
    batch_size = 64
    try:
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            try:
                response = await client.embeddings.create(
                    model=s.embed_model, input=batch, dimensions=s.embed_dimensions
                )
            except BadRequestError:
                response = await client.embeddings.create(model=s.embed_model, input=batch)
            vectors.extend([item.embedding for item in sorted(response.data, key=lambda d: d.index)])
        return vectors
    except APIError as exc:
        log.warning("Embedding provider failed, using hashing embeddings: %s", exc)
        return [hash_embedding(t) for t in texts]
