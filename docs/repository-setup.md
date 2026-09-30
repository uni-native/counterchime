# One-time repository setup

The separate `/repository-setup.html` page is an owner-requested operational helper, not part of the contest showcase. Only a user may enter and submit an existing GitHub token. Do not inspect the filled field, read clipboard contents, enter a token on the user's behalf, or reuse an exposed token.

The HTTPS, same-origin POST endpoint accepts only a bounded JSON `apiKey` property. It calls fixed GitHub endpoints: verify `/user` is `uni-native`; inspect `/repos/uni-native/counterchime`; create `/user/repos` only after a 404. Creation parameters are fixed to an empty public `counterchime` repository. An existing private repository is not modified. Redirects are rejected. Upstream error bodies and arbitrary URL fields are never displayed.

No token is stored in application logs, database, browser storage, React state, URLs, exports, or returned responses. The uncontrolled password field clears synchronously when the user submits, and again on completion/page exit. Memory references are released; JavaScript strings cannot be securely zeroized. This is not a token vault and gives the assistant no continuing GitHub credential access. Revoking the token is the user's separate GitHub action.

Mocked tests cover account mismatch, invalid input/origin/method, fixed destination/body, existing repository handling, and redaction. No real GitHub credential was used during development. Provider/network failures can leave creation uncertain; check the exact repository before retrying. No source files are uploaded by this helper.

Official API: https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user
