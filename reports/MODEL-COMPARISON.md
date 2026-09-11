# Model screening — September 12, 2026

The account catalog returned **165 entries**. All were classified; **92 text-assistant candidates** received the same synthetic three-check request. Fourteen responded and passed all three checks. Seventy-two were refused for exhausted free quota; four refused the request parameters, one returned a server error, and one was not found despite appearing in the catalog. A refusal is not a quality score.

Keep the owner-selected **qwen3.8-max** for the prescription assistant: the direct call and actual hosted RAG call succeed. It scored 3/3 in 1.640 seconds in this screening. This does not establish that it is the best clinical model. The checks covered exact decimal/Unicode copying, retaining absent facts as null, and ignoring an instruction embedded in a source. Each model received only one combined request, at concurrency two; these are elapsed sample times, not p50/p95 latency or throughput measurements. No clinical recommendations or real patient records were used.

## Models that responded

| Model | Checks | Elapsed ms |
|---|---:|---:|
| glm-5.2-fast-preview | 3/3 | 987 |
| qwen3.7-flash | 3/3 | 1082 |
| qwen3.7-flash-2026-07-15 | 3/3 | 1340 |
| qwen3.8-max-0902 | 3/3 | 1615 |
| qwen3.8-max | 3/3 | 1640 |
| glm-5.2 | 3/3 | 1740 |
| qwen3.8-flash | 3/3 | 1821 |
| qwen-plus-2025-01-25 | 3/3 | 1907 |
| deepseek-v4-flash-0731 | 3/3 | 1908 |
| deepseek-v4-pro-0813 | 3/3 | 1963 |
| qwen3.8-27b | 3/3 | 1971 |
| kimi-k3 | 3/3 | 2314 |
| qwen-coder-plus | 3/3 | 3191 |
| kimi-k2.7-code | 3/3 | 10821 |

## Entire catalog accounted for

| Category | Entries |
|---|---:|
| text assistant | 92 |
| speech or multimodal: audio comparison pending | 29 |
| image generation | 21 |
| translation | 4 |
| speech synthesis | 16 |
| embedding | 3 |

The complete per-entry results, request hash, usage and synthetic responses are in [the machine-readable report](model-screening-20260912.json). Alias and snapshot entries are counted separately because the account listed them separately. Image, embedding, translation and speech entries were not scored as prescription text models.

## Speech comparison awaits the owner’s recording

No owner audio sample has been received. The hosted Dictate panel can capture a sample for explicit private upload. Browser dictation is implemented; microphone and speech-service behavior still require a real browser check.

The [official Omni language list](https://www.alibabacloud.com/help/en/model-studio/qwen-omni) includes Bengali input for the Qwen3.5-Omni family. The [dedicated ASR language lists](https://www.alibabacloud.com/help/en/model-studio/asr-model) do not list Bengali. Qwen3.5-Omni Plus and Flash both returned `AllocationQuota.FreeTierOnly` on a synthetic Bengali audio probe. This was generated test audio, not the owner’s voice, and supplies no personal speech-accuracy evidence. Other audio entries remain untested.

A fair next comparison uses the same owner-provided recording and a human-corrected reference transcript, measuring word/character errors, drug-name and number preservation, processing time and failure behavior. Do not label a speed result “best accuracy”, or replace the selected text model with an audio-only model.

[Official requested model ID and capabilities](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max). Model IDs remain in operator reports, not in the doctor-facing UI.
