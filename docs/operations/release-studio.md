# Release Studio connection

Product-release collection is a Mation native action, `marketing_release_collector`, in the Product releases group. It calls the existing T3 host at `/api/marketing/releases/collect` using Mation's configured T3 service credential. Install the T3 endpoint and create the Product releases T3 project before changing the automation. Set its execution target to that registered project, and preserve the automation's identity, enabled state, cadence and run history when changing its action. The older `sge_release_collector` remains supported for retained definitions; the new action does not call SGE.

For a one-off check, include the GitHub `releaseId` in the collect request. Omit it for the scheduled collector to consider every unseen verified release.

Studio appears beside each release's normal T3 conversation. Approve the selected highlights to start drafting. Give feedback in the conversation or Studio. Final approval publishes exactly the selected company update and optional personal repost. Imported images must be real files inside that conversation's project workspace. Private drafts and image bytes live under the T3 host's `baseDir/marketing`, outside its conversation database.

LinkedIn publishing requires host configuration before final approval:

- `MARKETING_LINKEDIN_TOKEN_FILE` points to a private file containing the OAuth access token. Never put tokens in chat, repository files, URLs or logs.
- `MARKETING_LINKEDIN_VERSION` is a supported monthly LinkedIn REST API version, for example `202609` while supported.
- `MARKETING_LINKEDIN_COMPANY_AUTHOR` is the verified recuut company author URN, `urn:li:organization:<id>`.
- `MARKETING_LINKEDIN_PERSONAL_AUTHOR` is Joseph's verified member author URN, `urn:li:person:<id>`, when personal reposts are used.

The token needs `w_organization_social` and an eligible role on the company page. Optional personal reposts need `w_member_social`. Reconciliation also needs access to read the affected post; LinkedIn restricts member-read permissions. Follow [LinkedIn's Posts API documentation](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) when requesting access. Do not infer permission from an existing browser login. Credential acquisition and expanded account access require their own user-authorized setup.

After changing the host connection, restart the host and ask the release agent to call `marketing_update` with `refresh_accounts`. That updates the saved destinations and removes any previous approval. Review the exact destinations again before publishing.

The company post publishes first. Its receipt is retained if the optional repost fails. A process interruption or lost write response marks the attempt uncertain and blocks another send. Inspect LinkedIn, then use `reconcile` with the actual post URN. Reconciliation verifies the saved author and text. A missing result must not be guessed, and an uncertain attempt must not be replaced with a fresh post.
