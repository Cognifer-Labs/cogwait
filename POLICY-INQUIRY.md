# Anthropic policy inquiry — is an ad-supported statusline plugin allowed?

Status: DRAFT — not yet sent. Send before any public launch or marketplace
submission (tasks/todo.md Phase 4 blocker).

## Where to send

1. **Anthropic support** — https://support.anthropic.com → submit a request
   (category: Claude Code). Primary channel.
2. **GitHub discussion** — https://github.com/anthropics/claude-code/discussions
   → open a discussion titled "Policy question: ad-supported statusline plugins".
   Public record of the answer; useful either way.

Send both. Keep copies of any reply — the answer gates the whole launch.

## Draft message

Subject: Policy question — ad-supported Claude Code statusline plugin

Hi,

I'm building a Claude Code plugin called Cogwait and want to confirm it's
within policy before publishing it anywhere. What it does:

- While Claude is thinking, the statusline (configured via the standard
  `statusLine` setting) shows a short sponsored text line, e.g.
  `[sponsor] Try Acme DB — acme.dev`.
- It is fully opt-in: the developer installs it deliberately, chooses an
  "ad level" (including off), and can uninstall cleanly. It never modifies
  Claude Code beyond the documented statusLine setting.
- Revenue: advertisers fund campaigns; the majority share of impression
  revenue goes to the developer running the plugin, and a user-configurable
  percentage of each payout is donated to open-source maintainers.
- Privacy: the plugin never reads prompts, code, or conversation content.
  It sends only an anonymous session hash and the chosen ad level to its
  backend. No conversation data leaves the machine.

My questions:

1. Does displaying paid sponsored content in the statusline violate any
   Claude Code usage policy or terms?
2. Is a plugin like this acceptable for distribution through community
   plugin marketplaces (`.claude-plugin/marketplace.json` registries)?
3. If affiliate links (rather than directly-sold ads) are shown instead,
   does that change the answer?
4. Is there anything that would make this compliant if the current shape
   isn't (e.g. disclosure requirements, opt-in wording, content rules)?

I'd rather adjust the design now than launch something non-compliant.
Happy to share the full source — the project is built to be auditable
(privacy policy, ad policy, and threat model are in the repo).

Thanks,
Dharsan
kesavand@gmail.com

## After the reply

- Allowed → unblock Phase 5 (publish) in tasks/todo.md, note the reply date here.
- Conditional → capture required changes as todo items before launch.
- Disallowed → pivot decision: Fund-OSS-only framing (no third-party ads) or shelve.
