---
title: "Self-hosting an LLM with vLLM: the real cost math vs an API"
seo_title: "Self-hosting an LLM with vLLM: real cost vs an API"
description: "A neutral break-even model for self-hosting an LLM with vLLM vs paying an API per token, with a worked example, real prices and a small production setup."
date: 2026-10-27
updated: 2026-11-13
tags: [LLM, vLLM, Cost, AI infrastructure]
draft: false
logos: [vllm, prometheus, grafana, docker]
---

"Should we run our own model or pay for an API?" The honest answer is a formula, not a feeling. This post is for founders and CTOs who need a quick decision, and for engineers who need the numbers and a setup they can run.

## TL;DR

- **Self-hosting is a fixed monthly cost. An API is a cost per token.** Self-hosting wins only after your monthly token volume passes a break-even point.
- **How busy the GPU stays decides almost everything.** You pay for the GPU every hour, busy or idle. At 10% busy, each token costs about 9 times more than at 90% busy.
- **Count your engineers' time.** In my example, a few hours a month of ops work costs as much as the GPU itself. Most spreadsheets leave this out.
- **In my example**, an 8B model on one L40S costs about $1,600 a month all-in. It beats gpt-5-mini after about 3.9 billion tokens a month. It never beats a cheap hosted copy of the same 8B model.
- **Good reasons to self-host often have nothing to do with cost:** data that must stay in your network, steady latency, your own fine-tunes, and no shared rate limits.

![Line chart: the API cost rises in a straight line with tokens per month, while the self-host cost stays flat at about $1,600 and steps up when a second GPU is added; the lines cross near 3.9 billion tokens](diagrams/break-even.svg "Example numbers (November 2026 prices): one L40S running an 8B model vs gpt-5-mini, 10 input tokens per output token")

## The three numbers you need

A **token** is a small piece of text, roughly part of a word. **Input tokens** are what you send (prompt, documents, chat history). **Output tokens** are what the model writes back. APIs charge for both, and output tokens usually cost more.

You only need three numbers to compare:

1. What self-hosting costs you each month.
2. How many tokens one GPU can actually handle each month.
3. What the API would charge for the same tokens.

### 1. Monthly self-host cost

| Item | Formula | Example (labelled) |
|---|---|---|
| GPU | GPUs × $/hour × hours | 1 × $1.09 × 730 h = **$795.70** |
| Storage | GB × $/GB-month | 50 GB × $0.10 = **$5** (example size) |
| Egress (data out) | GB × $/GB | **~$0** (see note) |
| Ops time | hours × your hourly cost | 8 h × $100 = **$800** (example) |
| **Total** | | **≈ $1,601 / month** |

The GPU price is RunPod's on-demand Secure Cloud rate for an **L40S** (a 48 GB NVIDIA data-centre GPU), checked in November 2026. Community Cloud lists it at $0.79/hour. The storage price is RunPod's volume disk rate from the same page. 730 is the average number of hours in a month.

**Ops time is the cost people forget.** Someone has to patch the host, upgrade vLLM, swap in a new model, answer alerts and fix things at 2 a.m. I used 8 hours a month at $100 an hour as an example. Put in your own team's real numbers. Even a small number here moves the break-even point a lot.

> **Note:** RunPod's pricing page doesn't list data transfer fees (checked November 2026). Text is small anyway. As a rough rule a token is about 4 bytes, so a billion tokens is only a few GB. Check your provider. Big clouds do charge for egress.

If you only need the model during office hours, stop the GPU at night: 12 hours × 22 working days = 264 hours, so the GPU line drops to about $288. Ops time stays the same.

### 2. Capacity: how many tokens one GPU can serve

```
capacity (output tokens / month) = throughput (tokens/s) × 3,600 × hours × utilisation
```

**Throughput** is how many output tokens per second the server produces across *all* requests together. **Utilisation** is the share of time the GPU actually works at that speed, instead of waiting for traffic.

#### Why one GPU serves many users at once

One request on its own streams slowly, and that speed is misleading. To write each token, the model reads all its weights from GPU memory. That memory read is the bottleneck, so one request leaves most of the GPU's compute idle.

vLLM fixes this with two ideas:

- **Continuous batching.** vLLM doesn't wait for a full batch. Each step, it adds new requests and drops finished ones, so the GPU always works on as many requests as fit. One read of the weights now produces a token for dozens of users.
- **PagedAttention.** Each request needs memory for its **KV cache** (the model's notes about the text so far). PagedAttention stores this cache in small fixed-size pages, the way an operating system handles RAM. Less memory is wasted, so more requests fit on the GPU at once.

Together, these make total throughput many times higher than the speed of one stream.

#### My throughput assumption, and why you must measure yours

I won't invent a throughput number. The best public number I found: Red Hat's MLPerf Inference v5.1 results (published 31 October 2025) show **1,207 tokens/s** on one L40S in the Server test, for Llama 3.1 8B in FP8 on vLLM 0.10.0. That test is summarising news articles: about 778 input tokens and 73 output tokens per request. Your traffic is different.

So for the example I use **1,000 output tokens/s** as a stated assumption, not a fact about your workload. Measure your own with vLLM's benchmark tool against a running server, using your real prompt and answer lengths:

```bash
vllm bench serve \
  --backend openai \
  --host 127.0.0.1 --port 8000 \
  --model llama-8b \
  --dataset-name random \
  --random-input-len 3000 \
  --random-output-len 300 \
  --num-prompts 500 \
  --max-concurrency 32
```

Run it at a few concurrency levels and pick the highest throughput where time to first token still meets your target. That number, not the peak, goes into the formula.

#### Utilisation is the number that matters most

Traffic is never flat. You plan for your busy hour, so the GPU sits half idle the rest of the day. With 1,000 tokens/s and 730 hours, one GPU can produce 2.63 billion output tokens a month at 100%. Look at what the same $1,601 buys at different utilisation:

| GPU busy | Output tokens / month | Self-host cost per 1M output tokens |
|---|---|---|
| 10% | 263M | $6.09 |
| 25% | 657M | $2.44 |
| 50% | 1.31B | $1.22 |
| 75% | 1.97B | $0.81 |
| 90% | 2.37B | $0.68 |

Same GPU, same bill, 9× difference in unit cost. I use **50%** in the example: a realistic target for steady traffic with daily peaks.

### 3. API cost

```
API cost = input tokens × input price + output tokens × output price
```

Prices are per 1 million tokens. To compare with one GPU, fix the ratio of input to output. I use **10 input tokens per output token**, which is typical for chat with documents (RAG) and is an example, not a rule. Then each 1M output tokens comes with 10M input tokens:

| API model (checked Nov 2026) | Input / 1M | Output / 1M | Cost per 1M output at 10:1 |
|---|---|---|---|
| Llama 3.1 8B Instruct Turbo on DeepInfra | $0.02 | $0.04 | $0.24 |
| Qwen3.5 9B on DeepInfra | $0.10 | $0.15 | $1.15 |
| Qwen3.5 9B on Together AI | $0.17 | $0.25 | $1.95 |
| gpt-4o-mini on OpenAI | $0.15 | $0.60 | $2.10 |
| gpt-5-mini on OpenAI | $0.25 | $2.00 | $4.50 |

The last column is `10 × input price + output price`.

## The break-even formula

Put the three numbers together. Let `k` be your input-to-output ratio.

```
break-even output tokens/month = monthly self-host cost ÷ (k × input price + output price)
```

The result only counts if it fits on your GPUs. If it is bigger than your capacity, add a GPU, add its cost to the total, and do the sum again. That's the step in the chart.

Here it is as a small function you can drop into a script:

```ts
type Api = { inPerM: number; outPerM: number };

export function breakEven(
  gpuHourly: number, hours: number, gpus: number,
  fixedMonthly: number,        // storage + egress + ops time
  tokensPerSec: number,        // measured with `vllm bench serve`
  utilisation: number,         // 0..1
  k: number,                   // input tokens per output token
  api: Api,
) {
  const selfHost = gpus * gpuHourly * hours + fixedMonthly;
  const apiPerOutM = k * api.inPerM + api.outPerM;
  const breakEvenOut = (selfHost / apiPerOutM) * 1e6;
  const capacityOut = gpus * tokensPerSec * 3600 * hours * utilisation;
  return { selfHost, breakEvenOut, fits: breakEvenOut <= capacityOut };
}

// Example from this post: one L40S vs gpt-5-mini
console.log(breakEven(1.09, 730, 1, 805, 1000, 0.5, 10, { inPerM: 0.25, outPerM: 2.0 }));
// → selfHost ≈ 1600.7, breakEvenOut ≈ 355.7M output tokens, fits: true
```

### The worked example, end to end

- Self-host cost: $795.70 GPU + $5 storage + $0 egress + $800 ops = **$1,600.70 a month**.
- Capacity at 50%: 1,000 × 3,600 × 730 × 0.5 = **1.31B output tokens** (about 14.5B tokens in total at 10:1).
- Against **gpt-5-mini**: $1,600.70 ÷ $4.50 = **356M output tokens**, or about **3.9B total tokens a month**. That fits on one GPU, at only about 14% busy. Above this, self-hosting is cheaper.
- Against **Qwen3.5 9B on Together AI**: $1,600.70 ÷ $1.95 = 821M output tokens (about 9B total). That needs the GPU about 31% busy. Still reachable.
- Against **Qwen3.5 9B on DeepInfra**: $1,600.70 ÷ $1.15 = 1.39B output tokens. That's more than one GPU at 50%. Add a second GPU ($2,401 total) and break-even moves to 2.09B output tokens (about 23B total), with both GPUs about 40% busy. Possible, but only at real scale.
- Against **Llama 3.1 8B on DeepInfra**: one fully used GPU produces 2.63B output tokens a month. At $0.24 per million, the API would charge about $631 for that. The GPU alone costs $796. **Self-hosting never wins here**, at any volume.

Remove the ops time and the gpt-5-mini break-even drops to about 2B total tokens. That's how much the forgotten line matters.

> **Warning:** Only compare models that pass the same quality bar. gpt-5-mini is a much stronger model than an 8B. The gpt-5-mini comparison only makes sense if the 8B model passes your own evals for your task.

![Stacked bars at 5 billion tokens a month: self-hosting about $1,601, split into a small busy-GPU part, a large idle-GPU part and ops time; gpt-5-mini API about $2,045; hosted Llama 3.1 8B API about $109](diagrams/cost-breakdown.svg "Where the money goes at 5B tokens a month (example numbers). Storage is $5 and included with ops time.")

At 5B tokens a month, the GPU is busy only about 17% of the time. Only about $138 of the $1,601 pays for useful GPU work. The rest is idle GPU and people. With an API you pay only for what you use, plus the provider's margin.

## The decision, without a spreadsheet

![Flowchart with four questions: must data stay in your network, is volume steadily above break-even, is the GPU busy over about half the time, and can the team run on-call; the answers lead to self-host, use an API, or a hybrid](diagrams/decision-flow.svg "A quick decision flow. Re-run the numbers when prices or traffic change.")

The 50% in question 3 is a rule of thumb against a hosted open model of the same size. Against gpt-5-mini the bar is lower; against the cheapest hosted 8B, even 90% isn't enough.

**Hybrid** means you run one GPU for your steady base load and send the overflow to an API that serves the same model. Since vLLM speaks the OpenAI API, your client just needs two base URLs and a fallback.

### Reasons to self-host that aren't about cost

- **Data stays with you.** Prompts never leave your network. For health or finance work, this alone can decide it.
- **Latency you control.** No shared queue with other customers. You choose the batch size, context length and region.
- **Your own fine-tunes.** Serve a fine-tuned model or LoRA adapters without a provider's custom-model fees or limits.
- **No shared rate limits.** Your only limit is your own hardware.

### Reasons against

- **On-call.** If the model is in your product's main path, someone must answer when it breaks.
- **Model upgrades.** New open models come out all the time. Each switch means new tests, new memory settings and new benchmarks.
- **GPU availability.** The GPU you want may not be free when you need to scale. Test a second GPU type.
- **Scale-to-zero cold starts.** Stopping the GPU when idle saves money, but the next request waits for the pod to start and the model to load. Depending on model size and where the weights live, that takes seconds to minutes. Fine for batch jobs, bad for chat.

## A small production setup

![Architecture: your app calls Nginx over HTTPS; Nginx handles TLS, rate limits and the API key check and forwards to the vLLM OpenAI-compatible server on the GPU; Prometheus scrapes vLLM metrics and Grafana shows dashboards and alerts](diagrams/serving-architecture.svg "Nginx in front, vLLM bound to localhost, Prometheus and Grafana watching it")

### vLLM

```bash
export VLLM_API_KEY="$(openssl rand -hex 32)"

vllm serve RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8 \
  --served-model-name llama-8b \
  --host 127.0.0.1 --port 8000 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --api-key "$VLLM_API_KEY"
```

- `--max-model-len` is the longest prompt plus answer the server accepts. Set it to what you really need. A smaller value leaves more GPU memory for the KV cache, so more requests run at once.
- `--gpu-memory-utilization` is the share of GPU memory vLLM may use (0 to 1) for weights plus KV cache. Leave a little room for other processes.
- `--api-key` makes vLLM check `Authorization: Bearer <key>` on `/v1` routes.
- `--host 127.0.0.1` keeps vLLM off the public internet. Only Nginx talks to it.

I checked these flags against the vLLM CLI docs in November 2026. Run `vllm serve --help` on your version to confirm.

### Nginx for TLS and rate limits

```nginx
# Limit per API key, not per IP: many users may share one office IP.
limit_req_zone $http_authorization zone=llm:10m rate=5r/s;

server {
    listen 443 ssl;
    server_name llm.example.com;
    ssl_certificate     /etc/letsencrypt/live/llm.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/llm.example.com/privkey.pem;
    client_max_body_size 2m;

    location /v1/ {
        limit_req zone=llm burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_buffering off;        # send tokens as they are generated
        proxy_read_timeout 300s;    # long answers take time
    }

    location / { return 404; }     # hides /metrics, /health and the rest
}
```

The rate and burst values are examples. Set them from your measured capacity.

### Prometheus and the alerts worth having

vLLM exposes Prometheus metrics at `/metrics` on the same port. These four tell you almost everything:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: vllm
    scrape_interval: 15s
    static_configs:
      - targets: ["127.0.0.1:8000"]
rule_files: ["rules.yml"]
```

```yaml
# rules.yml (thresholds are examples)
groups:
  - name: vllm
    rules:
      - alert: VllmDown
        expr: up{job="vllm"} == 0
        for: 2m
      - alert: VllmQueueGrowing
        expr: vllm:num_requests_waiting > 10
        for: 5m
      - alert: VllmKvCacheFull
        expr: vllm:kv_cache_usage_perc > 0.9
        for: 10m
      - alert: VllmSlowFirstToken
        expr: histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[5m]))) > 2
        for: 10m
```

- `vllm:num_requests_waiting`: requests in the queue. If it keeps growing, you're out of capacity.
- `vllm:kv_cache_usage_perc`: how full the KV cache is (0 to 1). Near 1, new requests wait.
- `vllm:time_to_first_token_seconds`: how long users wait before the answer starts. This is what people feel.
- `up`: the plain "is it alive" check.

One more for the money side: graph `rate(vllm:generation_tokens_total[1h])` against the throughput you measured. That ratio is your real utilisation, the most important input to the cost formula.

### The client: just change the base URL

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://llm.example.com/v1",
  apiKey: process.env.LLM_API_KEY, // the same key you gave vLLM
});

const res = await client.chat.completions.create({
  model: "llama-8b", // matches --served-model-name
  messages: [{ role: "user", content: "Summarise this ticket in one line: ..." }],
  max_tokens: 300,
});

console.log(res.choices[0].message.content);
console.log(res.usage); // log these: they feed your break-even sheet
```

Because the API shape is the same, going back to a hosted API is a config change, so the decision is cheap to undo.

## Trade-offs at a glance

| | Self-host, 24/7 | Self-host, office hours | Hosted open model API | Frontier "mini" API |
|---|---|---|---|---|
| Cost shape | Fixed monthly | Fixed, smaller | Per token, very low | Per token, higher |
| Wins when | High, steady volume | Daytime-only traffic | Low or spiky volume | You need the stronger model |
| Data control | Full | Full | Provider's terms | Provider's terms |
| Latency control | Full | Full, cold start each morning | Shared queue | Shared queue |
| Ops load | High | High | None | None |
| Typical failure | GPU or host down, you fix it | Doesn't start in the morning | Provider outage, rate limits | Provider outage, rate limits |

## Gotchas

- **`--api-key` only covers the API routes.** The vLLM docs say it protects `/v1` and a few other prefixes, and other endpoints stay open. Never expose port 8000 directly. Bind to localhost and put Nginx in front.
- **The same prompt twice is wasted GPU time.** If many users send identical requests (a fixed system prompt plus the same question), cache the answer in Redis before it reaches vLLM. The stampede and TTL tips in [Redis in front of Aurora PostgreSQL](/blog/redis-cache-stampede-aurora) apply here too.
- **Two vLLM processes, one GPU.** `--gpu-memory-utilization` is per process. Two instances at 0.9 each on one GPU will fail to start.
- **Your input-to-output ratio drifts.** Longer documents or a "thinking" model that writes long hidden reasoning both change `k`. Re-check it from `res.usage` every month.
- **Prompt caching changes API prices.** Many APIs charge much less for repeated input (cached input). If your prompts share a long prefix, use the cached price in the formula.
- **Prices move.** Every price here was checked in November 2026. Hosted open-model prices in particular keep falling.

## When not to use this

- Your volume is below break-even, or you don't know your volume yet. Start with an API and log `usage`.
- No one on the team can own a GPU service out of hours.
- You need a frontier model that has no open-weight version.
- Your traffic is very spiky and you can't accept cold starts.

## Checklist

- [ ] Log input and output tokens per request for a month.
- [ ] Pick the API you'd really use and price it at your input-to-output ratio.
- [ ] Measure throughput with `vllm bench serve` on your own prompts.
- [ ] Put ops hours into the monthly cost.
- [ ] Run the break-even formula and check it fits your GPU capacity.
- [ ] Bind vLLM to localhost, put Nginx with TLS and rate limits in front.
- [ ] Alert on queue length, KV cache, time to first token and `up`.
- [ ] Re-check prices and utilisation every quarter.

## Further reading

- [vLLM `serve` CLI reference](https://docs.vllm.ai/en/latest/cli/serve.html)
- [vLLM `bench serve` reference](https://docs.vllm.ai/en/latest/cli/bench/serve.html)
- [vLLM metrics design (metric names)](https://docs.vllm.ai/en/latest/design/metrics.html)
- [Efficient Memory Management for Large Language Model Serving with PagedAttention (Kwon et al., SOSP 2023)](https://arxiv.org/abs/2309.06180)
- [Red Hat MLPerf Inference v5.1 results with vLLM](https://www.redhat.com/en/blog/efficient-and-reproducible-llm-inference-red-hat-mlperf-inference-v51-results)
- [RunPod pricing](https://www.runpod.io/pricing)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [DeepInfra pricing](https://deepinfra.com/pricing)
- [Together AI pricing](https://www.together.ai/pricing)
- [Nginx `limit_req` module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
