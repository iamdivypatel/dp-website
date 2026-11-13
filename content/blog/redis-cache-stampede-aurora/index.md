---
title: "Cache-aside, write-through and stampede protection: Redis in front of Aurora PostgreSQL"
seo_title: "Redis caching for Aurora PostgreSQL: stop cache stampedes"
description: "Redis caching patterns for Postgres in plain words: cache-aside vs write-through, cache stampede prevention, TTL jitter and safe invalidation."
date: 2026-10-20
tags: [Redis, PostgreSQL, AWS, System design]
draft: false
logos: [redis, aws-aurora, nodedotjs, typescript]
---

Putting Redis in front of Aurora PostgreSQL is easy. Keeping it correct when traffic spikes, keys expire and Redis goes down is the hard part, so this post is about that part, with Node.js and TypeScript code you can copy.

## TL;DR

- **Start with cache-aside.** Read from Redis, and on a miss read from Aurora and save the result with a TTL. It is simple, and Aurora is still the source of truth.
- **Protect busy keys from stampedes.** Let one request rebuild an expired key while the others wait or get the old value. A `SET key token NX PX` lock, early refresh (XFetch) or stale-while-revalidate all do this.
- **Add jitter to every TTL** so that keys written together don't all expire together.
- **Delete from the cache only after the database commit**, and keep TTLs short. For data where staleness really hurts, store a version number and refuse older writes.
- **Plan for Redis being down.** Fall back to Aurora, but limit how many requests do that at the same time, or the outage moves to your database.

![Request path: the app checks Redis first, and on a miss reads Aurora and writes the result back to Redis](diagrams/cache-aside-path.svg "Cache-aside: steps 1–2 on a hit, steps 1–5 on a miss")

## The setup

A quick word on names first. On AWS, the managed service is **Amazon ElastiCache**. Since October 2024 it supports **Valkey**, the open-source fork of Redis run by the Linux Foundation, next to Redis OSS and Memcached. Valkey speaks the same protocol and commands as Redis, so everything in this post works on both. I'll say "Redis" for the cache and "Aurora" for Aurora PostgreSQL.

I use [ioredis](https://github.com/redis/ioredis) for the cache and [node-postgres](https://node-postgres.com/) (`pg`) for the database. Here is the base that every later snippet builds on. A **TTL** (time to live) is how many seconds a key stays before Redis removes it on its own.

```ts
import Redis from "ioredis";
import pg from "pg";

export const redis = new Redis(process.env.REDIS_URL!, {
  commandTimeout: 100,        // a slow cache is a broken cache
  maxRetriesPerRequest: 1,    // fail fast instead of piling up retries
  enableOfflineQueue: false,  // don't queue commands while disconnected
});
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export type Product = { id: string; name: string; price_cents: number; version: number };

export async function loadProduct(id: string): Promise<Product | null> {
  const { rows } = await db.query<Product>(
    "SELECT id, name, price_cents, version FROM products WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}
```

For ElastiCache with encryption in transit, use a `rediss://` URL (two s's) so ioredis connects over TLS. If you create the cluster with Terraform, it belongs with the other long-lived data stores; [Terraform for a one-AWS-account startup](/blog/terraform-aws-startup-layout) explains why.

The three ioredis options matter. By default, ioredis queues commands while it reconnects, so if Redis hangs, every request hangs with it. With these settings, a Redis problem becomes a fast error your code can handle.

## Four ways to keep a cache filled

![Three small flows: cache-aside, write-through and write-behind](diagrams/cache-patterns.svg "Who writes to the cache, and when")

- **Cache-aside** (also called *lazy loading*): the app reads Redis. On a miss, the app reads Aurora and writes the result to Redis. On a write, the app updates Aurora and deletes the cache key.
- **Read-through**: the same idea, but a cache library does the loading for you. Your code only talks to the cache. In Node apps this is usually just a helper like `getOrLoad` below.
- **Write-through**: every write goes to Aurora and then to Redis, in the same request. The cache stays warm, but you also cache data that nobody may ever read.
- **Write-behind** (or *write-back*): the app writes to Redis only, and a background worker copies changes to Aurora later. Writes are very fast, but if Redis loses data before the flush, those writes are gone.

For most apps I start with cache-aside plus a TTL. It fails safely: if the cache is empty or wrong, the next read fixes it. The [ElastiCache caching strategies guide](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html) suggests the same mix: lazy loading for reads, write-through where you need fresh data, and a TTL on everything.

### Cache-aside in 10 lines

```ts
export async function getProduct(id: string): Promise<Product | null> {
  const key = `product:v1:${id}`;
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached) as Product | null;

  const product = await loadProduct(id);
  await redis.set(key, JSON.stringify(product), "EX", ttlWithJitter(product ? 300 : 30));
  return product;
}
```

Note `ttlWithJitter` and the 30-second `null`. I'll come back to both.

## The cache stampede

![Two bar charts: without a lock, many queries hit Aurora when a key expires; with a lock, only one does](diagrams/stampede-timeline.svg "The same burst of traffic, with and without a lock")

A **cache stampede** (also called a *thundering herd*) happens when a popular key expires and many requests miss at the same moment. Each one runs the same query against Aurora. Say your home page key gets 2,000 requests a second and the query takes 200 ms. In that 200 ms, around 400 requests all miss and all run the query. Aurora slows down, so the query takes longer, so even more requests miss. That loop is how a cache expiry turns into an outage.

There are three common fixes. You can use them together.

### Fix 1: a single-flight lock

"Single flight" means only one request rebuilds the key, and everyone else waits for its result. In Redis you build that with one command: `SET lock:key token NX PX 5000`. `NX` means "only set it if it doesn't exist", so only one client gets the lock. `PX 5000` means the lock removes itself after 5 seconds, so a crashed process can't hold it forever.

The tricky part is releasing the lock. A plain `DEL` is a bug. If your rebuild took longer than 5 seconds, the lock already expired, another request took it, and your `DEL` now deletes *their* lock. The fix, which the [Valkey `SET` docs](https://valkey.io/commands/set/) also describe, is a random token and a small Lua script that deletes the lock only if it still holds your token. Redis runs a Lua script as one step, so nothing can happen between the check and the delete.

```ts
import { randomUUID } from "node:crypto";

const RELEASE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

export async function withLock<T>(
  key: string, ttlMs: number, fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const lockKey = `lock:${key}`;
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return { ok: false };   // someone else holds it
  try {
    return { ok: true, value: await fn() };
  } finally {
    await redis.eval(RELEASE, 1, lockKey, token); // only delete our own lock
  }
}
```

> **Tip:** On Valkey 9.0 or later you can replace the Lua script with the built-in [`DELIFEQ key value`](https://valkey.io/commands/delifeq/) command. Check which engine version your cluster runs before you depend on it.

Now the read path. The request that gets the lock checks the cache one more time (another request may have filled it already), loads from Aurora and saves the value. The others sleep a little and check again.

```ts
import { setTimeout as sleep } from "node:timers/promises";

export async function getOrLoad<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;

    const res = await withLock(key, 5_000, async () => {
      const again = await redis.get(key);         // filled while we waited?
      if (again !== null) return JSON.parse(again) as T;
      const value = await load();
      await redis.set(key, JSON.stringify(value), "EX", ttlWithJitter(ttlSec));
      return value;
    });
    if (res.ok) return res.value;
    await sleep(50 + Math.random() * 50);          // lock is busy: wait, then re-check
  }
  return load(); // waited ~1.5 s: stop waiting and go to the DB
}
```

This is not a lock you'd trust for money or stock counts. If Redis fails over, a lock can be lost. Here that's fine. The worst case is that two requests rebuild the same key, which is what would have happened anyway without the lock.

### Fix 2: refresh early, at random (XFetch)

The lock makes the others wait. A nicer trick is to rebuild the key *a bit before* it expires, so it never really expires under load. If every request did that at the same fixed moment, you'd get a stampede again. So each request rolls a dice instead, and the chance of refreshing grows as expiry gets closer.

This is the **XFetch** algorithm from the paper *Optimal Probabilistic Cache Stampede Prevention* (Vattani, Chierichetti and Lowenstein, VLDB 2015). You store two extra things with the value: `delta`, how long the last rebuild took, and the expiry time. Slow queries start refreshing earlier, which is what you want.

```ts
type Entry<T> = { value: T; delta: number; expiresAt: number };
const BETA = 1; // > 1 refreshes earlier, < 1 later

export async function xfetch<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const raw = await redis.get(key);
  if (raw !== null) {
    const e = JSON.parse(raw) as Entry<T>;
    // Math.log(Math.random()) is <= 0, so this adds a random head start
    const refreshEarly = Date.now() - e.delta * BETA * Math.log(Math.random()) >= e.expiresAt;
    if (!refreshEarly) return e.value;
  }
  const start = Date.now();
  const value = await load();
  const delta = Date.now() - start;               // how long a rebuild takes
  const entry: Entry<T> = { value, delta, expiresAt: Date.now() + ttlSec * 1000 };
  await redis.set(key, JSON.stringify(entry), "PX", ttlSec * 1000);
  return value;
}
```

No lock and no waiting. Under heavy traffic, one or two requests refresh a little early and the rest keep reading the cached value. The guarantee is about probability, not a promise, so a few requests may refresh at once. That's usually fine. The check uses each server's clock, so keep clocks in sync with NTP.

### Fix 3: stale-while-revalidate

**Stale-while-revalidate** means "give the user the old value right now, and rebuild it in the background." The name comes from an HTTP cache header ([RFC 5861](https://www.rfc-editor.org/rfc/rfc5861)). You keep two times: a *fresh* time, and a longer *hard* TTL in Redis. Between the two, the value is stale but still usable.

```ts
type Swr<T> = { value: T; freshUntil: number };

async function refresh<T>(key: string, freshSec: number, staleSec: number, load: () => Promise<T>): Promise<T> {
  const value = await load();
  const entry: Swr<T> = { value, freshUntil: Date.now() + freshSec * 1000 };
  await redis.set(key, JSON.stringify(entry), "EX", freshSec + staleSec);
  return value;
}

export async function getSwr<T>(
  key: string, freshSec: number, staleSec: number, load: () => Promise<T>,
): Promise<T> {
  const raw = await redis.get(key);
  if (raw === null) return refresh(key, freshSec, staleSec, load); // true miss
  const entry = JSON.parse(raw) as Swr<T>;
  if (Date.now() > entry.freshUntil) {
    // stale: answer now, rebuild in the background, one worker only
    void withLock(key, 5_000, () => refresh(key, freshSec, staleSec, load))
      .catch((err) => console.warn("swr refresh failed", key, err));
  }
  return entry.value;
}
```

Nobody waits for Aurora once the key exists. It's my default for product lists, settings and feature flags, where a few seconds of old data are fine. A true miss (the first load, or after the hard TTL) still goes straight to the database. On a very hot key, wrap that path with `getOrLoad` too.

## TTL jitter

If you warm a cache by loading 50,000 keys in one job, all with `EX 300`, they all expire in the same second five minutes later. You've built a stampede on a timer. **Jitter** means adding a small random amount to each TTL so expiries spread out.

```ts
export function ttlWithJitter(baseSeconds: number, spread = 0.1): number {
  const delta = baseSeconds * spread;
  return Math.max(1, Math.round(baseSeconds - delta + Math.random() * 2 * delta));
}
// ttlWithJitter(300) → somewhere between 270 and 330 seconds
```

Plus or minus 10% is enough for most cases. It costs nothing, so I add it everywhere.

## Invalidation and the stale write-back race

"Invalidation" means removing or updating a cache entry when the real data changes. The usual cache-aside rule is: write to Aurora, then `DEL` the key. The next read will load the new row. Mostly, that works. But there is a race.

![Sequence: a reader loads v1, a writer commits v2 and deletes the key, then the reader writes v1 back into Redis](diagrams/invalidation-race.svg "The bad order of events: the old value lands after the DEL")

Follow the numbers:

1. A reader misses in Redis.
2. It reads the row from Aurora and gets version 1.
3. Before it saves that, a writer updates the row to version 2 and commits.
4. The writer deletes the cache key, which is already empty.
5. Now the reader finally saves version 1 into Redis.

Redis now holds old data until the TTL runs out. It's rare, but on a busy key, rare things happen every day.

There are three fixes, from simplest to strongest.

### Delete after commit

Never delete the key *before* or *during* the transaction, or a reader can refill it with the old row before your commit lands. Delete after `COMMIT`, and treat a failed `DEL` as "the TTL will clean it up."

```ts
export async function updatePrice(id: string, priceCents: number): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE products SET price_cents = $2, version = version + 1 WHERE id = $1",
      [id, priceCents],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  // only after COMMIT: readers that start now will see the new row
  await redis.del(`product:v1:${id}`).catch((err) => console.warn("DEL failed", err));
}
```

### Keep TTLs short

A short TTL doesn't stop the race, but it limits how long the damage lasts. It's your safety net for every bug in this section.

### Use versions so old data can't win

When old data really hurts (prices, permissions, account status), give each row a `version` column that goes up by one on every update. Store the version next to the cached value, and only let a write in if it's newer. On update, the writer saves the new row straight into the cache instead of deleting it. That's write-through with a version check. The slow reader from the diagram then tries to save version 1 over version 2, and the script says no.

```ts
const SET_IF_NEWER = `
local cur = redis.call("HGET", KEYS[1], "ver")
if cur and tonumber(cur) >= tonumber(ARGV[1]) then return 0 end
redis.call("HSET", KEYS[1], "ver", ARGV[1], "data", ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1`;

export async function cacheProduct(p: Product, ttlSec = 300): Promise<boolean> {
  const n = await redis.eval(SET_IF_NEWER, 1, `product:v2:${p.id}`,
    p.version, JSON.stringify(p), ttlWithJitter(ttlSec));
  return n === 1;
}

export async function savePrice(id: string, priceCents: number): Promise<void> {
  const { rows } = await db.query<Product>(
    `UPDATE products SET price_cents = $2, version = version + 1
     WHERE id = $1 RETURNING id, name, price_cents, version`,
    [id, priceCents],
  );
  if (rows[0]) await cacheProduct(rows[0]); // newer version wins, old ones bounce off
}
```

On the read path, call `cacheProduct(row)` instead of a plain `SET`. Notice the `v1`/`v2` in the key names: that's the other meaning of "versioned keys." If you change the shape of what you cache, change the key prefix, and the old entries simply age out instead of breaking your new code.

## Hot keys

A **hot key** is one key that gets a big share of all traffic, like a home page config or a flash-sale product. In a Redis cluster, each key lives on one shard. So a single hot key can max out one node while the rest sit idle, and adding shards doesn't help.

Two cheap fixes in the app go a long way. First, merge identical requests inside one Node process, so 200 concurrent requests for the same key turn into one Redis call. Second, keep a tiny copy in memory for about a second.

```ts
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const local = new Map<string, { value: unknown; until: number }>();

export async function getHot<T>(key: string, load: () => Promise<T>): Promise<T> {
  const l = local.get(key);
  if (l && l.until > Date.now()) return l.value as T;
  const value = await singleFlight(key, () => getOrLoad(key, 300, load));
  local.set(key, { value, until: Date.now() + 1_000 }); // 1 s in-process copy
  return value;
}
```

In real code, use a bounded LRU (such as the `lru-cache` package) instead of a plain `Map`. If that isn't enough, read from ElastiCache replicas, or store a few copies of the key (`config:home:0` to `config:home:7`) and pick one at random.

## Negative caching

**Negative caching** means remembering that something *doesn't* exist. Without it, a request for a product ID that isn't in the database misses Redis every single time and always hits Aurora. A bot scanning random IDs can hurt you badly this way.

You already saw the fix in `getProduct`: when the row is `null`, cache `null` with a short TTL (30 seconds there). Keep it short, because when that ID is created you want it to show up quickly. If you create rows with known IDs, delete the key on insert, the same as on update.

## When Redis is down

Sooner or later, Redis will be slow or unreachable. The usual answer is to **fail open**: if the cache doesn't work, read from the database. That's correct, but think about the numbers. If your cache serves 95% of reads, failing open sends 20 times more traffic to Aurora in one second. Aurora also has a hard connection limit. So fail open, but only up to a limit, and reject the rest quickly.

```ts
let fallbacks = 0;
const MAX_FALLBACKS = 10; // per process; size it against Aurora's connection budget

export class CacheUnavailable extends Error {}

export async function getProductSafe(id: string): Promise<Product | null> {
  const key = `product:v1:${id}`;
  let cached: string | null;
  try {
    cached = await redis.get(key);
  } catch {
    // Redis is down or slow: go to Aurora, but only a few requests at a time
    if (fallbacks >= MAX_FALLBACKS) throw new CacheUnavailable("shedding load");
    fallbacks++;
    try { return await loadProduct(id); } finally { fallbacks--; }
  }
  if (cached !== null) return JSON.parse(cached) as Product | null;
  const product = await loadProduct(id);
  redis.set(key, JSON.stringify(product), "EX", ttlWithJitter(product ? 300 : 30))
    .catch(() => {}); // best effort; a failed SET is just a future miss
  return product;
}
```

Map `CacheUnavailable` to an HTTP 503 with a `Retry-After` header. To size `MAX_FALLBACKS`, take the database connections you can spare and divide by the number of app processes. If you run many small processes, such as Lambda functions, put RDS Proxy in front of Aurora so a spike of new connections doesn't overwhelm it.

> **Warning:** Only the Redis call sits inside the `try`. If you wrap the whole function, a database error also looks like "Redis is down", and your fallback retries the same failing query.

## Picking a pattern

| Pattern | Read latency | Freshness | Complexity | Failure mode |
|---|---|---|---|---|
| Cache-aside + TTL | Miss costs one DB query | Stale up to TTL | Low | Stampedes on hot keys |
| Write-through | Mostly hits | Fresh after each write | Medium | Caches data nobody reads |
| Write-behind | Fast writes | Cache is the truth for a while | High | Lost writes if Redis loses data |
| Lock (single flight) | Waiters pay a small delay | Same as TTL | Medium | Waiters slow down if rebuild is slow |
| XFetch | Almost always a hit | Refreshes a bit early | Low | A few duplicate rebuilds |
| Stale-while-revalidate | Always fast after first load | Stale up to the extra window | Medium | Old data shown during the window |
| Versioned writes | Same as cache-aside | No stale write-backs | Medium | Needs a `version` column |

And a rough guide for TTLs. These are starting points, not measured numbers:

| Data | Example TTL | Pattern |
|---|---|---|
| Config and feature flags | 30–60 s | Stale-while-revalidate + local copy |
| Product or profile pages | 5–15 min | Cache-aside + lock or XFetch |
| Prices, permissions | 1–5 min | Versioned write-through |
| "Not found" results | 10–60 s | Negative caching |
| Session data | Match the session length | Redis as the store, not a cache |

## Gotchas

- **Lua scripts and cluster mode.** In a Redis cluster (and ElastiCache Serverless), all keys used by one script must live in the same hash slot. Every script here touches just one key, so they work. If you add a second key, use a hash tag like `{product:42}` in both key names.
- **JSON of `undefined`.** `JSON.stringify(undefined)` returns `undefined`, ioredis stores it as an empty string, and the next `JSON.parse("")` throws. Return `null` from loaders, never `undefined`.
- **Eviction.** When Redis runs out of memory, it removes keys based on the `maxmemory-policy` setting. A cache should use an LRU or LFU policy. Lock keys can be evicted too, which is one more reason the lock is only an optimisation.
- **Missing metrics.** Track hit rate, lock waits, fallbacks and Redis latency. A falling hit rate is the first sign of a stampede or a bad key design.

## When not to use this

- **When Aurora is already fast enough.** A good index and a read replica may be all you need.
- **For data that must be exactly right**, like account balances or stock counts at checkout. Read those from the writer instance inside the transaction.
- **When each request asks for different data.** If every query is unique, your hit rate will be near zero and you pay for Redis for nothing.
- **Write-behind for anything you can't afford to lose.** If you need queued writes, use a real queue like SQS, not the cache.

## Checklist

- [ ] Every key has a TTL, with jitter.
- [ ] ioredis has a `commandTimeout`, low retries and no offline queue.
- [ ] Hot keys use a lock, XFetch or stale-while-revalidate.
- [ ] Locks use a random token and a compare-and-delete release.
- [ ] Cache deletes happen after `COMMIT`, never before.
- [ ] Data where staleness hurts uses a version check.
- [ ] "Not found" is cached with a short TTL.
- [ ] Fallback to Aurora has a concurrency limit.
- [ ] Dashboards show hit rate, fallbacks and Redis latency.

## Further reading

- [Caching strategies](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html), Amazon ElastiCache docs
- [Announcing Amazon ElastiCache for Valkey](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-elasticache-valkey), AWS, October 2024
- [Engine versions and upgrading in ElastiCache](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html), Amazon ElastiCache docs
- [`SET` command](https://valkey.io/commands/set/) and [`DELIFEQ` command](https://valkey.io/commands/delifeq/), Valkey docs
- [Optimal Probabilistic Cache Stampede Prevention](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf), Vattani, Chierichetti and Lowenstein, PVLDB vol. 8, 2015
- [RFC 5861: HTTP Cache-Control Extensions for Stale Content](https://www.rfc-editor.org/rfc/rfc5861)
- [ioredis](https://github.com/redis/ioredis) and [node-postgres transactions](https://node-postgres.com/features/transactions)
