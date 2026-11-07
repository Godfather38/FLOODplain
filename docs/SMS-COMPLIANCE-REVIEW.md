# November 7 continuation — experimental source reconciliation

Base release: `90d0d12209e10f2e7c0b085f3a5bff942692a74a`; main: `fc3174238b749877df7c3129dfcd164a7da8a791`. GitHub comparison confirms identical file trees (release is one merge commit ahead). PR #13 remains a conflicting draft at `3064a539d855158b43f2eace17d2158d629db79b`. Branch: `experimental/sms-compliance-release-20261107`.

This is incomplete review work, not deployment or submission approval. No live policies, provider settings, registration, messages or production refs are changed by this revision.

## Reconciliation

- Applied PR #13 source hunks onto the current release, retaining current map/scenario controls, route predictions, repaired road heights and owner-health handling.
- Resolved the removed footer by adding only Privacy Policy, Terms of Service and Support links; did not restore the retired experimental-map link. Dedicated policy CSS hides this footer in full-map mode; the signup and settings policy links remain.
- Combined Twilio acceptance mocks with the release's cache-write failure hook, preserving health regression coverage.
- Retained PR #13 screenshots as historical mocked preview evidence; they are not screenshots of this reconciliation or of an approved/live sender.
- Deliberately retained the release's generated `apps-script/WashWatch.gs` unchanged. The environment has no usable shell, so `npm run build:gas` cannot be run here. Do not deploy this branch until that bundle is regenerated from the reconciled sources and checked. The old bundle does NOT include the source fixes.

## Fresh CI follow-up

[CI run 42397987468](https://github.com/Godfather38/FLOODplain/actions/runs/42397987468) ran npm test at 7265442: 416 passed, 1 failed. All seven SMS compliance tests passed. The failure was the existing simulator guard forbidding the retired exp-link nav. Corrected by giving the policy-only navigation its own policy-links class and styling, without weakening the test or changing simulator placement. Browser CI was still running when this follow-up was recorded; follow-up CI results must be checked. The generated GAS bundle still requires regeneration.

## Fresh checks and limitations

Six existing SMS behavioral tests passed in the available V8 runtime using the reconciled source and mock. The test bodies cover provider rejection/malformed/network replies, consent/confirmation retry, expiry/refused welcome, duplicate waitlist/stop, beta web-help wording, and 21610/broken configuration. Node imports were replaced by an in-memory runner; base64 authentication was a harmless fixed mock. This is not an `npm test` run. Source and mock syntax parse; inline policy matches canonical source. No fresh browser tests or screenshot captures ran. Prior 387-test/browser claims below belong solely to PR #13's earlier revision.

Current-release service-check run https://github.com/Godfather38/FLOODplain/actions/runs/42391882804 is recorded as failed. Its cause has not been attributed to SMS or this revision; investigate independently before assuming live readiness.

## Denial-to-remedy status

| Code | Evidence and limit | Source revision | Still required |
|---|---|---|---|
| [30473](https://www.twilio.com/docs/api/errors/30473) business website | Submitted business website remains unverified. Today's availability cannot establish reviewer-time availability. | Explicit FLOODplain identity; labeled public policy/support entry points. | Read actual saved businessWebsite/profile; verify identity matches the consumer site; anonymous browser check of exact URL and redirects after authorized deployment. |
| [30493](https://www.twilio.com/docs/api/errors/30493) SMS terms | Prior screenshot showed terms and privacy both used the legacy #/privacy URL. Sharing a URL is not itself proof of rejection cause. | Independent static terms, preserved legacy route; accurate 2/day default, up to 4 with key, codes/confirmation/waitlist, rates and sender-specific cancellation/help. | Confirm real HELP/STOP/START behavior and monthly volume; approve accurate terms; regenerate/test/deploy only when authorized; verify exact saved terms URL anonymously. |
| [30509](https://www.twilio.com/docs/api/errors/30509) opt-in evidence access | Existing evidence was a public Google Doc plus hosted image. Public document hosting is allowed; its historical accessibility and completeness remain unproven. | Distinct signup/waitlist disclosures and affirmative actions, consent version/date, confirmation handling and staged mock screenshots. | Check exact submitted links logged out; refresh existing external Doc in place and capture complete actual deployed flow. Explicitly distinguish beta, mock future sender and production evidence. No Doc changed here. |
| [30536](https://www.twilio.com/docs/api/errors/30536) privacy | Legacy rendering depended on app startup; absolute “never shared” and deletion wording required correction for processor/suppression behavior. | Independent privacy access; collected fields, Google/Verizon/Twilio processors, consent protection, support/report/diagnostics, active-sheet deletion versus carrier suppression. | Owner/account evidence must confirm real storage, access, sharing, retention and deletion practices outside repo before policy publication; verify exact saved privacy link and public rendering. |

Other blockers: no verified sender or Messaging Service settings; no controlled live HELP/STOP/START test; no verified business/profile fields or expected monthly volume. Setting TWILIO_APPROVED=yes also enables waitlist sends and remains outside this work. Provider acceptance is not delivery or verification approval.

---

# Historical PR #13 review (November 6; not fresh validation)

# SMS verification repair — review only

Base: `af0726b92d41655ee507894ff17ebbae567ff9d7`. Experimental branch: `experimental/sms-compliance-20261106`. This revision does not deploy, submit a registration, change provider settings, enable `TWILIO_APPROVED`, or send live texts. Toll-free verification is not a license, and acceptance is not guaranteed.

## Findings and remediations

| Review code | Requirement and demonstrated finding | Revision | Evidence and remaining work |
|---|---|---|---|
| [30473](https://www.twilio.com/docs/api/errors/30473) | Business website must be public, operational and identify the sender. The submitted business-website field is unknown. Anonymous Chrome currently receives HTTP 200 at the old GitHub Pages URL after its custom-domain redirect. | Added persistent labeled Privacy Policy, Terms of Service and Support links in `public/index.html`; policy identifies FLOODplain, formerly Wash Watch, and its service area. | Current access is not evidence of availability when reviewed. Confirm actual saved business/profile fields and project identity before resubmission. |
| [30493](https://www.twilio.com/docs/api/errors/30493) | Public terms need frequency, rates and cancellation disclosures. Existing combined policy already had these, but rendering depended on route data and app startup. It incorrectly described HELP as reaching the operator. | `public/sms-policy-content.html`, generated `privacy.html`/`terms.html`, `policy-route.js` and inline legacy policy provide independent access. Terms distinguish beta web controls from toll-free replies, default 2/day from key-based 4/day, codes, confirmation and one waitlist notification. | Desktop/mobile tests block app modules and route data; static pages also work without JavaScript. Both separate registration fields and labeled links should point to the reviewed policies. A shared prior document alone is not a proven defect. |
| [30509](https://www.twilio.com/docs/api/errors/30509) | Opt-in evidence must be anonymously accessible and show the complete consent process. Current hosted image returns HTTP 200; historical reviewer access remains unknown. Existing evidence and branding evolved after the original application. | Refreshed existing `public/twilio/optin.png` and `terms.png`; added confirmation, clearly labeled future-sender preview and `twilio/index.html`. Signup and waitlist have distinct affirmative buttons and adjacent policy links. | Images use fictional numbers and mocked services. Recheck deployed URLs and refresh any existing external proof document in place before resubmission. A dedicated SMS form does not inherently require an extra checkbox. |
| [30536](https://www.twilio.com/docs/api/errors/30536) | Public privacy policy must describe collection, use and protection. Prior “never shared” wording omitted delivery processors and explicit consent protection; “Stopping texts deletes your number” conflated web deletion with provider STOP. | Privacy describes private Google Sheet/Apps Script storage, Google email/Verizon beta delivery, future Twilio/carrier processing, collected fields, support/report/diagnostic handling, and opt-in-data protections. Web deletion and provider suppression are distinguished. | Policy content matches code paths inspected; owner must confirm operational handling outside the repository. This is a demonstrated disclosure improvement, not proof of the reviewer's exact reason. |

Official [onboarding guidance](https://help.twilio.com/hc/en-us/articles/13264118705051-Required-Information-for-Toll-Free-Verification) calls for consistent branding, clearly labeled policy links, voluntary consent and accurate message examples. Separate fields do not by themselves establish that separate documents are required. A document accessible to anyone with its link is an allowable type of proof; document hosting alone is not a defect.

## Exact behavior changes

- `public/app.js`: accurate 2/day default, up to 4 with key, requested codes and confirmation; separate policy links; beta web cancellation/help; waitlist STOP/HELP and web removal; consent version sent with affirmative actions; interrupted-code return control; duplicate in-flight actions guarded; failed stop requests no longer overwritten with success; HTTP failures rejected.
- `apps-script/Code.gs`: consent version/date appended to existing subscriber schema (legacy callers remain labeled `legacy-button`, not retroactively assigned new consent); waitlist version recorded for new rows. Existing columns, script URL and filename remain stable.
- Code sends must receive provider acceptance before the UI enters confirmation. Confirmation checks four digits and ten-minute expiry, is idempotent, includes branding/frequency/rates/cancellation/help, and activates the subscriber only after acceptance. Provider acceptance is not handset delivery.
- Twilio HTTP status and response payload are checked, including malformed/network failures. Error 21610 deactivates the subscriber and marks a matching waitlist entry opted out. No Verizon fallback follows a Twilio refusal or broken approved configuration. Live STOP/HELP handling remains the provider's existing configuration; no new unverified webhook has been added.
- Recurring SMS gets explicit FLOODplain branding plus cancellation/help instructions; long alert summaries are shortened before the footer so the footer survives. Confirmation, code and waitlist text are no longer blindly cut in the middle of disclosures. The existing daily budget counts message attempts, not carrier segments; multi-part SMS can cost more.
- `public/support.html`/`support.js`: public stop and operator-support forms use the existing service endpoint. Support messages do not enroll the sender. Both report service refusal honestly.
- `apps-script/WashWatch.gs` is generated using `npm run build:gas`, not manually edited. Push topics and Verizon beta remain intact.

## Before and after text

Prior signup: “at most 4 msgs/day, plus a one-time sign-up code … your number is never shared.” Revised: “up to 2 scheduled alerts/day (up to 4 with an access key), plus requested verification codes and a signup confirmation. Message and data rates may apply.” The sender-specific cancellation instructions and separate labeled policy/support links follow beside the button. The complete source text is in `public/app.js`.

Prior actual welcome: “FLOODplain texts are on: [times], [days]. To stop, use Stop texts in the app's Alerts screen.” Revised toll-free welcome: “FLOODplain texts are on: [times], [days]. Up to [selected number of times] alerts/day. Msg & data rates may apply. Reply STOP to cancel, HELP for help.” Beta messages instead link to web support/cancellation.

Prior waitlist message offered signup but omitted rates and reply instructions. Revised: “FLOODplain: all-carrier signup is available: https://godfather38.github.io/FLOODplain/#/alerts . Your one requested waitlist text; no recurring alerts unless you sign up. Msg & data rates may apply. Reply STOP to cancel, HELP for help.”

The complete revised privacy/terms text is `public/sms-policy-content.html`; generated copies are checked for drift. The PR diff is the full code revision, including deletions, rather than a summary-only handoff.

## Verification

Run `npm test`, `npm run build:gas`, `npm run test:browser`, and `npm run test:sms-browser`. For local installed Chrome set `E2E_CHROME=1`. Browser requests to messaging services are mocked. The SMS suite covers 390px mobile and 1280px desktop; broken/no-data policy access; JavaScript-disabled static policies; repeat/interrupted signup; duplicate confirmation; separate waitlist enrollment; failed and successful stop; support failures; and the future toll-free UI without activation. Screenshots are reproducible from that suite.

`e2e/audit-public.mjs` separately audits the original public URL, policy hash and hosted image with non-GET requests blocked. The November 6 audit observed HTTP 200 for all three, redirecting to `floodplain.duckdns.org`; the policy retained `#/privacy` and rendered existing text. Code inspection demonstrates the old rendering dependency; the new independent policy tests cover that failure mode.

## Approval and operational steps still required

1. Review the full diff, policy assertions and staged screenshots. Confirm legal/project identity and actual business/profile fields; do not invent registration numbers or contact facts.
2. Approve and publish the frontend and regenerated Apps Script together at their existing URLs. This branch has not done that. Recheck policy, opt-in, support and image URLs anonymously after deployment, including redirects and a no-data policy visit. Update existing external proof documentation in place and label the current beta versus future toll-free flow accurately.
3. Inspect the actual sender and any Messaging Service configuration read-only. Confirm current built-in STOP/HELP behavior and support response. Do not infer a Messaging Service from a PN identifier. If a branded HELP response needs a configuration change, obtain approval for the exact response and setting first. Do not enable Advanced Opt-Out automatically; see [Twilio's guide](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).
4. Submit the reviewed, matching registration values only after approval. Business identity, profile fields and real expected monthly volume require verification against the account. Keep program branding consistent as FLOODplain, noting former Wash Watch where helpful.
5. After provider approval, separately authorize activation and controlled live delivery/STOP/HELP/START testing. Setting `TWILIO_APPROVED=yes` also enables the existing waitlist notification path; it must not be treated as a harmless configuration toggle.

No registration identifiers, private contacts, credentials or external proof-document identifiers belong in this public report.
