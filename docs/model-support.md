# Default provider models

Verified against primary provider documentation on 28 October 2026. This check made zero authenticated provider or inference calls. `setup --model MODEL_ID` keeps the choice configurable.

| Provider | Own-key default | Documentation |
|---|---|---|
| Groq | `openai/gpt-oss-20b` | Listed as a production text model in the [supported models catalogue](https://console.groq.com/docs/models) and [model reference](https://console.groq.com/docs/model/openai/gpt-oss-20b). |
| Anthropic | `claude-sonnet-4-6` | Listed as Active in the [model lifecycle table](https://platform.claude.com/docs/en/about-claude/model-deprecations), with retirement not sooner than 17 February 2027 at verification. |

The original Groq model, `llama-3.3-70b-versatile`, is now labelled Enterprise in its [official reference](https://console.groq.com/docs/model/llama-3.3-70b-versatile). It remains selectable explicitly for an account with access; the own-key default uses the generally listed production option above.

For GPT-OSS, the direct Groq request uses `max_completion_tokens`, low reasoning effort and `include_reasoning: false`, following the [reasoning API documentation](https://console.groq.com/docs/reasoning). The briefing reads the final content field. The Anthropic adapter combines returned text blocks, keeping other content block types separate.

Documentation support, account entitlement and task quality are separate checks. The candidate tests request shape and response handling with fixtures. A real selected-account recording remains part of acceptance.
