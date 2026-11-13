---
title: "Zero-downtime Lambda deploys from GitHub Actions: OIDC, versions, aliases and canary rollback"
description: "Deploy AWS Lambda from GitHub Actions with no stored AWS keys: OIDC login, versions, a weighted alias canary and automatic rollback."
date: 2026-10-20
updated: 2026-11-13
tags: [AWS Lambda, GitHub Actions, CI/CD, Terraform]
draft: false
logos: [aws-lambda, githubactions, aws-api-gateway, terraform]
---

If you deploy Lambda functions from GitHub Actions with plain AWS CLI calls (no SAM, no CDK pipeline), this post shows you how to ship new code to a small slice of traffic first, roll back on its own when errors go up, and do all of it without a single AWS access key stored in GitHub.

## TL;DR

- **No stored keys.** GitHub Actions logs in to AWS with OIDC. The job gets short-lived credentials from AWS STS, and the IAM role only trusts one repo and one GitHub environment.
- **Never send traffic to `$LATEST`.** Every deploy uploads the code, waits for the update to finish, and publishes a numbered version. API Gateway and all event sources call an alias named `live`.
- **Move traffic slowly.** Point 10% of `live` at the new version, watch the errors for five minutes, then move it to 100% or put it back. CodeDeploy can do this for you, or a 40-line shell script can.
- **Rollback is one API call.** You point the alias back at the old version. You don't rebuild anything.
- **Monorepos:** work out which function folders changed and deploy only those, one matrix job per function. Prod waits for a reviewer to approve it.

![Deploy pipeline from git push to promote or roll back](diagrams/pipeline.svg "The whole path. Everything after 'publish' changes only where the alias points.")

## Four words you need first

Here is the vocabulary, one plain sentence each:

- **`$LATEST`** is the editable copy of your function. When you upload code, it lands here.
- A **version** (`1`, `2`, … `8`) is a frozen copy of `$LATEST`. You can't change its code or settings after you publish it.
- An **alias** (like `live`) is a named pointer to a version. You can move it at any time, and it can split traffic between **two** versions by weight.
- A **canary** is a small share of real traffic (say 10%) that tries the new version first, so a bad release hurts only a few requests.

That's the whole trick. Versions are the "what". The alias is the "where". A deploy just publishes a new "what" and then slowly moves the "where".

## Step 1: let GitHub log in to AWS without keys

![GitHub OIDC token exchanged for short-lived AWS credentials](diagrams/oidc-trust.svg "The job proves who it is with a signed token. The role's trust policy decides if that is enough.")

OIDC (OpenID Connect) is a standard way for one system to prove its identity to another with a signed token. Here is how it works:

1. Your job asks GitHub for a token. This needs `permissions: id-token: write` in the workflow.
2. GitHub signs a JWT (a JSON Web Token: a small signed JSON document). Its `sub` claim says who is asking, for example `repo:my-org/my-repo:environment:production`.
3. The `aws-actions/configure-aws-credentials` action sends this token to AWS STS (Security Token Service) with `AssumeRoleWithWebIdentity`.
4. STS checks the signature and the role's trust policy, then gives back credentials that expire within hours.

The trust policy is where your security lives. Here is the one I use for prod:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:environment:production"
      }
    }
  }]
}
```

One detail trips up a lot of people. **If the job uses a GitHub environment, the `sub` claim uses the environment form (`…:environment:production`), not the branch form (`…:ref:refs/heads/main`).** If your trust policy expects the branch but the job has `environment: production`, the login fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity". Write the condition for the form your job really sends.

IAM also refuses a GitHub trust policy that has no `sub` condition, or one whose value is only `*`. That's good: without it, any GitHub repo in the world could take on your role.

Here is the Terraform for the provider and the role:

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # No thumbprint_list: for GitHub, AWS checks the certificate against its own trusted CAs.
}

data "aws_iam_policy_document" "gha_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:my-org/my-repo:environment:production"]
    }
  }
}

resource "aws_iam_role" "gha_deploy_prod" {
  name               = "gha-lambda-deploy-prod"
  assume_role_policy = data.aws_iam_policy_document.gha_trust.json
}
```

> **Note:** Older guides tell you to work out a certificate thumbprint for GitHub. You don't need to anymore. Since July 2023, AWS checks GitHub's certificate against its own list of trusted root CAs and ignores any thumbprint you set. In current versions of the Terraform AWS provider, `thumbprint_list` is optional, so leave it out. On very old provider versions it was required, so upgrade if Terraform complains.

Give the role only what the deploy needs: `lambda:UpdateFunctionCode`, `GetFunction`, `GetFunctionConfiguration`, `PublishVersion`, `GetAlias`, `UpdateAlias`, `ListVersionsByFunction`, `ListAliases` and `DeleteFunction` (for cleanup), plus `cloudwatch:DescribeAlarms` and `cloudwatch:GetMetricStatistics`. Scope the Lambda actions to your function ARNs, like `arn:aws:lambda:*:111122223333:function:orders-*`. Make one role per environment, so a staging job can never touch prod.

## Step 2: point everything at the alias

![Event sources call the live alias, which splits traffic between v7 and v8](diagrams/where-things-point.svg "Callers only know 'live'. Only the alias knows about versions.")

This is the step people skip, and then their "canary" does nothing. If API Gateway calls the plain function ARN (`…:function:orders`), it calls `$LATEST`. The moment CI uploads a new zip, 100% of your users get untested code. No alias trick can help after that.

So every caller must use the **alias ARN** (`…:function:orders:live`):

- **API Gateway / Function URL:** the integration URI uses the alias, and the `lambda:InvokeFunction` permission has `--qualifier live`. A permission on the plain function does not cover the alias.
- **Event source mappings** (SQS, Kinesis, DynamoDB streams): set `FunctionName` to the alias ARN.
- **S3, SNS, EventBridge:** the target is the alias ARN, and the resource policy is on the alias.

In Terraform, let Terraform create the alias and the wiring, and let CI own the version numbers:

```hcl
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.orders.function_name
  function_version = aws_lambda_function.orders.version # only used on first create
  lifecycle {
    ignore_changes = [function_version, routing_config] # CI moves these
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "apigw-live"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.orders.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# In the API Gateway integration:
#   integration_uri = aws_lambda_alias.live.invoke_arn
```

Also add `filename` and `source_code_hash` to `ignore_changes` on `aws_lambda_function`. If you don't, the next `terraform apply` puts back whatever zip Terraform last saw, and that zip lands on `$LATEST`.

## Step 3: upload, wait, publish

Each deploy runs three AWS CLI calls:

```bash
sha=$(aws lambda update-function-code --function-name orders \
  --zip-file fileb://function.zip --query CodeSha256 --output text)

aws lambda wait function-updated --function-name orders

ver=$(aws lambda publish-version --function-name orders \
  --code-sha256 "$sha" --description "$GITHUB_SHA" \
  --query Version --output text)
```

Here is why each piece is there:

- **`wait function-updated`**: `update-function-code` returns before the update is done. If you publish too early, you get a `ResourceConflictException`, or a version of the old code.
- **`--code-sha256`**: this makes `publish-version` fail if someone else changed `$LATEST` between your upload and your publish. You freeze exactly the zip you tested, or nothing.
- **`--description "$GITHUB_SHA"`**: later, `list-versions-by-function` tells you which commit each version came from.

Watch out for one edge case: if nothing changed since the last version, Lambda doesn't make a new one. It hands back the existing one. The canary script below checks for this and exits early.

## Step 4: move traffic slowly

![Stacked bars showing v7 and v8 traffic share before, during and after the canary](diagrams/alias-weights.svg "A 10% canary for five minutes, then all traffic moves to v8.")

A weighted alias holds one main version plus `AdditionalVersionWeights`, which is a map of one other version to a share between 0 and 1. With `{"8": 0.1}`, about 10% of calls go to v8 and the rest go to v7. Both versions must have the same execution role and the same dead-letter queue setup, and neither can be `$LATEST`.

You have two ways to drive this.

### Option A: let CodeDeploy do it

CodeDeploy knows how to shift Lambda alias traffic. You make an app and a deployment group once (in Terraform). Then each deploy is one API call. `CodeDeployDefault.LambdaCanary10Percent5Minutes` sends 10% for five minutes, then the other 90%. If an alarm you attached goes off while it runs, CodeDeploy stops and puts the alias back by itself.

```hcl
resource "aws_codedeploy_app" "orders" {
  name             = "orders"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "live" {
  app_name               = aws_codedeploy_app.orders.name
  deployment_group_name  = "live"
  service_role_arn       = aws_iam_role.codedeploy.arn # AWSCodeDeployRoleForLambda
  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"
  deployment_style {
    deployment_type   = "BLUE_GREEN"
    deployment_option = "WITH_TRAFFIC_CONTROL"
  }
  alarm_configuration {
    enabled = true
    alarms  = [aws_cloudwatch_metric_alarm.orders_live_errors.alarm_name]
  }
  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }
}
```

From the workflow, after `publish-version`, you pass an AppSpec (the small file that tells CodeDeploy which alias to move, and from which version to which) right in the call:

```bash
cur=$(aws lambda get-alias --function-name orders --name live \
  --query FunctionVersion --output text)
appspec=$(cat <<EOF
{"version":0.0,"Resources":[{"orders":{"Type":"AWS::Lambda::Function",
 "Properties":{"Name":"orders","Alias":"live","CurrentVersion":"$cur","TargetVersion":"$ver"}}}]}
EOF
)
id=$(aws deploy create-deployment --application-name orders \
  --deployment-group-name live \
  --revision "$(jq -nc --arg c "$appspec" \
     '{revisionType:"AppSpecContent",appSpecContent:{content:$c}}')" \
  --query deploymentId --output text)
aws deploy wait deployment-successful --deployment-id "$id"
```

The waiter fails if the deployment fails or rolls back, so your job goes red. The deploy role also needs `codedeploy:CreateDeployment`, `GetDeployment`, `GetDeploymentConfig`, `RegisterApplicationRevision` and `GetApplicationRevision`. You can also add `BeforeAllowTraffic` hooks: a Lambda that runs a smoke test before any real traffic moves.

### Option B: a small script you can read

If you don't want another service, the same logic fits in a short script. It shifts 10%, checks every minute for five minutes, then promotes or rolls back. It looks at two signals: the alias-level error alarm, and the `Errors` metric for **only the new version**. The `ExecutedVersion` dimension in CloudWatch splits alias metrics by the version that really ran.

```bash
#!/usr/bin/env bash
# scripts/canary.sh <function> <alias> <new-version>
set -euo pipefail
fn=$1; alias=$2; new=$3
weight=${CANARY_WEIGHT:-0.1}; minutes=${BAKE_MINUTES:-5}; alarm="$fn-$alias-errors"

old=$(aws lambda get-alias --function-name "$fn" --name "$alias" --query FunctionVersion --output text)
[ "$old" = "$new" ] && { echo "v$new is already live"; exit 0; }

point() { aws lambda update-alias --function-name "$fn" --name "$alias" \
  --function-version "$1" --routing-config 'AdditionalVersionWeights={}' > /dev/null; }
rollback() { trap - ERR INT TERM; point "$old"; echo "::error::$fn rolled back to v$old"; exit 1; }

aws lambda update-alias --function-name "$fn" --name "$alias" \
  --routing-config "AdditionalVersionWeights={\"$new\"=$weight}" > /dev/null
trap rollback ERR INT TERM   # a cancelled or crashed job must not leave the split in place

for i in $(seq "$minutes"); do
  sleep 60
  state=$(aws cloudwatch describe-alarms --alarm-names "$alarm" \
    --query 'MetricAlarms[0].StateValue' --output text)
  errors=$(aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors \
    --dimensions Name=FunctionName,Value="$fn" Name=Resource,Value="$fn:$alias" Name=ExecutedVersion,Value="$new" \
    --start-time "$(date -u -d '-3 min' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
    --period 60 --statistics Sum --query 'sum(Datapoints[].Sum)' --output text)
  echo "minute $i: alarm=$state, v$new errors=$errors"
  if [ "$state" = "ALARM" ] || [ "${errors%.*}" -gt 0 ]; then rollback; fi
done

trap - ERR INT TERM
point "$new"
echo "$fn:$alias -> v$new (100%)"
```

"Any error at all" is a strict rule. For a busy function, swap it for an error rate (`Errors` ÷ `Invocations` for the new version) and a minimum number of calls, so one unlucky timeout doesn't block every release.

## The full workflow (option B, monorepo-ready)

![Changed folders become a matrix of deploy jobs](diagrams/monorepo-matrix.svg "Only folders with changes get a deploy job. Each job runs its own canary.")

This workflow assumes one folder per function under `functions/`, with the folder name the same as the Lambda function name. The first job finds which folders changed. The second job runs once per changed function.

```yaml
name: deploy-lambdas
on:
  push:
    branches: [main]
    paths: ["functions/**"]

jobs:
  changes:
    runs-on: ubuntu-latest
    permissions: { contents: read }
    outputs:
      functions: ${{ steps.diff.outputs.functions }}
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - id: diff
        run: |
          fns=$(git diff --name-only "${{ github.event.before }}" "${{ github.sha }}" -- functions/ \
            | cut -d/ -f2 | sort -u | jq -R . | jq -sc .)
          echo "functions=$fns" >> "$GITHUB_OUTPUT"

  deploy:
    needs: changes
    if: needs.changes.outputs.functions != '[]'
    runs-on: ubuntu-latest
    environment: production          # required reviewers + the OIDC sub claim
    permissions:
      id-token: write                # lets the job ask GitHub for an OIDC token
      contents: read                 # lets actions/checkout read the repo
    strategy:
      fail-fast: false
      matrix:
        fn: ${{ fromJSON(needs.changes.outputs.functions) }}
    concurrency: deploy-${{ matrix.fn }}   # never two canaries on one alias
    defaults:
      run: { working-directory: "functions/${{ matrix.fn }}" }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 24 }
      - run: npm ci && npm test && npm run build
      - run: cd dist && zip -qr ../function.zip .
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ vars.DEPLOY_ROLE_ARN }}
          aws-region: ap-south-1
      - id: publish
        run: |
          sha=$(aws lambda update-function-code --function-name "${{ matrix.fn }}" \
            --zip-file fileb://function.zip --query CodeSha256 --output text)
          aws lambda wait function-updated --function-name "${{ matrix.fn }}"
          ver=$(aws lambda publish-version --function-name "${{ matrix.fn }}" \
            --code-sha256 "$sha" --description "${{ github.sha }}" --query Version --output text)
          echo "version=$ver" >> "$GITHUB_OUTPUT"
      - run: ../../scripts/canary.sh "${{ matrix.fn }}" live "${{ steps.publish.outputs.version }}"
```

A few notes on this file:

- **`environment: production`** does two jobs. In the repo settings you add **required reviewers** to that environment, so the job waits until a person approves it. It also makes the OIDC `sub` claim `repo:my-org/my-repo:environment:production`, which is exactly what the trust policy allows. A job without the environment can't take on the prod role at all.
- **`DEPLOY_ROLE_ARN`** is an environment variable, not a secret. A role ARN isn't sensitive, and keeping it per environment means staging and prod use different roles without any `if` logic.
- **`fail-fast: false`** means one function rolling back doesn't cancel the canaries of the others halfway through.
- **`paths`** on the trigger skips the whole run when nothing under `functions/` changed. The `git diff` then narrows it down to the folders that did change.
- `configure-aws-credentials@v6` was the current major version when I checked in November 2026. Pin a full commit SHA if your org requires it.

## Triggers that behave differently under a weighted alias

The traffic split happens **per invocation**. That's simple for HTTP, but less simple for anything that batches or retries.

| Trigger | What the split means | Watch out for |
|---|---|---|
| API Gateway, Function URL, ALB | Each request picks v7 or v8 by weight | Low traffic is noisy: AWS says the split is probabilistic, so with only a few calls the real share can be far from 10% |
| S3, SNS, EventBridge (async) | Each event picks a version when Lambda runs it | Don't assume a retry goes to the same version. A bad v8 can fail an event that v7 then retries |
| SQS mapping | The poller calls the alias once per batch, so the whole batch goes to one version | Failed messages come back after the visibility timeout and may land on either version. Big batches make the 10% lumpy |
| Kinesis / DynamoDB streams | Same, per batch | By default, a failing batch blocks its shard until it succeeds or expires, so v8 errors slow down v7 too |
| Provisioned concurrency | Set on the alias or a version, never `$LATEST` | While the split is active, calls can spill over to on-demand (cold) instances. AWS suggests extra provisioned concurrency during the shift |

For queue and stream consumers, I keep the canary but care more about the rollback alarm than the bake time. A shard stuck on a poison batch is a worse problem than a few HTTP 500s.

## Rollback and cleanup

Rolling back is one call. You don't rebuild or re-upload anything:

```bash
aws lambda update-alias --function-name orders --name live \
  --function-version 7 --routing-config 'AdditionalVersionWeights={}'
```

Old versions pile up, and each one counts toward Lambda's code storage quota. When I checked in November 2026, that was 300 GB per Region, and AWS can't raise it. I keep the last five versions and never delete one that an alias still uses:

```bash
fn=orders; keep=5
in_use=$(aws lambda list-aliases --function-name "$fn" --output json \
  | jq -r '.Aliases[] | .FunctionVersion, ((.RoutingConfig.AdditionalVersionWeights // {}) | keys[])')
aws lambda list-versions-by-function --function-name "$fn" --output json \
  | jq -r '.Versions[].Version | select(. != "$LATEST")' | sort -n | head -n -"$keep" \
  | while read -r v; do
      grep -qx "$v" <<<"$in_use" && continue
      aws lambda delete-function --function-name "$fn" --qualifier "$v"
    done
```

Run it as a last step after a successful promote, or as a weekly scheduled workflow.

## CodeDeploy or the script?

| | CodeDeploy (option A) | Script (option B) | Flip the alias at once |
|---|---|---|---|
| Moving parts | App, deployment group, service role | One shell file | One CLI call |
| Rollback trigger | CloudWatch alarms, handled by AWS | Alarm + per-version metric, handled by your job | You, by hand |
| If the CI runner dies mid-shift | CodeDeploy keeps going | `trap` rolls back on cancel; a hard kill leaves the split | Nothing in flight |
| Shift patterns | Canary, linear, all-at-once, custom | Whatever you write | All-at-once |
| Pre-traffic smoke tests | Built in (`BeforeAllowTraffic` hook) | A step before the script | A step before the flip |
| Best for | Many functions, long bake times, strict audit | Few functions, readable pipelines | Internal tools, dev stages |

My rule of thumb: start with the script, because you can read the whole deploy in one file. Move to CodeDeploy once you bake for longer than a CI job should sit waiting, or when someone asks for an audit trail of every traffic shift.

## Gotchas

- **The first push to a new branch** has `github.event.before` set to forty zeros, so `git diff` fails. Use `git diff HEAD~1` as a fallback, or deploy all functions in that case.
- **Terraform and CI fighting.** Without `ignore_changes`, `terraform apply` resets the alias to the version Terraform remembers. That's a silent rollback, or a silent roll-forward.
- **Config changes skip the canary.** Environment variables, memory and timeout live on `$LATEST` too. They're only safe because `publish-version` freezes them together with the code. Never change config on a live version (you can't anyway), and never point callers at `$LATEST`.
- **Metrics arrive late.** A Lambda metric carries the time the call started, and it can show up a few minutes later (longer for slow functions). A one-minute bake can promote before the errors are even reported. That's why the script looks back three minutes on every check, and why I bake for five.
- **No traffic means no signal.** If the function gets two calls in five minutes, the canary proves nothing. Send synthetic traffic, or make the script require a minimum `Invocations` count before it promotes.
- **Database changes aren't covered.** v7 and v8 run side by side, so any schema change must work with both. Use expand-then-contract migrations.

## When not to use this

- **You already use SAM or CDK.** `AutoPublishAlias` plus `DeploymentPreference` sets up all of option A for you. Don't rebuild it by hand.
- **Low-traffic internal jobs**, like a nightly cron function. A canary needs traffic to mean anything. Publish a version and flip the alias.
- **Changes that can't run side by side**, such as a new message format that v7 can't read. Use a feature flag or a two-step release instead of a traffic split.

## Checklist

- [ ] OIDC provider with no thumbprint; role trust limited by `aud` and an exact `sub`
- [ ] One deploy role per environment, with Lambda actions scoped to your function ARNs
- [ ] Every trigger and permission uses the `live` alias ARN, never the plain ARN
- [ ] `update-function-code` → `wait function-updated` → `publish-version --code-sha256`
- [ ] Error alarm on `Resource = <fn>:live`; per-version check with `ExecutedVersion`
- [ ] Rollback on alarm, on job cancel and on script error
- [ ] `ignore_changes` on the alias version, the routing config and the function's zip
- [ ] Prod environment with required reviewers
- [ ] Old versions cleaned up, keeping any version an alias uses

## Further reading

- [Lambda: implement canary deployments using a weighted alias](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
- [Lambda: using aliases in event sources and permissions policies](https://docs.aws.amazon.com/lambda/latest/dg/using-aliases.html)
- [Lambda: viewing metrics (the `ExecutedVersion` dimension)](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-view.html)
- [Lambda: configuring provisioned concurrency](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [IAM: configuring a role for the GitHub OIDC identity provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html#idp_oidc_Create_GitHub)
- [GitHub: OpenID Connect reference (subject claim formats)](https://docs.github.com/en/actions/reference/security/oidc)
- [GitHub changelog: AWS OIDC no longer needs pinned certificates (July 2023)](https://github.blog/changelog/2023-07-13-github-actions-oidc-integration-with-aws-no-longer-requires-pinning-of-intermediate-tls-certificates/)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
- [CodeDeploy: deployment configurations](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html)
- [CodeDeploy: AppSpec example for a Lambda deployment](https://docs.aws.amazon.com/codedeploy/latest/userguide/reference-appspec-file-example.html#appspec-file-example-lambda)
- [Terraform: aws_iam_openid_connect_provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_openid_connect_provider)
