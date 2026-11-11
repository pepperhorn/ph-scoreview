# Self-hosted CI runner (t3box)

Ledger 0024. ph-scoreview CI runs on a self-hosted GitHub Actions runner on **t3box** (tailnet `100.91.168.52`) to stop paying for GitHub-hosted Linux minutes. The job images are unchanged: `validate` and `reader` run in `mcr.microsoft.com/playwright:v1.63.0-noble`, so the runner needs Docker.

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

## Notes
- The repo is private, so fork PRs can't run code on t3box. Don't make the repo public while this runner is attached. If it ever goes public, require approval for outside contributors first.
- Run **one** runner instance at first. The Chromium validation is CPU-heavy, and parallel jobs (`validate` + 2× `reader`) queue one at a time. Add a second instance (`--name t3box-2`) if PR latency matters more than t3box load.
- Disk: Playwright images and `_work` caches grow. Add `docker image prune -af --filter until=168h` to a weekly cron.
- Never put the registration token in GBrain, docs or chat logs. It expires in an hour anyway.
