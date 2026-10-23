# Generated from openapi/arex-v1.json by generate_wire.py; do not edit.
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, TypedDict

if TYPE_CHECKING:
    from typing_extensions import Required

ErrorCode = Literal['invalid_request', 'content_blocked', 'unauthorized', 'registration_required', 'account_deletion_pending', 'not_found', 'method_not_allowed', 'run_not_cancellable', 'source_not_available', 'rate_limit_exceeded', 'outstanding_run_limit', 'daily_credits_exhausted', 'weekly_credits_exhausted', 'internal_error', 'temporarily_unavailable']
ResearchFailureCode = Literal['timeout', 'execution_failed', 'worker_unavailable', 'interrupted']
ContentsTier = Literal['auto', 'flex']
ResearchMode = Literal['fast', 'deep']
ResearchModeRequest = Literal['auto', 'fast', 'deep']
ResearchStatus = Literal['queued', 'running', 'completed', 'failed', 'cancelled']

class ContentsRequest(TypedDict, total=False):
    url: Required[str]
    tier: ContentsTier
    livecrawl: bool
    livecrawl_timeout_ms: int
    max_characters: int

class ContentsResponse(TypedDict, total=False):
    url: Required[str]
    title: str
    published_at: str
    image_url: str
    image_urls: list[str]
    content: Required[str]
    truncated: Required[bool]

class ErrorError(TypedDict, total=False):
    code: Required[ErrorCode]
    message: Required[str]
    retryable: Required[bool]
    request_id: Required[str]
    param: str

class Error(TypedDict, total=False):
    error: Required[ErrorError]

class ResearchCreateRequest(TypedDict, total=False):
    query: Required[str]
    mode: ResearchModeRequest

class ResearchRunResultSourcesItem(TypedDict, total=False):
    title: Required[str]
    url: Required[str]

class ResearchRunResult(TypedDict, total=False):
    answer: Required[str]
    sources: Required[list[ResearchRunResultSourcesItem]]

class ResearchRunError(TypedDict, total=False):
    code: Required[ResearchFailureCode]
    retryable: Required[bool]

class ResearchRun(TypedDict, total=False):
    id: Required[str]
    status: Required[ResearchStatus]
    mode: Required[ResearchMode]
    requested_mode: Required[ResearchModeRequest]
    created_at: Required[str]
    started_at: str
    completed_at: str
    result: ResearchRunResult
    error: ResearchRunError
    message: str

class SearchRequest(TypedDict, total=False):
    query: Required[str]
    limit: int
    published_after: str
    published_before: str

class SearchResponseResultsItem(TypedDict, total=False):
    title: Required[str]
    url: Required[str]
    snippet: str
    published_at: str

class SearchResponse(TypedDict, total=False):
    results: Required[list[SearchResponseResultsItem]]


WIRE_LIMITS: dict[str, Any] = {'ContentsRequest': {'livecrawl': {'default': False},
                     'livecrawl_timeout_ms': {'maximum': 90000, 'minimum': 1000},
                     'max_characters': {'default': 12000,
                                        'maximum': 131072,
                                        'minimum': 1},
                     'tier': {'default': 'auto', 'enum': ['auto', 'flex']},
                     'url': {'maxLength': 8192,
                             'pattern': '^[Hh][Tt][Tt][Pp][Ss]?://[^/@?#]+(?:[/?#]|$)'}},
 'ContentsResponse': {'image_urls': {'maxItems': 50}},
 'ResearchCreateRequest': {'mode': {'default': 'auto',
                                    'enum': ['auto', 'fast', 'deep']},
                           'query': {'maxLength': 2000, 'minLength': 1}},
 'ResearchRun': {'mode': {'enum': ['fast', 'deep']},
                 'requested_mode': {'enum': ['auto', 'fast', 'deep']},
                 'status': {'enum': ['queued',
                                     'running',
                                     'completed',
                                     'failed',
                                     'cancelled']}},
 'SearchRequest': {'limit': {'default': 10, 'maximum': 10, 'minimum': 1},
                   'query': {'maxLength': 2000, 'minLength': 1}}}
