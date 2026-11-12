# Self-hosted CI runner (t3box)

Ledger 0024. ph-scoreview CI runs on a self-hosted GitHub Actions runner on **t3box** (tailnet `100.91.168.52`) to stop paying for GitHub-hosted Linux minutes. `validate` and `reader` run in a container (`mcr.microsoft.com/playwright:v1.63.0-noble`, or the CI image below when `CI_IMAGE` is set), so the runner needs Docker.

## Switch

`ci.yml` reads `runs-on` from the repo variable `CI_RUNS_ON` (JSON) and falls back to `ubuntu-latest` when it's unset.

```bash
gh variable set CI_RUNS_ON -R pepperhorn/ph-scoreview --body '["self-hosted","linux","x64","t3box"]'   # use t3box
gh variable delete CI_RUNS_ON -R pepperhorn/ph-scoreview                                              # back to GitHub-hosted
```

If t3box is offline, queued jobs wait for it, up to 24 h. Delete the variable to fall back.

## Install (run on t3box; the human does this because tailnet SSH policy blocks agents)

```bash
# 1. a dedicated user with Docker access
sudo useradd -m -s /bin/bash ghrunner && sudo usermod -aG docker ghrunner
sudo -iu ghrunner
mkdir actions-runner && cd actions-runner
curl -fsSL -o runner.tgz https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz
tar xzf runner.tgz && rm runner.tgz

# 2. registration token (short-lived; from any machine with gh logged in as an org admin)
#    gh api -X POST repos/pepperhorn/ph-scoreview/actions/runners/registration-token --jq .token
./config.sh --unattended --url https://github.com/pepperhorn/ph-scoreview \
  --token <TOKEN> --name t3box --labels t3box --work _work --replace
exit

# 3. run as a service (as your sudo user)
cd ~ghrunner/actions-runner && sudo ./svc.sh install ghrunner && sudo ./svc.sh start
```

Check: `gh api repos/pepperhorn/ph-scoreview/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'` should show `t3box` `online`.

## Status (2026-11-12)

- Installed by the lead over Tailscale SSH (root) with `t3box-runner.sh`: `ghrunner` user in the docker group, service `actions.runner.pepperhorn-ph-scoreview.t3box`, Poppler on the host, weekly prune in `/etc/cron.d/ghrunner-prune`. t3box: 8 cores, 14 GB RAM.
- **`CI_RUNS_ON` unset again (2026-11-12).** Verification run 43183805870: both reader jobs passed on t3box (~15 min each), but `test:pack` crashed with `Illegal instruction` (exit 132) in `astro build` inside the fresh-from-npm Astro host. t3box is an i7-3610QM (Ivy Bridge: AVX, no AVX2/BMI2/FMA), so some native binary the pack smoke installs needs x86-64-v3. Also: one runner serialises the three jobs (52 min wall clock vs ~19 min hosted), and the repo is now public, so hosted minutes are free. Leave this repo on GitHub-hosted runners; t3box suits private repos whose toolchains run on x86-64-v2.
- `CI_IMAGE` not set yet (ghcr package not anonymously pullable).
- **The repo is now public.** Fork PR workflows require approval for all external contributors (`actions/permissions/fork-pr-contributor-approval` = `all_external_contributors`), so no outside code reaches t3box unreviewed. Never approve a fork PR's workflow run without reading the diff, including `.github/`.

## Notes
- The repo is private, so fork PRs can't run code on t3box. Don't make the repo public while this runner is attached. If it ever goes public, require approval for outside contributors first.
- Run **one** runner instance at first. The Chromium validation is CPU-heavy, and parallel jobs (`validate` + 2× `reader`) queue one at a time. Add a second instance (`--name t3box-2`) if PR latency matters more than t3box load.
- Disk: Playwright images and `_work` caches grow. Add `docker image prune -af --filter until=168h` to a weekly cron.
- Never put the registration token in GBrain, docs or chat logs. It expires in an hour anyway.

## CI image

The default remains the public Playwright image above. To avoid installing Poppler on every CI run, `.github/ci-image/Dockerfile` adds `poppler-utils` to that image. The **Publish CI image** workflow (`ci-image.yml`) builds and pushes `ghcr.io/pepperhorn/ph-scoreview-ci:v1.63.0-noble` using `GITHUB_TOKEN`; it runs manually or when `.github/ci-image/**` changes on `main`.

Merging a change under `.github/ci-image/**` publishes the image automatically. To republish by hand:

```bash
gh workflow run ci-image.yml -R pepperhorn/ph-scoreview --ref main
```

Before switching, make the `ph-scoreview-ci` container package **public** in its GitHub package settings (**one-way**: GitHub can't make a public package private again; approved by the human 2026-11-12), then verify an anonymous pull succeeds. The image contains only Playwright and Poppler, with no repository files or secrets. CI deliberately pulls anonymously: its existing `contents: read` token cannot pull private GHCR packages, and supplying GitHub credentials to the default MCR registry is unnecessary. Private-image support would also need `packages: read` permission and conditional container credentials; that is outside this task's permitted `ci.yml` edits. See [GitHub's container-registry authentication guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Then switch both CI jobs (works on GitHub-hosted and self-hosted runners):

```bash
gh variable set CI_IMAGE -R pepperhorn/ph-scoreview --body 'ghcr.io/pepperhorn/ph-scoreview-ci:v1.63.0-noble'
# Roll back to the public Playwright image and Poppler install fallback:
gh variable delete CI_IMAGE -R pepperhorn/ph-scoreview
```

Keep the Playwright tags in `ci.yml`, `.github/ci-image/Dockerfile`, and `ci-image.yml` aligned with `playwright-core`. **`CI_IMAGE` overrides the tag in `ci.yml`**: a Playwright bump must also bump the Dockerfile tag, publish the new image, and re-set `CI_IMAGE` to the new tag, or CI keeps running the old browsers. Both jobs skip apt when `pdftoppm` is already present; otherwise they install Poppler with five apt retries.
