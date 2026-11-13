---
title: "Terraform for a one-AWS-account startup: layout, state, and the day you split"
seo_title: "Terraform project structure for an AWS startup"
description: "How to structure Terraform for a small AWS startup: one state, then split state per stack and environment, then multi-account. With real HCL."
date: 2026-10-13
tags: [Terraform, AWS, Infrastructure as Code, DevOps]
draft: false
logos: [terraform, aws-aurora, aws-systems-manager, githubactions]
---

If you are the developer who "also does the infra" at a small company, this post shows how I lay out Terraform for one AWS account, how I store state, and how I know it is time to split things up.

## TL;DR

- **Start with one folder and one state file.** It is fine for a small team with a small account. Don't build for a scale you don't have yet.
- **When plans get slow or scary, split state by how often things change:** `network`, `data`, `app`, `edge`. Each one becomes a separate state per environment.
- **Keep state in S3 with `use_lockfile = true`.** S3-native locking is generally available from Terraform 1.11, and the old DynamoDB lock table is deprecated.
- **Use folders for environments, not workspaces.** The environment name sits in the path, so you can see where you are applying.
- **Move to several AWS accounts** when you need hard walls around prod data, or when a second team starts working in the same account.

![Three stages side by side: one state in one account, four split states in one account, and separate prod, staging and shared accounts under AWS Organizations, with the trigger signals on a timeline below](diagrams/tf-stages.svg "The three stages, and the signals that move you from one to the next")

A quick word list before we start. **State** is the file where Terraform remembers which real AWS resources it manages. A **root module** is the folder you run `terraform plan` in. A **stack** is my name for one root module with its own state. **Blast radius** is how much can break if one change goes wrong.

## Stage 1: one root module, one state

At the start, everything lives in one folder: VPC, Aurora, Lambda, API Gateway, SQS, CloudFront, WAF, IAM. One `terraform apply` builds the lot. This is the right choice when:

- one or two people make infra changes;
- `terraform plan` finishes in a minute or two;
- you have one environment, or staging is a cheap copy you rebuild often.

Even here, the state must not live on your laptop. Put it in S3 from day one.

```hcl
terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "example-tfstate"
    key          = "main.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

`use_lockfile = true` tells Terraform to write a small lock file next to the state file in S3. While one person runs `apply`, nobody else can. Terraform 1.10 added this as an experiment. Terraform 1.11 made it generally available and deprecated the DynamoDB-related backend arguments. The current S3 backend docs say DynamoDB locking "will be removed in a future minor version". So for a new setup, you don't need a DynamoDB table at all. If you already have one, you can set both `dynamodb_table` and `use_lockfile` while you move over; Terraform then takes both locks.

Turn on versioning for the state bucket. If a bad apply or a bad manual edit damages the state, you can go back to an older version.

> **Tip:** Create the state bucket by hand or with a tiny separate "bootstrap" config. Don't manage the bucket from the same state that lives inside it.

## Stage 2: split state by lifecycle and blast radius

The single state starts to hurt in a way you can feel. A plan takes five minutes because Terraform has to check every resource. A small Lambda change shows a diff on the database. Two people want to apply at the same time and one of them waits for the lock. Every apply feels like it could break everything, because it can.

![A monolith state shown as one big red circle containing every resource, next to four small circles for network, data, app and edge where only app is red](diagrams/tf-blast-radius.svg "A bad change in a split setup stays inside one stack")

The fix is to split one big state into a few smaller ones. I split by **lifecycle**, which means how often a thing changes, and by **blast radius**:

| Stack | What's inside | How often it changes | Cost of a mistake |
|---|---|---|---|
| `network` | VPC, subnets, NAT, VPC endpoints | a few times a year | very high |
| `data` | Aurora, Redis, S3 buckets | monthly | very high (data loss) |
| `app` | Lambda, API Gateway, SQS, EventBridge, IAM roles | daily | medium |
| `edge` | CloudFront, WAF, Route 53 records | weekly | high (whole site down) |

Four stacks is enough for most startups. More than six or seven, and you spend your day wiring outputs between them.

### The repo layout

![Repository tree: infra folder with envs containing prod and staging tfvars files, stacks containing network, data, app and edge, and modules containing your own modules and pinned registry modules](diagrams/tf-repo-tree.svg "One copy of the code in stacks/, small per-environment files in envs/")

Each folder under `stacks/` is a root module. The code is the same for prod and staging. What changes is a small `.tfvars` file (variable values) and the backend settings in `envs/<env>/`. The backend block in each stack is left empty on purpose, and you fill it in at `init` time. Terraform calls this a "partial configuration".

```hcl
# stacks/app/backend.tf
terraform {
  backend "s3" {}
}

# envs/prod/backend.hcl
bucket       = "example-tfstate-prod"
region       = "eu-west-1"
encrypt      = true
use_lockfile = true
```

```bash
# run from infra/
env=prod stack=app
terraform -chdir=stacks/$stack init -reconfigure \
  -backend-config=../../envs/$env/backend.hcl \
  -backend-config="key=$env/$stack.tfstate"
terraform -chdir=stacks/$stack plan -var-file=../../envs/$env/$stack.tfvars
```

Each stack in each environment gets its own state key, like `prod/app.tfstate`. A tiny `Makefile` or script wraps these two commands so nobody types them by hand.

### Why folders and not workspaces

Terraform **workspaces** let one folder hold several states, and you switch between them with `terraform workspace select`. They look perfect for environments. I don't use them for that, for three reasons:

1. **The environment is hidden.** It lives in a local setting, not in the command or the path. Sooner or later someone applies to prod while thinking they are in staging.
2. **Differences creep into the code.** You end up with `terraform.workspace == "prod" ? 3 : 1` all over the place. A tfvars file per environment keeps those numbers in one small, readable place.
3. **Same backend for everything.** All workspaces share one bucket and the same access rights. With folders, prod state can live in its own bucket with tighter IAM.

Workspaces are fine for short-lived copies, like one stack per feature branch. For prod and staging, I want the name in the path.

### Passing values between stacks

Once the state is split, the `app` stack still needs the subnet IDs from `network` and the database endpoint from `data`. There are two common ways to pass them.

![Network, data, app and edge applied in order one to four; each writes outputs to SSM Parameter Store and the next one reads them, with dashed arrows showing the terraform_remote_state alternative](diagrams/tf-state-deps.svg "Apply in order: network, data, app, edge. Destroy in the reverse order")

**Option 1: `terraform_remote_state`.** The `app` stack reads the outputs of the `network` state file directly.

```hcl
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "example-tfstate-prod"
    key    = "prod/network.tfstate"
    region = "eu-west-1"
  }
}

resource "aws_lambda_function" "api" {
  # ...
  vpc_config {
    subnet_ids         = data.terraform_remote_state.network.outputs.private_subnet_ids
    security_group_ids = [aws_security_group.api.id]
  }
}
```

It is quick to set up. The catch: the reader needs permission to read the whole state file of the other stack, and that file can hold secrets. It also ties the two stacks together tightly. Rename an output, and the other stack breaks on its next plan.

**Option 2: SSM Parameter Store.** The `network` stack writes the values it wants to share as parameters. Other stacks read only those values.

```hcl
# stacks/network: publish
resource "aws_ssm_parameter" "private_subnet_ids" {
  name  = "/${var.env}/network/private_subnet_ids"
  type  = "StringList"
  value = join(",", module.vpc.private_subnets)
}

# stacks/app: consume
data "aws_ssm_parameter" "private_subnet_ids" {
  name = "/${var.env}/network/private_subnet_ids"
}

locals {
  private_subnet_ids = split(",", data.aws_ssm_parameter.private_subnet_ids.insecure_value)
}
```

I use `insecure_value` because subnet IDs are not secret. The normal `value` attribute is marked as sensitive, which hides it in the plan output and makes the plan harder to review.

| | `terraform_remote_state` | SSM parameters |
|---|---|---|
| Setup effort | lowest | one resource per value |
| Who can read what | whole state file | only the shared values |
| Coupling | tight, to output names | loose, to a parameter path |
| Readable by non-Terraform tools | no | yes (scripts, Lambda, CI) |
| Failure mode | output renamed, reader breaks | parameter missing, plan fails with a clear error |

I start with SSM. The parameter paths become a small, clear contract between stacks, and Lambda code or scripts can read the same values at runtime.

## Modules: write your own or use the registry?

A **module** is a folder of Terraform code you can call many times with different inputs. My rule is simple:

- **Use [terraform-aws-modules](https://registry.terraform.io/namespaces/terraform-aws-modules)** for big, well-known building blocks like the VPC. They handle many edge cases you would otherwise learn about the hard way.
- **Write your own small module** when it captures how *your* company does something. For example, `lambda-service` creates a function, its IAM role, its log group with a retention period, and its alarms, all with your naming rules.
- **Don't wrap a registry module in your own module** just to rename its inputs. That adds a layer and saves nothing.

Always pin versions. `version = "~> 6.0"` lets in bug fixes and new features, but not the next major version, which may break things. Upgrade on purpose, in its own pull request, and read the plan.

## Protect your data stores

The `data` stack holds things you can't get back by re-running Terraform. Protect them twice: once in Terraform and once in AWS.

```hcl
resource "aws_rds_cluster" "main" {
  cluster_identifier          = "${var.env}-main"
  engine                      = "aurora-postgresql"
  master_username             = "app_admin"
  manage_master_user_password = true # RDS keeps the password in Secrets Manager
  deletion_protection         = true # AWS refuses to delete it
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.env}-main-final"
  storage_encrypted           = true

  lifecycle {
    prevent_destroy = true # Terraform refuses to plan a destroy
  }
}
```

`prevent_destroy` makes any plan that would delete this resource fail. That includes the sneaky case where you change a field that forces a "replace", which is a delete plus a create. `deletion_protection` is the AWS-side lock, and it also stops someone clicking "Delete" in the console. Add `prevent_destroy` to S3 buckets with user data too.

> **Warning:** `prevent_destroy` only works while the resource block is in your code. If someone deletes the whole block, the protection goes with it. This is why `deletion_protection` on the AWS side matters.

## Bringing in resources made by hand

Most startups have a few things someone created in the console before Terraform arrived. Since Terraform 1.5 you can import them with an `import` block in your code, instead of the older one-off `terraform import` command.

```hcl
import {
  to = aws_s3_bucket.uploads
  id = "example-uploads-prod"
}
```

```bash
terraform plan -generate-config-out=generated.tf
```

Terraform reads the real bucket and writes a matching `resource` block into `generated.tf`. Clean that file up, move the block where it belongs, and run `plan` again until it shows no changes apart from the import. Then apply. Because the import is in code, it goes through the same pull request review as every other change. You can delete the `import` block after the apply.

## Tags everywhere, with `default_tags`

Tags are labels on AWS resources. They power cost reports and help you find out who owns what. Set them once on the provider, and every resource the provider creates gets them.

```hcl
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      env        = var.env
      stack      = "app"
      managed_by = "terraform"
      repo       = "infra"
    }
  }
}
```

Now you can filter Cost Explorer by `stack` and see what `data` costs compared with `app`. You'll need to turn these tags on as cost allocation tags in the Billing console first.

## Secrets never go in tfvars

tfvars files are committed to Git. Anything in them is readable by everyone with repo access, forever. So:

- let AWS create and store secrets where it can, like `manage_master_user_password` on Aurora above;
- for your own secrets (API keys for other services), create the `aws_secretsmanager_secret` in Terraform but set the value outside Terraform, by hand or from a script;
- give the Lambda function permission to read the secret at runtime, and pass only the secret's ARN (its AWS address) in an environment variable.

Remember that any secret Terraform reads or creates ends up in the state file in plain text. Keep the state bucket encrypted, versioned and locked down to the CI roles and one or two admins.

## CI: plan on pull request, apply on merge

![CI flow: pull request triggers a read-only plan, the plan is posted as a comment and reviewed; on merge, staging applies automatically and prod applies after an environment approval](diagrams/tf-ci-flow.svg "Nobody runs apply from a laptop")

The deploy side, with OIDC and no stored keys, is covered in [Zero-downtime Lambda deploys from GitHub Actions](/blog/lambda-zero-downtime-deploys-github-actions). Here is the short version for Terraform:

- On every pull request, CI runs `plan` for each stack and environment that changed, and posts the output as a PR comment. Reviewers read the plan, not just the code.
- CI logs in to AWS with **OIDC**, which lets GitHub Actions get short-lived AWS credentials without storing any access keys. The plan job uses a read-only role.
- On merge to `main`, CI applies staging automatically. Prod uses a GitHub environment with required reviewers, so a person has to click "approve" first. The apply job uses a separate role that only that protected environment can assume.

## Catching drift on a schedule

**Drift** is when the real AWS setup no longer matches your code, usually because someone fixed something in the console at 2 a.m. Run a scheduled job, say every night, that plans every stack:

```bash
terraform -chdir=stacks/$stack plan -detailed-exitcode -lock=false \
  -var-file=../../envs/$env/$stack.tfvars
status=$?
# 0 = no changes, 1 = error, 2 = drift found
if [ "$status" -eq 2 ]; then
  echo "Drift in $env/$stack" # post to Slack or open an issue
fi
```

`-detailed-exitcode` makes the exit code tell you if there is a diff. `-lock=false` is safe here because this job only reads. Fix drift by changing the code or by re-applying, never by ignoring the alert.

## Stage 3: the day you split into accounts

One account with split states goes a long way. These are the signals that it's time for separate AWS accounts, managed with **AWS Organizations** (the AWS service for grouping accounts under one bill and one set of rules):

- **You need a hard wall around prod data.** IAM rules inside one account can do a lot, but a mistake in one policy can still reach prod. A separate account is a much stronger boundary.
- **Customers or audits ask for it.** Security reviews often ask whether prod is isolated from dev. "It's a different account" is an easy answer.
- **A second team arrives.** They need admin rights in staging, but they should not have them in prod.
- **Service limits clash.** A load test in staging uses up the account-wide Lambda concurrency limit and slows down prod.

The good news: if you followed Stage 2, the move is mostly config. The stacks stay the same. Each environment gets its own account, and `envs/prod/backend.hcl` points to a state bucket inside the prod account. The provider assumes a role in the right account. A `shared` account holds the things that sit above the environments, like CI roles, central logs and the top-level DNS zone.

## Gotchas

- **Moving resources between states.** Splitting a monolith means moving resources from one state to another without deleting them. Use `removed` blocks in the old stack (with `lifecycle { destroy = false }`) and `import` blocks in the new stack, or `terraform state mv`. Practise on staging first.
- **Circular dependencies.** If `network` needs a value from `app`, your split is wrong. Values should only flow in the apply order.
- **Destroying in the wrong order.** Tear down `edge` first and `network` last, or the destroy gets stuck on resources that are still in use.
- **`default_tags` don't reach everything.** Resources AWS creates for you, like log groups a Lambda creates on its own, are not managed by Terraform and get no tags. Create those resources in Terraform yourself.
- **Lock left behind.** If CI is killed during an apply, the lock file stays. Check that nothing is running, then use `terraform force-unlock`.

## When not to use this

- **A side project or a prototype.** One state and one environment is enough. Split later.
- **Your team already runs Terragrunt or HCP Terraform.** Those tools have their own way of handling the same problems. Follow their model instead of mixing two.
- **The workload is mostly Kubernetes.** You may want Terraform only for the cluster and the network, and a different tool for what runs inside it.

## Checklist

- [ ] State in a versioned, encrypted S3 bucket with `use_lockfile = true` and Terraform 1.11 or newer
- [ ] One state per stack per environment, with the environment in the path
- [ ] Values shared through SSM parameters, read in apply order
- [ ] `prevent_destroy` and `deletion_protection` on Aurora and important buckets
- [ ] No secrets in tfvars; `default_tags` on every provider
- [ ] Plan on PR, apply on merge, OIDC roles, approval for prod
- [ ] A nightly drift check that alerts someone

## Further reading

- [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3): `use_lockfile`, partial configuration and the DynamoDB deprecation
- [Upgrading to Terraform v1.11](https://developer.hashicorp.com/terraform/language/v1.11.x/upgrade-guides): S3-native locking becomes generally available
- [The `import` block](https://developer.hashicorp.com/terraform/language/block/import) and [importing resources](https://developer.hashicorp.com/terraform/language/import)
- [The `terraform_remote_state` data source](https://developer.hashicorp.com/terraform/language/state/remote-state-data)
- [AWS provider `default_tags`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs#default_tags-configuration-block)
- [Configuring OpenID Connect in Amazon Web Services (GitHub docs)](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [Organizing your AWS environment using multiple accounts (AWS whitepaper)](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html)
